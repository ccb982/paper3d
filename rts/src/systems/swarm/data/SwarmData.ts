// ============================================================
// data/SwarmData —— 蜂群数据面（**无指挥语义**；重写 P4 归位）
// ============================================================
// 职责（只做数据/查询/端口，不做决策、不发令）：
//   · 地形与表：DefensePlan / TerrainScore / L1 语义 / L2 工事（HoleMask/HoleTable）/ PassTable
//   · 事态与环：PostureFn（p/frontP）+ 环形活动区（ringBounds/clampToRing）+ t01 时钟
//   · 工事数据：FortifyPlanner（需求/分区）+ 施工带（fortifyBand）+ 阶段 S1/S2
//   · 编制与生成执行：CommanderSpawn + RosterController + 生成端口（模式层注入）
// 消费方：新引擎（经 main/LiveView 单源读取）、队长核端口、导航/SteerPick 表桥、UI/探针只读。
// ============================================================

import { RasterMap } from '../../../services/map/RasterMap';
import type { SwarmSystem } from '../SwarmSystem';
import { analyzeLandingTerrain, type DefensePlan } from '../LandingTerrain';
import type { BattlePosture } from '../Posture';
import { PostureFn } from '../PostureFn';
import { RANGED } from '../RangedTactics';
import { TerrainScore, weightsFor } from '../TerrainScore';
import { TerrainSemantics, Sem, SEM_NAMES, L1_R } from '../TerrainSemantics';
import { HoleMask } from '../HoleMask';
import { HoleTable } from '../HoleTable';
import { samplerFor } from '../../../services/map/TerrainSampler';
import { CommanderSpawn } from '../CommanderSpawn';
import { DANGER } from '../SwarmDanger';
import { PassTable } from '../nav/PassTable';
import { RosterController } from '../RosterController';
import { FortifyPlanner, NEED_DONE } from '../FortifyPlanner';
import type { EngineerPort } from '../engine/EngineerManager';
import { hasCoverFrom } from '../UnitTactics';
import { scoreForUnit } from '../UnitStrategy';
import { setSteerTable } from '../../../entity/SteerPick';
import { COVER_HP, coverBlocksLine, coverAt as coverAtEntity, snapshotCovers } from '../../../entity/CoverEntity';
import type { SquadRating } from '../SquadTable';
import type { UnitRole, SquadType, MobTactics } from '../../../entity/SwarmUnit';

/** ★ 坑底硬阈值（低于此高度不可走 → 禁止再挖；与 EngineerManager 端口同口径） */
const FLOOR_MIN = -1.2;
/** ★ L3 寻路亲和（P1-3）：scoreFor 归一 ±PATH_AFF_N 分 → 倍率 ∓PATH_AFF_W（与掩体折扣相乘） */
const PATH_AFF_N = 8;
const PATH_AFF_W = 0.25;

export class SwarmData {
  /** ★ S0 勘察：地形检测产出的防守布置 */
  private plan: DefensePlan | null = null;
  /** ★ L1 敌人地形语义表（静态主体 + ★动态战壕覆盖层；《RTS架构.md》§1；落地/换落点重算） */
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
  /** ★ 权重缓存（postureP/posture 变才重算；SteerPick 8 向热路径免重复 weightsFor） */
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
  /** ★ 调试/测试：日程进度覆盖（0~1；<0 = 关闭覆盖，用太阳钟） */
  debugDayT01 = -1;
  /** ★ 最近一次归一化当日进度（时间轴 UI 读） */
  lastT01 = 0;

  /** ★ 时间轴拖动（调试/演示）：**绝对**设置当日进度（绕过相对归一 t01Base），事态/命令随之重算 */
  scrubDay(v: number): void {
    this.t01Base = 0;
    this.debugDayT01 = Math.max(0, Math.min(1, v));
  }

