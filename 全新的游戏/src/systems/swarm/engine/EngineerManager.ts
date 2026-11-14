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
import type { UnitTactics } from './UnitScoring';
import { KIND, SLOPE_DIR, type TerrainSemantics } from '../TerrainSemantics';

/** 工兵策略参数（集中可调） */
export const ENGINEER_POLICY = {
  /** 到件半径（米）：队长到件以内才计时。
   *  ★ 2026-11-15 3 → 8：引擎 march 的到达判定就是 `HOLD_R = 8m`（走到 8m 内就停），
   *    原来要求 3m ⇒ 工兵永远差 5 米、`到位 0`、`t` 永不增长。
   *    取 8（= HOLD_R）：引擎认为"到了"的位置，施工机制也认，两边口径彻底对齐。 */
  WORK_R: 8,
  /** ★★ 掩体 : 战壕 的产出比（用户定 2026-11-15「压制一半掩体，多造战壕」）：
   *  每造 1 件掩体后连挖 N 件战壕，再回头造 1 件掩体。N=2 ⇒ 1:2。 */
  TRENCH_PER_COVER: 2,
  /** ★ 就近施工点候选距离（米）。**首项 0 = 就地**（用户定 2026-11-15「实在不行就地建也行」）：
   *  距离 0 ⇒ 不需要任何移动就开工；后续候选逐步外推让工兵自然往前走。 */
  NEAR_DIST: [0, 2.2, 4, 6],
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
  /** ★ 战壕线「就近」半径（米）：只挖队长 `WORK_R` 以内的线点（成线优先）；
   *  超出 ⇒ 就地挖（用户定 2026-11-15「战壕随处可建，实在不行就地建也行」）。
   *  ★ 30 → 6：线点常在一二十米外，工兵 march 停在 HOLD_R=8m 就走不到 ⇒ 一律就地。 */
  TRENCH_NEAR_R: 6,
  /** ★ 到不了就换件（秒）：取件后这么久还没进 WORK_R 且未开工 → 弃件重取。
   *  防「有件但永远走不到」把 4 支工兵全锁死（2026-11-15 实测：件4/干4/挖坑0次）。 */
  STUCK_S: 30,
  /** ★ 补兵节拍（秒/只）：每扇区缺员的投放间隔 */
  /** ★ 补队节拍（秒；事态驱动：越后越频繁；用户定 2026-09-26） */
  REPLENISH_SLOW_S: 10,
  REPLENISH_FAST_S: 2,
  /** ★ 工兵小队总配额（上限；不要太多兵；用户定 2026-09-26） */
  SQUAD_QUOTA: 3,
  /** ★ 分区无件空转超时（秒）→ 换区（用户定 2026-09-26） */
  ZONE_IDLE_S: 15,
  // ---- ★ 工兵战术实施（D5；用户定 2026-09-30：消费地形语义 → 战术决策） ----
  /** 岗哨三件：斜件后退（米） */
  SENTRY_BACK: 3.5,
  /** 岗哨三件：斜件左右（米） */
  SENTRY_SIDE: 2.5,
  /** 岗哨判定：朝舰缘搜索半径（格；"高地面内向舰侧骤降边缘带 ≤2 格"） */
  SENTRY_EDGE_CELLS: 2,
  /** 战术扫描：半径（米）与步长（米）——岗哨=山顶 / 封口=缝道（4m=地形格，防漏小特征） */
  TACTIC_SCAN_R: 110,
  TACTIC_SCAN_STEP: 4,
  /** 战术扫描重算间隔（秒） */
  TACTIC_RESCAN_S: 3,
  /** 每拍每队最多试几个候选（可达门逐个测） */
  TACTIC_MAX_TRY: 8,
} as const;

/** ★ 工兵件数据（D5 战术实施产物）：位置 + 正面朝向点 */
export interface EngineerPiece {
  x: number;
  z: number;
  /** 正面朝向点（缺省 = 参照舰/玩家） */
  face?: { x: number; z: number };
  tactic: 'sentry' | 'choke' | 'cover' | 'trench';
}

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
  /** 总攻中（**只用于掩护施工 `wardSpot`**；不再停战壕 —— 用户定 2026-11-15） */
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
  /** 造掩体（真源端口；face = 正面朝向点；缺省 = 朝舰） */
  cover(x: number, z: number, variant: 'cover' | 'wall', face?: { x: number; z: number }): void;
  /** ★ 地形事实读取口（D5 工兵战术：山顶岗哨/缝道封口；未接 = 退回常规件） */
  facts?(): TerrainSemantics | null;
  /** ★ §3.C 总攻掩护施工（用户定 2026-09-29）：引擎给的**动态建造点**（查询保护对象位置得出）；
   *  null = 非保护状态（走原查询机制） */
  wardSpot?(id: number): { x: number; z: number } | null;
  /** ★ 掩护掩体落成回执（引擎据此抑制同点重复产点，直到保护对象移动） */
  wardCoverDone?(id: number, x: number, z: number): void;
  /** ★ 玩家位（近旁时建造朝向玩家侧） */
  playerOf?(): { x: number; z: number } | null;
  /** ★ 附近已建工事数（密度门；单一建造账本，用户定 2026-09-29） */
  coversNear?(x: number, z: number, r: number): number;
  /** ★★ 战壕线（S0 勘察的三环直线；每个点 = 一个战壕块中心）。
   *  **战壕件的唯一来源**：1:1 循环轮到"挖战壕"时按扇区从这里取点，
   *  各队挖各自扇区那一段 ⇒ 连成整条防线（缺省 = 退回 pickSpot 的常规点）。 */
  trenchLine?(): { x: number; z: number }[][] | null;

  /** 挖战壕一遍（≈0.2m） */
  dig(x: number, z: number): void;
  /**
   * ★★ 批量挖战壕（一次 tick 的多遍挖掘合并为一批）。
   *   ★ 为什么需要批量：每遍挖掘都会触发【1m 深度场窗扫】（r+12 米窗口 ≈ 50×50 格，
   *     每格一次包络场求值）——一次 tick 连挖 5 遍 = 5 次窗扫（≈7800 格次），
   *     而窗扫是幂等的（挖完再扫一次 == 逐遍扫）⇒ 合并成 1 次，结果完全相同。
   *   ★ 语义：points = 本批要挖的点（按顺序）；实现方负责逐点挖 + 只做一次脏标记。
   *   缺省未实现 → 回退为逐点 dig（行为等价，只是慢）。
   */
  digBatch?(points: { x: number; z: number }[]): void;
  /** 地形脏标记（评分/采样局部重算） */
  markDirty(x: number, z: number, r: number): void;
  /**
   * ★★ 仅工事表标脏（2026-11-08）：**不做深度场窗扫**。
   *   ★ 为什么需要：造掩体只建**实体**（不挖地形），却走 markDirty →
   *     深度场窗扫（r+12 米窗口 ≈ 48×48 = 2304 格 × 包络场求值）⇒ 白扫。
   *   ★ 语义等价：深度场只记录挖过的地形凹陷；掩体是实体，不改地形高度场。
   *   缺省未实现 → 回退 markDirty（行为等价，只是慢）。
   */
  markBuiltOnly?(x: number, z: number): void;
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
// ★ 防区数学单源（2026-09-30）：secOfAngle 来自 swarm/Sectors
import { secOfAngle } from '../Sectors';

