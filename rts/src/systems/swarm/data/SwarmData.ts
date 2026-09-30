// ============================================================
// data/SwarmData —— 蜂群数据面（**无指挥语义**；重写 P4 归位）
// ============================================================
// 职责（只做数据/查询/端口，不做决策、不发令）：
//   · 地形与表：DefensePlan / 事实表 TerrainSemantics / 兵种评分 UnitScoring / L2 工事（HoleMask/HoleTable）/ PassTable
//   · 事态与环：PostureFn（p/frontP）+ 环形活动区（ringBounds/clampToRing）+ t01 时钟
//   · 工事数据：FortifyPlanner（需求/分区）+ 施工带（fortifyBand）+ 阶段 S1/S2
//   · 编制统计：RosterController；生成执行：四兵种管理器自有创建接口（模式层注入原子生成口）
// 消费方：新引擎（经 main/LiveView 单源读取）、队长核端口、导航/SteerPick 表桥、UI/探针只读。
// ============================================================

import { ROSTER_TARGET } from '../RosterController';
import { meleeRole } from '../../spawn/MobPick';
import { RasterMap } from '../../../services/map/RasterMap';
import { ShipHighland } from '../tactics/SectorBuilder';
import type { SwarmSystem } from '../SwarmSystem';
import { analyzeLandingTerrain, type DefensePlan } from '../LandingTerrain';
import type { BattlePosture } from '../Posture';
import { PostureFn } from '../PostureFn';
import { TerrainSemantics, L1_R, R_MAX } from '../TerrainSemantics';
import { type TacticalCtx, scoreFor, scoreTileAt } from '../engine/UnitScoring';
import { rangedGarrisonSpot } from '../engine/RangedManager';
import { CoverTables } from './CoverTables';
import { PlanData } from './PlanData';
import { samplerFor } from '../../../services/map/TerrainSampler';
import { PassTable } from '../nav/PassTable';
import { PassTableKeeper } from '../nav/PassTableKeeper';
import { RosterController } from '../RosterController';
import { makeCombatCreationPort, makeEngineerPort } from './Ports';
import { FortifyPlanner, NEED_DONE } from '../FortifyPlanner';
import { angleOfPoint, secOfPoint, clampAngleToSector } from '../Sectors';
import type { EngineerPort } from '../engine/EngineerManager';
import { hasCoverFrom } from '../UnitTactics';
import { setSteerTable } from '../../../entity/SteerPick';
import type { UnitRole, SquadType } from '../../../entity/SwarmUnit';
import type { MobRole } from '../engine/contracts';

/** ★ 坑底硬阈值（低于此高度不可走 → 禁止再挖；与 EngineerManager 端口同口径） */
/** ★ L3 寻路亲和（P1-3）：scoreFor 归一 ±PATH_AFF_N 分 → 倍率 ∓PATH_AFF_W（与掩体折扣相乘） */
const PATH_AFF_N = 8;
const PATH_AFF_W = 0.25;