  /** ★ 恢复实时时钟（清拖动覆盖） */
  followRealtime(): void {
    this.debugDayT01 = -1;
    this.t01Base = -1;
  }
  /** 进入总攻时的兵力（撤退判定基准） */
  private aliveAtPosture = 0;
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
  /** ★ 环形活动区上限（事态函数管；第一波收拢到舰） */
  private frontMaxD = -1;
  /** ★ 最近一次舰船位（环夹取基准；引擎/队长核同口径） */
  private lastShipX = 0;
  /** ★ 原始当日进度（hooks.dayT01；第一波 ≥0.45 起停止新增施工——队长层派件读） */
  private lastDayRaw = -1;
  private lastShipZ = 0;
  /** ★ 命令夹环计数（探针/调试） */
  cmdLogRingClamps = 0;
  /** ★ 前线永不再贴近舰船的余量（米） */
  private static readonly SHIP_CLEAR = 16;

  /** ★ 环形一日推进（用户定 2026-09-25）：**宽环 → 大圆 → 甜甜圈 → 点**
   *  · 初始宽环：(D0min, D0max)（= 前沿 ±80m，环带宽 ≥120m，不窄）
   *  · 第一波大圆：(0, 90)——较大的圆（内 0=可到舰，外 90=不许跑远）
   *  · 甜甜圈：(60, 180)——中空环（回撤休整：不许贴舰、也不许离远）
   *  · 总攻：→ (0, 0) 收缩为一个点
   *  日程：0.20-0.45 收大圆 / 0.45-0.62 大圆驻留 / 0.62-0.72 变大甜甜圈 /
   *        0.72-0.82 甜甜圈驻留 / 0.82-0.90 收点 / 0.90-1.00 点驻留 */
  static ringBounds(t: number, d0min: number, d0max: number): { minD: number; maxD: number } {
    const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
    const BIG_R = 90;     // 第一波大圆半径（2026-09-25 用户定：130 → 90，缩小外径）
    const DONUT_IN = 60;  // 甜甜圈内径
    const DONUT_OUT = 180; // 甜甜圈外径
    if (t < 0.20) return { minD: d0min, maxD: d0max };
    if (t < 0.45) { const k = (t - 0.20) / 0.25; return { minD: lerp(d0min, 0, k), maxD: lerp(d0max, BIG_R, k) }; }
    if (t < 0.62) return { minD: 0, maxD: BIG_R };
    if (t < 0.72) { const k = (t - 0.62) / 0.10; return { minD: lerp(0, DONUT_IN, k), maxD: lerp(BIG_R, DONUT_OUT, k) }; }
    if (t < 0.82) return { minD: DONUT_IN, maxD: DONUT_OUT };
    if (t < 0.90) { const k = (t - 0.82) / 0.08; return { minD: lerp(DONUT_IN, 0, k), maxD: lerp(DONUT_OUT, 0, k) }; }
    return { minD: 0, maxD: 0 };   // ★ 总攻：一个点，驻留到日终
  }
  /** 最近一次大队决策（调试/测试读取） */
  lastDecision: { squad: number; kind: string; at: number } | null = null;
  /** ★ 大队生成/登场队列（自本类拆出：CommanderSpawn；回收名单也在其中） */
  private readonly spawn: CommanderSpawn;
  /** ★ N0 可行性表（迷宫抽象；地形纯函数、建一次；《RTS架构.md》§3.0） */
  readonly passTable = new PassTable();
  /** ★ §13.1 编制比例（占比统计 + 缺口；只读，不改行为） */
  readonly roster = new RosterController();
  /** ★ §13.3 工事规划（最危险区域选择；工兵循环的第一步） */
  readonly fortify = new FortifyPlanner();
  /** ★ §13.4 前推里程（棘轮：只增；每拍 +≤0.5m，封顶 frontP 允许值×120m） */
  /** ★ 前推棘轮里程（事态控制；每拍 ≤0.5m） */
  private pushM = 0;