export class EngineerManager extends RoleManager {
  /** 各队当前施工点（件；含发放时刻 + ★ 战术件队列） */
  private readonly spots = new Map<number, { x: number; z: number; score: number; at: number; plan?: EngineerPiece[] }>();
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
  /** ★ 每队上一件类型（用户定 2026-09-29：循环=掩体→坑洞→掩体… 1:1 交替） */
  private readonly lastKind = new Map<number, 'cover' | 'trench'>();
  /** ★★ 自上一件掩体之后已挖了几条战壕（用户定 2026-11-15「压制一半掩体，多造战壕」）。
   *  未初始化 = 先造一掩体；`n >= TRENCH_PER_COVER` ⇒ 轮到一个掩体。 */
  private readonly sinceCover = new Map<number, number>();
  /** ★★ 本队**最近一次掩体的落位**（用户定 2026-11-15「造了掩体后面理论是要挖战壕的，
   *  特别是对于面向飞船的掩体」）：战壕点 = 掩体**背舰侧**沿背向排开 3m / 7m。
   *  ⇒ 掩体+壕沟成组；且距离只有 3~7m（< WORK_R=8）——工兵刚造完掩体就站在旁边，
   *  战壕件**立刻开工**，不再出现"取到战壕件却走不到/超时弃件"。 */
  private readonly lastCover = new Map<number, { x: number; z: number }>();
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
  readonly fortDbg = {
    spots: 0, working: 0, idle: 0, built: 0, maxWork: 0, spawned: 0, sentry: 0, choke: 0, last: '',
    /** ★ 分账（2026-11-15「工兵是不是很少挖战壕」取证）：掩体/战壕落地件数 */
    covers: 0, trenches: 0,
    /** 战壕累计挖了几层（一件战壕目标 5 层；层数远小于件数 ⇒ 挖一半就弃件） */
    trenchDigs: 0,
    /** 战壕件里有多少是**从战壕线**取的（vs 退回常规 pickSpot 点） */
    trenchPick: 0,
    /** 弃件次数（复检不过）——频繁弃件 = 战壕永远挖不完 */
    abandon: 0,
    /** ★ 想挖战壕但该点挖不动（canDig=false）⇒ 已降级成掩体（掩体不应因此变少） */
    trenchNoDig: 0,
    /** ★★ 挖坑调用次数 / 累计点数（2026-11-15 定位「挖坑函数是否真的被调到」）：
     *  digCalls=0 ⇒ 工兵压根没走到 buildAt 的挖掘分支（件/站位/判定问题）；
     *  digCalls>0 而地面没坑 ⇒ 才轮到怀疑 digRectBatch。 */
    digCalls: 0, digPoints: 0,
    /** 当前有编制的工兵小队数 / 有件 / 正在施工 / 空闲（诊断"工兵是否在干活"） */
    squads: 0,
    /** ★ 卡住换件次数（到不了件点，STUCK_S 超时） */
    stuck: 0,
    /** ★ 本拍：所有队到各自件点的最小距离（-1 = 无件）/ 已进 WORK_R 的队数 */
    minDist: -1, nearN: 0,
  };
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

  // ============================================================
  // ★ 工兵战术实施（D5；用户定 2026-09-30）
  //   消费地形事实（真相源）→ 战术件数据：
  //     ① 岗哨（最高）：山顶 ∧ 朝舰缘 → 三件（前件朝舰 / 两斜件后退+左右+45°）
  //     ② 缝道封口（次高）：缝道 ∧ W≤2 → 单件，正面=缝道轴向（朝舰侧）
  //     ③ 常规防御件（兜底）：走原 need 查询
  // ============================================================

