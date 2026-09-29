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
//   ★ **无到件计时**（用户定 2026-09-29）：寻路可行即去造——**不做途中计时/拉黑/区冷却**；
//   ★ **补队（用户定）**：**分区里的工兵小队没了 → 补一支新小队**（在该分区锚点集中投放施工兵成队）；
//   小队经 SquadManager 及时汇报，引擎不微操队员。
//
// ★★ 收回机制铁律（《RTS架构.md》§0.1）★★
//   工兵被卡死收回 = **一定出了问题**（站桩/无件可派/到不了件/施工不推进）——修派件与行动，不给豁免。
// ★★ 禁私自补丁铁律（《RTS架构.md》§0.2）★★
// ============================================================

import { RoleManager, type RoleCtx } from './RoleManager';
import { THREAT_NEAR } from '../CoverGeom';
import type { SquadManager } from './SquadManager';
import { BUILDER_SQUAD_MAX } from '../SquadTable';
import { FORTIFY_SECTORS } from '../FortifyPlanner';

/** 工兵策略参数（集中可调） */
export const ENGINEER_POLICY = {
  /** 到件半径（米）：队长到件以内才计时 */
  WORK_R: 3,
  /** ★ 掩体建造：工兵**当前位置向参照侧**多远放掩体（米；用户定 2026-09-29） */
  COVER_BUILD_HIDE: 1.6,
  /** ★ 掩体密度门（用户定 2026-09-29）：该半径内掩体 ≥ 上限 → 改挖战壕 */
  COVER_DENSITY_R: 12,
  COVER_DENSITY_MAX: 3,
  /** ★ 掩体施工时长（秒）= **真实建造时长**（用户定 2026-09-27：此前写死 6s，远超 0.6s 建造动画
   *  → 工兵"造得很快却站着"，净位移 <4m 被判官按卡死收）。单源 = COVER_DEPLOY_BUILD_TIME。 */
  COVER_TIME_S: 0.8,
  /** 战壕施工时长（秒） */
  TRENCH_TIME_S: 10,
  /** 战壕每遍挖掘间隔（秒；每遍 ≈0.2m） */
  DIG_EVERY_S: 2,
  /** 战壕最大遍数（≈1.0m；受坑底硬阈值封顶） */
  MAX_DIGS: 5,
  /** ★ 补兵节拍（秒/只）：每扇区缺员的投放间隔 */
  /** ★ 补队节拍（秒；事态驱动：越后越频繁；用户定 2026-09-26） */
  REPLENISH_SLOW_S: 10,
  REPLENISH_FAST_S: 2,
  /** ★ 工兵小队总配额（上限；不要太多兵；用户定 2026-09-26） */
  SQUAD_QUOTA: 3,
  /** ★ 分区无件空转超时（秒）→ 换区（用户定 2026-09-26） */
  ZONE_IDLE_S: 15,
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
    /** ★ 施工者位置（朝前方：优先比工兵靠舰的点；用户定 2026-09-27） */
    from?: { x: number; z: number },
  ): { x: number; z: number; score: number } | null;
  /** 此点还能再挖（坑底硬阈值未到） */
  canDig(x: number, z: number): boolean;
  /** 造掩体（真源端口） */
  cover(x: number, z: number, variant: 'cover' | 'wall'): void;
  /** ★ §3.C 总攻掩护施工（用户定 2026-09-29）：引擎给的**动态建造点**（查询保护对象位置得出）；
   *  null = 非保护状态（走原查询机制） */
  wardSpot?(id: number): { x: number; z: number } | null;
  /** ★ 掩护掩体落成回执（引擎据此抑制同点重复产点，直到保护对象移动） */
  wardCoverDone?(id: number, x: number, z: number): void;
  /** ★ 玩家位（近旁时建造朝向玩家侧） */
  playerOf?(): { x: number; z: number } | null;
  /** ★ 附近已建工事数（密度门；单一建造账本，用户定 2026-09-29） */
  coversNear?(x: number, z: number, r: number): number;

  /** 挖战壕一遍（≈0.2m） */
  dig(x: number, z: number): void;
  /** 地形脏标记（评分/采样局部重算） */
  markDirty(x: number, z: number, r: number): void;
  /** ★ 补兵：在 (x,z) 附近请求生成施工兵；true = 已受理 */
  requestSpawn(role: 'builder', x: number, z: number): boolean;
  /** ★ 事态进度 0~1（补队节拍驱动；可选：未接 = 0） */
  posture?(): number;
  /** ★ 主攻扇区（优先投工兵；可选：未接 = 全区） */
  mainSectors?(): readonly number[];
  /** ★ 预热门：8 区任务数据全扫描完成后才建/派（可选；未接 = 已就绪） */
  sectorsScanned?(): boolean;
}