  /** ★ 施工带（事态函数口径，单源）：rLo=允许离舰+8、rHi=90 或 rLo+30，再加前推棘轮 pushM。
   *  引擎 tick 与小地图/探针共用——防"两处重算、漏 pushM"（2026-09-25 修） */
  get fortifyBand(): { rLo: number; rHi: number; minD: number; maxD: number; frontP: number; pushM: number } {
    const rLo = Math.max(24, this.frontMinD + 8);
    const rHiBase = Math.max(90, rLo + 30) + this.pushM;
    const rHi = this.frontMaxD > 0 ? Math.min(rHiBase, this.frontMaxD) : rHiBase;   // ★ 施工外圈不越活动上限
    return { rLo, rHi, minD: this.frontMinD, maxD: this.frontMaxD, frontP: this.frontP, pushM: this.pushM };
  }
  private fortifyAccum = 0;
  /** ★ 工程阶段（S0 勘察 → S1 施工 → S2 就绪；第一波 0.45 后转 S2） */
  stage: 'S0' | 'S1' | 'S2' = 'S0';

  constructor(private readonly swarm: SwarmSystem) {
    this.spawn = new CommanderSpawn({
      plan: () => this.plan,
      mob: () => this.spawnMob,
      mobIndex: () => this.spawnMobIndex,
      builder: () => this.spawnBuilder,
      gap: () => (this.roster.dbg.gap === '-' ? null : { role: this.roster.dbg.gap, val: this.roster.dbg.gapVal }),
    });
  }

  /** ★ 环形夹取（公开给队长核（port.clampRing））：径向夹进 [下限, 上限]；
   *  未启用/未就绪 → 原样返回；收拢态（上限<下限）→ 上限主导（收拢到 0=舰船点） */
  clampToRing(x: number, z: number): { x: number; z: number } {
    if (this.frontMinD < 0 || this.frontMaxD < 0) return { x, z };
    if (this.lastShipX === 0 && this.lastShipZ === 0) return { x, z };
    const dx = x - this.lastShipX, dz = z - this.lastShipZ;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return { x, z };
    const rMin = this.frontMinD, rMax = this.frontMaxD;
    const rWant = rMax < rMin ? Math.min(d, Math.max(0, rMax)) : Math.min(Math.max(d, rMin), rMax);
    if (Math.abs(rWant - d) <= 0.01) return { x, z };
    this.cmdLogRingClamps++;
    return { x: this.lastShipX + (dx / d) * rWant, z: this.lastShipZ + (dz / d) * rWant };
  }