  /** ① 岗哨三件：山顶 ∧ ±2 格内存在迎舰坡面 → 前件 + 两斜件（件点必须可站，否则丢弃该件） */
  private sentryPieces(facts: TerrainSemantics, x: number, z: number, ship: { x: number; z: number }): EngineerPiece[] | null {
    const c = facts.cellAt(x, z);
    if (!c || c.kind !== KIND.Peak) return null;
    // 朝舰缘：±2 格内有迎舰坡面（向舰侧骤降）
    let edge = false;
    for (let dz = -ENGINEER_POLICY.SENTRY_EDGE_CELLS; dz <= ENGINEER_POLICY.SENTRY_EDGE_CELLS && !edge; dz++) {
      for (let dx = -ENGINEER_POLICY.SENTRY_EDGE_CELLS; dx <= ENGINEER_POLICY.SENTRY_EDGE_CELLS && !edge; dx++) {
        const e = facts.cellAt(x + dx * 4, z + dz * 4);
        if (e && e.slope >= 0.25 && e.slopeDir === SLOPE_DIR.Front) edge = true;
      }
    }
    if (!edge) return null;
    const ux0 = ship.x - x, uz0 = ship.z - z;
    const L = Math.hypot(ux0, uz0) || 1;
    const ux = ux0 / L, uz = uz0 / L;          // 朝舰单位
    const rx = -uz, rz = ux;                    // 右手向
    const B = ENGINEER_POLICY.SENTRY_BACK, W = ENGINEER_POLICY.SENTRY_SIDE, H = 10;
    const rot = (vx: number, vz: number, a: number): { x: number; z: number } =>
      ({ x: vx * Math.cos(a) - vz * Math.sin(a), z: vx * Math.sin(a) + vz * Math.cos(a) });
    const lf = rot(ux, uz, Math.PI / 4), rf = rot(ux, uz, -Math.PI / 4);
    const lx = x - ux * B - rx * W, lz = z - uz * B - rz * W;
    const gx = x - ux * B + rx * W, gz = z - uz * B + rz * W;
    const standable = (px: number, pz: number): boolean => facts.isPassableAt(px, pz);
    const out: EngineerPiece[] = [{ x, z, face: { x: x + ux * H, z: z + uz * H }, tactic: 'sentry' }];
    if (standable(lx, lz)) out.push({ x: lx, z: lz, face: { x: lx + lf.x * H, z: lz + lf.z * H }, tactic: 'sentry' });
    if (standable(gx, gz)) out.push({ x: gx, z: gz, face: { x: gx + rf.x * H, z: gz + rf.z * H }, tactic: 'sentry' });
    return out;
  }

