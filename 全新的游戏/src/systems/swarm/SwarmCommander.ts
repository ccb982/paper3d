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
import { TerrainScore, weightsFor } from './TerrainScore';
import { TerrainSemantics, Sem, SEM_NAMES, L1_R } from './TerrainSemantics';
import { HoleMask } from './HoleMask';
import { HoleTable } from './HoleTable';
import { samplerFor } from '../../services/map/TerrainSampler';
import { decideTarget, type DecideCtx, type DecideState } from './Decide';
import { EngineerCorps, type BuildPiece } from './EngineerCorps';
import { CommanderSpawn } from './CommanderSpawn';
import { AnchorSelect } from './CommanderAnchorSelect';
import { MemberTaskBoard } from './MemberTaskBoard';
import { engineMissionFor, hasCoverFrom } from './UnitTactics';
import { scoreForUnit } from './UnitStrategy';
import { setSteerTable } from '../../entity/SteerPick';
import { COVER_HP, coverBlocksLine, snapshotCovers } from '../../entity/CoverEntity';
import type { SquadRating } from './SquadTable';
import { SQUAD_MAX, type Squad } from './SquadTable';
import type { TacticalOrder, UnitRole, SquadType } from '../../entity/SwarmUnit';

/** 重组/岗位计算用的复用暂存（零分配） */
const _c0 = { x: 0, z: 0 };
const _c1 = { x: 0, z: 0 };
/** ★ L3 寻路亲和（P1-3）：scoreFor 归一 ±PATH_AFF_N 分 → 倍率 ∓PATH_AFF_W（与掩体折扣相乘） */
const PATH_AFF_N = 8;
const PATH_AFF_W = 0.25;

