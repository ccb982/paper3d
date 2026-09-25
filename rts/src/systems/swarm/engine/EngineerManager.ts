// ============================================================
// engine/EngineerManager —— 工兵管理器（重写 P4；用户定 2026-09-25）
// ============================================================
// 工兵**由新引擎全权负责**（旧工事链已销毁）：
//   · 派件：建造位置查询函数（危险点优先 → 扇区弧链随机可达点）——数据经端口单源取
//   · 发令：目标点交 OrderWriter 统一发令（本管理器不直接写令）
//   · 施工：队长到件 3m 内计时（掩体 6s / 战壕 10s），满即落地（端口 = 真源）
//   · 分区认领/需求刷新：借端口（planner 数据）摊销驱动
// 位置只从 Positions 单源取；不加入攻击队列（由接线层保证）；不越权管其他兵种。
// ============================================================

import { RoleManager, type RoleCtx } from './RoleManager';
import type { SquadManager } from './SquadManager';

/** 工兵策略参数（集中可调） */
export const ENGINEER_POLICY = {
  /** 每防区工兵小队数（引擎按需调 requestSpawn） */
  PER_SECTOR: 1,
  /** 到件半径（米）：队长到件以内才计时 */
  WORK_R: 3,
  /** 掩体施工时长（秒） */
  COVER_TIME_S: 6,
  /** 战壕施工时长（秒） */
  TRENCH_TIME_S: 10,
  /** 战壕每遍挖掘间隔（秒；每遍 ≈0.2m） */
  DIG_EVERY_S: 2,
  /** 战壕最大遍数（≈1.0m；受坑底硬阈值封顶） */
  MAX_DIGS: 5,
} as const;

/** 建造位置查询 / 施工落地端口（由接线层注入；工兵管理器只消费数据） */
export interface EngineerPort {
  /** 环形施工带 [rLo, rHi]（事态函数口径；含前推棘轮） */
  band(): { rLo: number; rHi: number };
  /** 环心（舰船） */
  ship(): { x: number; z: number };
  /** 该点要塞需求（null = 不可用/不可站） */
  needAt(x: number, z: number): number | null;
  /** 从该队队长位直达可达 */
  canReach(id: number, x: number, z: number): boolean;
  /** 总攻（战壕暂停；只修掩体） */
  assault(): boolean;
  /** 第一波后停止新增施工 */
  noNewBuild(): boolean;
  /** 需求达标线（need < 此值 = 该区已够工事） */
  doneScore(): number;
  /** 该队认领的扇区（-1 = 未认领） */
  sectorOf(id: number): number;
  /** 部署分区认领（planner.assign；一队一区） */
  assignClaims(ids: readonly number[]): void;
  /** 摊销刷新一个扇区（数据刷新；每拍 1 区 → 全区 ~4s 一轮） */
  refreshSector(cx: number, cz: number, rLo: number, rHi: number): void;
  /** 建造位置查询（危险点优先 → 扇区弧链随机可达点） */
  pickSpot(
    sec: number, rLo: number, rHi: number,
    canReach: (x: number, z: number) => boolean,
  ): { x: number; z: number; score: number } | null;
  /** 此点还能再挖（坑底硬阈值未到） */
  canDig(x: number, z: number): boolean;
  /** 造掩体（真源端口） */
  cover(x: number, z: number, variant: 'cover' | 'wall'): void;
  /** 挖战壕一遍（≈0.2m） */
  dig(x: number, z: number): void;
  /** 地形脏标记（评分/采样局部重算） */
  markDirty(x: number, z: number, r: number): void;
}

const keyOf = (p: { x: number; z: number }): string => `${p.x},${p.z}`;

export class EngineerManager extends RoleManager {
  /** 各队当前施工点（件） */
  private readonly spots = new Map<number, { x: number; z: number }>();
  /** 各队施工计时（秒） */
  private readonly work = new Map<number, number>();
  /** 各队战壕已挖遍数 */
  private readonly digs = new Map<number, number>();
  /** 已完成过一件的队（首件豁免"第一波后停新增"——落地班底必派一件；之后停） */
  private readonly builtOnce = new Set<number>();
  /** 已建件（key = "x,z"） */
  private readonly built = new Set<string>();
  private lastNow = -1;
  /** 施工探针（G9） */
  readonly fortDbg = { spots: 0, working: 0, idle: 0, built: 0, maxWork: 0, last: '' };

  constructor(
    mgr: SquadManager,
    /** 端口取用（接线层注入；未接线/自检 → null：保持站位） */
    private readonly portOf: () => EngineerPort | null = () => null,
  ) {
    super('engineer', mgr);
  }

