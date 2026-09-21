// ============================================================
// SwarmCommander —— 蜂群指挥器（引擎侧：大队任务 / 小队覆盖 / BattalionView）
// ============================================================
// 《实体架构.md》§5.11 命令层级：
//   大队任务 BattalionMission（path + target，全队基线）
//   → 小队覆盖 SquadOrder（引擎可对特定小队覆盖；subTargets 按 squadId 分派）
//   → 队长个体指令（SquadTactics 分解 → 原子执行）
// 输入面 BattalionView（各队评级 + 全局玩家/舰船位置）；战术决策（F3+）后续消费本层。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import type { SwarmSystem } from './SwarmSystem';
import { analyzeLandingTerrain, type DefensePlan } from './LandingTerrain';
import { resolveDoctrine, type MobTactics } from './SquadDoctrine';
import { applyPosture, type BattlePosture } from './Posture';
import { PostureFn, releaseAt } from './PostureFn';
import { BattleLine, type LineUnit } from './BattleLine';
import { RANGED } from './RangedTactics';
import { TerrainScore } from './TerrainScore';
import { TerrainSemantics, Sem, SEM_NAMES } from './TerrainSemantics';
import { samplerFor } from '../../services/map/TerrainSampler';
import { decideTarget, type DecideCtx, type DecideState } from './Decide';
import { engineMissionFor } from './UnitTactics';
import { guardPoint, UNIT_TACTICS } from './UnitTactics';
import { setSteerTable } from '../../entity/SteerPick';
import { coverBlocksLine } from '../../entity/CoverEntity';
import type { SquadRating } from './SquadTable';
import { SQUAD_MAX, type Squad } from './SquadTable';
import type { TacticalOrder, UnitRole } from '../../entity/SwarmUnit';

/** 重组/岗位计算用的复用暂存（零分配） */
const _c0 = { x: 0, z: 0 };
const _c1 = { x: 0, z: 0 };

/** ★ 引擎侧信息面（《敌人管线设计.md》§3.5）：战术决策的输入 */
export interface BattalionView {
  squads: SquadRating[];
  playerX: number;
  playerZ: number;
  shipX: number;
  shipZ: number;
  now: number;
}

export class SwarmCommander {
  /** 大队任务（基线；周期重发保持存活，队长不抢） */
  private mission: TacticalOrder | null = null;
  /** ★ S0 勘察：地形检测产出的防守布置 */
  private plan: DefensePlan | null = null;
  /** ★ L1 敌人地形语义表（静态·舰船锚；《敌人管线设计.md》§1；落地/换落点重算） */
  readonly semantics = new TerrainSemantics();
  /** ★ 工程阶段（S1）：造掩体端口（模式层注入；生成 CoverEntity(owner:'enemy', poster:false)） */
  buildCover: ((x: number, z: number, variant: 'cover' | 'wall') => void) | null = null;
  /** ★ S1：挖战壕端口（模式层注入；每次一块 4×4m、1 层） */
  digTrench: ((x: number, z: number) => void) | null = null;
  /** ★ 兵力创建端口（模式层注入：按角色在 (x,z) 生成一只；**全权在本层**）
   *  @param near 开局班底用：**不做"≥80m 远离玩家"外推**（直接在锚点生成，工程队能立刻开工） */
  spawnMob: ((x: number, z: number, role: UnitRole, elite?: boolean, near?: boolean) => void) | null = null;
  /** ★ 按 mobIndex 生成一只（名单重放用；模式层注入） */
  spawnMobIndex: ((x: number, z: number, mobIndex: number) => void) | null = null;
  /** ★ 施工兵种生成端口（独有施工战术：模式层挑名册 canBuild 兵种；无 → 杂兵兜底） */
  spawnBuilder: ((x: number, z: number) => void) | null = null;
  /** ★ 逐兵种战术表（名册 `EnemySpec.tactics`；模式层按 mobIndex 提供） */
  mobTactics: ((mobIndex: number) => MobTactics | null) | null = null;
  /** ★ 当前态势（引擎内部变量；驱动各编队命令强度） */
  battlePosture: BattlePosture = 'fortify';
  /** ★ 态势函数（M2：p = clamp(schedule(t) + provocation)；连续权重插值） */
  private readonly postureFn = new PostureFn();
  /** ★ 态势调试值：攻势强度 / 日程 / 挑衅（覆盖层与测试读取） */
  postureP = 0;
  postureSchedule = 0;
  postureProvocation = 0;
  /** 内部日程时钟（无太阳钟输入时的兜底：落地起算，7.5 分钟 = 一个白天） */
  private rhythmT = 0;
  /** 太阳钟口径：落地时的当日进度（节奏从落地起算 → t01 在黄昏到达 1；<0 = 待定） */
  private t01Base = -1;
  private static readonly DAY_RHYTHM_S = 450;
  /** 挑衅采样：最近命中戳（防重复计）+ 击杀差分 */
  private readonly hitSeen = new Map<number, number>();
  private lastKills = 0;
  /** 单日节律增兵：第一波 / 总攻 是否已增兵 */
  private wave1Sent = false;
  private finalSent = false;
  /** ★ 调试/测试：日程进度覆盖（0~1；<0 = 关闭覆盖，用太阳钟） */
  debugDayT01 = -1;
  /** ★ 迷失回收：离队长过远且卡住的代理（uid → 上次位置/时间/连续卡死次数） */
  private readonly lost = new Map<number, { x: number; z: number; at: number; stuck: number }>();
  private lostAccum = 0;
  /** 迷失判定：离队长 > 60m；8s 内挪动 < 2m 视为卡死；连续 2 拍 → 自我销毁 */
  private static readonly LOST_DIST = 60;
  private static readonly LOST_STUCK_S = 8;
  private static readonly LOST_MOVE_EPS = 2;
  /** 进入总攻时的兵力（撤退判定基准） */
  private aliveAtPosture = 0;
  /** ★ 战役级闭环（1Hz）：小队评级/求援/受阻 → 大队改派（自下而上的反馈闭环） */
  private tacticalAccum = 0;
  /** ★ 进攻队列调控（前/中/后排 + 车道；进攻态势时生效） */
  private readonly battleLine = new BattleLine();
  /** ★ 地块有利位置评分表（全兵种共用；掩体/态势变化即重建） */
  private readonly terrainScore = new TerrainScore();
  /** 评分表触发戳（换落点 +1） */
  private scoreStamp = 0;
  /** 态势代次（切换 → 触发整队） */
  private postureEpoch = 0;
  private readonly progress = new Map<number, { d: number; at: number; stall: number }>();
  private readonly supportCd = new Map<number, number>();
  /** 最近一次大队决策（调试/测试读取） */
  lastDecision: { squad: number; kind: string; at: number } | null = null;
  /** ★ 已建成的掩体（远程驻守点；换落点 planDefense 时清空） */
  private readonly builtCovers: { x: number; z: number }[] = [];
  /** ★ 起飞回收名单（兵种属性 + 数量；放置由本层决定） */
  private recalledRoster: { mobIndex: number; role: UnitRole; count: number }[] | null = null;
  /** ★ 大队：一队 30 怪；一局多个 */
  private battalionCount = 0;
  /** ★ 待登场队列（**逐步登场**；总攻可一次性整编队） */
  private spawnQueue: { x: number; z: number; role: UnitRole; elite: boolean; mobIndex: number }[] = [];
  private spawnAccum = 0;
  /** 登场间隔（秒/只） */
  private static readonly SPAWN_INTERVAL = 1.5;
  private static readonly BATTALION_SIZE = 30;
  private static readonly BATTALION_MAX = 4;
  /** ★ 战术阶段（S0 勘察 → S1 工程 → S2 防线就绪） */
  stage: 'S0' | 'S1' | 'S2' = 'S0';
  /** ★ 待建工事块（逐步拼装：掩体每块 4m，战壕每块 4m；外环 → 内环） */
  private buildPieces: { kind: 'cover' | 'trench'; x: number; z: number; ring: 0 | 1 | 2 }[] = [];
  private readonly builtSlots = new Set<string>();
  private engAccum = 0;
  private buildCd = 0;
  /** ★ 各工程队自己的施工冷却（squadId → 剩余秒；并行施工用） */
  private readonly buildCds = new Map<number, number>();
  private resendAccum = 0;
  private static readonly RESEND_S = 10;