const keyOf = (x: number, z: number): string => `${x},${z}`;
const TAU = Math.PI * 2;
const secOfAngle = (ang: number): number => Math.floor((ang / TAU) * FORTIFY_SECTORS) % FORTIFY_SECTORS;

export class EngineerManager extends RoleManager {
  /** 各队当前施工点（件；含发放时刻） */
  private readonly spots = new Map<number, { x: number; z: number; score: number; at: number }>();
  /** ★ 件预约表（全局唯一：格点 → 队；防多队同点） */
  private readonly reserved = new Map<string, number>();
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
  /** ★ 空转起始时刻（无件持续超时 → 换区；用户定 2026-09-26） */
  private readonly noSpotSince = new Map<number, number>();
  /** ★ 分区“有活”记忆（滞回 15s；防数据回刷/带漂移导致建队抖动） */
  private readonly zoneWorkUntil = new Map<number, number>();
  /** ★ 投放在途宽限期（分区 → 时刻）：**投放后短期不重复投**（防同区连拍堆队） */
  private readonly zoneSpawnGrace = new Map<number, number>();
  private readonly zoneTaken = new Set<number>();
  private zoneCursor = 0;
  /** 施工探针（G9） */
  readonly fortDbg = { spots: 0, working: 0, idle: 0, built: 0, maxWork: 0, spawned: 0, last: '' };
  /** ★ 按队完工计数（探针：验证“每队真的开工”） */
  readonly builtBy = new Map<number, number>();

  constructor(
    mgr: SquadManager,
    /** 端口取用（接线层注入；未接线/自检 → null：保持站位） */
    private readonly portOf: () => EngineerPort | null = () => null,
  ) {
    super('engineer', mgr);
  }

  /** 工兵目标分配 + 施工推进：认区（大队管理器）→ 取件（预约制）→ 复检 → 施工/补兵 */
  /** ★ 参照点（用户定 2026-09-29）：玩家进到 THREAT_NEAR 内 → 玩家；否则舰 */
  private buildRef(port: EngineerPort, s: { x: number; z: number }): { x: number; z: number } | null {
    const pl = port.playerOf?.() ?? null;
    if (pl && Math.hypot(pl.x - s.x, pl.z - s.z) <= THREAT_NEAR) return pl;
    return port.ship();
  }

  /** ★ 建造位置（用户定 2026-09-29）：**工兵当前位置向参照侧 1.6m**（与掩体点无关；
   *  掩体点只是行军目标）。参照=舰；玩家 20m 内 → 玩家。 */
  private coverSpot(port: EngineerPort, s: { x: number; z: number }): { x: number; z: number } {
    const ref = this.buildRef(port, s);
    if (!ref) return { x: s.x, z: s.z };
    const dx = ref.x - s.x, dz = ref.z - s.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return { x: s.x, z: s.z };
    return { x: s.x + (dx / d) * ENGINEER_POLICY.COVER_BUILD_HIDE, z: s.z + (dz / d) * ENGINEER_POLICY.COVER_BUILD_HIDE };
  }