  /** ★ S0 勘察：舰船落地周边地形检测 → DefensePlan（高地/掩体位/来向/三环）
   *  展开轴 = 扫描走廊轴（落地一次）；**掩体一律朝舰船（落点中心）侧 +5m、战壕留在原位**；
   *  此后不随玩家移动/危机度动态重排（《RTS架构.md》§3/§4，用户定调 2026-09-21）。 */
  planDefense(cx: number, cz: number, radius = 80, now = 0): DefensePlan | null {
    const raster = RasterMap.current;
    if (!raster) return null;
    this.plan = analyzeLandingTerrain(raster, cx, cz, radius);
    this.postCache.clear();     // ★ 现场有利位置缓存复位
    this.scoreStamp++;          // ★ 评分表触发戳（换落点重算）
    this.terrainScore.clear();
    this.passTable.build(raster, cx, cz, radius);   // ★ N0 可行性表（地形纯函数；一次构建，工事不重建）
    this.swarm.attachPassTable(this.passTable);     // ★ N1：表 → 命令门/小队寻路（可行性寻路启用）
    this.stage = 'S1';
    // ★ 换登陆点 = 重新部署：取消上一落点排队的兵力，本落点重新起一个大队
    //   （舰船会不断移动换登陆点；每次落地都要有自己的防御布置）
    this.spawn.reset();
    this.pushM = 0;   // ★ 前推里程复位（换落点）
    // ★ 单日节律复位（§3.5）：日程从落地重新走，挑衅采样清零（波次标记在引擎，t01 回退自动复位）
    this.rhythmT = 0;
    this.t01Base = -1;
    this.hitSeen.clear();
    setSteerTable(null);
    this.lastKills = this.swarm.ledger.kills;
    this.postureFn.reset(now);
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

  /** ★ 每帧：事态/环/地形表/工事数据/生成队列（数据面 tick）
   *  @param dayT01 当日进度 0~1（太阳钟：6:00=0 / 18:00=1；<0 = 无输入 → 内部兜底钟） */
  /** ★ 事态闸门（调试/探针读：frontP 单调推进、minD 允许离舰半径） */
  get frontGate(): { frontP: number; minD: number } {
    return { frontP: this.frontP, minD: this.frontMinD };
  }

  /** ★ 环形活动区（事态函数**单源**；新引擎 OrderValidator ① / 队长令同口径）：
   *  [minD, maxD] = 允许的离舰半径区间 + 环心（舰船）。未就绪 = (-1,-1)。 */
  get ring(): { minD: number; maxD: number; cx: number; cz: number } {
    return { minD: this.frontMinD, maxD: this.frontMaxD, cx: this.lastShipX, cz: this.lastShipZ };
  }

  /** ★ 地形表只读视图（队长掩体校验/外部读用；队长经 resolveAnchor 传入） */
  get terrain(): TerrainScore {
    return this.terrainScore;
  }

  /** ★ 阶段二：代价代次（掩体/地形重评 +1；加权寻路的偏好重算依据） */
  get pathStamp(): number {
    return this.scoreStamp;
  }

  /** ★ 调试/探针：掩体校验真源（与队长同源 hasCoverFrom） */
  debugHasCover(tx: number, tz: number, x: number, z: number): boolean {
    return hasCoverFrom(tx, tz, x, z, this.terrainScore);
  }

  tick(dt: number, now: number, playerX = 0, playerZ = 0, dayT01 = -1, shipX = 0, shipZ = 0): void {
    this.lastDayRaw = this.debugDayT01 >= 0 ? this.debugDayT01 : dayT01;   // ★ 生效日进度（时间轴拖动同口径）
    this.viewPX = playerX;
    this.viewPZ = playerZ;
    this.roster.tick(dt, this.swarm.squads);   // ★ §13.1 编制占比统计（4Hz）
    // ★ 工事（数据侧）：前推棘轮 + 缺口计数——位置查询/派件/施工全在新引擎 EngineerManager
    this.fortifyAccum += dt;
    if (this.fortifyAccum >= 0.5) {
      this.fortifyAccum = 0;
      if (this.stage === 'S1' && this.lastDayRaw >= 0.45) this.stage = 'S2';   // 第一波后停新增（就绪）
      const DONE = NEED_DONE;   // ★ 需求达标线（need < DONE = 该区已够工事）
      // ★ 前推（§13.4）：8 区全达标才推进；每拍 ≤0.5m；封顶 frontP×120m（事态允许）
      const allDone = this.fortify.safety.every((v) => Number.isFinite(v) && v < DONE);
      if (allDone) this.pushM = Math.min(this.frontP * 120, this.pushM + 0.5);
      this.fortify.dbg.builders = [...this.swarm.squads.all()].filter((s) => s.builders).length;
      this.fortify.dbg.claimsN = this.fortify.claims.size;
      this.fortify.dbg.spotsN = this.fortify.spots.size;
    }
    // ★ 态势函数（M2）：p = clamp(schedule(t) + provocation)
    //   日程 = 太阳钟（无输入 → 落地起算兜底钟）；挑衅 = 被击 + 击杀（衰减在 PostureFn 内）
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
      t01 = Math.min(1, this.rhythmT / SwarmData.DAY_RHYTHM_S);
    }
    this.lastT01 = t01;
    // ★ 距离系数时间增益（用户定 2026-09-25）：t01=0 → ×1；t01=1 → ×(1+24)=×25（碾压地形）
    this.terrainScore.distGain = 1 + 24 * Math.max(0, Math.min(1, t01));
    // ★ 兵力放行/波次已迁新引擎（EngineBridge.situation）；本层只算事态与环
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
    this.ringTick(shipX, shipZ);
    // ★ 逐步登场：队列滴灌（每 SPAWN_INTERVAL 出一只；总攻走 instant 不入队）
    this.spawn.drain(dt);
    // ★ 波次判定/兵力放行已迁新引擎（`EngineBridge.situation`：t01 + releaseAt → setReleaseCap/spawnBattalion）
    //   本层只留生成执行（CommanderSpawn）与地形/工事数据。
  }