  /** ② 缝道封口件：缝道 ∧ W≤2 → 单件，正面=缝道轴向朝舰侧（横跨车道堵路） */
  private chokePiece(facts: TerrainSemantics, x: number, z: number, ship: { x: number; z: number }): EngineerPiece | null {
    const c = facts.cellAt(x, z);
    if (!c || c.kind !== KIND.Gap || c.narrowW < 1 || c.narrowW > 2) return null;
    const DIRS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [1, 1], [1, -1]];
    const d = c.narrowDir;
    if (d < 0 || d > 3) return null;
    const ax = d === 0 ? 1 : d === 1 ? 0 : d === 2 ? 3 : 2;   // 法线 → 轴向（垂直向）
    let vx = DIRS[ax][0], vz = DIRS[ax][1];
    if (vx * (ship.x - x) + vz * (ship.z - z) < 0) { vx = -vx; vz = -vz; }   // 朝舰侧
    return { x, z, face: { x: x + vx * 10, z: z + vz * 10 }, tactic: 'choke' };
  }

  /** 点 → 件队列（岗哨 > 封口 > 常规） */
  private planFor(port: EngineerPort, x: number, z: number): EngineerPiece[] {
    const facts = port.facts?.() ?? null;
    if (facts) {
      const ship = port.ship();
      const sentry = this.sentryPieces(facts, x, z, ship);
      if (sentry) return sentry;
      const choke = this.chokePiece(facts, x, z, ship);
      if (choke) return [choke];
    }
    return [{ x, z, tactic: 'cover' }];
  }

  /** 战术候选扫描（缓存；每 TACTIC_RESCAN_S 秒重扫一次）：岗哨=山顶 / 封口=缝道 */
  private tacticScanAt = -1;
  private tacticCache: { sentry: { x: number; z: number }[]; choke: { x: number; z: number }[] } = { sentry: [], choke: [] };
  /** ★ 调优（2026-09-30）：一个山顶只造**一组**岗哨（8m 格记账）——否则 sentry 候选永不枯竭、choke 被饿死 */
  private readonly sentrySiteDone = new Set<string>();
  /** ★ 战术件连做上限（2026-09-30）：连做 N 件战术件后强制转常规一件（让掩体↔战壕循环有机会出壕） */
  private readonly tacticStreak = new Map<number, number>();
  private readonly siteKey = (x: number, z: number): string => `${Math.round(x / 8)},${Math.round(z / 8)}`;
  private sentryBuiltNear(x: number, z: number): boolean {
    const kx = Math.round(x / 8), kz = Math.round(z / 8);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) if (this.sentrySiteDone.has(`${kx + a},${kz + b}`)) return true;
    }
    return false;
  }
  private refreshTactics(port: EngineerPort, ship: { x: number; z: number }, now: number): void {
    if (now - this.tacticScanAt < ENGINEER_POLICY.TACTIC_RESCAN_S) return;
    this.tacticScanAt = now;
    const facts = port.facts?.() ?? null;
    if (!facts) { this.tacticCache = { sentry: [], choke: [] }; return; }
    const sentry: { x: number; z: number }[] = [];
    const choke: { x: number; z: number }[] = [];
    const R = ENGINEER_POLICY.TACTIC_SCAN_R, ST = ENGINEER_POLICY.TACTIC_SCAN_STEP;
    for (let dz = -R; dz <= R; dz += ST) {
      for (let dx = -R; dx <= R; dx += ST) {
        const x = ship.x + dx, z = ship.z + dz;
        const c = facts.cellAt(x, z);
        if (!c) continue;
        if (c.kind === KIND.Peak) {
          if (!this.sentryBuiltNear(x, z) && this.sentryPieces(facts, x, z, ship)) sentry.push({ x, z });
        } else if (c.kind === KIND.Gap && c.narrowW >= 1 && c.narrowW <= 2) choke.push({ x, z });
      }
    }
    this.tacticCache = { sentry, choke };
  }

  /** 本队取战术件（岗哨优先、次封口；可达门逐个测；全不可达 → null 落常规） */
  private pickTactic(port: EngineerPort, id: number, s: { x: number; z: number }, ship: { x: number; z: number }, now: number): EngineerPiece[] | null {
    this.refreshTactics(port, ship, now);
    const exclude = (x: number, z: number): boolean => this.built.has(keyOf(x, z)) || this.reserved.has(keyOf(x, z));
    const tryList = (list: { x: number; z: number }[], narrowest = false): EngineerPiece[] | null => {
      const arr = list.filter((p) => !exclude(p.x, p.z))
        .sort((a, b) => narrowest
          ? (factsW(a) - factsW(b)) || (Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))
          : Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z));
      const n = Math.min(arr.length, ENGINEER_POLICY.TACTIC_MAX_TRY);
      for (let i = 0; i < n; i++) {
        if (!port.canReach(id, arr[i].x, arr[i].z)) continue;
        return this.planFor(port, arr[i].x, arr[i].z);
      }
      return null;
    };
    const facts = port.facts?.() ?? null;
    const factsW = (p: { x: number; z: number }): number => facts ? (facts.cellAt(p.x, p.z)?.narrowW ?? 99) : 99;
    return tryList(this.tacticCache.sentry) ?? tryList(this.tacticCache.choke, true);
  }

  /** ★★ 本队的「下一件」类型（掩体 / 战壕）——**取件与施工共用的唯一口径**。
   *
   *  规则（用户定 2026-09-26/29，2026-11-15 修订）：区域工事密度 ≥ 上限 → 战壕；
   *  其余 **1:1 循环：上一件是掩体 ⇒ 下一件挖战壕**（每队各记各的账）。
   *  ★ 2026-11-15：此前这套判定**只在施工时**（`buildAt` 前）算一次，取件仍用
   *    `pickSpot`（掩体点查询）⇒ 工兵拿着"掩体点"去挖战壕，且 S0 勘察算好的
   *    `DefensePlan.trenchLines`（三环战壕线）**全项目零消费者** ⇒ 战壕永远连不成防线。
   *    现在取件前先问一次本函数（见 assign 的取件段）。
   *  ★★ **总攻不再一刀切"只修掩体"**（用户定 2026-11-15：「工兵总攻的时候也要记得挖战壕」）：
   *    原来第一行是 `if (port.assault()) return 'cover'`⇒ 整个总攻期零战壕。
   *    现在总攻照样走 1:1 循环（掩体 ↔ 战壕），总攻的"掩护施工"走另一条独立分支
   *    （`wardSpot`，恒定掩体，见 assign 顶部的保护态），不受这里影响。 */
  private nextKind(port: EngineerPort, id: number, x: number, z: number): 'cover' | 'trench' {
    const dense = (port.coversNear?.(x, z, ENGINEER_POLICY.COVER_DENSITY_R) ?? 0)
      >= ENGINEER_POLICY.COVER_DENSITY_MAX;
    if (dense) return 'trench';
    // ★★ 1 掩体 : N 战壕（用户定 2026-11-15「压制一半掩体，多造战壕」）。
    //   旧实现按 lastKind 1:1 交替 + 战术件（岗哨三件一组，全是掩体，且优先级最高）
    //   ⇒ 实测 41 掩体 / 1 战壕。现在改成计数配比：挖满 N 条战壕才轮到 1 件掩体。
    const n = this.sinceCover.get(id) ?? ENGINEER_POLICY.TRENCH_PER_COVER;
    return n < ENGINEER_POLICY.TRENCH_PER_COVER ? 'trench' : 'cover';
  }

  /** ★★ 掩体背后的战壕点（用户定 2026-11-15「造了掩体后面理论是要挖战壕的，
   *  特别是对于面向飞船的掩体」）。
   *
   *  方向 = **背舰侧**（掩体正面朝舰 ⇒ 背后就是远离舰那一侧）。
   *  第 1 条 +3m、第 2 条 +7m（按 `sinceCover` 递推），再往后 +11m…
   *  ★ 前两条都在 `WORK_R = 8` 内 —— 工兵刚造完掩体就在旁边，战壕件**立刻开工**，
   *  不再出现"取到战壕件却走不到 / 超时弃件"（实测弃件率 50%，战壕成不了）。
   *  候选不合格（已建 / 挖不动 / 不可达）就试下一个距离；全不行返回 null（调用方回落就近点）。 */
  private behindCoverSpot(
    port: EngineerPort, id: number, ship: { x: number; z: number },
    exclude: (x: number, z: number) => boolean,
    canReach: (x: number, z: number) => boolean,
  ): { x: number; z: number } | null {
    const c = this.lastCover.get(id);
    if (!c) return null;
    const bx = c.x - ship.x, bz = c.z - ship.z;
    const L = Math.hypot(bx, bz);
    if (L < 1e-3) return null;
    const ux = bx / L, uz = bz / L;
    const n = this.sinceCover.get(id) ?? 0;
    for (const d of [3 + n * 4, 5 + n * 4, 3, 5]) {
      const x = c.x + ux * d, z = c.z + uz * d;
      if (exclude(x, z)) continue;
      if (!port.canDig(x, z)) continue;
      if (!canReach(x, z)) continue;
      return { x, z };
    }
    return null;
  }

  /** ★★ 就近战壕点（2026-11-15「就近自选」）：战壕线上离**队长**最近的点，限 `TRENCH_NEAR_R` 以内。
   *
   *  取不到 ⇒ 返回 null，调用方回落到 `nearSpot`（就在就近点挖战壕，1:1 循环照跑）。
   *  过滤：已被预约/已建（exclude）、needAt 无效、坑底已到（canDig）、不可达。
   *  ★ canReach 是 BFS（贵）⇒ 只在"比当前最优更近"时才测。 */
  private nearTrenchPick(
    port: EngineerPort, from: { x: number; z: number },
    exclude: (x: number, z: number) => boolean,
    canReach: (x: number, z: number) => boolean,
  ): { x: number; z: number } | null {
    const lines = port.trenchLine?.();
    if (!lines || lines.length === 0) return null;
    const lim = ENGINEER_POLICY.TRENCH_NEAR_R;
    let bestD = lim * lim;
    let best: { x: number; z: number } | null = null;
    for (const line of lines) {
      for (const p of line) {
        if (exclude(p.x, p.z)) continue;
        const dx = p.x - from.x, dz = p.z - from.z;
        const d = dx * dx + dz * dz;
        if (d >= bestD) continue;
        if (!port.canDig(p.x, p.z)) continue;
        if (!canReach(p.x, p.z)) continue;
        bestD = d; best = p;
      }
    }
    return best;
  }

  /** ★★ 就近自选施工点（用户定 2026-11-15「每队自己算要在哪造，就近」）。
   *
   *  为什么：原「建造位置查询」要 march 到几十米外的件点，而 `buildAt` 要求 3m 内才计时
   *  ⇒ march 目标一旦被防区锁夹取 / 寻路偏差，距离永远 > 3m ⇒ 4 支工兵全卡死
   *  （实测 `件4 干4 挖坑0次 距件12.3m 卡8`）。改成**以队长脚下为基准**取点：
   *  首候选 2.5m 已在 `WORK_R = 3m` 内 ⇒ 不需要"走到位"就能开工；件点仍是 march 目标
   *  ⇒ 工兵会小步移动，不会在原地把候选耗尽。
   *
   *  候选序：距离 2.5 / 4 / 6m × 朝参照侧（舰/玩家）0 / ±30° / ±60° / ±90°。
   *  过滤：已建/已预约、needAt 无效、挖不动（水/坑底）、不可达。 */
  private nearSpot(
    port: EngineerPort, from: { x: number; z: number }, ref: { x: number; z: number },
    exclude: (x: number, z: number) => boolean,
    canReach: (x: number, z: number) => boolean,
  ): { x: number; z: number } | null {
    const ux = ref.x - from.x, uz = ref.z - from.z;
    const L = Math.hypot(ux, uz) || 1;
    const bx = ux / L, bz = uz / L;
    for (const d of ENGINEER_POLICY.NEAR_DIST) {
      for (const a of [0, 0.52, -0.52, 1.05, -1.05, 1.57, -1.57]) {
        const ca = Math.cos(a), sa = Math.sin(a);
        const dx = bx * ca - bz * sa, dz = bx * sa + bz * ca;
        const x = from.x + dx * d, z = from.z + dz * d;
        if (exclude(x, z)) continue;
        if (!port.canDig(x, z)) continue;
        if (!canReach(x, z)) continue;
        return { x, z };
      }
    }
    return null;
  }

  /** ★ 建造 = 独立机制
（用户定 2026-09-29；类似开火）：**位置来源（查询/保护对象）与本机制解耦**——
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
      // ★ 落位：战术件（岗哨/封口）按**件数据**（含正面朝向）；常规=当前位置向参照侧 1.6m（用户定 2026-09-29）
      const piece = this.spots.get(id)?.plan?.[0];
      const bp = piece ? { x: piece.x, z: piece.z } : this.coverSpot(port, s);
      port.cover(bp.x, bp.z, 'cover', piece?.face);
      // ★ 记下掩体落位（战壕要挖在它背舰侧，见 lastCover 的说明）
      this.lastCover.set(id, { x: bp.x, z: bp.z });
      // ★★ 造掩体只建实体（不挖地形）→ 只标工事表，**不做深度场窗扫**
      //   （原实现走 markDirty → 窗扫 48×48=2304 格 × 包络场 = 白扫，纯浪费）。
      if (port.markBuiltOnly) port.markBuiltOnly(bp.x, bp.z);
      else port.markDirty(bp.x, bp.z, 12);
      this.built.add(keyOf(bp.x, bp.z));
      this.built.add(keyOf(spot.x, spot.z));   // ★ 件点也记（防同点再取件；用户定 2026-09-29）
      this.builtOnce.add(id);
      this.builtBy.set(id, (this.builtBy.get(id) ?? 0) + 1);
      this.work.delete(id); this.digs.delete(id);
      return 'done';
    }
    const canDig = port.canDig(spot.x, spot.z);
    let digs = this.digs.get(id) ?? 0;
    const want = Math.min(ENGINEER_POLICY.MAX_DIGS, Math.floor(t / ENGINEER_POLICY.DIG_EVERY_S));
    const ship = port.ship();
    // ★★ 批量挖掘：一次 tick 的多遍挖掘合并成一批 → 深度场窗扫只做 1 次
    //   （原实现每遍都扫一次 r+12 米窗口 ≈ 50×50 格；连挖 5 遍 = 5 次窗扫）。
    //   窗扫幂等（挖完扫一次 == 逐遍扫）⇒ 结果完全相同，只是省掉 4 次窗扫。
    const batch: { x: number; z: number }[] = [];
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
      batch.push({ x: dx, z: dz });
      digs++;
    }
    if (batch.length > 0) {
      this.fortDbg.digCalls++;
      this.fortDbg.digPoints += batch.length;
      if (port.digBatch) {
        port.digBatch(batch);
      } else {
        // 回退：逐点挖（每点一次窗扫 = 旧行为，语义相同只是慢）
        // ★ 不再调 markDirty：dig 端口已自带工事表标脏（调了会把窗扫做两遍）
        for (const p of batch) port.dig(p.x, p.z);
      }
    }
    this.digs.set(id, digs);
    if (!canDig || t >= ENGINEER_POLICY.TRENCH_TIME_S || digs >= ENGINEER_POLICY.MAX_DIGS) {
      this.built.add(keyOf(spot.x, spot.z));
      this.builtOnce.add(id);
      this.builtBy.set(id, (this.builtBy.get(id) ?? 0) + 1);
      this.fortDbg.trenchDigs += digs;   // ★ 分账：本件实际挖了几层（0 层 = 一点没挖就"完成"）
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
    // 未接线（自检/降级）：**不发目标**（工兵无命令全交给掩体点查询；用户定 2026-09-29）
    if (!port) {
      this.dbg.assigned = 0;
      return 0;
    }
    const now = ctx.now;
    const dt = this.lastNow >= 0 ? Math.max(0, Math.min(1, now - this.lastNow)) : 0;
    this.lastNow = now;
    // ★ 诊断：每拍重置「到件点最小距离 / 已到位队数」（stuck 累计不清）
    this.fortDbg.minDist = -1; this.fortDbg.nearN = 0;
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
      // ★★ 总攻掩护与战壕 **1:1 交替**（用户定 2026-11-15「工兵总攻的时候也要记得挖战壕」）：
      //   上一件已经是掩体（含上一件掩护掩体）⇒ 本拍**让给战壕**，不接掩护点；
      //   下面的 nextKind 此时必然返回 'trench'（lastKind === 'cover'）⇒ 去战壕线取件。
      //   原实现：只要 wardSpot 有点就 continue ⇒ 总攻期工兵**只造掩护掩体、零战壕**。
      //   ★ 让出的那一拍若战壕取不到件，会回落到常规件（tryBand 兜底）⇒ 不会站桩。
      const ws = port.assault?.() && port.wardSpot && this.lastKind.get(id) !== 'cover'
        ? port.wardSpot(id) : null;
      if (ws) {
        spot = { x: ws.x, z: ws.z, score: 0, at: spot?.at ?? now };
        this.spots.set(id, spot);
        if (this.buildAt(port, id, s, ws, 'cover', dt) === 'done') {
          port.wardCoverDone?.(id, ws.x, ws.z);
          this.built.add(keyOf(ws.x, ws.z));   // ★ 掩护点也记（防同点再取件；用户定 2026-09-29）
          this.lastKind.set(id, 'cover');      // ★ 循环记账（掩护=掩体件）
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
        // ★ 诊断：本拍到件点距离（minDist 每拍在入口重置为 +∞）
        {
          const dd = Math.hypot(s.x - spot.x, s.z - spot.z);
          if (this.fortDbg.minDist < 0 || dd < this.fortDbg.minDist) this.fortDbg.minDist = dd;
          if (arrived) this.fortDbg.nearN++;
        }
        // ★ 复检：建成 / need 无效 / 出本区 / 不可达 → 换件（**不再因“出带”判死**：分到区就去造）
        //   战术件（岗哨/封口）跳过 needAt/扇区复检（不由 need 驱动；只守：未建 + 可达）
        const tactical = spot.plan?.[0] !== undefined && spot.plan[0].tactic !== 'cover';
        // ★★ 已开工的件不再用 needAt 复检（2026-11-14「工兵战壕挖得少」取证）：
        //   战壕第一层挖完就会在 ±4m 形成高差 ⇒ blockedNow=true ⇒ fortifyNeed=null
        //   ⇒ 下一拍把**自己挖的坑**判成"不可施工"并弃件，只挖 1 层就走。
        //   开工后（已挖过 / 已累计施工时间）只保留"已建成 / 出区 / 不可达"三条硬判。
        const started = (this.digs.get(id) ?? 0) > 0 || (this.work.get(id) ?? 0) > 0;
        // ★★ 可达性也在开工后豁免（2026-11-15「没挖战壕」）：战壕第 1~2 层挖完，
        //   坑壁变陡 ⇒ PassTable BFS 从队长位到**件点**判不可达 ⇒ 弃件 ⇒ digs 清零
        //   ⇒ 下一件又从第 0 层重来 ⇒ **永远挖不到 5 层、现场只留几个浅坑**。
        //   已开工 = 人就在旁边，不需要重新验收可达。
        // ★ 卡住（到不了）：取件后 STUCK_S 秒仍未进 WORK_R 且未开工 → 弃件重取。
        //   防 4 支工兵被同一批"走不到的件"永久锁死（实测：件4/干4/挖坑0次）。
        const stuck = !arrived && !started && (now - spot.at) > ENGINEER_POLICY.STUCK_S;
        // ★★ needAt 复检也去掉（2026-11-15「不要取件机制」口径）：就近点由工兵自己算，
        //   不再受要塞需求表约束 —— 否则取件时过了、下一拍 needAt=null 又判死，等于白取。
        //   剩下的硬判只有：已建 / 出扇区（就近点天然满足）/ 未开工时的可达 / 卡住超时。
        const bad = stuck
          || this.built.has(k)
          || (!tactical && !inSec)
          || (!started && !port.canReach(id, spot.x, spot.z));
        if (bad) {
          if (stuck) this.fortDbg.stuck++;
          else this.fortDbg.abandon++;   // ★ 分账：弃件（战壕挖一半被弃 = 这条最该归零）
          this.releaseFor(id); this.spots.delete(id); this.work.delete(id); this.digs.delete(id);
          spot = undefined;
        }
      }
      // ---- ★★ 取件（2026-11-15 改为「就近自选」：每队自己算，不走向量查询/预约带） ----
      //   用户定：「也不要什么取件机制了，每队自己算要在哪造掩体和战壕，就近」。
      //   原 `pickSpot(sec, band…)` 要 march 到几十米外的件点，而 buildAt 要求 3m 内才计时
      //   ⇒ 一旦 march 目标被防区锁夹取 / 寻路偏差就永远到不了（实测 件4 干4 挖坑0次 距件12.3m 卡8）。
      //   现在以**队长脚下**为基准就近取点（首候选 2.5m，已在 WORK_R 内），件点仍作
      //   march 目标 ⇒ 工兵会小步移动，不会原地把候选耗尽。
      if (!spot && sec >= 0) {
        const exclude = (x: number, z: number): boolean => {
          const k = keyOf(x, z);
          return this.built.has(k) || this.reserved.has(k);   // ★ 无拉黑（用户定 2026-09-29：寻路可行即去造）
        };
        const canReach = (x: number, z: number): boolean => port.canReach(id, x, z);
        // ★ noNewBuild（事态 0.45 后停新增）只约束"新掩体件"；战壕是加固，不挂它。
        const canNew = !port.noNewBuild() || !this.builtOnce.has(id);
        // ★ 战术件优先（D5：岗哨→封口→常规）。**连做配额 2 → 1**（用户定 2026-11-15
        //   「压制一半掩体」）：岗哨是"三件一组、全是掩体"，配额 2 时一队能连出 6 件掩体，
        //   是 41 掩体 / 1 战壕的主因。现在一组战术件之后必须回常规（1 掩体 : 2 战壕）循环。
        const streak = this.tacticStreak.get(id) ?? 0;
        const tact = canNew && streak < 1 ? this.pickTactic(port, id, s, ship, now) : null;
        let cand: { x: number; z: number } | null = null;
        if (!tact) {
          const ref = this.buildRef(port, s) ?? ship;
          const wantTrench = this.nextKind(port, id, s.x, s.z) === 'trench';
          if (wantTrench) {
            // ★ 先挖"刚造好的掩体背后"（成组工事、距离 3~7m ⇒ 立刻开工）；
            //   没掩体/不可用 → 战壕线附近 → 就近点。
            cand = this.behindCoverSpot(port, id, ship, exclude, canReach)
              ?? this.nearTrenchPick(port, s, exclude, canReach);
          }
          // 战壕线附近没点 ⇒ 退到就近点（就在该点挖，1:1 循环照跑）
          if (!cand) cand = this.nearSpot(port, s, ref, exclude, canReach);
        }
        if (tact) {
          spot = { x: tact[0].x, z: tact[0].z, score: 999, at: now, plan: tact };   // ★ 战术件队列
          this.spots.set(id, spot);
          this.reserved.set(keyOf(spot.x, spot.z), id);   // ★ 预约（全局唯一）
          if (tact[0].tactic === 'sentry') { this.fortDbg.sentry++; this.sentrySiteDone.add(this.siteKey(spot.x, spot.z)); }
          else if (tact[0].tactic === 'choke') this.fortDbg.choke++;
          this.tacticStreak.set(id, streak + 1);
          this.dbg.last = `#${id} 战术件 ${tact[0].tactic} @${spot.x | 0},${spot.z | 0}`;
          this.work.delete(id); this.digs.delete(id);
        } else if (cand) {
          // ★ 就近件：件点 = 施工点（不再有独立的"掩体位查询点"）。
          //   不带 plan ⇒ 复检走常规判定；就近点就在队长旁，扇区必然一致，
          //   needAt 已在 nearSpot / nearTrenchPick 里过滤过。
          spot = { x: cand.x, z: cand.z, score: 999, at: now };
          this.spots.set(id, spot);
          this.reserved.set(keyOf(spot.x, spot.z), id);   // ★ 仍防两队抢同一点
          this.tacticStreak.set(id, 0);
          this.work.delete(id); this.digs.delete(id);
          this.fortDbg.trenchPick++;   // 常规件计数（旧字段名）
          this.dbg.last = `#${id} 就近件 @${spot.x | 0},${spot.z | 0}`;
        }
      }
      if (!spot) {
        // 未部署 / 无件可派：**不发目标**（交给引擎唯一兜底：行军↔巡逻；
        //   用户定 2026-09-29：没活就兜底，不发“站位件”混淆发令）
        this.targets.delete(id);
        idle++;
        continue;
      }
      // ---- 施工：统一独立机制（位置来源=查询/保护对象；本机制只负责"到范围计时"） ----
      {
        // ★ 选型（用户定 2026-09-26/29；2026-11-15 修订）：**区域工事密度≥上限 → 改挖战壕**；
        //   其余按**循环：掩体 → 坑洞 → 掩体 …（1:1，每队各记各的账）**——造完一件换下一种。
        //   ★ 总攻不再是"全掩体"（用户：总攻也要挖战壕）；战术件（岗哨/封口）仍是掩体。
        const tacticKind = spot.plan?.[0]?.tactic;
        let kind: 'cover' | 'trench' = tacticKind === 'sentry' || tacticKind === 'choke' ? 'cover'
          // ★ 战壕线件：必定挖战壕（不受 1:1 循环的 lastKind 影响，否则会在战壕线点上盖掩体）
          : tacticKind === 'trench' ? 'trench'
          : this.nextKind(port, id, spot.x, spot.z);
        // ★★ 挖不动的点 ⇒ 改判掩体（2026-11-15「掩体也造得少了」）：
        //   原实现在 canDig=false 的点上仍走战壕分支，buildAt 第一次调用就 `!canDig → 'done'`
        //   ⇒ **一层没挖却被记为"战壕成"**（还 built.add 掉该点）⇒ 这一件工位完全空转
        //   ⇒ 掩体也跟着少一半。这里先降级为掩体，保证每件都有产出。
        if (kind === 'trench' && !port.canDig(spot.x, spot.z)) {
          kind = 'cover';
          this.fortDbg.trenchNoDig++;
        }
        if (this.buildAt(port, id, s, spot, kind, dt) === 'done') {
          this.lastKind.set(id, kind);   // ★ 循环记账（总攻掩护 vs 战壕的交替用）
          // ★ 1:N 配比记账（用户定 2026-11-15）：掩体 → 清零；战壕 → 累加
          if (kind === 'cover') this.sinceCover.set(id, 0);
          else this.sinceCover.set(id, (this.sinceCover.get(id) ?? 0) + 1);
          if (kind === 'cover') this.fortDbg.covers++;
          else this.fortDbg.trenches++;
          const entry = this.spots.get(id);
          const rest = kind === 'cover' && entry?.plan && entry.plan.length > 1 ? entry.plan.slice(1) : null;
          // ★ 兜底（审计修复）：下一件必须**可达**才换目标；不可达就顺延/收尾（防送死卡死）
          let nextIdx = -1;
          if (rest) {
            for (let i = 0; i < rest.length; i++) {
              if (port.canReach(id, rest[i].x, rest[i].z)) { nextIdx = i; break; }
            }
          }
          if (rest && nextIdx >= 0) {
            // ★ 岗哨三件：落成一件 → 下一件（更新目标点，队长继续走过去）
            this.releaseFor(id);
            const next = rest[nextIdx];
            this.spots.set(id, { x: next.x, z: next.z, score: entry!.score, at: now, plan: rest.slice(nextIdx) });
            this.reserved.set(keyOf(next.x, next.z), id);
            this.dbg.last = `#${id} 岗哨件成 → 下一件 @${next.x | 0},${next.z | 0}（余 ${rest.length - nextIdx - 1}）`;
          } else {
            this.releaseFor(id); this.spots.delete(id);
            this.dbg.last = kind === 'cover'
              ? `#${id} 掩体成 @${spot.x | 0},${spot.z | 0}`
              : `#${id} 战壕成 @${spot.x | 0},${spot.z | 0}`;
          }
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
    this.fortDbg.squads = ids2.length;
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
    this.lastKind.clear();
    this.sinceCover.clear();
    this.lastCover.clear();
    this.builtBy.clear();
    this.spawnAt.clear();
    this.zoneOf.clear();
    this.noSpotSince.clear();
    this.zoneWorkUntil.clear();
    this.zoneSpawnGrace.clear();
    this.zoneTaken.clear();
    this.zoneCursor = 0;
    this.lastNow = -1;
    this.sentrySiteDone.clear();
    this.tacticStreak.clear();
    this.tacticScanAt = -1;
    this.tacticCache = { sentry: [], choke: [] };
    this.fortDbg.spots = 0; this.fortDbg.working = 0; this.fortDbg.idle = 0; this.fortDbg.built = 0;
    this.fortDbg.maxWork = 0; this.fortDbg.spawned = 0;
    this.fortDbg.covers = 0; this.fortDbg.trenches = 0; this.fortDbg.trenchDigs = 0;
    this.fortDbg.trenchPick = 0; this.fortDbg.abandon = 0; this.fortDbg.trenchNoDig = 0;
    this.fortDbg.digCalls = 0; this.fortDbg.digPoints = 0; this.fortDbg.squads = 0;
  }
}

// ============================================================
// ★ 工兵战术系数表（D3 骨架）：远离接敌（靠舰侧施工）；件优先级梯队 = D5 接线
// ============================================================
export const ENGINEER_TACTICS: UnitTactics = {
  mul: { h: 0.5, dist: 0.6, threat: 1.0, cover: 0.9, gap: 0.6, narrow: 0.7, hidden: 0, coverLOS: 0.8, high: 0, front: 0, back: 1.0, near: 0.5 },
  /** ★ D7：**从山背面上去**——背舰坡优先（工兵上山造岗哨走背舰面，不暴露迎舰面） */
  curves: { back: [[0.05, 0.3], [0.45, 0.4], [1, 0.5]], coverLOS: [[0.05, 0.3], [0.45, 0.5], [1, 0.6]] },
  withdraw: { h: 0.5, dist: 0.25, threat: 0.6, cover: 1.2, gap: 0.2, narrow: 0.1, hidden: 0, coverLOS: 0, high: 0, front: 0, back: 0, near: 0 },
  away: 1,
};