  /** ★ 部署选点（Decide.ts）：状态计数 + 上下文复用对象（每拍赋值，零分配） */
  private readonly decideSt: DecideState = { coverIdx: 0, assaultIdx: 0, screenIdx: 0, flyerIdx: 0 };
  /** ★ 工程队稳定分派（squadId → buildPieces 下标；防止每拍重挑 → 来回跑） */
  private readonly buildAssign = new Map<number, number>();
  /** ★ 驻守位锁定 / 驻守滞回（Decide 消费；防"来回走"） */
  private readonly holdPos = new Map<number, { x: number; z: number }>();
  private readonly protectState = new Map<number, boolean>();
  /** ★ 近 8s 被击小队（保护状态的反击开关；每决策拍从 recentHits 重建） */
  private readonly alertSet = new Set<number>();
  private readonly decideCtx: DecideCtx = {
    plan: null as unknown as DecideCtx['plan'],
    table: null as unknown as TerrainScore,
    playerX: 0, playerZ: 0, chase: false, lineSlot: null,
    front: { x: 0, z: 0 },
    buildSlot: null, slot: undefined, buildTarget: null, buildSite: null, stage: 'S0',
    hold: new Map(), protectState: new Map(), alert: new Set(), post: new Map(), mission: 'hold',
    builders: [], buildPieces: [], builtSlots: new Set<string>(),
    highPick: null, covers: [],
  };

  constructor(private readonly swarm: SwarmSystem) {}

  /** ★ 大队任务（路径 + 目标；`subTargets` 按 squadId 分派到各队） */
  setMission(order: TacticalOrder | null): void {
    this.mission = order;
    this.resendAccum = 0;
    this.dispatchMission();
  }

  /** ★ 对特定小队下覆盖命令（引擎优先级最高，队长不抢） */
  orderSquad(squadId: number, order: TacticalOrder, ttl = 30): void {
    this.swarm.issueOrder(squadId, order, ttl);
  }

  /** ★ 发信号（五轴「时序」：等 signal 的命令到点生效） */
  emitSignal(id: number): void {
    this.swarm.tactics.board.emitSignal(id);
  }

  /** ★ S0 勘察：舰船落地周边地形检测 → DefensePlan（高地/掩体位/来向/三环）
   *  @param playerX,playerZ 玩家位置：**参与战术轴**（玩家从哪边来，防线朝哪边摆） */
  planDefense(cx: number, cz: number, radius = 80, playerX?: number, playerZ?: number): DefensePlan | null {
    const raster = RasterMap.current;
    if (!raster) return null;
    // ★ 战术轴偏好 = 舰船 → 玩家（玩家在附近 15~140m 时；否则用扫描的最可走方向）
    let px: number | undefined, pz: number | undefined;
    if (playerX !== undefined && playerZ !== undefined) {
      const dx = playerX - cx, dz = playerZ - cz;
      const d = Math.hypot(dx, dz);
      if (d > 15 && d < 140) { px = dx / d; pz = dz / d; }
    }
    this.plan = analyzeLandingTerrain(raster, cx, cz, radius, px, pz);
    // ★ 建造顺序：外环（≈56m）50m 开外）→ 中环 → 内环（≈24m ≈ 远程覆盖线）
    //   每环：**掩体先行**（每个掩位 3 块，沿切线 ±4m → 12m 宽）→ **战壕跟进**（该环弧上每 4m 一块）
    const ringOrder: (0 | 1 | 2)[] = [2, 1, 0];
    this.buildPieces = [];
    // ★ 工程兵优先在**有利位置**（扫描产物评分）施工：同环内按 post 分排序
    const postScore = new Map<string, number>();
    for (const p of this.plan.posts) postScore.set(`${p.x.toFixed(1)},${p.z.toFixed(1)}`, p.score);
    const scoreOf = (x: number, z: number): number => postScore.get(`${x.toFixed(1)},${z.toFixed(1)}`) ?? 0;
    for (const r of ringOrder) {
      const tx = -this.plan.approachZ, tz = this.plan.approachX;   // 环的切线方向
      const slots = this.plan.coverSlots.filter((s) => s.ring === r)
        .sort((a, b) => scoreOf(b.x, b.z) - scoreOf(a.x, a.z));
      for (const slot of slots) {
        for (const off of [-4, 0, 4]) {
          this.buildPieces.push({ kind: 'cover', x: slot.x + tx * off, z: slot.z + tz * off, ring: r });
        }
      }
      const line = this.plan.trenchLines[r] ?? [];
      for (const p of line) this.buildPieces.push({ kind: 'trench', x: p.x, z: p.z, ring: r });
    }
    // ★ 兜底：地形分析没给出可用点位（开阔地/全被拒）→ 沿来向弧线自造掩体位
    if (this.buildPieces.length === 0) {
      const raster = RasterMap.current;
      const a0 = Math.atan2(this.plan.approachZ, this.plan.approachX);
      for (const r of [2, 1, 0] as const) {
        for (const k of [-2, 0, 2]) {
          const a = a0 + k * 0.35;
          const x = this.plan.cx + Math.cos(a) * [40, 60, 80][r];
          const z = this.plan.cz + Math.sin(a) * [40, 60, 80][r];
          const role = raster?.tileDefAt(x, z).genRole;
          if (role === 'pit' || role === 'liquid') continue;
          if (raster && raster.surfaceHeightAt(x, z) < -1.2) continue;
          this.buildPieces.push({ kind: 'cover', x, z, ring: r });
        }
      }
    }
    this.builtSlots.clear();
    this.progress.clear();      // ★ 换落点：战役级闭环状态复位
    this.supportCd.clear();
    this.battleLine.clear();    // ★ 换落点：进攻队列复位
    this.postCache.clear();     // ★ 现场有利位置缓存复位
    this.scoreStamp++;          // ★ 评分表触发戳（换落点重算）
    this.terrainScore.clear();
    this.stage = 'S1';
    // ★ 换登陆点 = 重新部署：取消上一落点排队的兵力，本落点重新起一个大队
    //   （舰船会不断移动换登陆点；每次落地都要有自己的防御布置）
    this.spawnQueue.length = 0;
    this.spawnAccum = 0;
    this.battalionCount = 0;
    // ★ 单日节律复位（§3.5）：日程从落地重新走，波次标记/挑衅采样清零
    this.rhythmT = 0;
    this.t01Base = -1;
    this.wave1Sent = false;
    this.finalSent = false;
    this.hitSeen.clear();
    this.lost.clear();
    this.lostAccum = 0;
    this.buildAssign.clear();
    this.holdPos.clear();
    this.protectState.clear();
    this.postAssign.clear();
    this.missionAssign.clear();
    this.taskedSquads.clear();
    setSteerTable(null);
    this.lastKills = this.swarm.ledger.kills;
    this.postureFn.reset(performance.now() / 1000);
    this.battlePosture = 'fortify';
    // ★ 兵力创建（全权在本层）：
    //   · 回收名单 → 按名单**逐步回场**（数量/兵种照旧）
    //   · 全新驻防 → 开局只上**少量班底**（近战 + 后勤修工事），其余由节律逐步补满基数
    if (this.recalledRoster) {
      this.spawnBattalion(false);
    } else {
      this.spawnCadre();
      this.spawnBattalion(false);
    }
    return this.plan;
  }

  /** ★ 起飞回收：只交**名单**（兵种属性 + 数量）——怎么布置由本层决定 */
  setRecalledRoster(roster: { mobIndex: number; role: UnitRole; count: number }[]): void {
    this.recalledRoster = roster.length > 0 ? roster : null;
  }