  /** ★ 工兵数据/落地端口（新引擎 EngineerManager 消费；旧工事指挥链已销毁）：
   *  数据 = 分区/需求/环带/可达；建造位置查询 + 施工落地都在这一个口上（单源）。 */
  engineerPort(): EngineerPort {
    return {
      band: () => { const b = this.fortifyBand; return { rLo: b.rLo, rHi: b.rHi }; },
      ship: () => ({ x: this.lastShipX, z: this.lastShipZ }),
      needAt: (x, z) => this.fortifyNeed(x, z),
      canReach: (id, x, z) => {
        const s = this.swarm.squads.get(id);
        const lead = s?.members.get(s.leaderUid);
        if (!lead) return false;
        return this.swarm.walkableLine(lead.x, lead.z, x, z) && this.swarm.reachable(lead.x, lead.z, x, z);
      },
      assault: () => this.battlePosture === 'assault',
      noNewBuild: () => this.lastDayRaw >= 0.45,
      doneScore: () => NEED_DONE,
      sectorOf: (id) => this.fortify.claims.get(id) ?? -1,
      assignClaims: (ids) => this.fortify.assign(ids, NEED_DONE),
      refreshSector: (cx, cz, rLo, rHi) =>
        this.fortify.refreshOne(cx, cz, rLo, rHi, (x, z) => this.fortifyNeed(x, z)),
      pickSpot: (sec, rLo, rHi, canReach) =>
        this.fortify.targetOf(this.lastShipX, this.lastShipZ, sec, rLo, rHi,
          (x, z) => this.fortifyNeed(x, z), NEED_DONE, canReach),
      canDig: (x, z) => {
        const raster = RasterMap.current;
        return !raster || raster.surfaceHeightAt(x, z) - 0.2 >= FLOOR_MIN;
      },
      cover: (x, z, v) => this.buildCover?.(x, z, v),
      dig: (x, z) => this.digTrench?.(x, z),
      markDirty: (x, z, r) => this.markTerrainDirty(x, z, r),
    };
  }

  /** ★ 环形活动区（事态函数单源；每帧）：宽环 → 第一波大圆 → 甜甜圈 → 点；夹环基准 = 舰船 */
  private ringTick(shipX: number, shipZ: number): void {
    if (!this.plan) return;
    const front0 = { x: this.plan.cx + this.plan.approachX * 40, z: this.plan.cz + this.plan.approachZ * 40 };
    const ffrontD = Math.hypot(shipX - front0.x, shipZ - front0.z);
    const RING_HALF = 80;   // 初始宽环：以原前沿 ffrontD 为中心 ±80m
    const rb = SwarmData.ringBounds(this.lastT01, Math.max(0, ffrontD - RING_HALF), ffrontD + RING_HALF);
    this.frontMinD = rb.minD;
    this.frontMaxD = rb.maxD;
    this.lastShipX = shipX; this.lastShipZ = shipZ;   // ★ 夹环/工事基准（单源）
  }

  /** 旧部署维护（engineeringTick）已删除（用户定 2026-09-25）：战斗队由新引擎发令、工兵由 EngineerManager。 */
  private _removedEngineeringTick(): void {
    /* 保留空壳仅为引用清理过渡；无调用点，随本文件下次瘦身删除。 */
  }

  /** ★ 远程有利位置（制高点 / 掩体后；含"掩体真的挡子弹"校验）。
   *  规则：距离在 [0.5R, 1.05R]（能射到且不贴脸）且 **≥ minDist**（边撤边打时要求更远）；
   *  掩体挡住玩家视线加分；越接近理想站位（0.8R）越好；无合适点 → null（原地射击）。 */
  rangedPost(px: number, pz: number, range: number, minDist = 0, now = 0): { x: number; z: number } | null {
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
    return this.terrainPost(px, pz, range, now);
  }