/** ★ 引擎保护配置：保护对象（锚）+ 来源（护工/射手/工地/岗位） */
export interface ProtectTarget { x: number; z: number; source: 'engineer' | 'shooter' | 'site' | 'post' | 'cover' }

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
  /** ★ L1 敌人地形语义表（静态主体 + ★动态战壕覆盖层；《敌人管线设计.md》§1；落地/换落点重算） */
  readonly semantics = new TerrainSemantics();
  readonly holeMask = new HoleMask();   // ★ 独立破坏掩码（与 L1 语义表解耦）
  /** ★★ 敌用动态坑洞公式表（掩码 → 深×近打分；2Hz 持续重排） */
  readonly holeTable = new HoleTable();
  private holeClock = 0; private coverTag = '';   // 工事表节拍 / 掩体集合指纹
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
  /** ★ 实时玩家位置（tick 刷新；scoreTypeAt/SteerPick 兵种分用——比 rebuild 烙进 score 的新） */
  private viewPX = 0;
  private viewPZ = 0;
  /** ★ 权重缓存（postureP/posture 变才重算；SteerPick 16 向热路径免重复 weightsFor） */
  private _wKey = '';
  private _wCache: ReturnType<typeof weightsFor> | null = null;
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
  /** ★ 前进闸门（事态函数给；0~1 只增）：整条战线离舰角落差可放行的比例——"稳步推进" */
  private frontP = 0;
  /** 态势代次（切换 → 触发整队） */
  private postureEpoch = 0;
  /** ★ 事态闸门解析出的**允许离舰最小半径**（本次部署拍；-1 = 无闸） */
  private frontMinD = -1;
  /** ★ 前线永不再贴近舰船的余量（米） */
  private static readonly SHIP_CLEAR = 16;
  private readonly progress = new Map<number, { d: number; at: number; stall: number }>();
  private readonly supportCd = new Map<number, number>();
  /** 最近一次大队决策（调试/测试读取） */
  lastDecision: { squad: number; kind: string; at: number } | null = null;
  /** ★ 大队生成/登场队列（自本类拆出：CommanderSpawn；回收名单也在其中） */
  private readonly spawn: CommanderSpawn;
  /** ★ 工兵施工链（《工兵架构.md》）：阶段/施工目标表/调度/挖建全在 EngineerCorps */
  readonly corps: EngineerCorps;
  /** ★ 成员级任务（taskX/Z）唯一入口（施工分块 / 护卫扇区） */
  readonly memberTasks: MemberTaskBoard;
  /** 工兵链状态别名（真源在 corps；外部观测与内部直读都走这里） */
  get stage(): 'S0' | 'S1' | 'S2' { return this.corps.stage; }
  set stage(v: 'S0' | 'S1' | 'S2') { this.corps.stage = v; }
  get buildPieces(): readonly BuildPiece[] { return this.corps.pieces; }
  get builtSlots(): Set<string> { return this.corps.built; }
  get digPasses(): Map<string, number> { return this.corps.passes; }
  private get buildFocus(): Map<number, number> { return this.corps.focus; }
  private get buildAssign(): Map<number, number> { return this.corps.assign; }
  private get buildCds(): Map<number, number> { return this.corps.cds; }
  private get engAccum(): number { return this.corps.accum; }
  private set engAccum(v: number) { this.corps.accum = v; }
  private resendAccum = 0;
  private static readonly RESEND_S = 10;

  /** ★ 部署选点（Decide.ts）：状态计数 + 上下文复用对象（每拍赋值，零分配） */
  private readonly decideSt: DecideState = { coverIdx: 0, assaultIdx: 0, screenIdx: 0, flyerIdx: 0 };
  /** ★ 驻守位锁定 / 驻守滞回（Decide 消费；防"来回走"） */
  private readonly holdPos = new Map<number, { x: number; z: number }>();
  private readonly protectState = new Map<number, boolean>();
  /** ★ 近 8s 被击小队（保护状态的反击开关；每决策拍从 recentHits 重建） */
  private readonly alertSet = new Set<number>();
  private readonly decideCtx: DecideCtx = {
    plan: null as unknown as DecideCtx['plan'],
    table: null as unknown as TerrainScore,
    playerX: 0, playerZ: 0, now: 0, chase: false, lineSlot: null,
    front: { x: 0, z: 0 },
    buildSlot: null, slot: undefined, buildTarget: null, protect: null, stage: 'S0',
    hold: new Map(), protectState: new Map(), alert: new Set(), post: new Map(), mission: 'hold',
    builders: [], buildPieces: [], builtSlots: new Set<string>(),
    highPick: null, covers: [], shipX: 0, shipZ: 0, frontMinD: -1,
    weights: { h: 0, dist: 0, threat: 0, cover: 0, width: 0, choke: 0, near: 0 },
  };

  constructor(private readonly swarm: SwarmSystem) {
    this.memberTasks = new MemberTaskBoard(swarm.pool);
    this.corps = new EngineerCorps({
      blockedAt: (x, z) => this.blockedAt(x, z),
      markDirty: (x, z, r) => this.markTerrainDirty(x, z, r),
      cover: () => this.buildCover,
      dig: () => this.digTrench,
    }, this.memberTasks);
    this.spawn = new CommanderSpawn({
      plan: () => this.plan,
      mob: () => this.spawnMob,
      mobIndex: () => this.spawnMobIndex,
      builder: () => this.spawnBuilder,
    });
    this.anchors = new AnchorSelect({
      plan: () => this.plan,
      squadExists: (id) => !!this.swarm.squads.get(id),
      holeCovers: () => this.holeTable.covers,
      bestTrenchNear: (x, z, r) => this.terrainScore.bestTrenchNear(x, z, r),
      corpsPieces: () => this.corps.pieces,
    });
  }

  /** ★ 大队任务（路径 + 目标；`subTargets` 按 squadId 分派到各队） */
  setMission(order: TacticalOrder | null): void {
    this.mission = order;
    this.resendAccum = 0;
    this.dispatchMission();
  }

  /** ★ 对特定小队下覆盖命令（引擎优先级最高，队长不抢） */
  orderSquad(squadId: number, order: TacticalOrder, ttl = 30): void {
    if (this.swarm.squads.centroidOf(squadId, _c0)) this.issueChecked(squadId, _c0.x, _c0.z, order, ttl);
    else this.swarm.issueOrder(squadId, order, ttl);
  }

  // ============================================================
  // ★ P2 初级寻路核验门（《敌人管线重构总纲.md》§4-P2，2026-09-22）
  // ============================================================
  // 发令前查"命令能不能落地"：可达 → coarse 走廊路点随令附带；
  // 硬不可达 → 沿 from→tgt 径向缩近 3 档 → alternateTarget 换目标 → 都不行**不发**。
  // unknown（HPA 簇未建完）→ 放行不附 coarse（防冷启动误杀）。
  // 验收："发出即不可达命令 = 0/局" 由本门保证（by construction）。
  readonly coarseDbg = { checked: 0, adjusted: 0, skipped: 0, unknown: 0 };

  /** 发令核验门：全部引擎发令点必须走这里（返回 false = 未发）。 */
  private issueChecked(
    squadId: number, fromX: number, fromZ: number, order: TacticalOrder, ttl?: number,
  ): boolean {
    // ① 生效目标解析（五轴分工 subTargets 按队覆写——核验必须查覆写后的目标）
    const sub = order.subTargets?.find((t) => t.squadId === squadId);
    const eff = sub ?? order.target;
    // 无目标 / 飞行队（独立空中层走直线）→ 不核验直接放行
    const squad = this.swarm.squads.get(squadId);
    if (!eff || squad?.type === 'flyer') {
      this.swarm.issueOrder(squadId, order, ttl);
      return true;
    }
    this.coarseDbg.checked++;
    const coarse: { x: number; z: number }[] = [];
    const res = this.swarm.coarseCheck(fromX, fromZ, eff.x, eff.z, coarse);
    if (res === 'ok') {
      this.swarm.issueOrder(squadId, { ...order, coarse }, ttl);
      return true;
    }
    if (res === 'unknown') {
      this.coarseDbg.unknown++;
      this.swarm.issueOrder(squadId, order, ttl);   // 簇预热中：放行、不附 coarse
      return true;
    }
    // ② 硬不可达 → 缩近（径向 3 档）：每档复核，首个可达即改目标放行
    const dx = eff.x - fromX, dz = eff.z - fromZ;
    const withTgt = (x: number, z: number, c: { x: number; z: number }[]): TacticalOrder => {
      if (sub) {
        return {
          ...order,
          subTargets: order.subTargets!.map((t) => (t.squadId === squadId ? { ...t, x, z } : t)),
          coarse: c,
        };
      }
      return { ...order, target: { ...eff, x, z }, coarse: c };
    };
    for (const t of [0.75, 0.5, 0.25]) {
      const ax = fromX + dx * t, az = fromZ + dz * t;
      if (this.swarm.coarseCheck(fromX, fromZ, ax, az, coarse) === 'ok') {
        this.coarseDbg.adjusted++;
        this.swarm.cmdLog.noteAdjustedUnreachable();
        this.swarm.issueOrder(squadId, withTgt(ax, az, coarse), ttl);
        this.lastDecision = { squad: squadId, kind: 'shrink_unreachable', at: performance.now() / 1000 };
        return true;
      }
    }
    // ③ 缩近也不行 → 换目标（最近高地/掩体位）
    const alt = this.alternateTarget(fromX, fromZ, eff);
    if ((alt.x !== eff.x || alt.z !== eff.z)
      && this.swarm.coarseCheck(fromX, fromZ, alt.x, alt.z, coarse) === 'ok') {
      this.coarseDbg.adjusted++;
      this.swarm.cmdLog.noteAdjustedUnreachable();
      this.swarm.issueOrder(squadId, withTgt(alt.x, alt.z, coarse), ttl);
      this.lastDecision = { squad: squadId, kind: 'retarget_unreachable', at: performance.now() / 1000 };
      return true;
    }
    // ④ 都不行 → 不发（保证"发出即不可达 = 0"；下拍决策自然重试）
    this.coarseDbg.skipped++;
    this.lastDecision = { squad: squadId, kind: 'skip_unreachable', at: performance.now() / 1000 };
    return false;
  }

  /** ★ 发信号（五轴「时序」：等 signal 的命令到点生效） */
  emitSignal(id: number): void {
    this.swarm.tactics.board.emitSignal(id);
  }

  /** ★ S0 勘察：舰船落地周边地形检测 → DefensePlan（高地/掩体位/来向/三环）
   *  展开轴 = 扫描走廊轴（落地一次）；**掩体一律朝舰船（落点中心）侧 +5m、战壕留在原位**；
   *  此后不随玩家移动/危机度动态重排（《工兵架构.md》§3/§4，用户定调 2026-09-21）。 */
  planDefense(cx: number, cz: number, radius = 80): DefensePlan | null {
    const raster = RasterMap.current;
    if (!raster) return null;
    this.plan = analyzeLandingTerrain(raster, cx, cz, radius);
    this.corps.regenerate(this.plan);
    this.builtSlots.clear(); this.digPasses.clear();
    this.progress.clear();      // ★ 换落点：战役级闭环状态复位
    this.supportCd.clear();
    this.battleLine.clear();    // ★ 换落点：进攻队列复位
    this.postCache.clear();     // ★ 现场有利位置缓存复位
    this.scoreStamp++;          // ★ 评分表触发戳（换落点重算）
    this.terrainScore.clear();
    this.stage = 'S1';
    // ★ 换登陆点 = 重新部署：取消上一落点排队的兵力，本落点重新起一个大队
    //   （舰船会不断移动换登陆点；每次落地都要有自己的防御布置）
    this.spawn.reset();
    // ★ 单日节律复位（§3.5）：日程从落地重新走，波次标记/挑衅采样清零
    this.rhythmT = 0;
    this.t01Base = -1;
    this.wave1Sent = false;
    this.finalSent = false;
    this.hitSeen.clear();
    this.buildAssign.clear();
    this.holdPos.clear();
    this.protectState.clear();
    this.anchors.reset();
    this.missionAssign.clear();
    this.memberTasks.clearAll();
    this.protectAssign.clear();
    this.builderRoles.clear();
    setSteerTable(null);
    this.lastKills = this.swarm.ledger.kills;
    this.postureFn.reset(performance.now() / 1000);
    this.battlePosture = 'fortify';
    // ★ 兵力创建（全权在本层，编成/放置见 CommanderSpawn）：
    //   · 回收名单 → 按名单**逐步回场**（数量/兵种照旧）
    //   · 全新驻防 → 开局只上**少量班底**（近战 + 后勤修工事），其余由节律逐步补满基数
    this.spawn.deploy();
    return this.plan;
  }

  /** ★ 起飞回收：只交**名单**（兵种属性 + 数量）——怎么布置由本层决定 */
  setRecalledRoster(roster: { mobIndex: number; role: UnitRole; count: number }[]): void {
    this.spawn.setRoster(roster);
  }

  /** ★ 生成一个大队（30 怪；逐步登场/instant；编成/放置见 CommanderSpawn） */
  spawnBattalion(instant = false): boolean {
    return this.spawn.battalion(instant);
  }

  /** ★ 防守布置（读；阶段机 S0~S6 消费） */
  get defensePlan(): DefensePlan | null {
    return this.plan;
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
  /** ★ 事态闸门（调试/探针读：frontP 单调推进、minD 允许离舰半径） */
  get frontGate(): { frontP: number; minD: number } {
    return { frontP: this.frontP, minD: this.frontMinD };
  }

  /** ★ 地形表只读视图（队长掩体校验/外部读用；队长经 resolveAnchor 传入） */
  get terrain(): TerrainScore {
    return this.terrainScore;
  }

  /** ★ 调试/探针：掩体校验真源（与队长同源 hasCoverFrom） */
  debugHasCover(tx: number, tz: number, x: number, z: number): boolean {
    return hasCoverFrom(tx, tz, x, z, this.terrainScore);
  }

  tick(dt: number, playerX = 0, playerZ = 0, dayT01 = -1, shipX = 0, shipZ = 0): void {
    this.viewPX = playerX;
    this.viewPZ = playerZ;
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
    this.frontP = st.frontP;
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
        this.terrainScore.rebuild(raster, this.plan, this.holeTable.covers, this.postureP,
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
          // ★ 独立坑洞掩码（同锚窗口）：真源 = RasterMap.levelDepthAt（权威挖掘深度）
          this.holeMask.build({ digDepthAt: (x, z) => raster.levelDepthAt(x, z) },
            this.plan.cx, this.plan.cz);
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
          const gw = globalThis as unknown as { __holeMask?: HoleMask; __holeTable?: HoleTable };
          gw.__holeMask = this.holeMask;
          gw.__holeTable = this.holeTable;
        }
        // ★★★ 敌用工事表（动态 2Hz）：坑洞（掩码×深×近）+ 掩体（活注册表×遮蔽×近）
        this.holeClock += dt;
        if (this.holeClock >= 0.5) {
          this.holeClock = 0;
          const cov = snapshotCovers('enemy').map((c) => ({ x: c.x, z: c.z, hp: c.hp, maxHp: COVER_HP, variant: c.variant, heading: c.heading, hidden: coverBlocksLine(c.x, c.z, playerX, playerZ) }));
          this.holeTable.rebuild(this.holeMask, this.semantics, playerX, playerZ, cov);
          const tag = `${cov.length}:${cov.map((c) => `${c.x | 0},${c.z | 0}`).join(';')}`;
          if (tag !== this.coverTag) { this.coverTag = tag; this.scoreStamp++; }   // 掩体增减 → 评分表全量重评
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
    this.engineeringTick(dt, playerX, playerZ, shipX, shipZ);
    // ★ 战役级闭环（1Hz，晚于工程拍 → 反馈决策可覆盖基础部署）
    this.tacticalTick(dt, playerX, playerZ);
    // ★ 逐步登场：队列滴灌（每 SPAWN_INTERVAL 出一只；总攻走 instant 不入队）
    this.spawn.drain(dt);
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

  /** ★★ 引擎保护配置（本拍）：各队保护对象 + 来源（护工/射手/工地/岗位/掩体）——保护对象由大队定 */
  readonly protectAssign = new Map<number, ProtectTarget>();
  /** ★ 岗位/护工/掩体驻守/有利位锚点选择（自本类拆出：CommanderAnchorSelect） */
  private readonly anchors: AnchorSelect;
  /** ★ 远程掩体驻守表（只读；probe/覆盖层） */
  get coverHolders(): Map<number, { cx: number; cz: number; x: number; z: number }> {
    return this.anchors.coverHolders;
  }
  /** ★ 施工分工（蜂群引擎指派）：cover = 修掩体班；trench = 挖战壕班；any = 兼顾 */
  private readonly builderRoles = new Map<number, 'cover' | 'trench' | 'any'>();
  /** ★ 引擎大任务（粘性：squadId → { mission, epoch }；只在落点/态势/阶段切换时重派） */
  private readonly missionAssign = new Map<number, { mission: string; epoch: number }>();

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
        this.memberTasks.write(uid, 0, 0);   // ★ 并队后旧任务清零（由新队的任务重派接管）
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

  /** ★ 部署维护（2s 决策拍）——**按兵种分工 + 对玩家移动的敏感度不同**：
   *  · 近战（盾/突击）：**追玩家**（玩家在附近时直接压上去；否则推进到防线）
   *  · 施工队（canBuild）：守着自己的工位/工事，不因玩家跑动被拉走
   *  · 远程队：占住高地/火力点，**不追脸**
   *  · 后勤等：向防线后集结
   *  S1 = 边打边施工；S2 = 只维护部署（不再施工）。 */
  private engineeringTick(dt: number, playerX: number, playerZ: number, shipX: number, shipZ: number): void {
    if (!this.plan) return;
    // ★ 总攻：工兵**暂停开挖战壕**（件保留，从不清空——用户定调）；掩体继续、转掩护射手
    this.corps.setTrenchPaused(this.battlePosture === 'assault');
    const squads = [...this.swarm.squads.all()];
    // ★ 施工队 = **具备施工能力的兵种**（后勤不一定能施工；杂兵可兼任）；
    //   兜底：名册里一个施工兵种都没有（缺素材/未加载）→ 杂兵（assault）兼任
    let builders = squads.filter((s) => s.builders);
    if (builders.length === 0) builders = squads.filter((s) => s.type === 'assault');
    // ★ 掩体驻守（远程）：**每帧**按玩家位置更新"能挡射界"的掩体背侧站位（引擎配置 → 个体执行）
    this.anchors.updateCoverHolders(squads, playerX, playerZ);
    this.engAccum += dt;
    // ★ 施工冷却**每帧递减**（不受 2s 拍闸限制）：4s 战壕 = 真 4s；否则每拍减 0.1 → 一趟要 ~80s
    if (this.stage === 'S1') {
      for (const s of builders) {
        const cd = this.buildCds.get(s.id) ?? 0;
        if (cd > 0) this.buildCds.set(s.id, cd - dt);
      }
    }
    if (this.engAccum < 2) return;   // 2s 决策拍
    this.engAccum = 0;
    const slot = this.buildPieces.find((s) =>
      !this.builtSlots.has(`${s.x},${s.z}`) && this.corps.canWork(s.kind));
    const plan = this.plan;
    if (!slot && this.stage === 'S1') this.stage = 'S2';   // 无待建块 → 就绪
    // ★ 施工优先：工程队**完全不因玩家靠近而停工**（旁边有玩家 → 护卫队上，自己该挖挖）
    const buildSlot = this.stage === 'S1' && slot ? slot : null;
    // 正面基准：有工事点用工事点；否则落点前方 40m（★ 复刻一份，勿改工件坐标）
    const front0 = (buildSlot ?? { x: plan.cx + plan.approachX * 40, z: plan.cz + plan.approachZ * 40 });
    const front = { x: front0.x, z: front0.z };
    // ★ 事态闸门（用户定调 2026-09-21：事态函数限制与舰船的距离——"稳步推进，不一上来冲家"）：
    //   命令/前线/施工一律不得越过「允许离舰半径」，该半径随 PostureFn.frontP 单调收拢到 SHIP_CLEAR；
    //   施工期（S1）封顶 0.35 —— 造掩体战壕阶段基本留守初始前沿，总攻才逐步贴近。
    {
      const effFrontP = this.stage === 'S1' ? Math.min(this.frontP, 0.35) : this.frontP;
      const ffrontD = Math.hypot(shipX - front0.x, shipZ - front0.z);
      this.frontMinD = Math.max(SwarmCommander.SHIP_CLEAR, ffrontD + (SwarmCommander.SHIP_CLEAR - ffrontD) * effFrontP);
      if (ffrontD > 1e-3 && ffrontD < this.frontMinD - 0.01) {
        const k = this.frontMinD / ffrontD;
        front.x = shipX + (front0.x - shipX) * k;
        front.z = shipZ + (front0.z - shipZ) * k;
      }
      // ★ 施工闸门：距舰 < 前沿的工件未解锁 → 稳步推进建造线（近→远逐步开）
      this.corps.gate = { x: shipX, z: shipZ, minD: this.frontMinD - 12 };
    }
    // ★ 近战类目标：按**姿态 × 兵种配置**的追击开关决定打玩家还是守正面；
    //   施工期盾队前出掩护工事（screen 分支单独处理）
    const chase = Math.hypot(playerX - plan.cx, playerZ - plan.cz) < 90;
    // ★ 按小队属性部署（`SquadDoctrine`：通用兜底 + 属性覆盖 + 逐兵种 + 施工 override）→ 再叠态势
    const highPick = this.anchors.pickHighGroundNear(plan, front.x, front.z, 48);
    const covers = this.anchors.garrisonCovers(plan, playerX, playerZ, chase);
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
    ctx.now = performance.now() / 1000;
    ctx.front = front; ctx.buildSlot = buildSlot; ctx.slot = slot;
    ctx.shipX = shipX; ctx.shipZ = shipZ; ctx.frontMinD = this.frontMinD;   // ★ 事态闸门（离舰半径）
    ctx.weights = this.liveWeights();                                       // ★ L3 scoreFor 基权（P1-4）
    ctx.builders = builders; ctx.buildPieces = this.buildPieces;
    ctx.builtSlots = this.builtSlots; ctx.highPick = highPick; ctx.covers = covers;
    ctx.hold = this.holdPos; ctx.protectState = this.protectState;
    // ★ 稳定岗位（每队一次分派；无岗队补岗）
    this.anchors.ensurePosts(squads);
    ctx.post = this.anchors.post;
    // ★ 近 8s 被击小队 → "保护状态"的反击开关（打了保护的士兵 → 该打就打）
    this.alertSet.clear();
    const nowS = performance.now() / 1000;
    for (const [id, t] of this.swarm.recentHits) if (nowS - t <= 8) this.alertSet.add(id);
    ctx.alert = this.alertSet;
    // ★ 预分派工程队（稳定分配；取第一个在建块作为"工地"给近战护卫）
    let buildSite: { x: number; z: number } | null = null;
    if (this.battlePosture === 'assault') {
      // ★ 总攻：施工只剩掩体（战壕暂停开挖）；"工地"锚切到最近远程小队
      //   → 护卫/施工都以射手为保护对象（工兵在射手威胁侧展开）
      buildSite = this.anchors.rangedAnchor(squads, front);
    }
    if (this.stage === 'S1') {
      for (const s of builders) {
        let cx = 0, cz = 0, n = 0;
        for (const m of s.members.values()) { cx += m.x; cz += m.z; n++; }
        if (n > 0) { cx /= n; cz /= n; }
        const idx = this.corps.assignBuild(s.id, cx, cz);
        if (idx >= 0 && !buildSite) buildSite = { x: this.buildPieces[idx].x, z: this.buildPieces[idx].z };
      }
    }
    // ★ 施工分工（用户定调）：**1 个施工队修掩体，其余全部挖战壕**；只有一个队 / 某类工件没了 → 兼顾。
    //   每拍按"剩余未建工件类"重算：掩体建完 → 全员转挖壕；总攻 → 战壕只暂停（件保留），全员转修掩体。
    {
      const key = (q: { x: number; z: number }): string => `${q.x},${q.z}`;
      const trenchPaused = this.battlePosture === 'assault';
      this.corps.setTrenchPaused(trenchPaused);
      const needTrench = !trenchPaused
        && this.corps.pieces.some((q) => q.kind === 'trench' && !this.corps.built.has(key(q)));
      const needCover = this.corps.pieces.some((q) => q.kind === 'cover' && !this.corps.built.has(key(q)));
      const aliveB = new Set(builders.map((b) => b.id));
      for (const id of [...this.builderRoles.keys()]) if (!aliveB.has(id)) this.builderRoles.delete(id);
      // 粘性分工（防抖）：先清掉"本类已没活"的旧分工；再按需补一个掩体班，其余战壕班
      for (const b of builders) {
        const r = this.builderRoles.get(b.id);
        if (r === 'cover' && !needCover) this.builderRoles.delete(b.id);
        if (r === 'trench' && !needTrench) this.builderRoles.delete(b.id);
      }
      let hasCover = builders.some((b) => this.builderRoles.get(b.id) === 'cover');
      for (const b of builders) {
        let r = this.builderRoles.get(b.id);
        if (!r) {
          if (builders.length >= 2 && needCover && needTrench) {
            r = hasCover ? 'trench' : 'cover';
            if (r === 'cover') hasCover = true;
          } else {
            r = 'any';
          }
          this.builderRoles.set(b.id, r);
        }
        this.corps.setRole(b.id, r);
      }
      // 掩体班阵亡 → 从战壕班补一个（保持"1 掩体班 + 其余战壕班"）
      if (builders.length >= 2 && needCover && needTrench && !hasCover) {
        const b = builders.find((x) => this.builderRoles.get(x.id) === 'trench') ?? builders[0];
        this.builderRoles.set(b.id, 'cover');
        this.corps.setRole(b.id, 'cover');
      }
    }
    // ★ S1 护工锚：工程队质心表（非工兵队粘性配对跟随保护）
    const engCent = new Map<number, { x: number; z: number }>();
    if (this.stage === 'S1' && this.battlePosture !== 'assault') {
      for (const b of builders) {
        let x = 0, z = 0, n = 0;
        for (const m of b.members.values()) { x += m.x; z += m.z; n++; }
        if (n > 0) engCent.set(b.id, { x: x / n, z: z / n });
      }
    }
    ctx.stage = this.stage;
    // ★ 大任务粘性（引擎只在此刻重派：落点/态势/施工阶段切换）
    const missionEpoch = this.postureEpoch * 100000 + this.scoreStamp * 2 + (this.stage === 'S1' ? 0 : 1);
    this.protectAssign.clear();
    // ★ P3-2 保护配额（重构总纲 §2.5）：同一保护对象 ≤2 队——防"5 队挤 1 锚"堆挤
    const PROTECT_QUOTA = 2;
    const pcount = new Map<string, number>();
    const quotaOk = (key: string): boolean => {
      const n = pcount.get(key) ?? 0;
      if (n >= PROTECT_QUOTA) return false;
      pcount.set(key, n + 1);
      return true;
    };
    const coordKey = (pre: string, x: number, z: number): string => `${pre}:${x | 0},${z | 0}`;
    for (const s of squads) {
      let scx = 0, scz = 0, sn = 0;
      for (const m of s.members.values()) { scx += m.x; scz += m.z; sn++; }
      if (sn > 0) { scx /= sn; scz /= sn; }
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
      // ★★ 引擎保护配置（保护对象由大队定；队长/个体只读位置——《小队战术与命令.md》§2.1）：
      //   S1 非工兵 → 粘性配对的工程队（护工）；总攻 → 射手锚；S1 其余 → 工地；S2 → 岗位
      const escort = !s.builders && sn > 0 && engCent.size > 0
        ? this.anchors.escortAnchor(s.id, scx, scz, engCent) : null;
      const coverHold = (s.type === 'ranged' && !s.builders) ? this.anchors.coverHolders.get(s.id) : undefined;
      let pt: ProtectTarget | null = null;
      // ★ 配额闸门：cover/site/shooter/post 按锚坐标计数；engineer 按工程队 id 计数（锚随动不误判）
      if (coverHold && quotaOk(coordKey('cov', coverHold.cx, coverHold.cz))) pt = { x: coverHold.cx, z: coverHold.cz, source: 'cover' };   // ★ 远程：驻守掩体（中心；站位由队长绕掩体算）
      else if (escort) {
        const eid = this.anchors.escort.get(s.id) ?? -1;
        if (eid >= 0 && quotaOk(`eng:${eid}`)) pt = { x: escort.x, z: escort.z, source: 'engineer' };
        else {
          // ★ 本队配对的工程队满额 → 换最近有余量的工程队（重锁粘性配对；都满 → 不配，走常规部署）
          let alt = -1, bd = Infinity;
          for (const [id, c] of engCent) {
            if ((pcount.get(`eng:${id}`) ?? 0) >= PROTECT_QUOTA) continue;
            const d = (c.x - scx) ** 2 + (c.z - scz) ** 2;
            if (d < bd) { bd = d; alt = id; }
          }
          if (alt >= 0 && quotaOk(`eng:${alt}`)) {
            const c = engCent.get(alt)!;
            this.anchors.escort.set(s.id, alt);
            pt = { x: c.x, z: c.z, source: 'engineer' };
          }
        }
      }
      else if (this.battlePosture === 'assault' && buildSite && quotaOk(coordKey('site', buildSite.x, buildSite.z))) pt = { x: buildSite.x, z: buildSite.z, source: 'shooter' };
      else if (buildSite && quotaOk(coordKey('site', buildSite.x, buildSite.z))) pt = { x: buildSite.x, z: buildSite.z, source: 'site' };
      else if (ma.mission === 'guard' || ma.mission === 'patrol') {
        const post = this.anchors.post.get(s.id);
        if (post && quotaOk(coordKey('post', post.x, post.z))) pt = { x: post.x, z: post.z, source: 'post' };
      }
      if (pt) this.protectAssign.set(s.id, pt);
      ctx.protect = pt;
      // ★ 施工块稳定分派（施工大任务下才有目标；成员再分到不同块 → 并行施工）
      if (ma.mission === 'build' && this.stage === 'S1') {
        const idx = this.buildAssign.get(s.id);
        ctx.buildTarget = idx !== undefined && idx >= 0 ? this.buildPieces[idx] : buildSlot;
        this.corps.spreadBuilders(s, scx, scz);
      } else if (ma.mission === 'guard' || ma.mission === 'patrol') {
        ctx.buildTarget = null;
        // ★ 护卫/巡逻扇区（成员级）：被击/无保护对象 → 清任务（交给动态反击/巡逻令）
        if (this.alertSet.has(s.id) || !ctx.protect) this.memberTasks.clear(s);
        // ★ 工兵的保护动作 = 造工事（有未建掩体 → 施工；没有 → 交队长站位/执行）
        else if (s.builders) {
          if (!this.corps.spreadBuilders(s, ctx.protect.x, ctx.protect.z)) this.memberTasks.clear(s);
        }
        // ★ 其余保护队：清成员任务 → 保护令（对象+玩家位置）+ 队长站位 + 编队槽执行（代理/队长自身）
        else this.memberTasks.clear(s);
      } else {
        ctx.buildTarget = null;
        this.memberTasks.clear(s);
      }
      // ★ 线位只在"刚整队"那一拍生效；★ 正在攻击（chase）的队**不受队列影响**
      ctx.lineSlot = lineFresh && !d.chase ? this.battleLine.get(s.id) : null;
      const out = decideTarget(d, s, ctx, st);
      this.issueChecked(s.id, scx, scz, {
        kind: out.kind, target: out.target, roe: out.roe,
        urgency: out.urgency, mission: out.mission || undefined,
        threatX: out.threat?.x, threatZ: out.threat?.z, seq: 0,
      }, out.ttl);
    }
    // ⑤ 施工（逐步拼装，仅 S1；挖建执行在 EngineerCorps）
    this.corps.construct(builders);
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
        this.issueChecked(helper.squadId, helper.cx, helper.cz, {
          kind: 'advance', target: { x: m.x, z: m.z }, roe: 'engage', seq: 0,
        }, 6);
        this.supportCd.set(helper.squadId, now + 10);
        this.lastDecision = { squad: helper.squadId, kind: m.kind === 'requestSupport' ? 'support' : 'scout', at: now };
      }
    }
    // ★ 评级索引（发令核验起点；tacticalTick 内所有 issueChecked 共用）
    const rateOf = new Map<number, SquadRating>();
    for (const r of ratings) rateOf.set(r.squadId, r);
    // ★ 掩体驻守微调（1Hz）：**无条件重发**（掩体中心 + 最新玩家位置）——实时跟随玩家换侧/绕掩体
    for (const [id, h] of this.anchors.coverHolders) {
      const rr = rateOf.get(id);
      const order: TacticalOrder = {
        kind: 'garrison', target: { x: h.cx, z: h.cz }, roe: 'engage', mission: 'hold',
        threatX: playerX, threatZ: playerZ, seq: 0,
      };
      if (rr) this.issueChecked(id, rr.cx, rr.cz, order, 4);
      else this.swarm.issueOrder(id, order, 4);
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
            this.issueChecked(r.squadId, r.cx, r.cz,
              { kind: 'advance', target: alt, roe: 'engage', seq: 0 }, 8);
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
        this.issueChecked(r.squadId, r.cx, r.cz, {
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
      const blocked = hasCoverFrom(px, pz, x, z, this.terrainScore);   // 玩家 → 该点：真被遮挡吗（实体LOS+地形）
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
    for (const c of this.holeTable.covers) {
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
      if (hasCoverFrom(px, pz, x, z, this.terrainScore)) score += 3;
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

  /** ★ 当前态势权重（带缓存；SteerPick 热路径用） */
  private liveWeights(): ReturnType<typeof weightsFor> {
    const key = `${this.postureP}|${this.battlePosture}`;
    if (key !== this._wKey || !this._wCache) {
      this._wKey = key;
      this._wCache = weightsFor(this.postureP, this.battlePosture);
    }
    return this._wCache;
  }

  /** ★ L3 兵种分（重构 P1）：当前态势基权 × 兵种权重 × 合成字段（探针/中立选位用；
   *  小队消费在 Decide/SquadPath 内走 UnitStrategy.scoreForUnit 纯函数） */
  scoreForType(type: SquadType, x: number, z: number, playerX = 0, playerZ = 0): number {
    return scoreForUnit(type, this.terrainScore.featsAt(x, z, playerX, playerZ), this.liveWeights());
  }

  /** ★ SteerTable 扩展（重构 P1-2）：16 向候选按兵种打分；读实时玩家位置 */
  scoreTypeAt(type: string, x: number, z: number): number | null {
    const f = this.terrainScore.featsAt(x, z, this.viewPX, this.viewPZ);
    if (!f) return null;
    return scoreForUnit(type as SquadType, f, this.liveWeights());
  }

  /** ★ parity 断言用：与 score[] 同一重建权重+烘焙玩家位复算 mixed（隔离权重/玩家两项陈旧差） */
  scoreMixedAt(x: number, z: number): number | null {
    const base = this.terrainScore.weightsSnapshot();
    if (!base) return null;
    const lp = this.terrainScore.bakedPlayer();
    return scoreForUnit('mixed', this.terrainScore.featsAt(x, z, lp.x, lp.z), base);
  }

  /** ★ 水域查询（允许站立；执行层在水中 → 上岸权重） */
  /** ★ 掩体/战壕寻路折扣（SquadPath 逐格乘算；战壕/掩体=寻路加分点） */
  pathMulAt(x: number, z: number): number {
    return this.terrainScore.pathMulAt(x, z);
  }

  /** ★ L3 寻路代价（重构 P1-3）：掩体折扣 × 兵种亲和——scoreFor 越高越便宜。
   *  SquadPath/HPA 统一夹取 [0.5,1.5]；非表内/不可站 → 1（阻挡另判） */
  pathMulFor(type: string, x: number, z: number): number {
    const cover = this.terrainScore.pathMulAt(x, z);
    const f = this.terrainScore.featsAt(x, z, this.viewPX, this.viewPZ);
    if (!f || !f.pass) return 1;
    const s = scoreForUnit(type as SquadType, f, this.liveWeights());
    const aff = Math.max(-1, Math.min(1, s / PATH_AFF_N));
    return cover * (1 - PATH_AFF_W * aff);
  }

  isWaterAt(x: number, z: number): boolean {
    return this.terrainScore.isWaterAt(x, z);
  }

  /** ★★ 全地形破坏的中央入口（ChunkManager.onTerrainDig 接线；**玩家子弹也走这**）：
   *   1m 深度场窗扫 → HoleTable（敌读工事）
   *   + TerrainScore 局部重算：**挖过即战壕**（显式 dug 标记——玩家挖的坑同样算，
   *     平底坑内部/坑壁不靠低洼判据，敌人选位直接可见可用）
   *   + 统一采样缓存失效。 */
  noteTerrainDig(x: number, z: number, r = 16): void {
    this.holeMask.refresh(x, z, r + 12);                        // ★ L2 工事源（1m 深度场）
    this.terrainScore.invalidateArea(x, z, r + 6, true);        // ★ L3：挖过即战壕（含玩家挖掘）
    const raster = RasterMap.current;
    if (raster) samplerFor(raster).invalidateArea(x, z, r + 6); // ★ 统一采样缓存同步失效
  }

  /** ★ 地形脏区（模式层挖改/建造都调这个）：noteTerrainDig 单入口别名 */
  markTerrainDirty(x: number, z: number, r = 12): void {
    this.noteTerrainDig(x, z, r);
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
    this.spawn.clear();
    this.corps.pieces = [];
    this.buildFocus.clear();
    this.builtSlots.clear(); this.digPasses.clear();
    this.holeTable.clear();
    this.engAccum = 0;
    this.resendAccum = 0;
    this.postureFn.reset(performance.now() / 1000);
    this.battlePosture = 'fortify';
    this.aliveAtPosture = 0;
    this.rhythmT = 0;
    this.t01Base = -1;
    this.wave1Sent = false;
    this.finalSent = false;
    this.debugDayT01 = -1;
    this.hitSeen.clear();
    this.buildAssign.clear();
    this.holdPos.clear();
    this.protectState.clear();
    this.anchors.reset();
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
      if (this.swarm.squads.centroidOf(s.id, _c0)) {
        this.issueChecked(s.id, _c0.x, _c0.z, m, SwarmCommander.RESEND_S + 5);
      } else {
        this.swarm.issueOrder(s.id, m, SwarmCommander.RESEND_S + 5);
      }
    }
  }
}