  /** ★ 生成一个大队（30 怪；按角色配比 · 沿外环弧部署；后续大队更远列阵）
   *  编成来源：优先**起飞回收名单**（兵种/数量照旧；放置仍按本层战术布置），
   *  否则标准配比（±2 随机 + 概率精英）。
   *  @param instant 总攻/落地用：true = 一次性上整编队；false = **逐步登场**（队列滴灌） */
  spawnBattalion(instant = false): boolean {
    const plan = this.plan;
    if (!plan || this.battalionCount >= SwarmCommander.BATTALION_MAX) return false;
    const roster = this.recalledRoster;
    const useRoster = !!roster && !!this.spawnMobIndex;
    if (!useRoster && !this.spawnMob) return false;
    this.battalionCount++;
    const entries: { role: UnitRole; elite: boolean; mobIndex: number }[] = [];
    if (useRoster) {
      this.recalledRoster = null;
      for (const r of roster!) {
        for (let i = 0; i < r.count; i++) entries.push({ role: r.role, elite: false, mobIndex: r.mobIndex });
      }
    } else {
      // ★ 配比（基准 30）：盾 6 / 突击 10 / 远程 6 / 后勤 4 / 飞行 4；每类 ±2；精英 0~2
      const base: [UnitRole, number][] = [
        ['shield', 6], ['assault', 10], ['ranged', 6], ['logistics', 4], ['flyer', 4],
      ];
      const comp = base.map(([role, n]) => [role, Math.max(1, n + Math.round((Math.random() - 0.5) * 4))] as [UnitRole, number]);
      for (const [role, n] of comp) for (let i = 0; i < n; i++) entries.push({ role, elite: false, mobIndex: -1 });
      const eliteN = (Math.random() < 0.5 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0);
      for (let i = 0; i < eliteN; i++) entries.push({ role: 'assault', elite: true, mobIndex: -1 });
    }
    if (entries.length === 0) return false;
    const baseA = Math.atan2(plan.approachZ, plan.approachX);
    // ★ 集结区（正面楔形：±30°、≈96m 起）——从来向远处进场，**不围圈**
    const ringR = 96 + (this.battalionCount - 1) * 8;
    const total = entries.length;
    // ★ 部署锚点：**优先用自身地形分析产出的可站点**（掩体位/高地/战壕线）——
    //   保证所有兵都落在可达陆地上（此前盲投 96m 环：施工队掉湖里 → 永远开不了工）；
    //   锚点不足时才退回来向楔形环。
    const anchors = this.placementAnchors(plan);
    let k = 0;
    for (const e of entries) {
      let x: number, z: number;
      if (anchors && anchors.length > 0) {
        const a = anchors[k % anchors.length];
        x = a.x + (Math.random() - 0.5) * 2;
        z = a.z + (Math.random() - 0.5) * 2;
      } else {
        const a = baseA + (-1 + (2 * k) / total) * (Math.PI / 6);
        const rr = ringR + (Math.random() - 0.5) * 10;
        x = plan.cx + Math.cos(a) * rr;
        z = plan.cz + Math.sin(a) * rr;
      }
      k++;
      if (instant) {
        if (e.mobIndex >= 0 && this.spawnMobIndex) this.spawnMobIndex(x, z, e.mobIndex);
        else this.spawnMob?.(x, z, e.role, e.elite);
      } else {
        this.spawnQueue.push({ x, z, role: e.role, elite: e.elite, mobIndex: e.mobIndex });
      }
    }
    return true;
  }

  /** ★ 开局班底（§3.5 扎根期）：少量近战守线 + 后勤/远程开工；其余由单日节律逐步补
   *  ★ 施工兵优先走 `spawnBuilder`（名册 canBuild 兵种）——保证开局有真正的工程队 */
  private spawnCadre(): void {
    const plan = this.plan;
    if (!plan) return;
    const anchors = this.placementAnchors(plan);
    const at = (k: number): { x: number; z: number } => (anchors.length > 0
      ? { x: anchors[k % anchors.length].x, z: anchors[k % anchors.length].z }
      : { x: plan.cx + plan.approachX * 40, z: plan.cz + plan.approachZ * 40 });
    // ① 工程队：3 只（有专门端口用专门的；否则退"杂兵兼任"名单）
    for (let k = 0; k < 3; k++) {
      const a = at(k);
      if (this.spawnBuilder) this.spawnBuilder(a.x + (Math.random() - 0.5) * 2, a.z + (Math.random() - 0.5) * 2);
      else this.spawnMob?.(a.x + (Math.random() - 0.5) * 2, a.z + (Math.random() - 0.5) * 2, 'assault', false, true);
    }
    // ② 近战护卫 + 远程
    if (!this.spawnMob) return;
    const roles: UnitRole[] = ['shield', 'shield', 'assault', 'assault', 'ranged'];
    for (let k = 0; k < roles.length; k++) {
      const a = at(k + 3);
      this.spawnMob(a.x + (Math.random() - 0.5) * 2, a.z + (Math.random() - 0.5) * 2, roles[k], false, true);
    }
  }

