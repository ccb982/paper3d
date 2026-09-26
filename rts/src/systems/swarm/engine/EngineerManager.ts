// ============================================================
// engine/EngineerManager —— 工兵管理器（重做 2026-09-26；用户定）
// ============================================================
// 工兵**由新引擎全权负责**（旧工事链已销毁）。
//
// ★★ 工兵流程（用户设计；唯一口径 2026-09-26 重做）★★
//   ① 分区（用户定 2026-09-26）：**每支工兵小队一个独立分区**（不同队不同区；队自己指挥自己，及时汇报）；
//   ② 取件：**建造位置查询**（扇区内 ∧ 带内 ∧ 需求最高 ∧ 可达 ∧ **未被预约/未建/未拉黑**）；
//   ③ 施工：队长到件 3m 内计时（掩体 6s / 战壕 10s，满即落地）；
//   ④ 续件：造完释放预约 → 立刻申请下一个；只要引擎不干预就一直造下去。
//   ★ **件预约制**：一件（格点）全局唯一（本管理器 `reserved`）——防多队同点/一区多队扎堆；
//   ★ **每拍复检**：件必须 ∈ 本队扇区 ∧ 带内 ∧ need 有效 ∧ 可达；不过 → 释放重取；
//   ★ **到件看门狗**：发件后 `ARRIVE_TIMEOUT_S` 未进 WORK_R → 拉黑该点（BLACK_TTL_S）换点（`fortDbg.unreach`）；
//   ★ **补队（用户定）**：**分区里的工兵小队没了 → 补一支新小队**（在该分区锚点集中投放施工兵成队）；
//   小队经 SquadManager 及时汇报，引擎不微操队员。
//
// ★★ 收回机制铁律（《RTS架构.md》§0.1）★★
//   工兵被卡死收回 = **一定出了问题**（站桩/无件可派/到不了件/施工不推进）——修派件与行动，不给豁免。
// ★★ 禁私自补丁铁律（《RTS架构.md》§0.2）★★
// ============================================================

import { RoleManager, type RoleCtx } from './RoleManager';
import type { SquadManager } from './SquadManager';
import { BUILDER_SQUAD_MAX } from '../SquadTable';
import { FORTIFY_SECTORS } from '../FortifyPlanner';

/** 工兵策略参数（集中可调） */
export const ENGINEER_POLICY = {
  /** 每扇区工兵小队数（补兵目标；按小队满编计） */
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
  /** ★ 到件看门狗（秒）：发件后超时未到 → 判不可达，拉黑换点 */
  ARRIVE_TIMEOUT_S: 25,
  /** ★ 拉黑时长（秒）：到期自动解禁 */
  BLACK_TTL_S: 60,
  /** ★ 补兵节拍（秒/只）：每扇区缺员的投放间隔 */
  REPLENISH_EVERY_S: 4,
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
  /** ★ 本队存活人数（补兵缺口用） */
  aliveOfSquad(id: number): number;
  /** 摊销刷新一个扇区（数据刷新；每拍 1 区 → 全区 ~4s 一轮） */
  refreshSector(cx: number, cz: number, rLo: number, rHi: number): void;
  /** 建造位置查询（危险点优先 → 扇区弧链可达点；`exclude` = 预约/已建/黑名单） */
  pickSpot(
    sec: number, rLo: number, rHi: number,
    canReach: (x: number, z: number) => boolean,
    exclude?: (x: number, z: number) => boolean,
  ): { x: number; z: number; score: number } | null;
  /** 此点还能再挖（坑底硬阈值未到） */
  canDig(x: number, z: number): boolean;
  /** 造掩体（真源端口） */
  cover(x: number, z: number, variant: 'cover' | 'wall'): void;
  /** 挖战壕一遍（≈0.2m） */
  dig(x: number, z: number): void;
  /** 地形脏标记（评分/采样局部重算） */
  markDirty(x: number, z: number, r: number): void;
  /** ★ 补兵：在 (x,z) 附近请求生成施工兵；true = 已受理 */
  requestSpawn(role: 'builder', x: number, z: number): boolean;
}

const keyOf = (x: number, z: number): string => `${x},${z}`;
const TAU = Math.PI * 2;
const secOfAngle = (ang: number): number => Math.floor((ang / TAU) * FORTIFY_SECTORS) % FORTIFY_SECTORS;

export class EngineerManager extends RoleManager {
  /** 各队当前施工点（件；含发放时刻） */
  private readonly spots = new Map<number, { x: number; z: number; score: number; at: number }>();
  /** ★ 件预约表（全局唯一：格点 → 队；防多队同点） */
  private readonly reserved = new Map<string, number>();
  /** ★ 到件黑名单（格点 → 解禁时刻；到不了的件短期不再派） */
  private readonly black = new Map<string, number>();
  /** 各队施工计时（秒） */
  private readonly work = new Map<number, number>();
  /** 各队战壕已挖遍数 */
  private readonly digs = new Map<number, number>();
  /** 已完成过一件的队（首件豁免"第一波后停新增"） */
  private readonly builtOnce = new Set<number>();
  /** 已建件（key = "x,z"） */
  private readonly built = new Set<string>();
  private lastNow = -1;
  /** ★ 补队节拍（分区 → 下次可投放时刻） */
  private readonly spawnAt = new Map<number, number>();
  /** ★ 分区分配（队 → 分区；一队一区、不重合） */
  private readonly zoneOf = new Map<number, number>();
  private readonly zoneTaken = new Set<number>();
  private zoneCursor = 0;
  /** 施工探针（G9） */
  readonly fortDbg = { spots: 0, working: 0, idle: 0, built: 0, maxWork: 0, unreach: 0, spawned: 0, last: '' };