  /** ★ 建造 = 独立机制（用户定 2026-09-29；类似开火）：**位置来源（查询/保护对象）与本机制解耦**——
   *  到 WORK_R 就计时（不驱动移动）；掩体 `COVER_TIME_S` / 战壕 `TRENCH_TIME_S`（每 2s 一遍 ×5）。
   *  返回 'done' = 本次件落成（由调用方做"预约释放/落成回执"等位置侧记账）。 */
  private buildAt(
    port: EngineerPort, id: number, s: { x: number; z: number },
    spot: { x: number; z: number }, kind: 'cover' | 'trench', dt: number,
  ): 'working' | 'done' {
    // ★ 建造**不做达标检测**（用户定 2026-09-29）：99% 情况可造，检测会把工兵卡死；
    //   达标由**选点侧**负责（常规=查询；保护态=引擎按保护对象位置给点）。
    if (Math.hypot(s.x - spot.x, s.z - spot.z) > ENGINEER_POLICY.WORK_R) return 'working';
    const t = (this.work.get(id) ?? 0) + dt;
    this.work.set(id, t);
    this.fortDbg.maxWork = Math.max(this.fortDbg.maxWork, t);
    if (kind === 'cover') {
      if (t < ENGINEER_POLICY.COVER_TIME_S) return 'working';
      // ★ 落位（用户定 2026-09-29）：**当前位置向参照侧 1.6m**
      const bp = this.coverSpot(port, s);
      port.cover(bp.x, bp.z, 'cover');
      port.markDirty(bp.x, bp.z, 12);
      this.built.add(keyOf(bp.x, bp.z));
      this.builtOnce.add(id);
      this.builtBy.set(id, (this.builtBy.get(id) ?? 0) + 1);
      this.work.delete(id); this.digs.delete(id);
      return 'done';
    }
    const canDig = port.canDig(spot.x, spot.z);
    let digs = this.digs.get(id) ?? 0;
    const want = Math.min(ENGINEER_POLICY.MAX_DIGS, Math.floor(t / ENGINEER_POLICY.DIG_EVERY_S));
    const ship = port.ship();
    while (canDig && digs < want) {
      // ★ 坑洞朝前（用户定 2026-09-27）：第 2 道起沿**舰方向**每次 2m（壕沟向舰延伸）
      let dx = spot.x, dz = spot.z;
      if (digs > 0) {
        const ux = ship.x - spot.x, uz = ship.z - spot.z;
        const L = Math.hypot(ux, uz) || 1;
        const fx = spot.x + (ux / L) * digs * 2;
        const fz = spot.z + (uz / L) * digs * 2;
        if (port.canDig(fx, fz)) { dx = fx; dz = fz; }
      }
      port.dig(dx, dz);
      port.markDirty(dx, dz, 16);
      digs++;
    }
    this.digs.set(id, digs);
    if (!canDig || t >= ENGINEER_POLICY.TRENCH_TIME_S || digs >= ENGINEER_POLICY.MAX_DIGS) {
      this.built.add(keyOf(spot.x, spot.z));
      this.builtOnce.add(id);
      this.builtBy.set(id, (this.builtBy.get(id) ?? 0) + 1);
      this.work.delete(id); this.digs.delete(id);
      return 'done';
    }
    return 'working';
  }