export class SwarmData {
  /** ★ 落点计划 / 活动环 / 施工带（PlanData；2026-09-30 抽出） */
  readonly planning = new PlanData();
  /** ★ L1 敌人地形语义表（静态主体 + ★动态战壕覆盖层；《RTS架构.md》§1；落地/换落点重算） */
  readonly semantics = new TerrainSemantics();
  /** ★ 工事表集合（HoleMask/HoleTable + 掩体加成 + LOS 地形层；2026-09-30 抽出） */
  readonly covers = new CoverTables({
    plan: () => this.planning.defensePlan,
    builtList: () => this.fortify.builtList(),
    builtCount: () => this.fortify.builtCount,
    pass: () => this.passTable,
  });
  get holeMask(): import('../HoleMask').HoleMask { return this.covers.mask; }
  get holeTable(): import('../HoleTable').HoleTable { return this.covers.table; }
  /** ★ 工程阶段（S1）：造掩体端口（模式层注入；生成 CoverEntity(owner:'enemy', poster:false)）
   *  face = 正面朝向点（D5 战术件：岗哨斜件 45° / 封口横向；缺省 = 朝舰） */
  buildCover: ((x: number, z: number, variant: 'cover' | 'wall', face?: { x: number; z: number }) => void) | null = null;
  /** ★ S1：挖战壕端口（模式层注入；每次一块 4×4m、1 层） */
  digTrench: ((x: number, z: number) => void) | null = null;
  private spawnMob: ((x: number, z: number, role: UnitRole, elite?: boolean, near?: boolean) => void) | null = null;
  private spawnBuilder: ((x: number, z: number) => void) | null = null;
  /** ★ 装配原子生成口（模式层一次性注入；此后再无其他创建入口） */
  attachSpawnPorts(ports: {
    mob: (x: number, z: number, role: UnitRole, elite?: boolean, near?: boolean) => void;
    builder: (x: number, z: number) => void;
  }): void {
    this.spawnMob = ports.mob;
    this.spawnBuilder = ports.builder;
  }
  /** ★ 当前态势（引擎内部变量；驱动各编队命令强度） */
  battlePosture: BattlePosture = 'fortify';
  /** ★ 态势函数（M2：p = clamp(schedule(t) + provocation)；连续权重插值） */
  private readonly postureFn = new PostureFn();
  /** ★ 态势调试值：攻势强度 / 日程 / 挑衅（覆盖层与测试读取） */
  postureP = 0;
  /** ★ 实时玩家位置（tick 刷新；scoreTypeAt/SteerPick 兵种分用——比 rebuild 烙进 score 的新） */
  private viewPX = 0;
  private viewPZ = 0;
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
    // ★ 自由快进/倒退（用户定）：拖动即**重算姿态状态**（解总攻锁/清挑衅/闸门归零）→ 事态/环可反向
    this.postureFn.reset(this.lastNowS);
    this.planning.resetClock();   // ★ 拖动即重算事态环（下一拍）
  }

  /** ★ 恢复实时时钟（清拖动覆盖） */
  followRealtime(): void {
    this.debugDayT01 = -1;
    this.t01Base = -1;
    this.postureFn.reset(this.lastNowS);
    this.planning.resetClock();   // ★ 恢复实时即重算事态环（下一拍）
  }
  /** 进入总攻时的兵力（撤退判定基准） */
  private aliveAtPosture = 0;
  /** ★ 地块有利位置评分表（全兵种共用；掩体/态势变化即重建） */
  /** ★ 评分数据源（查询时算；无第四网格）：每拍重建 = 三张表句柄 + 权重 + 玩家位 */
  private tacticCtx: TacticalCtx | null = null;
  /** ★ 距离系数时间增益（指挥器每拍写；1 = 无增益） */
  distGain = 1;
  /** 评分表触发戳（换落点 +1） */
  private scoreStamp = 0;
  /** ★ 前进闸门（事态函数给；0~1 只增）：整条战线离舰角落差可放行的比例——"稳步推进" */
  private frontP = 0;
  /** 态势代次（切换 → 触发整队） */
  private postureEpoch = 0;
  /** 最近一拍实秒（scrub/恢复实时重置姿态用） */
  private lastNowS = 0;
  /** ★ 原始当日进度（hooks.dayT01；第一波 ≥0.45 起停止新增施工——队长层派件读） */
  private lastDayRaw = -1;

  /** 最近一次大队决策（调试/测试读取） */
  lastDecision: { squad: number; kind: string; at: number } | null = null;
  /** ★ N0 可行性表（迷宫抽象）；★ 随地形走（用户定 2026-09-27）：keeper 负责标脏/节流重建 */
  readonly passTable = new PassTable();
  private readonly passKeeper = new PassTableKeeper();
  /** ★ §13.1 编制比例（占比统计 + 缺口；只读） */
  readonly roster = new RosterController();
  /** ★ §13.3 工事规划（最危险区域选择） */
  readonly fortify = new FortifyPlanner();
  /** ★ 近战混编计数（shield:assault 轮询；用户定 2026-09-27） */
  private meleeMix = { mix: 0 };

  /** ★ 施工带（PlanData 公式；总攻不收敛为点） */
  get fortifyBand(): { rLo: number; rHi: number; minD: number; maxD: number; frontP: number; pushM: number } {
    return this.planning.band(this.frontP);
  }
  private fortifyAccum = 0;

  constructor(private readonly swarm: SwarmSystem) {
  }

  /** ★ 环形夹取（公开给队长核（port.clampRing））：径向夹进 [下限, 上限]；
   *  未启用/未就绪 → 原样返回；收拢态（上限<下限）→ 上限主导（收拢到 0=舰船点） */
  clampToRing(x: number, z: number): { x: number; z: number } {
    return this.planning.clampToRing(x, z);
  }

  /** ★ §0.3 防区锁：非总攻 + 队长在环带内 → 目标夹进本扇区楔形；带外（溢出/外面）→ 原样 */
  sectorLockTarget(id: number, x: number, z: number): { x: number; z: number } {
    return this.planning.sectorLockTarget(x, z, (sid) => {
      const sq = this.swarm.squads.get(sid);
      const lead = sq ? sq.members.get(sq.leaderUid) : undefined;
      return lead ? { x: lead.x, z: lead.z } : null;
    }, id);
  }

  /** ★ S0 勘察：舰船落地周边地形检测 → DefensePlan（高地/掩体位/来向/三环）。掩体朝舰侧+5m、战壕留原位；
   *  可行性表（2026-09-30 修）：**以舰为中心**、半径罩住 舰↔落点 走廊（否则打到舰西侧 outside）。 */
  planDefense(cx: number, cz: number, radius = 80, now = 0, shipX?: number, shipZ?: number): DefensePlan | null {
    const raster = RasterMap.current;
    if (!raster) return null;
    this.planning.setPlan(analyzeLandingTerrain(raster, cx, cz, radius));
    this.scoreStamp++;          // ★ 评分表触发戳（换落点重算）
    this.tacticCtx = null;
    const pcx = shipX !== undefined ? shipX : cx;
    const pcz = shipZ !== undefined ? shipZ : cz;
    this.passTable.build(raster, pcx, pcz, radius);   // ★ N0 可行性表（舰心窗；初始构建）
    this.passKeeper.bind(pcx, pcz, radius);
    this.swarm.attachPassTable(this.passTable);     // ★ N1：表 → 命令门/小队寻路（可行性寻路启用）
    this.planning.stage = 'S1';
    // ★ 换登陆点 = 重新部署：取消上一落点排队的兵力，本落点重新起一个大队
    //   （舰船会不断移动换登陆点；每次落地都要有自己的防御布置）
    this.planning.resetPush();   // ★ 前推里程复位（换落点）
    // ★ 单日节律复位（§3.5）：日程从落地重新走，挑衅采样清零（波次标记在引擎，t01 回退自动复位）
    this.rhythmT = 0;
    this.t01Base = -1;
    this.hitSeen.clear();
    setSteerTable(null);
    this.lastKills = this.swarm.ledger.kills;
    this.postureFn.reset(now);
    this.battlePosture = 'fortify';
    // ★ 兵力创建：**四兵种管理器自有创建接口**（用户定 2026-09-26）——
    //   本层只提供原子生成口与防区锚点；旧班底/大队/回收名单创建已删。
    return this.planning.defensePlan;
  }

  /** ★ 防守布置（读；阶段机 S0~S6 消费） */
  get defensePlan(): DefensePlan | null { return this.planning.defensePlan; }
  setDefensePlan(plan: DefensePlan | null): void { this.planning.setPlan(plan); }
  get stage(): 'S0' | 'S1' | 'S2' { return this.planning.stage; }
  get lastShipX(): number { return this.planning.lastX; }
  get lastShipZ(): number { return this.planning.lastZ; }
  get cmdLogRingClamps(): number { return this.planning.clamps; }

  /** ★ 每帧：事态/环/地形表/工事数据/生成队列（数据面 tick）
   *  @param dayT01 当日进度 0~1（太阳钟：6:00=0 / 18:00=1；<0 = 无输入 → 内部兜底钟） */
  /** ★ 事态闸门（调试/探针读：frontP 单调推进、minD 允许离舰半径） */
  get frontGate(): { frontP: number; minD: number } {
    return { frontP: this.frontP, minD: this.planning.ring().minD };
  }

  /** ★ 环形活动区（事态函数**单源**；新引擎 OrderValidator ① / 队长令同口径）：
   *  [minD, maxD] = 允许的离舰半径区间 + 环心（舰船）。未就绪 = (-1,-1)。 */
  get ring(): { minD: number; maxD: number; cx: number; cz: number } {
    return this.planning.ring();
  }

  /** ★ 地形表只读视图（队长掩体校验/外部读用；队长经 resolveAnchor 传入） */
  /** ★ 阶段二：代价代次（掩体/地形重评 +1；加权寻路的偏好重算依据） */
  get pathStamp(): number {
    return this.scoreStamp;
  }

  /** ★ 调试/探针：掩体校验真源（与队长同源 hasCoverFrom） */
  debugHasCover(tx: number, tz: number, x: number, z: number): boolean {
    return this.covers.debugHasCover(tx, tz, x, z);
  }

  tick(dt: number, now: number, playerX = 0, playerZ = 0, dayT01 = -1, shipX = 0, shipZ = 0): void {
    this.lastNowS = now;
    this.lastDayRaw = this.debugDayT01 >= 0 ? this.debugDayT01 : dayT01;   // ★ 生效日进度（时间轴拖动同口径）
    this.viewPX = playerX;
    this.viewPZ = playerZ;
    this.roster.tick(dt, this.swarm.squads);   // ★ §13.1 编制占比统计（4Hz）
    // ★ 工事（数据侧）：前推棘轮 + 缺口计数——位置查询/派件/施工全在新引擎 EngineerManager
    this.fortifyAccum += dt;
    if (this.fortifyAccum >= 0.5) {
      this.fortifyAccum = 0;
      if (this.passKeeper.flush(this.passTable, RasterMap.current)) this.scoreStamp++;   // ★ 表真正重建 → 代次戳 +1
      if (this.planning.stage === 'S1' && this.lastDayRaw >= 0.45) this.planning.stage = 'S2';   // 第一波后停新增（就绪）
      const DONE = NEED_DONE;   // ★ 需求达标线（need < DONE = 该区已够工事）
      // ★ 前推（§13.4）：8 区全达标才推进；每拍 ≤0.5m；封顶 frontP×120m（事态允许）
      // ★ 未扫描 → 不算达标；已扫描但**无可行点**（-∞，如海面）→ 视为达标（不可施工，不阻塞前推）
      const allDone = this.fortify.safety.every((v, i) => this.fortify.scanned[i] && (!Number.isFinite(v) || v < DONE));
      // ★ 总攻不推（施工带已收缩为点）；其余达标即推，2m/s（用户定：前压提速）
      if (allDone) this.planning.advancePush(this.frontP, this.battlePosture === 'assault');
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
    this.distGain = 1 + 24 * Math.max(0, Math.min(1, t01));
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
    const plan = this.planning.defensePlan;
    if (plan) {
      const raster = RasterMap.current;
      if (raster) {
        const smp0 = samplerFor(raster);
        // ★ 战术上下文（D3：事实 + 事态 → 兵种管理器策略合成；本层不再有评分表）
        const hasShip0 = shipX !== 0 || shipZ !== 0;
        this.tacticCtx = {
          facts: this.semantics,
          heightAt: (x: number, z: number) => smp0.heightAt(raster, x, z),
          bonus: this.covers.bonusCached(),
          waterAt: (x, z) => this.isWaterAt(x, z), isDugAt: (x, z) => this.holeMask.isDug(x, z),
          // ★ D7-2 掩体遮挡（参照=舰；实体掩体 LOS + 地形掩体）——近寻路消费
          coverFromAt: (x, z) => hasCoverFrom(this.lastShipX, this.lastShipZ, x, z, this.covers.blocker),
          ship: hasShip0 ? { x: shipX, z: shipZ } : { x: plan.cx, z: plan.cz },
          player: { x: playerX, z: playerZ },
          p: this.postureP, posture: this.battlePosture,
          distGain: this.distGain,
        };
        setSteerTable(this);   // ★ 表桥：实体侧 SteerPick 也能读表（同内核）
        // ★ 地形事实表（静态·**舰心窗**）：未建/舰动/换落点时重建；半径罩住 舰↔落点 走廊（dist+60）
        const hasShip = shipX !== 0 || shipZ !== 0;
        const cxs = hasShip ? shipX : plan.cx, czs = hasShip ? shipZ : plan.cz;
        const corridor = Math.hypot(plan.cx - cxs, plan.cz - czs);
        const radius = Math.min(R_MAX, Math.max(L1_R, corridor + 60));
        const a = this.semantics.anchor;
        const ao = this.semantics.aoAnchor;
        if (!this.semantics.isReady || a.x !== cxs || a.z !== czs || ao.x !== plan.cx || ao.z !== plan.cz) {
          const smp = samplerFor(raster);
          this.semantics.build({
            heightAt: (x, z) => smp.heightAt(raster, x, z),
            roleAt: (x, z) => smp.roleAt(raster, x, z),
          }, cxs, czs, radius, plan.cx, plan.cz);
          // ★ 独立坑洞掩码（同锚窗口）：真源 = RasterMap.levelDepthAt（权威挖掘深度）
          this.holeMask.build({ digDepthAt: (x, z) => raster.levelDepthAt(x, z) },
            plan.cx, plan.cz);
          const dbg = typeof location !== 'undefined'
            && (location.search.includes('l1dbg') || location.search.includes('swarmdbg'));
          if (dbg) {
            const st = this.semantics.stats();
            console.log('[L1] 地形事实表构建完成', JSON.stringify(st));
          }
          (globalThis as unknown as { __l1?: TerrainSemantics }).__l1 = this.semantics;
          const gw = globalThis as unknown as {
            __holeMask?: import('../HoleMask').HoleMask;
            __holeTable?: import('../HoleTable').HoleTable;
          };
          gw.__holeMask = this.holeMask;
          gw.__holeTable = this.holeTable;
        }
        // ★★★ 敌用工事表（动态 2Hz）：坑洞（掩码×深×近）+ 掩体（活注册表×遮蔽×近）
        if (this.covers.tick(dt, this.semantics, playerX, playerZ)) this.scoreStamp++;   // 掩体增减 → 评分代次 +1
      }
    }
    // ★ 事态环（1Hz；用户定）：范围按秒更新——避免每子步抖动引发夹环改令
    this.planning.tick(dt, this.postureP, shipX, shipZ);
    // ★ 波次判定/兵力放行已迁新引擎（`EngineBridge.situation`：t01 + releaseAt → setReleaseCap/spawnBattalion）
    //   本层只留原子生成口与地形/工事数据。
  }

  /** ★ 工兵数据/落地端口（新引擎 EngineerManager 消费；旧工事指挥链已销毁）：
   *  数据 = 分区/需求/环带/可达；建造位置查询 + 施工落地都在这一个口上（单源）。 */
  /** ★ 舰船关联高地判定（防区/工兵件 共同排除；用户定 2026-09-26） */
  onShipPlateau(x: number, z: number): boolean {
    const raster = RasterMap.current;
    if (!raster) return false;
    if (this.lastShipX === 0 && this.lastShipZ === 0) return false;
    const shipY = raster.surfaceHeightAt(this.lastShipX, this.lastShipZ);
    return this.shipHi.contains(this.lastShipX, this.lastShipZ, shipY, x, z,
      (px, pz) => raster.surfaceHeightAt(px, pz));   // ★ 连通高原整片排除（用户定 2026-09-27②）
  }

  /** ★ 与主角相连高原缓存（工兵建造点门；用户定 2026-09-27） */
  private readonly shipHi = new ShipHighland();

  /** ★ 主攻扇区（tactics 注入；工兵优先投放） */
  mainSectors: number[] = [];

  squadSectorOf: ((id: number) => number) | null = null;
  sectorAnchorOf: ((sec: number) => { x: number; z: number } | null) | null = null;

  // ---- 端口宿主（data/Ports.ts 工厂消费；只暴露端口真正需要的） ----
  get system(): SwarmSystem { return this.swarm; }
  ship(): { x: number; z: number } { return { x: this.lastShipX, z: this.lastShipZ }; }
  band(): { rLo: number; rHi: number } { const b = this.fortifyBand; return { rLo: b.rLo, rHi: b.rHi }; }
  outerRing(): number { return this.planning.outerMax; }
  dayRaw(): number { return this.lastDayRaw; }
  /** ★ 近战按 盾:突击 占比混合生成（ROSTER_TARGET；用户定 2026-09-27） */
  spawnRole(role: MobRole, x: number, z: number): boolean {
    if (!this.spawnMob) return false;
    const ur = role === 'melee'
      ? meleeRole(this.meleeMix, ROSTER_TARGET.shield / Math.max(0.01, ROSTER_TARGET.shield + ROSTER_TARGET.assault))
      : role === 'engineer' ? 'logistics' : role;
    this.spawnMob(x, z, ur as Parameters<typeof this.spawnMob>[2], false, true);
    return true;
  }
  spawnBuilderAt(x: number, z: number): boolean {
    if (!this.spawnBuilder) return false;
    this.spawnBuilder(x, z);
    return true;
  }

  combatCreationPort(): import('../engine/SquadCreation').CreationPort {
    return makeCombatCreationPort(this);
  }

  engineerPort(): EngineerPort {
    return makeEngineerPort(this);
  }

  /** 旧部署维护（engineeringTick）已删除（用户定 2026-09-25）：战斗队由新引擎发令、工兵由 EngineerManager。 */

  /** ★ 坡面方位（表标注；上坡函数用）：weld+climb 位 → 轴向法线 + 边中点 */
  canStep(x: number, z: number, dx: number, dz: number): boolean {
    return this.passTable.canStep(x, z, dx, dz);
  }

  climbRunAt(x: number, z: number, dx = 0, dz = 0): { x: number; z: number; ux: number; uz: number; width: number; rise: number; lx: number; lz: number } | null {
    return this.passTable.climbRunAt(x, z, dx, dz);
  }


  /** ★ 调试/测试：强制切态势（覆盖态势函数自动转移；总攻同样锁定） */
  setPosture(p: BattlePosture, now = 0): void {
    this.postureFn.force(p, now);
    this.battlePosture = p;
    this.aliveAtPosture = p === 'assault' ? this.swarm.ledger.alive : 0;
  }

  /** ★ 硬边界查询（墙面/坑水；表未就绪 → false）：移动/寻路的危险地形判定 */
  /** ★ 硬通行（用户定 2026-09-29）：**坑/战壕不参与寻路** → 无硬格。 */
  blockedAt(_x: number, _z: number): boolean {
    return false;
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
    return scoreTileAt(this.tacticCtx, x, z);
  }

  /** ★ 工兵要塞需求分：兵种分（defense 档）× 掩体缺口；水/坑/硬边排除（null）
   *  ——"该守且没掩体"的地方分最高（D5 将换"件优先级梯队"） */
  fortifyNeed(x: number, z: number): number | null {
    if (this.covers.blockedNow(x, z)) return null;
    const ctx = this.tacticCtx;
    if (!ctx) return null;
    const val = scoreFor('defense', ctx, x, z, this.viewPX, this.viewPZ);
    if (val <= -1e8) return null;
    const cover = ctx.bonus.get(`${Math.round(x / 4)},${Math.round(z / 4)}`) ?? 0;
    const deficit = 1 - Math.min(1, Math.max(0, cover) / 2.5);   // COVER_FULL = 2.5
    return val * deficit;
  }

  /** ★ L3 兵种分（D3：路由到该兵种管理器系数表） */
  scoreForType(type: SquadType, x: number, z: number, playerX = 0, playerZ = 0): number {
    if (!this.tacticCtx) return -1e9;
    return scoreFor(type, this.tacticCtx, x, z, playerX, playerZ);
  }

  /** ★ SteerTable 扩展：16 向候选按兵种打分；读实时玩家位置 */
  scoreTypeAt(type: string, x: number, z: number): number | null {
    if (!this.tacticCtx) return null;
    return scoreFor(type as SquadType, this.tacticCtx, x, z, this.viewPX, this.viewPZ);
  }

  /** ★ 近寻路分（D7）：有队 → 按该队兵种策略（近战/远程/工兵各自消费）；无上下文 → null */
  scoreForSquad(sid: number, x: number, z: number): number | null {
    if (!this.tacticCtx) return null;
    const type = this.swarm.squads.get(sid)?.type ?? 'mixed';
    return scoreFor(type, this.tacticCtx, x, z, this.viewPX, this.viewPZ);
  }

  /** ★ parity 断言用：同上下文复算 mixed */
  scoreMixedAt(x: number, z: number): number | null {
    if (!this.tacticCtx) return null;
    return scoreFor('mixed', this.tacticCtx, x, z);
  }

  /** ★ 水域查询（允许站立；执行层在水中 → 上岸权重） */


  /** ★ 远程部署位（D7 接线）：高地+岗哨驻守位（围绕舰扫全 AO；位数据） */
  rangedGarrison(sid: number, x: number, z: number): { x: number; z: number } | null {
    const ctx = this.tacticCtx;
    if (!ctx) return null;
    const rec = this.swarm.squads.get(sid);
    const lead = rec ? rec.members.get(rec.leaderUid) : undefined;
    return rangedGarrisonSpot(ctx, lead ? { x: lead.x, z: lead.z } : { x, z }, this.planning.ship());
  }

  /** ★ 水域查询（地形真相：地块角色 liquid；用户定 2026-09-25 三张表原则） */
  isWaterAt(x: number, z: number): boolean {
    return RasterMap.current?.tileDefAt(x, z).genRole === 'liquid';
  }

  /** ★★ 全地形破坏中央入口（ChunkManager.onTerrainDig；玩家子弹也走这）：
   *  1m 深度场窗扫 → HoleTable + 直读掩码（挖过即战壕）+ 采样缓存失效。 */
  noteTerrainDig(x: number, z: number, r = 16): void {
    this.holeMask.refresh(x, z, r + 12);                        // ★ L2 工事源（1m 深度场；评分查询时直读 → 挖过即战壕）
    const raster = RasterMap.current;
    if (raster) samplerFor(raster).invalidateArea(x, z, r + 6); // ★ 统一采样缓存同步失效
    this.passKeeper.markDirty();   // ★ 表随地形走（重建拍见 tick；代次戳在**真正重建时** +1）
  }

  /** ★ 地形脏区（模式层挖改/建造都调这个）：noteTerrainDig 单入口别名 */
  markTerrainDirty(x: number, z: number, r = 12): void {
    this.noteTerrainDig(x, z, r);
    if (Number.isFinite(this.lastShipX)) this.fortify.markDirty(x, z, this.lastShipX, this.lastShipZ); else this.fortify.dirty.fill(true);   // ★ 表变化→标脏（查询前即时重算）
  }

  /** ★ 调试：态势一行摘要（覆盖层/测试读取） */
  postureInfo(): string {
    return `态势 ${this.battlePosture} p=${this.postureP.toFixed(2)}`
      + ` 日程=${this.postureSchedule.toFixed(2)} 挑衅=${this.postureProvocation.toFixed(2)}`;
  }

  /** 清理（退出模式） */
  clear(now = 0): void {
    this.planning.reset();
    this.covers.clear();
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
    this.tacticCtx = null;
    this.passTable.clear();
    this.fortify.clear();
  }
}