  /** 工兵目标分配 + 施工推进：派件（位置查询）→ 到件计时 → 落地 */
  assign(ctx: RoleCtx): number {
    const port = this.portOf();
    this.targets.clear();
    const ids = [...this.squads];
    // 未接线（自检/降级）：保持站位
    if (!port) {
      for (const id of ids) {
        const s = ctx.pos.squad(id);
        if (s) this.targets.set(id, { x: s.x, z: s.z });
      }
      this.dbg.assigned = this.targets.size;
      return this.targets.size;
    }
    const dt = this.lastNow >= 0 ? Math.max(0, Math.min(1, ctx.now - this.lastNow)) : 0;
    this.lastNow = ctx.now;
    // 阵亡释放
    const alive = new Set(ids);
    for (const id of [...this.spots.keys()]) {
      if (alive.has(id)) continue;
      this.spots.delete(id); this.work.delete(id); this.digs.delete(id);
    }
    // 分区认领 + 需求摊销刷新（引擎驱动数据）
    port.assignClaims(ids);
    const band = port.band();
    const ship = port.ship();
    port.refreshSector(ship.x, ship.z, band.rLo, band.rHi);
    let working = 0, idle = 0;
    for (const id of ids) {
      const s = ctx.pos.squad(id);
      if (!s) continue;
      let spot = this.spots.get(id);
      if (spot) {
        const k = keyOf(spot);
        const d = Math.hypot(spot.x - ship.x, spot.z - ship.z);
        // 已建成 / 地形不可用 / **出带（环收拢后件被夹环 → 人到不了）** → 丢弃重取
        if (this.built.has(k) || port.needAt(spot.x, spot.z) === null
          || d < band.rLo - 1 || d > band.rHi + 1) {
          this.spots.delete(id); this.work.delete(id); this.digs.delete(id);
          spot = undefined;
        }
      }
      if (!spot && (!port.noNewBuild() || !this.builtOnce.has(id))) {
        const sec = port.sectorOf(id);
        if (sec >= 0) {
          const pick = port.pickSpot(sec, band.rLo, band.rHi, (x, z) => port.canReach(id, x, z));
          // ★ 件必须落在施工带内（= 环 ∩ 施工带；环夹取会挪目标 → 到不了件）；带外宁可不派
          if (pick) {
            const d = Math.hypot(pick.x - ship.x, pick.z - ship.z);
            if (d >= band.rLo - 1 && d <= band.rHi + 1) {
              spot = { x: pick.x, z: pick.z };
              this.spots.set(id, spot);
              this.work.delete(id); this.digs.delete(id);
            }
          }
        }
      }
      if (!spot) {
        // 无件可派（第一波后/无合法点）：保持站位
        this.targets.set(id, { x: s.x, z: s.z });
        idle++;
        continue;
      }
      // ★ 施工：队长到件 3m 内才计时；掩体 6s / 战壕 10s（每 2s 挖一遍）
      if (Math.hypot(s.x - spot.x, s.z - spot.z) <= ENGINEER_POLICY.WORK_R) {
        const kind: 'cover' | 'trench' = port.assault() ? 'cover' : 'trench';
        const t = (this.work.get(id) ?? 0) + dt;
        this.work.set(id, t);
        this.fortDbg.maxWork = Math.max(this.fortDbg.maxWork, t);
        if (kind === 'cover') {
          if (t >= ENGINEER_POLICY.COVER_TIME_S) {
            port.cover(spot.x, spot.z, 'cover');
            port.markDirty(spot.x, spot.z, 12);
            this.built.add(keyOf(spot));
            this.builtOnce.add(id);
            this.spots.delete(id); this.work.delete(id); this.digs.delete(id);
            this.dbg.last = `#${id} 掩体成 @${spot.x | 0},${spot.z | 0}`;
          }
        } else {
          const canDig = port.canDig(spot.x, spot.z);
          let digs = this.digs.get(id) ?? 0;
          const want = Math.min(ENGINEER_POLICY.MAX_DIGS, Math.floor(t / ENGINEER_POLICY.DIG_EVERY_S));
          while (canDig && digs < want) {
            port.dig(spot.x, spot.z);
            port.markDirty(spot.x, spot.z, 16);
            digs++;
          }
          this.digs.set(id, digs);
          if (!canDig || t >= ENGINEER_POLICY.TRENCH_TIME_S || digs >= ENGINEER_POLICY.MAX_DIGS) {
            this.built.add(keyOf(spot));
            this.builtOnce.add(id);
            this.spots.delete(id); this.work.delete(id); this.digs.delete(id);
            this.dbg.last = `#${id} 战壕成 @${spot.x | 0},${spot.z | 0}`;
          }
        }
        working++;
      }
      this.targets.set(id, { x: spot.x, z: spot.z });
    }
    this.dbg.assigned = this.targets.size;
    this.fortDbg.spots = this.spots.size;
    this.fortDbg.working = working;
    this.fortDbg.idle = idle;
    this.fortDbg.built = this.built.size;
    return this.targets.size;
  }

  override clear(): void {
    super.clear();
    this.spots.clear();
    this.work.clear();
    this.digs.clear();
    this.builtOnce.clear();
    this.built.clear();
    this.lastNow = -1;
    this.fortDbg.spots = 0; this.fortDbg.working = 0; this.fortDbg.idle = 0; this.fortDbg.built = 0; this.fortDbg.maxWork = 0;
  }
}