  constructor(
    mgr: SquadManager,
    /** 端口取用（接线层注入；未接线/自检 → null：保持站位） */
    private readonly portOf: () => EngineerPort | null = () => null,
  ) {
    super('engineer', mgr);
  }

  /** 工兵目标分配 + 施工推进：认区（大队管理器）→ 取件（预约制）→ 复检 → 施工/补兵 */
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
    const now = ctx.now;
    const dt = this.lastNow >= 0 ? Math.max(0, Math.min(1, now - this.lastNow)) : 0;
    this.lastNow = now;
    // 阵亡/离场释放
    const alive = new Set(ids);
    for (const id of [...this.spots.keys()]) {
      if (alive.has(id)) continue;
      this.releaseFor(id);
      this.spots.delete(id); this.work.delete(id); this.digs.delete(id);
    }
    // 需求数据摊销刷新（引擎驱动数据；认区已交大队管理器）
    const band = port.band();
    const ship = port.ship();
    port.refreshSector(ship.x, ship.z, band.rLo, band.rHi);
    // 黑名单过期清理
    for (const [k, t] of [...this.black]) if (t <= now) this.black.delete(k);
    let working = 0, idle = 0;
    // ★ 补兵统计：按部署扇区累计工兵存活
    // ★ 分区分配（用户定）：每支工兵小队一个**独立分区**（不重合）；队灭 → 释放分区
    for (const [id, sec] of [...this.zoneOf]) {
      if (alive.has(id)) continue;
      this.zoneOf.delete(id);
      this.zoneTaken.delete(sec);
    }
    for (const id of ids) {
      if (this.zoneOf.has(id)) continue;
      let sec = -1;
      for (let i = 0; i < FORTIFY_SECTORS; i++) {
        const c = (this.zoneCursor + i) % FORTIFY_SECTORS;
        if (!this.zoneTaken.has(c)) { sec = c; break; }
      }
      if (sec < 0) sec = this.zoneCursor % FORTIFY_SECTORS;
      this.zoneOf.set(id, sec);
      this.zoneTaken.add(sec);
      this.zoneCursor = (sec + 1) % FORTIFY_SECTORS;
    }
    // 分区状态：存活人数 / 队数 / 锚点
    const secAlive = new Map<number, number>();
    const secSquads = new Map<number, number>();
    const secAnchor = new Map<number, { x: number; z: number }>();
    for (const id of ids) {
      const sec = this.zoneOf.get(id) ?? -1;
      if (sec < 0) continue;
      secAlive.set(sec, (secAlive.get(sec) ?? 0) + port.aliveOfSquad(id));
      secSquads.set(sec, (secSquads.get(sec) ?? 0) + 1);
      const s = ctx.pos.squad(id);
      if (s && !secAnchor.has(sec)) secAnchor.set(sec, { x: s.x, z: s.z });
    }
    for (const id of ids) {
      const s = ctx.pos.squad(id);
      if (!s) continue;
      const sec = this.zoneOf.get(id) ?? -1;
      let spot = this.spots.get(id);
      // ---- 每拍复检（件必须仍合法；用户定 2026-09-26） ----
      if (spot) {
        const k = keyOf(spot.x, spot.z);
        const d = Math.hypot(spot.x - ship.x, spot.z - ship.z);
        let ang = Math.atan2(spot.z - ship.z, spot.x - ship.x);
        if (ang < 0) ang += TAU;
        const inSec = sec >= 0 && secOfAngle(ang) === sec;
        const arrived = Math.hypot(s.x - spot.x, s.z - spot.z) <= ENGINEER_POLICY.WORK_R;
        const timedOut = !arrived && now - spot.at > ENGINEER_POLICY.ARRIVE_TIMEOUT_S;
        const bad = this.built.has(k) || port.needAt(spot.x, spot.z) === null
          || d < band.rLo - 1 || d > band.rHi + 1 || !inSec || !port.canReach(id, spot.x, spot.z);
        if (timedOut) {
          // ★ 到件看门狗：到不了 → 拉黑 + 换点
          this.black.set(k, now + ENGINEER_POLICY.BLACK_TTL_S);
          this.fortDbg.unreach++;
          this.fortDbg.last = `#${id} 到不了件 @${spot.x | 0},${spot.z | 0} → 拉黑换点`;
          this.releaseFor(id); this.spots.delete(id); this.work.delete(id); this.digs.delete(id);
          spot = undefined;
        } else if (bad) {
          this.releaseFor(id); this.spots.delete(id); this.work.delete(id); this.digs.delete(id);
          spot = undefined;
        }
      }
      // ---- 取件（建造位置查询；预约制 + 黑名单过滤） ----
      if (!spot && sec >= 0 && (!port.noNewBuild() || !this.builtOnce.has(id))) {
        const pick = port.pickSpot(sec, band.rLo, band.rHi, (x, z) => port.canReach(id, x, z),
          (x, z) => {
            const k = keyOf(x, z);
            return this.built.has(k) || this.reserved.has(k) || (this.black.get(k) ?? 0) > now;
          });
        if (pick) {
          const d = Math.hypot(pick.x - ship.x, pick.z - ship.z);
          if (d >= band.rLo - 1 && d <= band.rHi + 1) {
            spot = { x: pick.x, z: pick.z, score: pick.score, at: now };
            this.spots.set(id, spot);
            this.reserved.set(keyOf(spot.x, spot.z), id);   // ★ 预约（全局唯一）
            this.work.delete(id); this.digs.delete(id);
          }
        }
      }
      if (!spot) {
        // 未部署 / 无件可派（第一波后/无合法点）：保持站位
        this.targets.set(id, { x: s.x, z: s.z });
        idle++;
        continue;
      }
      // ---- 施工：队长到件 3m 内才计时；掩体 6s / 战壕 10s（每 2s 挖一遍） ----
      if (Math.hypot(s.x - spot.x, s.z - spot.z) <= ENGINEER_POLICY.WORK_R) {
        const kind: 'cover' | 'trench' = port.assault() ? 'cover' : 'trench';
        const t = (this.work.get(id) ?? 0) + dt;
        this.work.set(id, t);
        this.fortDbg.maxWork = Math.max(this.fortDbg.maxWork, t);
        if (kind === 'cover') {
          if (t >= ENGINEER_POLICY.COVER_TIME_S) {
            port.cover(spot.x, spot.z, 'cover');
            port.markDirty(spot.x, spot.z, 12);
            this.built.add(keyOf(spot.x, spot.z));
            this.builtOnce.add(id);
            this.releaseFor(id); this.spots.delete(id); this.work.delete(id); this.digs.delete(id);
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
            this.built.add(keyOf(spot.x, spot.z));
            this.builtOnce.add(id);
            this.releaseFor(id); this.spots.delete(id); this.work.delete(id); this.digs.delete(id);
            this.dbg.last = `#${id} 战壕成 @${spot.x | 0},${spot.z | 0}`;
          }
        }
        working++;
      }
      this.targets.set(id, { x: spot.x, z: spot.z });
    }
    // ---- ★ 补队（用户定 2026-09-26）：**分区里的工兵小队没了 → 补一支新小队**（投放 3 只成队） ----
    for (let sec = 0; sec < FORTIFY_SECTORS; sec++) {
      const squadsHere = secSquads.get(sec) ?? 0;
      const aliveHere = secAlive.get(sec) ?? 0;
      if (squadsHere > 0 && aliveHere > 0) continue;          // 分区有活队 → 不补
      if (squadsHere === 0 && !this.zoneTaken.has(sec)) continue;   // 从未占用 → 开局不铺
      const next = this.spawnAt.get(sec) ?? 0;
      if (next > now) continue;
      this.spawnAt.set(sec, now + ENGINEER_POLICY.REPLENISH_EVERY_S);
      const anchor = secAnchor.get(sec) ?? ship;
      let n = 0;
      for (let k = 0; k < BUILDER_SQUAD_MAX; k++) {
        if (!port.requestSpawn('builder', anchor.x + (k - 1) * 1.5, anchor.z)) break;
        n++;
      }
      if (n > 0) { this.fortDbg.spawned += n; this.fortDbg.last = `分区${sec} 补新小队（${n} 只）`; }
    }
    this.dbg.assigned = this.targets.size;
    this.fortDbg.spots = this.spots.size;
    this.fortDbg.working = working;
    this.fortDbg.idle = idle;
    this.fortDbg.built = this.built.size;
    return this.targets.size;
  }

  /** 释放某队持有的预约件 */
  private releaseFor(id: number): void {
    const spot = this.spots.get(id);
    if (!spot) return;
    const k = keyOf(spot.x, spot.z);
    if (this.reserved.get(k) === id) this.reserved.delete(k);
  }

  override clear(): void {
    super.clear();
    this.spots.clear();
    this.reserved.clear();
    this.black.clear();
    this.work.clear();
    this.digs.clear();
    this.builtOnce.clear();
    this.built.clear();
    this.spawnAt.clear();
    this.zoneOf.clear();
    this.zoneTaken.clear();
    this.zoneCursor = 0;
    this.lastNow = -1;
    this.fortDbg.spots = 0; this.fortDbg.working = 0; this.fortDbg.idle = 0; this.fortDbg.built = 0;
    this.fortDbg.maxWork = 0; this.fortDbg.unreach = 0; this.fortDbg.spawned = 0;
  }
}