  /** ★ 可站部署锚点（地形分析产物：掩体位 + 高地 + 战壕线；空 = 无可用点） */
  private placementAnchors(plan: DefensePlan): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    for (const c of plan.coverSlots) out.push({ x: c.x, z: c.z });
    for (const g of plan.highGround) out.push({ x: g.x, z: g.z });
    for (const line of plan.trenchLines) for (const p of line) out.push(p);
    return out;
  }

  /** ★ 防守布置（读；阶段机 S0~S6 消费） */
  get defensePlan(): DefensePlan | null {
    return this.plan;
  }

  /** ★ 取离 (x,z) 最近的高地（半径内；无 = null）——远程队占顶用 */
  private pickHighGroundNear(
    plan: DefensePlan, x: number, z: number, radius: number,
  ): { x: number; z: number; h: number } | null {
    let best: { x: number; z: number; h: number } | null = null;
    let bestD2 = radius * radius;
    for (const g of plan.highGround) {
      const d2 = (g.x - x) ** 2 + (g.z - z) ** 2;
      if (d2 <= bestD2) { bestD2 = d2; best = g; }
    }
    return best;
  }

  /** ★ 远程驻守点（掩体后侧）：已建掩体 > 规划掩体位；点在"掩体背向来向"一侧 1.2m。
   *  requireInRange = 只取距玩家 ≤48m 的（保证驻守点能射到玩家）；按距玩家近→远排序。 */
  private garrisonCovers(
    plan: DefensePlan, playerX: number, playerZ: number, requireInRange: boolean,
  ): { x: number; z: number }[] {
    const out: { x: number; z: number; d2: number }[] = [];
    const add = (x: number, z: number): void => {
      const bx = x - plan.approachX * 1.2;
      const bz = z - plan.approachZ * 1.2;
      const d2 = (bx - playerX) ** 2 + (bz - playerZ) ** 2;
      if (requireInRange && d2 > 48 * 48) return;
      out.push({ x: bx, z: bz, d2 });
    };
    for (const c of this.builtCovers) add(c.x, c.z);
    // ★ 扫描产物（有利位置）优先作为驻守点；coverSlots 兜底
    for (const p of plan.posts) add(p.x, p.z);
    for (const c of plan.coverSlots) add(c.x, c.z);
    // ★ 战壕也是驻守点（全兵种偏好；前线附近取一格）
    const tr = this.terrainScore.bestTrenchNear(
      plan.cx + plan.approachX * 45, plan.cz + plan.approachZ * 45, 35);
    if (tr) add(tr.x, tr.z);
    out.sort((a, b) => a.d2 - b.d2);
    return out.map((o) => ({ x: o.x, z: o.z }));
  }

  setDefensePlan(plan: DefensePlan | null): void {
    this.plan = plan;
  }

  /** ★ 引擎侧信息面（战术决策的输入；每拍现取，零缓存） */
  view(playerX: number, playerZ: number, shipX: number, shipZ: number): BattalionView {
    return {
      squads: this.swarm.ratings(),
      playerX,
      playerZ,
      shipX,
      shipZ,
      now: performance.now() / 1000,
    };
  }

  /** ★ 每帧：大队任务周期重发（TTL 保持）+ 部署维护
   *  @param dayT01 当日进度 0~1（太阳钟：6:00=0 / 18:00=1；<0 = 无输入 → 内部兜底钟） */
  tick(dt: number, playerX = 0, playerZ = 0, dayT01 = -1): void {
    // ★ 态势函数（M2）：p = clamp(schedule(t) + provocation)
    //   日程 = 太阳钟（无输入 → 落地起算兜底钟）；挑衅 = 被击 + 击杀（衰减在 PostureFn 内）
    const now = performance.now() / 1000;
    this.rhythmT += dt;
    // ★ 节奏口径：从落地起算 → 黄昏（18:00）到达 1；落地即黄昏/夜晚 → 直接进入总攻节奏
    const dRaw = this.debugDayT01 >= 0 ? this.debugDayT01 : dayT01;
    let t01: number;
    if (dRaw >= 0) {
      if (this.t01Base < 0) this.t01Base = dRaw;
      t01 = (1 - this.t01Base) < 0.08
        ? 1
        : Math.min(1, Math.max(0, (dRaw - this.t01Base) / (1 - this.t01Base)));
    } else {
      t01 = Math.min(1, this.rhythmT / SwarmCommander.DAY_RHYTHM_S);
    }
    // ★ 兵力放行（日节律）：早间只放少量 → 基数 → 第一波/总攻放宽（账本闸门是唯一真源）
    this.swarm.ledger.releaseCap = Math.ceil(this.swarm.ledger.total * releaseAt(t01));
    for (const [id, t] of this.swarm.recentHits) {
      if (this.hitSeen.get(id) !== t) { this.hitSeen.set(id, t); this.postureFn.provoke(0.01); }
    }
    if (this.hitSeen.size > 64) {
      for (const id of this.hitSeen.keys()) if (!this.swarm.recentHits.has(id)) this.hitSeen.delete(id);
    }
    const killed = this.swarm.ledger.kills - this.lastKills;
    if (killed > 0) { this.lastKills = this.swarm.ledger.kills; this.postureFn.provoke(0.03 * killed); }
    const aliveRatio = this.aliveAtPosture > 0
      ? this.swarm.ledger.alive / this.aliveAtPosture : 1;
    const st = this.postureFn.update(dt, t01, aliveRatio, now);
    this.postureP = st.p;
    this.postureSchedule = st.schedule;
    this.postureProvocation = st.provocation;
    const next = st.posture;
    if (next !== this.battlePosture) {
      this.battlePosture = next;
      this.postureEpoch++;   // ★ 态势切换 → 进攻队列重新整队
      // 进总攻：记撤退判定基准；离开总攻：清基准（aliveRatio 回到 1）
      this.aliveAtPosture = next === 'assault' ? this.swarm.ledger.alive : 0;
      this.engAccum = 2;   // 态势切换 → 下一拍立即重发部署
    }
    // ★ 地块评分表重建（换落点/态势变化才全量重算；掩体/挖掘走局部重算）
    if (this.plan) {
      const raster = RasterMap.current;
      if (raster) {
        this.terrainScore.rebuild(raster, this.plan, this.builtCovers, this.postureP,
          this.scoreStamp + this.postureEpoch * 100000,
          this.battlePosture, playerX, playerZ);
        setSteerTable(this);   // ★ 表桥：实体侧 SteerPick 也能读表（同内核）
        // ★ L1 语义表（静态）：仅在"未建 / 换落点"时构建一次（玩家移动不触发）
        const a = this.semantics.anchor;
        if (!this.semantics.isReady || a.x !== this.plan.cx || a.z !== this.plan.cz) {
          const smp = samplerFor(raster);
          this.semantics.build({
            heightAt: (x, z) => smp.heightAt(raster, x, z),
            roleAt: (x, z) => smp.roleAt(raster, x, z),
          }, this.plan.cx, this.plan.cz);
          const dbg = typeof location !== 'undefined'
            && (location.search.includes('l1dbg') || location.search.includes('swarmdbg'));
          if (dbg) {
            const st = this.semantics.stats();
            console.log('[L1] 语义表构建完成', JSON.stringify(st));
            for (const cls of [Sem.HighGround, Sem.Choke, Sem.Hollow, Sem.FrontSlope, Sem.ReverseSlope]) {
              const top = this.semantics.regionsOf(cls).slice(0, 3)
                .map((r) => `#${r.id}(a=${r.area}, rep=${r.rx.toFixed(0)},${r.rz.toFixed(0)})`).join(' ');
              if (top) console.log(`[L1] ${SEM_NAMES[cls]}: ${top}`);
            }
          }
          (globalThis as unknown as { __l1?: TerrainSemantics }).__l1 = this.semantics;
        }
      }
    }
    if (this.mission) {
      this.resendAccum += dt;
      if (this.resendAccum >= SwarmCommander.RESEND_S) {
        this.resendAccum = 0;
        this.dispatchMission();
      }
    }
    this.engineeringTick(dt, playerX, playerZ);
    // ★ 迷失回收（1Hz）：卡死回不来的代理自我销毁（非击杀，归还编制）
    this.reapLost(dt);
    // ★ 战役级闭环（1Hz，晚于工程拍 → 反馈决策可覆盖基础部署）
    this.tacticalTick(dt, playerX, playerZ);
    // ★ 逐步登场：队列滴灌（每 SPAWN_INTERVAL 出一只；总攻走 instant 不入队）
    if (this.spawnQueue.length > 0) {
      this.spawnAccum += dt;
      while (this.spawnAccum >= SwarmCommander.SPAWN_INTERVAL && this.spawnQueue.length > 0) {
        this.spawnAccum -= SwarmCommander.SPAWN_INTERVAL;
        const u = this.spawnQueue.shift()!;
        if (u.mobIndex >= 0 && this.spawnMobIndex) this.spawnMobIndex(u.x, u.z, u.mobIndex);
        else this.spawnMob?.(u.x, u.z, u.role, u.elite);
      }
    }
    // ★ 单日节律增兵（§3.5）：第一波（t01≥0.45）与总攻（t01≥0.80）各来一个大队；
    //   开局班底 + 逐步补满的基数是常备，两个波峰才是"大量增兵"（BATTALION_MAX 兜底）
    if (this.plan && this.stage !== 'S0') {
      if (!this.wave1Sent && t01 >= 0.45) {
        this.wave1Sent = true;
        this.spawnBattalion();
        this.lastDecision = { squad: -1, kind: 'wave1', at: now };
      }
      if (!this.finalSent && t01 >= 0.80) {
        this.finalSent = true;
        this.spawnBattalion(true);   // 总攻：整编一次性压上
        this.lastDecision = { squad: -1, kind: 'final', at: now };
      }
    }
  }

  /** ★ 每队稳定岗位（squadId → 岗哨/高地/掩体位/战壕；拆队前一直有效） */
  private readonly postAssign = new Map<number, { x: number; z: number }>();
  /** ★ 引擎大任务（粘性：squadId → { mission, epoch }；只在落点/态势/阶段切换时重派） */
  private readonly missionAssign = new Map<number, { mission: string; epoch: number }>();

  /** ★ 岗位分派：新队 → 就近未被认领的岗（一次定终身，杜绝每拍轮转 → 左右摆）
   *  ★ 兵种投影：盾队优先**隘口**（窄口吃线），其余按 高地/掩体位/战壕 */
  private ensurePosts(
    squads: readonly { id: number; type: string; members: Map<number, { x: number; z: number }> }[],
  ): void {
    const plan = this.plan;
    if (!plan) return;
    const missing = squads.filter((s) => !this.postAssign.has(s.id));
    if (missing.length === 0) return;
    const posts: { x: number; z: number }[] = [];
    for (const c of plan.chokepoints) posts.push({ x: c.x, z: c.z });
    const chokeN = posts.length;
    for (const g of plan.highGround) posts.push({ x: g.x, z: g.z });
    for (const p of plan.posts) posts.push({ x: p.x, z: p.z });
    for (const line of plan.trenchLines) for (const p of line) posts.push(p);
    if (posts.length === 0) return;
    const claimed = new Set<number>();
    for (const [, pos] of this.postAssign) {
      for (let i = 0; i < posts.length; i++) {
        if (posts[i].x === pos.x && posts[i].z === pos.z) { claimed.add(i); break; }
      }
    }
    for (const s of missing) {
      let cx = 0, cz = 0, n = 0;
      for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
      if (n === 0) continue;
      cx /= n; cz /= n;
      let bi = -1, bd = Infinity;
      // ★ 盾队先找隘口（80m 内最近未认领）；找不到再走通用列表
      if (s.type === 'defense') {
        for (let i = 0; i < chokeN; i++) {
          if (claimed.has(i)) continue;
          const d = (posts[i].x - cx) ** 2 + (posts[i].z - cz) ** 2;
          if (d < bd && d < 80 * 80) { bd = d; bi = i; }
        }
      }
      if (bi < 0) {
        bd = Infinity;
        for (let i = 0; i < posts.length; i++) {
          if (claimed.has(i)) continue;
          const d = (posts[i].x - cx) ** 2 + (posts[i].z - cz) ** 2;
          if (d < bd) { bd = d; bi = i; }
        }
      }
      if (bi < 0) bi = 0;   // 岗全被认领 → 允许共用最近岗
      if (bi >= 0) { claimed.add(bi); this.postAssign.set(s.id, { x: posts[bi].x, z: posts[bi].z }); }
    }
  }

  /** ★ 成员级任务：写/清（写 taskX/Z 列；uid → 池下标扫描） */
  private writeTask(uid: number, x: number, z: number): void {
    const pool = this.swarm.pool;
    for (let i = 0; i < pool.count; i++) {
      if (pool.swarmUid[i] !== uid) continue;
      pool.taskX[i] = x; pool.taskZ[i] = z;
      return;
    }
  }

  private clearMemberTasks(s: { id: number; members: Map<number, { x: number; z: number }> }): void {
    if (!this.taskedSquads.has(s.id)) return;
    for (const uid of s.members.keys()) this.writeTask(uid, 0, 0);
    this.taskedSquads.delete(s.id);
  }

  /** ★ 护卫扇区（成员级）：沿"工地→威胁"垂线分散站位（每人 4m 间隔） */
  private spreadGuards(
    s: { id: number; type: string; members: Map<number, { x: number; z: number }> },
    siteX: number, siteZ: number, px: number, pz: number,
  ): void {
    const dx = px - siteX, dz = pz - siteZ;
    const dl = Math.hypot(dx, dz) || 1;
    const ux = dx / dl, uz = dz / dl;
    const gd = UNIT_TACTICS[s.type as keyof typeof UNIT_TACTICS]?.guardDist ?? 8;
    const gx = siteX + ux * gd, gz = siteZ + uz * gd;
    const tx = -uz, tz = ux;   // 垂线（弧线切线）
    const n = s.members.size;
    let k = 0;
    for (const uid of s.members.keys()) {
      const off = (k - (n - 1) / 2) * 4;
      k++;
      this.writeTask(uid, gx + tx * off, gz + tz * off);
    }
    this.taskedSquads.add(s.id);
  }

  /** ★ 成员级分块（工程并行）：把本队成员分到附近未认领块 → 直写任务目标 */
  private spreadBuilders(s: { id: number; members: Map<number, { x: number; z: number }> }, cx: number, cz: number): void {
    const near: number[] = [];
    for (let i = 0; i < this.buildPieces.length && near.length < 3; i++) {
      const q = this.buildPieces[i];
      if (this.builtSlots.has(`${q.x},${q.z}`)) continue;
      if ((q.x - cx) ** 2 + (q.z - cz) ** 2 > 40 * 40) continue;
      near.push(i);
    }
    if (near.length === 0) return;
    let k = 0;
    for (const uid of s.members.keys()) {
      const q = this.buildPieces[near[k % near.length]];
      k++;
      this.writeTask(uid, q.x, q.z);
    }
    this.taskedSquads.add(s.id);
  }

  /** ★ 工程队分派：保持已派未建块；否则**在自己环带内**挑最近未认领块（少横穿），
   *  本环带建完再跨环 → "环带作业"（外环→中环→内环） */
  private assignBuild(squadId: number, cx: number, cz: number): number {
    const cur = this.buildAssign.get(squadId);
    if (cur !== undefined && cur < this.buildPieces.length
      && !this.builtSlots.has(`${this.buildPieces[cur].x},${this.buildPieces[cur].z}`)) return cur;
    const claimed = new Set<number>(this.buildAssign.values());
    // 就近未建块 → 作为本队"环带基准"
    let homeRing = -1, homeD = Infinity, anyBest = -1, anyD = Infinity;
    for (let i = 0; i < this.buildPieces.length; i++) {
      const q = this.buildPieces[i];
      if (this.builtSlots.has(`${q.x},${q.z}`) || claimed.has(i)) continue;
      const d = (q.x - cx) ** 2 + (q.z - cz) ** 2;
      if (d < anyD) { anyD = d; anyBest = i; }
      if (d < homeD) { homeD = d; homeRing = q.ring; }
    }
    if (anyBest < 0) return -1;
    // 环带内最近未认领块（优先级：环带基准 → 全局最近）
    let ringBest = -1, ringD = Infinity;
    for (let i = 0; i < this.buildPieces.length; i++) {
      const q = this.buildPieces[i];
      if (q.ring !== homeRing) continue;
      if (this.builtSlots.has(`${q.x},${q.z}`) || claimed.has(i)) continue;
      const d = (q.x - cx) ** 2 + (q.z - cz) ** 2;
      if (d < ringD) { ringD = d; ringBest = i; }
    }
    const best = ringBest >= 0 ? ringBest : anyBest;
    this.buildAssign.set(squadId, best);
    return best;
  }

  /** ★ 成员级任务列使用中的小队（任务切走时清零用） */
  private readonly taskedSquads = new Set<number>();
  /** ★ 小队自动重组（§4.6）：同键"不满半"小队 → 并入最近同键队 */
  private mergeTick(now: number): void {
    const list = [...this.swarm.squads.all()].filter((s) =>
      !s.singleton && !s.suicide && s.members.size > 0 && s.members.size * 2 <= SQUAD_MAX);
    if (list.length === 0) return;
    const pool = this.swarm.pool;
    for (const small of list) {
      const st = this.swarm.tactics.board.get(small.id);
      if (st && now < st.until) continue;                      // 有命令在身 → 不并
      if (!this.swarm.squads.centroidOf(small.id, _c0)) continue;
      const cSmall = { x: _c0.x, z: _c0.z };
      let best: Squad | null = null;
      let bestD = Infinity;
      for (const big of this.swarm.squads.all()) {
        if (big === small || big.singleton || big.suicide) continue;
        if (big.type !== small.type || big.mobKind !== small.mobKind
          || big.builders !== small.builders || big.suicide !== small.suicide) continue;
        if (big.members.size + small.members.size > SQUAD_MAX) continue;
        if (!this.swarm.squads.centroidOf(big.id, _c1)) continue;
        const d = (_c1.x - cSmall.x) ** 2 + (_c1.z - cSmall.z) ** 2;
        if (d < bestD) { bestD = d; best = big; }
      }
      if (!best) continue;
      for (const uid of [...small.members.keys()]) {
        const res = this.swarm.squads.mergeMember(uid, best);
        if (!res) continue;
        this.writeTask(uid, 0, 0);   // ★ 并队后旧任务清零（由新队的任务重派接管）
        for (const ch of res.leaderChanges) this.swarm.pushLeaderChange(ch.uid, ch.isLeader);   // ★ L3 队长镜像
        for (let i = 0; i < pool.count; i++) {
          if (pool.swarmUid[i] !== uid) continue;
          pool.squadId[i] = best.id;
          pool.battalionId[i] = best.battalionId;
          break;
        }
      }
      this.lastDecision = { squad: small.id, kind: 'merge', at: now };
      break;   // 一拍只并一队（避免连锁抖动）
    }
  }

  /** ★ 迷失回收（1Hz）：回队长寻路失败 → 目标改回队长；仍卡死 → 自我销毁
   *  触发：离队长 >60m 且 8s 内挪动 <2m（连续 2 拍）。销毁 = 非击杀离场（归还编制），
   *  避免"陷进出不去的地形"的代理永远占编制 / 算力（L3 实体由降格逻辑兜底）。 */
  private reapLost(dt: number): void {
    this.lostAccum += dt;
    if (this.lostAccum < 1) return;
    this.lostAccum = 0;
    const pool = this.swarm.pool;
    const now = performance.now() / 1000;
    for (let i = pool.count - 1; i >= 0; i--) {
      if (pool.isLeader[i] === 1) continue;
      const uid = pool.swarmUid[i];
      const squad = this.swarm.squads.get(pool.squadId[i]);
      const leader = squad?.members.get(squad.leaderUid);
      if (!leader) { this.lost.delete(uid); continue; }
      const d = Math.hypot(pool.x[i] - leader.x, pool.z[i] - leader.z);
      if (d < SwarmCommander.LOST_DIST) { this.lost.delete(uid); continue; }
      // ★ 回队长：迷失时把移动目标改到队长（寻路回队）
      pool.moveTargetX[i] = leader.x;
      pool.moveTargetZ[i] = leader.z;
      const rec = this.lost.get(uid);
      if (!rec) { this.lost.set(uid, { x: pool.x[i], z: pool.z[i], at: now, stuck: 0 }); continue; }
      if (Math.hypot(pool.x[i] - rec.x, pool.z[i] - rec.z) > SwarmCommander.LOST_MOVE_EPS) {
        rec.x = pool.x[i]; rec.z = pool.z[i]; rec.at = now; rec.stuck = 0; continue;
      }
      if (now - rec.at > SwarmCommander.LOST_STUCK_S && ++rec.stuck >= 2) {
        this.swarm.removeAgent(i, true, false);   // 非击杀离场 → 归还编制
        this.swarm.ledger.noteRemoved(1);
        this.lost.delete(uid);
      }
    }
    if (this.lost.size > 64) this.lost.clear();   // 防御：异常堆积直接清空
  }

  /** ★ 部署维护（2s 决策拍）——**按兵种分工 + 对玩家移动的敏感度不同**：
   *  · 近战（盾/突击）：**追玩家**（玩家在附近时直接压上去；否则推进到防线）
   *  · 施工队（canBuild）：守着自己的工位/工事，不因玩家跑动被拉走
   *  · 远程队：占住高地/火力点，**不追脸**
   *  · 后勤等：向防线后集结
   *  S1 = 边打边施工；S2 = 只维护部署（不再施工）。 */
  private engineeringTick(dt: number, playerX: number, playerZ: number): void {
    if (!this.plan) return;
    this.buildCd -= dt;
    const squads = [...this.swarm.squads.all()];
    // ★ 施工队 = **具备施工能力的兵种**（后勤不一定能施工；杂兵可兼任）；
    //   兜底：名册里一个施工兵种都没有（缺素材/未加载）→ 杂兵（assault）兼任
    let builders = squads.filter((s) => s.builders);
    if (builders.length === 0) builders = squads.filter((s) => s.type === 'assault');
    this.engAccum += dt;
    if (this.engAccum < 2) return;   // 2s 决策拍
    this.engAccum = 0;
    const slot = this.buildPieces.find((s) => !this.builtSlots.has(`${s.x},${s.z}`));
    const plan = this.plan;
    if (!slot && this.stage === 'S1') this.stage = 'S2';   // 无待建块 → 就绪
    // ★ 施工优先：施工队只受"玩家正踩在待建块上"（≤6m）影响，其余情况一律继续施工
    const nearPlayer = slot ? Math.hypot(playerX - slot.x, playerZ - slot.z) < 6 : false;
    const buildSlot = this.stage === 'S1' && slot && !nearPlayer ? slot : null;
    // 正面基准：有工事点用工事点；否则落点前方 40m
    const front = buildSlot ?? { x: plan.cx + plan.approachX * 40, z: plan.cz + plan.approachZ * 40 };
    // ★ 近战类目标：按**姿态 × 兵种配置**的追击开关决定打玩家还是守正面；
    //   施工期盾队前出掩护工事（screen 分支单独处理）
    const chase = Math.hypot(playerX - plan.cx, playerZ - plan.cz) < 90;
    // ★ 按小队属性部署（`SquadDoctrine`：通用兜底 + 属性覆盖 + 逐兵种 + 施工 override）→ 再叠态势
    const highPick = this.pickHighGroundNear(plan, front.x, front.z, 48);
    const covers = this.garrisonCovers(plan, playerX, playerZ, chase);
    // ★ 进攻队列调控（advance/mass/assault 时生效；前/中/后排 + 横向车道）
    //   ★ 用户定调（2026-09-21）：线位只是"队形调整的短暂命令"——**只有刚整队那一拍才下发**，
    //   其余时间不强制线位，让各队执行自己的战术（追击玩家/驻守/推进），否则永远不总攻。
    const lineActive = this.battlePosture === 'advance'
      || this.battlePosture === 'mass' || this.battlePosture === 'assault';
    let lineFresh = false;
    if (lineActive) {
      let fx = plan.approachX, fz = plan.approachZ;
      const ax = playerX - plan.cx, az = playerZ - plan.cz;
      const al = Math.hypot(ax, az);
      if (al > 12) { fx = ax / al; fz = az / al; }
      const units: LineUnit[] = [];
      for (const s of squads) {
        let cx = 0, cz = 0, n = 0;
        for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
        if (n > 0) { cx /= n; cz /= n; }
        units.push({ id: s.id, type: s.type, builders: s.builders, cx, cz });
      }
      lineFresh = this.battleLine.update(performance.now() / 1000, playerX, playerZ, fx, fz, units,
        this.battlePosture === 'assault', this.postureEpoch);
    }
    // ★ 部署选点（Decide.ts）：读表投影集中一处；计数轮转复用对象（零分配）
    const st = this.decideSt;
    st.coverIdx = 0; st.assaultIdx = 0; st.screenIdx = 0; st.flyerIdx = 0;
    const ctx = this.decideCtx;
    ctx.plan = plan; ctx.table = this.terrainScore;
    ctx.playerX = playerX; ctx.playerZ = playerZ; ctx.chase = chase;
    ctx.front = front; ctx.buildSlot = buildSlot; ctx.slot = slot;
    ctx.builders = builders; ctx.buildPieces = this.buildPieces;
    ctx.builtSlots = this.builtSlots; ctx.highPick = highPick; ctx.covers = covers;
    ctx.hold = this.holdPos; ctx.protectState = this.protectState;
    // ★ 稳定岗位（每队一次分派；无岗队补岗）
    this.ensurePosts(squads);
    ctx.post = this.postAssign;
    // ★ 近 8s 被击小队 → "保护状态"的反击开关（打了保护的士兵 → 该打就打）
    this.alertSet.clear();
    const nowS = performance.now() / 1000;
    for (const [id, t] of this.swarm.recentHits) if (nowS - t <= 8) this.alertSet.add(id);
    ctx.alert = this.alertSet;
    // ★ 预分派工程队（稳定分配；取第一个在建块作为"工地"给近战护卫）
    let buildSite: { x: number; z: number } | null = null;
    if (this.stage === 'S1') {
      for (const s of builders) {
        let cx = 0, cz = 0, n = 0;
        for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
        if (n > 0) { cx /= n; cz /= n; }
        const idx = this.assignBuild(s.id, cx, cz);
        if (idx >= 0 && !buildSite) buildSite = { x: this.buildPieces[idx].x, z: this.buildPieces[idx].z };
      }
    }
    ctx.buildSite = buildSite;
    ctx.stage = this.stage;
    // ★ 大任务粘性（引擎只在此刻重派：落点/态势/施工阶段切换）
    const missionEpoch = this.postureEpoch * 100000 + this.scoreStamp * 2 + (this.stage === 'S1' ? 0 : 1);
    for (const s of squads) {
      const d = applyPosture(
        resolveDoctrine(s.type, s.builders, this.mobTactics?.(s.mobKind) ?? null),
        this.battlePosture,
      );
      let ma = this.missionAssign.get(s.id);
      if (!ma || ma.epoch !== missionEpoch) {
        ma = {
          mission: engineMissionFor(s.type, {
            isBuilder: builders.includes(s) || s.builders,
            stage: this.stage,
            posture: this.battlePosture,
          }),
          epoch: missionEpoch,
        };
        this.missionAssign.set(s.id, ma);
      }
      ctx.mission = ma.mission;
      // ★ 施工块稳定分派（施工大任务下才有目标；成员再分到不同块 → 并行施工）
      if (ma.mission === 'build' && this.stage === 'S1') {
        const idx = this.buildAssign.get(s.id);
        ctx.buildTarget = idx !== undefined && idx >= 0 ? this.buildPieces[idx] : buildSlot;
        let cx = 0, cz = 0, n = 0;
        for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
        if (n > 0) this.spreadBuilders(s, cx / n, cz / n);
      } else if (ma.mission === 'guard') {
        ctx.buildTarget = null;
        // ★ 护卫扇区（成员级）：被击/无工地 → 清任务（交给动态反击）；否则分散护卫位
        if (this.alertSet.has(s.id) || !ctx.buildSite) this.clearMemberTasks(s);
        else this.spreadGuards(s, ctx.buildSite.x, ctx.buildSite.z, playerX, playerZ);
      } else {
        ctx.buildTarget = null;
        this.clearMemberTasks(s);
      }
      // ★ 线位只在"刚整队"那一拍生效；★ 正在攻击（chase）的队**不受队列影响**
      ctx.lineSlot = lineFresh && !d.chase ? this.battleLine.get(s.id) : null;
      const out = decideTarget(d, s, ctx, st);
      this.swarm.issueOrder(s.id, {
        kind: out.kind, target: out.target, roe: out.roe,
        urgency: out.urgency, mission: out.mission || undefined, seq: 0,
      }, out.ttl);
    }
    // ⑤ 施工（**逐步拼装**，仅 S1）：**按各工程队自己的分配块并行施工**
    //   （每队 3s 掩体 / 4s 战壕；任一成员到块 ≤5m 即动工 → 修"来回跑/停摆"）
    if (this.stage === 'S1' && this.buildCover) {
      for (const s of builders) {
        const cd = this.buildCds.get(s.id) ?? 0;
        if (cd > 0) { this.buildCds.set(s.id, cd - dt); continue; }
        // ★ 就近动工：任一成员 ≤5m 的**最近未建块**（配合成员级分块 → 多块并行）
        let piece: { kind: 'cover' | 'trench'; x: number; z: number } | null = null;
        let bestD = 25;
        for (const m of s.members.values()) {
          for (const q of this.buildPieces) {
            if (this.builtSlots.has(`${q.x},${q.z}`)) continue;
            const d = (m.x - q.x) ** 2 + (m.z - q.z) ** 2;
            if (d <= bestD) { bestD = d; piece = q; }
          }
        }
        if (!piece) continue;
        if (piece.kind === 'cover') {
          this.buildCover(piece.x, piece.z, 'cover');
          this.builtCovers.push({ x: piece.x, z: piece.z });   // ★ 远程驻守点
          this.markTerrainDirty(piece.x, piece.z, 12);          // ★ 新掩体 → 表 + 采样缓存局部重算
          this.buildCds.set(s.id, 3);
        } else {
          this.digTrench?.(piece.x, piece.z);
          this.markTerrainDirty(piece.x, piece.z, 12, true);    // ★ 战壕（挖掘标记）→ 表 + 采样缓存局部重算
          this.buildCds.set(s.id, 4);
        }
        this.builtSlots.add(`${piece.x},${piece.z}`);
      }
    }
  }

  /** ★ 战役级闭环（1Hz）：**自下而上的反馈 → 大队重新决策**
   *  读：小队评级（血量/接敌/存活）+ 队长上报（求援/共享目击）+ 推进进度（受阻）
   *  写：覆盖该队的引擎命令（改派抽援 / 重算路径 / 换目标 / 残血撤离）
   *  规则集中在此；态势与兵种配置仍作兜底。 */
  private tacticalTick(dt: number, playerX: number, playerZ: number): void {
    if (!this.plan) return;
    this.tacticalAccum += dt;
    if (this.tacticalAccum < 1) return;
    this.tacticalAccum = 0;
    const now = performance.now() / 1000;
    // ★ 小队自动重组（§4.6）：同键不满半 → 并入最近同键队（有命令/交战中不并）
    this.mergeTick(now);
    const ratings = this.swarm.ratings();
    // ① 队长上报 → 大队裁决（跨队决策上收：队长不再私聊响应）
    for (const r of ratings) {
      const msgs = this.swarm.tactics.board.takeFor(r.squadId, now);
      for (const m of msgs) {
        if (m.kind !== 'requestSupport' && m.kind !== 'shareContact') continue;
        const helper = this.pickHelper(ratings, m.x, m.z, r.squadId, now);
        if (!helper) continue;
        this.swarm.issueOrder(helper.squadId, {
          kind: 'advance', target: { x: m.x, z: m.z }, roe: 'engage', seq: 0,
        }, 6);
        this.supportCd.set(helper.squadId, now + 10);
        this.lastDecision = { squad: helper.squadId, kind: m.kind === 'requestSupport' ? 'support' : 'scout', at: now };
      }
    }
    // ② 逐队：受阻重试/换目标 + 残血撤离（按逐兵种 retreatHp）
    for (const r of ratings) {
      const squad = this.swarm.squads.get(r.squadId);
      const st = this.swarm.tactics.board.get(r.squadId);
      const tgt = st?.order.target;
      if (tgt) {
        const d = Math.hypot(r.cx - tgt.x, r.cz - tgt.z);
        const pr = this.progress.get(r.squadId);
        if (!pr || d < pr.d - 1.5) {
          this.progress.set(r.squadId, { d, at: now, stall: 0 });
        } else if (now - pr.at > 8 && d > 8) {
          pr.stall++;
          if (pr.stall <= 1 && st) {
            st.pathAt = 0; st.pathFailedAt = 0; st.order.path = undefined;   // 重算路径重试
            this.lastDecision = { squad: r.squadId, kind: 'retry', at: now };
          } else {
            const alt = this.alternateTarget(r.cx, r.cz, tgt);
            this.swarm.issueOrder(r.squadId, { kind: 'advance', target: alt, roe: 'engage', seq: 0 }, 8);
            this.lastDecision = { squad: r.squadId, kind: 'retarget', at: now };
          }
          pr.at = now; pr.d = d;
        }
      }
      const dct = resolveDoctrine(r.type, squad?.builders === true,
        squad ? this.mobTactics?.(squad.mobKind) ?? null : null);
      if (dct.retreatHp > 0 && r.hpRatio <= dct.retreatHp && st?.order.kind !== 'retreat') {
        const ax = r.cx - playerX, az = r.cz - playerZ;
        const al = Math.hypot(ax, az) || 1;
        this.swarm.issueOrder(r.squadId, {
          kind: 'retreat',
          target: { x: r.cx + (ax / al) * 18, z: r.cz + (az / al) * 18 },
          seq: 0,
        }, 6);
        this.lastDecision = { squad: r.squadId, kind: 'withdraw', at: now };
      }
    }
  }

  /** 抽援对象：最近的空闲健康队（同队除外；10s 冷却防连环抽调） */
  private pickHelper(
    ratings: SquadRating[], x: number, z: number, exclude: number, now: number,
  ): SquadRating | null {
    let best: SquadRating | null = null;
    let bestD2 = Infinity;
    for (const r of ratings) {
      if (r.squadId === exclude || r.status !== 'idle' || r.hpRatio < 0.5) continue;
      if ((this.supportCd.get(r.squadId) ?? 0) > now) continue;
      const d2 = (r.cx - x) ** 2 + (r.cz - z) ** 2;
      if (d2 < bestD2) { bestD2 = d2; best = r; }
    }
    return best;
  }

  /** 受阻换目标：取最近的高地/掩体位；无地形点 → 原目标横向偏移 12m */
  private alternateTarget(cx: number, cz: number, tgt: { x: number; z: number }): { x: number; z: number } {
    const plan = this.plan;
    if (!plan) return tgt;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const g of plan.highGround) {
      const d = (g.x - cx) ** 2 + (g.z - cz) ** 2;
      if (d < bestD) { bestD = d; best = { x: g.x, z: g.z }; }
    }
    for (const c of plan.coverSlots) {
      const d = (c.x - cx) ** 2 + (c.z - cz) ** 2;
      if (d < bestD) { bestD = d; best = { x: c.x, z: c.z }; }
    }
    if (best) return best;
    return { x: tgt.x - plan.approachZ * 12, z: tgt.z + plan.approachX * 12 };
  }

  /** ★ 远程有利位置（制高点 / 掩体后；含"掩体真的挡子弹"校验）。
   *  规则：距离在 [0.5R, 1.05R]（能射到且不贴脸）且 **≥ minDist**（边撤边打时要求更远）；
   *  掩体挡住玩家视线加分；越接近理想站位（0.8R）越好；无合适点 → null（原地射击）。 */
  rangedPost(px: number, pz: number, range: number, minDist = 0): { x: number; z: number } | null {
    const plan = this.plan;
    if (!plan || range <= 0) return null;
    const ideal = range * RANGED.PREFER_RATIO;
    // ★ 远程优先入壕（用户定调）：在"理想站位 ±6m"的射程环带里找最高分战壕 → 直接选它
    const dMin = Math.max(minDist, range * 0.5, ideal - 6);
    const dMax = Math.min(range * 1.05, ideal + 6);
    if (dMax > dMin) {
      const trRing = this.terrainScore.bestTrenchNear(px, pz, dMax, dMin, dMax);
      if (trRing) return { x: trRing.x, z: trRing.z };
    }
    let best: { x: number; z: number } | null = null;
    let bestScore = -Infinity;
    const consider = (x: number, z: number, high: boolean, base = 0): void => {
      const d = Math.hypot(x - px, z - pz);
      if (d < range * 0.5 || d > range * 1.05 || d < minDist) return;
      const blocked = coverBlocksLine(px, pz, x, z);   // 玩家 → 该点：掩体挡不挡
      let score = base + -Math.abs(d - ideal) * 0.08;
      if (blocked) score += 3;
      if (high) score += 0.8;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    };
    // ★ 优先用**落地扫描产物**（posts：一次算好的制高/掩体位）；已建掩体实时补入
    for (const p of plan.posts) {
      if (p.kind === 'cover') consider(p.x - plan.approachX * 1.2, p.z - plan.approachZ * 1.2, false, p.score);
      else consider(p.x, p.z, true, p.score);
    }
    for (const c of this.builtCovers) {
      consider(c.x - plan.approachX * 1.2, c.z - plan.approachZ * 1.2, false, 3.5);
    }
    // ★ 战壕偏好（全兵种；远程最重）：玩家射程带内最高分战壕格
    const tr = this.terrainScore.bestTrenchNear(px, pz, range * 1.05);
    if (tr) consider(tr.x, tr.z, false, 2.0);
    if (best) return best;
    // ★ 扫描产物/掩体都不在射程带内（玩家跑远了）→ **现场找位**：
    //   以玩家为圆心、0.8R 为半径环采样（高地优先 / 掩体加成 / 可站）
    return this.terrainPost(px, pz, range);
  }

  /** ★ 现场有利位置（无扫描产物时）：玩家周围射程环采样 + 1.5s 缓存（多小队共用） */
  private readonly postCache = new Map<string, { x: number; z: number; at: number }>();
  private terrainPost(px: number, pz: number, range: number): { x: number; z: number } | null {
    const raster = RasterMap.current;
    if (!raster) return null;
    const key = `${Math.floor(px / 16)},${Math.floor(pz / 16)},${Math.round(range)}`;
    const nowMs = performance.now();
    const hit = this.postCache.get(key);
    if (hit && nowMs - hit.at < 1500) return { x: hit.x, z: hit.z };
    const r = range * RANGED.PREFER_RATIO;
    let best: { x: number; z: number } | null = null;
    let bestScore = -Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = px + Math.cos(a) * r;
      const z = pz + Math.sin(a) * r;
      const role = raster.tileDefAt(x, z).genRole;
      const h = raster.surfaceHeightAt(x, z);
      if (role === 'pit' || (role === 'liquid' && h < -0.8) || h < -1.2) continue;
      // 高地加成：相对周边 5m 的抬升
      const elev = h - (raster.surfaceHeightAt(x + 5, z) + raster.surfaceHeightAt(x - 5, z)
        + raster.surfaceHeightAt(x, z + 5) + raster.surfaceHeightAt(x, z - 5)) / 4;
      // ★ 优先读地块评分表（全兵种共用；掩体/态势权重已在表内）；表未就绪回落高程探针
      let score = this.terrainScore.scoreAt(x, z) ?? (elev * 0.5);
      if (score <= -1e8) continue;
      if (coverBlocksLine(px, pz, x, z)) score += 3;
      if (score > bestScore) { bestScore = score; best = { x, z }; }
    }
    if (best) this.postCache.set(key, { x: best.x, z: best.z, at: nowMs });
    return best;
  }

  /** ★ 调试/测试：强制切态势（覆盖态势函数自动转移；总攻同样锁定） */
  setPosture(p: BattlePosture): void {
    this.postureFn.force(p, performance.now() / 1000);
    this.battlePosture = p;
    this.aliveAtPosture = p === 'assault' ? this.swarm.ledger.alive : 0;
    this.engAccum = 2;   // 下一拍立即重发部署
  }

  /** ★ 硬边界查询（墙面/坑水；表未就绪 → false）：移动/寻路的危险地形判定 */
  blockedAt(x: number, z: number): boolean {
    return this.terrainScore.blockedAt(x, z);
  }

  /** ★ 表分查询（执行层候选方向打分用；未就绪/表外 → null） */
  scoreAt(x: number, z: number): number | null {
    return this.terrainScore.scoreAt(x, z);
  }

  /** ★ 水域查询（允许站立；执行层在水中 → 上岸权重） */
  isWaterAt(x: number, z: number): boolean {
    return this.terrainScore.isWaterAt(x, z);
  }

  /** ★ 地形脏区（模式层任何挖改都调这个）：表局部重算（脏窗 + 邻环）
   *  @param dug 显式挖掘（战壕）→ 打挖掘标记（战壕阈值放宽到 0.12m） */
  markTerrainDirty(x: number, z: number, r = 12, dug = false): void {
    this.terrainScore.invalidateArea(x, z, r, dug);
    const raster = RasterMap.current;
    if (raster) samplerFor(raster).invalidateArea(x, z, r);   // ★ 统一采样缓存同步失效
  }

  /** ★ 调试：态势一行摘要（覆盖层/测试读取） */
  postureInfo(): string {
    return `态势 ${this.battlePosture} p=${this.postureP.toFixed(2)}`
      + ` 日程=${this.postureSchedule.toFixed(2)} 挑衅=${this.postureProvocation.toFixed(2)}`;
  }

  /** 清理（退出模式） */
  clear(): void {
    this.mission = null;
    this.plan = null;
    this.stage = 'S0';
    this.battalionCount = 0;
    this.spawnQueue = [];
    this.spawnAccum = 0;
    this.buildPieces = [];
    this.builtSlots.clear();
    this.builtCovers.length = 0;
    this.engAccum = 0;
    this.buildCd = 0;
    this.resendAccum = 0;
    this.recalledRoster = null;
    this.postureFn.reset(performance.now() / 1000);
    this.battlePosture = 'fortify';
    this.aliveAtPosture = 0;
    this.rhythmT = 0;
    this.t01Base = -1;
    this.wave1Sent = false;
    this.finalSent = false;
    this.debugDayT01 = -1;
    this.hitSeen.clear();
    this.lost.clear();
    this.lostAccum = 0;
    this.buildAssign.clear();
    this.holdPos.clear();
    this.protectState.clear();
    this.postAssign.clear();
    this.missionAssign.clear();
    this.postureP = 0;
    this.postureSchedule = 0;
    this.postureProvocation = 0;
    this.tacticalAccum = 0;
    this.progress.clear();
    this.supportCd.clear();
    this.battleLine.clear();
    this.postCache.clear();
    this.terrainScore.clear();
  }

  private dispatchMission(): void {
    const m = this.mission;
    if (!m) return;
    for (const s of this.swarm.squads.all()) {
      this.swarm.issueOrder(s.id, m, SwarmCommander.RESEND_S + 5);
    }
  }
}