  /** ★ 现场有利位置（无扫描产物时）：玩家周围射程环采样 + 1.5s 缓存（多小队共用） */
  private readonly postCache = new Map<string, { x: number; z: number; at: number }>();
  private terrainPost(px: number, pz: number, range: number, now = 0): { x: number; z: number } | null {
    const raster = RasterMap.current;
    if (!raster) return null;
    const key = `${Math.floor(px / 16)},${Math.floor(pz / 16)},${Math.round(range)}`;
    const nowMs = now * 1000;
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
      if (role === 'pit' || (role === 'liquid' && h < -0.8) || h < DANGER.PIT_H) continue;
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
  setPosture(p: BattlePosture, now = 0): void {
    this.postureFn.force(p, now);
    this.battlePosture = p;
    this.aliveAtPosture = p === 'assault' ? this.swarm.ledger.alive : 0;
  }

  /** ★ 硬边界查询（墙面/坑水；表未就绪 → false）：移动/寻路的危险地形判定 */
  blockedAt(x: number, z: number): boolean {
    return this.terrainScore.blockedAt(x, z);
  }

  /** ★ 掩体脚印（过掩体优化：SteerPick 候选惩罚 / TerrainAssist） */
  coverAt(x: number, z: number): boolean {
    return coverAtEntity(x, z);
  }

  /** ★ 直线可走（SteerTable 桥；TerrainAssist 出水方向用） */
  walkableLine(ax: number, az: number, bx: number, bz: number): boolean {
    return this.swarm.walkableLine(ax, az, bx, bz);
  }

  /** ★ 表高（SteerTable 桥；出水爬岸判定用） */
  heightAt(x: number, z: number): number {
    return this.passTable.heightAt(x, z);
  }

  /** ★ 局部坡度梯度（执行层坡面优化：上坡必须**从坡正面**=沿梯度/fall line 直上）
   *  ±2m 中心差分 → 单位化梯度（gx,gz 指向最陡上升方向）+ 坡度幅值 mag；表未就绪 → {0,0,0} */
  slopeGradAt(x: number, z: number): { gx: number; gz: number; mag: number } {
    const t = this.passTable;
    if (!t || !t.ready) return { gx: 0, gz: 0, mag: 0 };
    const gx = (t.heightAt(x + 2, z) - t.heightAt(x - 2, z)) / 4;
    const gz = (t.heightAt(x, z + 2) - t.heightAt(x, z - 2)) / 4;
    // ★ 表外 → heightAt=NaN：返回零梯度（防 NaN 污染执行层期望方向）
    if (!Number.isFinite(gx) || !Number.isFinite(gz)) return { gx: 0, gz: 0, mag: 0 };
    const mag = Math.hypot(gx, gz);
    if (mag < 1e-4) return { gx: 0, gz: 0, mag: 0 };
    return { gx: gx / mag, gz: gz / mag, mag };
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
    // ★ 距离系数时间增益（用户定 2026-09-25）：随时事增大，日终 ×(1+GAIN) 彻底碾压地形
    const gain = this.terrainScore.distGain;
    return gain === 1 ? this._wCache : { ...this._wCache, dist: this._wCache.dist * gain };
  }

  /** ★ 工兵要塞需求分（§13 评分体系大改）：防御价值 × 掩体缺口；水/坑/硬边排除（null）
   *  ——"该守且没掩体"的地方分最高（同源 TerrainScore/UnitStrategy，不另建表） */
  fortifyNeed(x: number, z: number): number | null {
    if (this.terrainScore.blockedAt(x, z)) return null;
    const f = this.terrainScore.featsAt(x, z, this.viewPX, this.viewPZ);
    if (!f || !f.pass) return null;
    const val = scoreForUnit('defense', f, this.liveWeights());
    if (val <= -1e8) return null;
    const deficit = 1 - Math.min(1, Math.max(0, f.cover) / 2.5);   // COVER_FULL = 2.5
    return val * deficit;
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
  clear(now = 0): void {
    this.plan = null;
    this.stage = 'S0';
    this.spawn.clear();
    this.holeTable.clear();
    this.postureFn.reset(now);
    this.battlePosture = 'fortify';
    this.aliveAtPosture = 0;
    this.rhythmT = 0;
    this.t01Base = -1;
    this.debugDayT01 = -1;
    this.hitSeen.clear();
    this.postureP = 0;
    this.postureSchedule = 0;
    this.postureProvocation = 0;
    this.postCache.clear();
    this.terrainScore.clear();
    this.passTable.clear();
    this.fortify.clear();
    this.pushM = 0;
  }
}