  /** ★ 施工任务调度（活源）：**位置只告知** → 队长寻路过去 → **建造独立机制**（buildAt）。
   * 非保护态=原查询；保护态=引擎给保护对象前部点。 */
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
    // ★ 只认**活队**（alive>0）：阵亡队不占分区/不计配额（用户定 2026-09-26）
    const ids2 = ids.filter((id) => port.aliveOfSquad(id) > 0);
    const alive = new Set(ids2);
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
    let working = 0, idle = 0;
    // ★ 补兵统计：按部署扇区累计工兵存活
    // ★ 预热门（用户定 2026-09-26）：8 区数据未扫完 → 不建不派（先站位，避早期误建队）
    const ready = port.sectorsScanned ? port.sectorsScanned() : true;
    // ★ 稳定“有活区”（滞回 15s）：**分配与创建共用同一份名单**
    for (let s = 0; s < FORTIFY_SECTORS; s++) {
      if (port.pickSpot(s, band.rLo, band.rHi, () => true) !== null) {
        this.zoneWorkUntil.set(s, now + 15);
      }
    }
    const workZonesNow: number[] = [];
    for (let s = 0; s < FORTIFY_SECTORS; s++) if ((this.zoneWorkUntil.get(s) ?? 0) > now) workZonesNow.push(s);
    // ★ 分区分配（用户定）：每支工兵小队一个**独立分区**（不重合）；队灭 → 释放分区
    for (const [id, sec] of [...this.zoneOf]) {
      if (alive.has(id)) continue;
      this.zoneOf.delete(id);
      this.zoneTaken.delete(sec);
    }
    // ★ 空转超时换区：无件持续 `ZONE_IDLE_S` → 释放本区（下一步重分配）
    for (const id of ids2) {
      const sec = this.zoneOf.get(id);
      if (sec === undefined) continue;
      if (this.spots.has(id)) { this.noSpotSince.delete(id); continue; }
      const since = this.noSpotSince.get(id) ?? now;
      this.noSpotSince.set(id, since);
      if (now - since >= ENGINEER_POLICY.ZONE_IDLE_S) {
        this.zoneOf.delete(id);
        this.zoneTaken.delete(sec);
        this.noSpotSince.delete(id);
        this.fortDbg.last = `分区${sec} 无件空转 → 换区`;
      }
    }
    for (const id of ids2) {
      if (this.zoneOf.has(id)) continue;
      let sec = -1;
      // ★ 只分**稳定有活区**（与创建同一份名单；预热未完成 → 不分）
      if (ready) {
        for (let i = 0; i < workZonesNow.length && sec < 0; i++) {
          const c = (workZonesNow[(this.zoneCursor + i) % workZonesNow.length] as number);
          if (this.zoneTaken.has(c)) continue;
          sec = c;
        }
      }
      // ★ 无活的空区**不分**（用户定 2026-09-26：不占无活区 → 不发呆）；等下一拍有活再分
      if (sec < 0) continue;
      this.zoneOf.set(id, sec);
      this.zoneTaken.add(sec);
      this.zoneCursor = (sec + 1) % FORTIFY_SECTORS;
    }
    // 分区状态：存活人数 / 队数 / 锚点
    const secAlive = new Map<number, number>();
    const secSquads = new Map<number, number>();
    const secAnchor = new Map<number, { x: number; z: number }>();
    for (const id of ids2) {
      const sec = this.zoneOf.get(id) ?? -1;
      if (sec < 0) continue;
      secAlive.set(sec, (secAlive.get(sec) ?? 0) + port.aliveOfSquad(id));
      secSquads.set(sec, (secSquads.get(sec) ?? 0) + 1);
      const s = ctx.pos.squad(id);
      if (s && !secAnchor.has(sec)) secAnchor.set(sec, { x: s.x, z: s.z });
    }
    for (const id of ids2) {
      const s = ctx.pos.squad(id);
      if (!s) continue;
      const sec = this.zoneOf.get(id) ?? -1;
      let spot = this.spots.get(id);
      // ★★ 保护状态（总攻掩护施工；用户定 2026-09-29）：建造点 = 引擎查询保护对象位置得出；
      //    施工**独立像开火**（到范围就计时），不走预约/黑名单/原查询。
      const ws = port.assault?.() && port.wardSpot ? port.wardSpot(id) : null;
      if (ws) {
        spot = { x: ws.x, z: ws.z, score: 0, at: spot?.at ?? now };
        this.spots.set(id, spot);
        if (this.buildAt(port, id, s, ws, 'cover', dt) === 'done') {
          port.wardCoverDone?.(id, ws.x, ws.z);
          this.spots.delete(id);
          this.dbg.last = `#${id} 掩护掩体成 @${ws.x | 0},${ws.z | 0}`;
        }
        this.targets.set(id, { x: ws.x, z: ws.z });   // 只告知掩体点；站位/朝向归队长
        working++;
        continue;
      }
      // ---- 每拍复检（件必须仍合法；用户定 2026-09-26） ----
      if (spot) {
        const k = keyOf(spot.x, spot.z);
        let ang = Math.atan2(spot.z - ship.z, spot.x - ship.x);
        if (ang < 0) ang += TAU;
        const inSec = sec >= 0 && secOfAngle(ang) === sec;
        const arrived = Math.hypot(s.x - spot.x, s.z - spot.z) <= ENGINEER_POLICY.WORK_R;
        // ★ 复检：建成 / need 无效 / 出本区 / 不可达 → 换件（**不再因“出带”判死**：分到区就去造）
        const bad = this.built.has(k) || port.needAt(spot.x, spot.z) === null
          || !inSec || !port.canReach(id, spot.x, spot.z);
        void arrived;
        if (bad) {
          this.releaseFor(id); this.spots.delete(id); this.work.delete(id); this.digs.delete(id);
          spot = undefined;
        }
      }
      // ---- 取件（建造位置查询；预约制 + 黑名单过滤） ----
      if (!spot && sec >= 0) {
        const exclude = (x: number, z: number): boolean => {
          const k = keyOf(x, z);
          return this.built.has(k) || this.reserved.has(k);   // ★ 无拉黑（用户定 2026-09-29：寻路可行即去造）
        };
        const canReach = (x: number, z: number): boolean => port.canReach(id, x, z);
        // ★ noNewBuild（事态 0.45 后停新增）只约束**常规带**；扩带兜底不受限（用户定 2026-09-27：
        //   "没件就往舰船方向继续造，或者往防区外造"——工兵不许持令站桩发呆被判官收）。
        const canNew = !port.noNewBuild() || !this.builtOnce.has(id);
        let pick = canNew ? port.pickSpot(sec, band.rLo, band.rHi, canReach, exclude, { x: s.x, z: s.z }) : null;
        if (!pick) {
          const tryBand = (lo: number, hi: number): { x: number; z: number; score: number } | null => {
            if (hi - lo < 6) return null;
            port.refreshSector?.(s.x, s.z, lo, hi);
            return port.pickSpot(sec, lo, hi, canReach, exclude, { x: s.x, z: s.z });
          };
          pick = tryBand(Math.max(10, band.rLo - 24), band.rLo)
            ?? tryBand(band.rHi, band.rHi + 36);
        }
        if (pick) {
          spot = { x: pick.x, z: pick.z, score: pick.score, at: now };   // 掩体点=纯行军目标
          this.spots.set(id, spot);
          this.reserved.set(keyOf(spot.x, spot.z), id);   // ★ 预约（全局唯一）
          this.work.delete(id); this.digs.delete(id);
        }
      }
      if (!spot) {
        // 未部署 / 无件可派（第一波后/无合法点）：保持站位
        this.targets.set(id, { x: s.x, z: s.z });
        idle++;
        continue;
      }
      // ---- 施工：统一独立机制（位置来源=查询/保护对象；本机制只负责"到范围计时"） ----
      {
        // ★ 选型（用户定 2026-09-26/29）：总攻全掩体；**区域掩体密度≥上限 → 改挖战壕**；
        //   其余维持 4 件里 3 掩体 / 1 战壕。
        const dense = (port.coversNear?.(spot.x, spot.z, ENGINEER_POLICY.COVER_DENSITY_R) ?? 0) >= ENGINEER_POLICY.COVER_DENSITY_MAX;
        const kind: 'cover' | 'trench' = port.assault() ? 'cover'
          : dense ? 'trench'
          : (this.built.size % 4) !== 3 ? 'cover' : 'trench';
        if (this.buildAt(port, id, s, spot, kind, dt) === 'done') {
          this.releaseFor(id); this.spots.delete(id);
          this.dbg.last = kind === 'cover'
            ? `#${id} 掩体成 @${spot.x | 0},${spot.z | 0}`
            : `#${id} 战壕成 @${spot.x | 0},${spot.z | 0}`;
        }
        working++;
      }
      this.targets.set(id, { x: spot.x, z: spot.z });   // 只告知掩体点；站位/朝向归队长（build 任务）
    }
    // ---- ★ 补队（用户定 2026-09-26）：**检查全部 8 个防区——有队就不放，没有就放** ----
    const posture = Math.max(0, Math.min(1, port.posture ? port.posture() : 0));
    const every = ENGINEER_POLICY.REPLENISH_SLOW_S + (ENGINEER_POLICY.REPLENISH_FAST_S - ENGINEER_POLICY.REPLENISH_SLOW_S) * posture;
    let totalSquads = ids2.length;
    const prefer = port.mainSectors ? [...port.mainSectors()] : [];
    const zoneOrder: number[] = [];
    for (const s of prefer) if (s >= 0 && s < FORTIFY_SECTORS && !zoneOrder.includes(s)) zoneOrder.push(s);
    for (let s = 0; s < FORTIFY_SECTORS; s++) if (!zoneOrder.includes(s)) zoneOrder.push(s);
    // ★ 预制配额（用户定 2026-09-26）：**稳定有活区数 ∩ 上限**；
    //   只给有活分区建队，绝不建会发呆的队（进图即建 = 缺了即补）。
    // ★ 逐区检查**仍需建造的空防区**（含被注销队留下的；用户定 2026-09-26）：
    //   有活 ∧ 无活队 ∧ 非在途 ∧ 非坏区 → 补/建（受配额）。
    const workZones = ready ? zoneOrder.filter((sec) => workZonesNow.includes(sec)) : [];
    const quota = Math.min(ENGINEER_POLICY.SQUAD_QUOTA, workZones.length);
    // ★ 占用计数（用户定 2026-09-26）：合法队 + **在途投放区**（防新队未注册时超配额造队）
    for (const sec of workZones) if ((this.zoneSpawnGrace.get(sec) ?? 0) > now) totalSquads++;
    for (const sec of workZones) {
      if (totalSquads >= quota) break;
      const squadsHere = secSquads.get(sec) ?? 0;
      const aliveHere = secAlive.get(sec) ?? 0;
      // ★ 统一编制机制（用户定 2026-09-26）：**进图即建 = 缺了即补（同一条路）**——
      //   有队就不放；受预制配额（有活区数∩上限）控制；班底/大队不再产工兵（互不挤占）。
      if (squadsHere > 0 && aliveHere > 0) continue;          // 有队 → 不放
      if ((this.zoneSpawnGrace.get(sec) ?? 0) > now) continue; // 刚投过（在途）→ 不重复投
      const next = this.spawnAt.get(sec) ?? 0;
      if (next > now) continue;
      this.spawnAt.set(sec, now + every);
      // 锚点：在该区内（优先区内建造需求点，否则中环径中心点）
      let anchor = secAnchor.get(sec) ?? null;
      if (!anchor) {
        const pick = port.pickSpot(sec, band.rLo, band.rHi, () => true);
        if (pick) anchor = { x: pick.x, z: pick.z };
      }
      if (!anchor) {
        const mid = ((sec + 0.5) / FORTIFY_SECTORS) * TAU;
        const r = Math.max(4, (band.rLo + Math.min(band.rHi, band.rLo + 60)) / 2);
        const c = port.ship();
        anchor = { x: c.x + Math.cos(mid) * r, z: c.z + Math.sin(mid) * r };
      }
      let n = 0;
      for (let k = 0; k < BUILDER_SQUAD_MAX; k++) {
        if (!port.requestSpawn('builder', anchor.x + (k - 1) * 1.5, anchor.z)) break;
        n++;
      }
      if (n > 0) {
        this.fortDbg.spawned += n;
        this.fortDbg.last = `分区${sec} 补新小队（${n} 只）`;
        totalSquads++;
        this.zoneSpawnGrace.set(sec, now + 25);   // ★ 在途宽限（队一到就不再投；不到 25s 后重试）
      }
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
    this.work.clear();
    this.digs.clear();
    this.builtOnce.clear();
    this.built.clear();
    this.builtBy.clear();
    this.spawnAt.clear();
    this.zoneOf.clear();
    this.noSpotSince.clear();
    this.zoneWorkUntil.clear();
    this.zoneSpawnGrace.clear();
    this.zoneTaken.clear();
    this.zoneCursor = 0;
    this.lastNow = -1;
    this.fortDbg.spots = 0; this.fortDbg.working = 0; this.fortDbg.idle = 0; this.fortDbg.built = 0;
    this.fortDbg.maxWork = 0; this.fortDbg.spawned = 0;
  }
}
