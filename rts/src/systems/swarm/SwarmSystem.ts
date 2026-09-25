// ============================================================
// SwarmSystem —— 蜂群调度器（《RTS架构.md》§41/§5.5；P1 数据层）
// ============================================================
// 职责：
//   · 代理池 + 人群网格 + 批量渲染的唯一持有者与驱动者
//   · 分层（L1/L2）决策与移动 tick（降频 + 相位抖动）；升格/降格/远距回收
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { entityPerf } from '../../entity/EntityPerf';
import { eventBus } from '../../core/EventBus';
import { SwarmLedger } from './SwarmLedger';
import {
  AgentPool,
  AGENT_TARGET_PLAYER,
  AGENT_TARGET_SHIP,
  AGENT_TARGET_SENTINEL,
  AGENT_TIER_FAR,
  AGENT_TIER_MID,
  type AgentSpawnData,
  type AgentSnapshot,
} from './AgentPool';
import { CrowdGrid } from './CrowdGrid';
import { SwarmBatch } from './SwarmBatch';
import { FlowField } from './FlowField';
import { SquadTable, type Squad, type SquadRating } from './SquadTable';
import { SquadNavigator } from './SquadNavigator';
import { followDir, leaderDir, followStopR } from './squad/Follow';
import type { SquadOrderState } from './squad/State';
import { rangedMoveTarget } from './RangedTactics';
import type { SwarmTierPort } from './SwarmTierPort';
import { SwarmData } from './data/SwarmData';
import {
  roleFromCode, orderFromCode, directiveFromCode, orderCode, directiveCode, fireCode, roleBucket,
  ROLE_SHIELD, type MobTactics, type TacticalOrder, type UnitDirective, type SwarmCarrier,
} from '../../entity/SwarmUnit';
import {
  AtomExecutor, MOVE_ATOMS, atomDirection, runDirective, fireProfile,
  type DirectiveRun,
} from '../../entity/AtomExecutor';
import { INTENT_PLAYER, INTENT_SHIP, INTENT_FLANK, INTENT_NONE } from './Director';
import { pickSteer } from '../../entity/SteerPick';
import { dangerPointAt } from '../../entity/TerrainAssist';
import { fallLineBlend } from '../../entity/TerrainAssist';
import type { FrameAssetSource } from '../../services/fx/AssetSource';
import { DANGER } from './SwarmDanger';
import type { PassTable } from './nav/PassTable';
import { SWARM, AUTONOMY, STUCK } from './SwarmConfig';

export { SWARM, AUTONOMY } from './SwarmConfig';

export interface SwarmHooks {
  /** 玩家位置（分层基准 / 索敌） */
  playerX: number;
  playerZ: number;
  /** 舰船位置（第二目标） */
  shipX: number;
  shipZ: number;
  /** 相机画面深处方向（贴图前后帧判定） */
  camForwardX: number;
  camForwardZ: number;
  /** 当前 L3 实体数（升格上限判定） */
  entityCount: number;
  dayT01?: number;   // ★ M2 当日进度 0~1（太阳钟 6:00=0/18:00=1；缺省 → 引擎落地兜底钟）
  /** ★ E4a：L3 实体只读列表（编队 steer 消费；模式层给 EntityManager 的敌人数组） */
  activeUnits?: () => readonly SwarmCarrier[];
  /** ★ 逐兵种战术表（名册 `EnemySpec.tactics`；模式层按 mobIndex 提供） */
  mobTactics?: (mobIndex: number) => MobTactics | null;
  /** ★ 步骤 8：升降格 / 回收唯一桥接（管线 P4）；模式层实现（WorldSpawner） */
  tierPort?: SwarmTierPort;
  /** 代理近战结算（targetKind：0=玩家 / 1=舰船 / 2=祖宗；x/z = 代理位置——祖宗结算定位用） */
  melee: (targetKind: number, dmg: number, x: number, z: number) => void;
  /** ★ 升格可见性钩子（2026-09-25 用户定："玩家视野内变实体"）：给了就用它判升格；
   *  未给 → 回退原口径（离焦点 playerX/Z < L3_RADIUS）。降格由模式层 tickDemote 判。 */
  inView?: (x: number, z: number) => boolean;
  /** ★ 祖宗嘲讽：查询 (x,z) 嘲讽圈内最近的祖宗位置（null = 圈外；返回对象会被复用） */
  nearestTaunt?: (x: number, z: number) => { x: number; z: number } | null;
  /** 代理被击杀（掉落/遗物击杀统计由模式层结算） */
  onAgentKilled?: (mobIndex: number, x: number, y: number, z: number) => void;
  /** ★ 步骤 5：队长变更（池侧选举/接任）→ 模式层镜像到 L3 实体 */
  onLeaderChanged?: (uid: number, isLeader: boolean) => void;
  /** ★ 步骤 9：**全灭才上报**（单人阵亡只下调评分，不发事件） */
  onSquadWiped?: (squadId: number) => void;
  /** ★ 步骤 9b：命令/指令 → L3 实体（池侧写列；实体不在池内，走 uid 映射） */
  onDirective?: (uid: number, order: TacticalOrder, directive: UnitDirective, until: number) => void;
  /** ★ 远程代理射击（真弹道；skin 0=箭/1=法球；spread=散布弧度） */
  onAgentRanged?: (
    targetKind: number, dmg: number, x: number, z: number,
    tx: number, tz: number, skin: number, speed: number, life: number, spread: number,
  ) => void;
}

const _sep = { x: 0, z: 0 };
const _flow = { x: 0, z: 0 };
const _atomDir = { x: 0, z: 0 };
/** ★ 统一决策内核输出 scratch（零分配） */
const _run: DirectiveRun = { moveIdx: 255, move: 'hold', fire: false, inRange: false };
const _dir = { x: 0, z: 0 };   // ★ 地形辅助 scratch（坡正面混合；零分配）
export class SwarmSystem {
  /** ★ 蜂群伤亡账本（引擎直管）：敌人总数 / 击杀 / 回收的唯一口径（2026-09-20） */
  readonly ledger = new SwarmLedger();
  /** ★ 唯一伤亡通道订阅（实体侧：EnemyBase.onRetire('killed') → enemy_killed；代理侧引擎内直记） */
  private readonly casualtyUnsub: () => void;
  /** ★ 非击杀离场订阅（recycled/despawned：账本存活 −1） */
  private readonly removedUnsub: () => void;
  readonly pool = new AgentPool();
  /** ★ 步骤 5：小队注册表 + 队长（同质就近编队；《RTS架构.md》§5.5） */
  readonly squads = new SquadTable();
  /** ★ 稳定 uid 分配器（spawn/demote 缺省分配；升降格往返不变） */
  private nextUid = 1;
  /** ★ 队长变更待广播（帧末统一回调，避免循环内跨层） */
  private readonly leaderChanges: { uid: number; isLeader: boolean }[] = [];
  /** ★ 步骤 9：待上报的全灭小队（帧末统一回调） */
  private readonly pendingWiped: number[] = [];
  /** ★ 步骤 9：成员状态同步节拍（4Hz） */
  private ratingAccum = 0;
  /** ★ 执行态单源（队长核；main 接线）：执行层读走廊/锚点用 */
  private squadStateOf: ((id: number) => SquadOrderState | null) | null = null;
  /** ★ 队注销回调（全灭/收编）：main 接线清队长核/引擎 store */
  private squadGone: ((id: number) => void) | null = null;
  /** ★ 蜂群指挥器（引擎侧：大队任务/小队覆盖/BattalionView） */
  readonly data = new SwarmData(this);
  /** ★ 步骤 10：大队警觉（squadId → 最近被击秒；态势机/外部只读） */
  readonly recentHits = new Map<number, number>();
  /** ★ 步骤 10：倾盆而出截止（秒；0 = 未触发） */
  private counterUntil = 0;
  /** ★ 步骤 6：上帧玩家位置（被击升格的 L3 范围判定） */
  private lastPlayerX = 0;
  private lastPlayerZ = 0;
  /** ★ 最近一帧 hooks（队长核 applyDirective → L3 onDirective 用） */
  private lastHooks: SwarmHooks | null = null;
  /** ★ E4a 编队 steer / HPA 预热节拍（10Hz） */
  private steerAccum = 0;
  /** ★ 小队寻路 + L3 编队 steer（拆分模块；SquadPath + Formation） */
  private readonly nav = new SquadNavigator();
  /** 编队锚点量算复用对象（零分配） */
  /** ★ 执行层：原子执行器（二级掷；步骤 9c） */
  private readonly atoms = new AtomExecutor();
  private grid = new CrowdGrid();
  private batch: SwarmBatch | null = null;
  /** ★ P2：群体导航流场 + 警戒场（与网格共存） */
  private flow = new FlowField();
  private flowTimer = 0;
  /** ★ P2：攻击槽（每个目标一圈扇区；owner = 代理下标，-1 空；索引含祖宗 2） */
  private slotOwner: Int16Array[] = [
    new Int16Array(SWARM.SLOT_ANGLES).fill(-1),
    new Int16Array(SWARM.SLOT_ANGLES).fill(-1),
    new Int16Array(SWARM.SLOT_ANGLES).fill(-1),
  ];
  /** ★ P2：攻击令牌计数（每目标同时挥击数；索引含祖宗 2） */
  private tokenUsed = [0, 0, 0];

  constructor() {
    this.nav.pathMul = (type, x, z) => this.data.pathMulFor(type, x, z);   // ★ 掩体折扣 × 兵种亲和（P1-3）
    // ★ 唯一伤亡通道（实体侧）：EnemyBase.onRetire('killed') → enemy_killed → 账本
    //   代理/队长（池内）由 update 循环直记；两条路都只报数量，不需要兵种。
    //   uid ≤ 0（计划外直建实体，如 Boss）不属于蜂群账本 → 不计。
    this.casualtyUnsub = eventBus.on('enemy_killed', (p) => {
      if (p.uid > 0) this.ledger.reportCasualty(1);
    });
    // ★ 非击杀离场：存活 −1；recycled 视为回收（归还编制、计 recalled）
    this.removedUnsub = eventBus.on('enemy_removed', (p) => {
      if (p.uid <= 0) return;
      if (p.reason === 'recycled') this.ledger.noteRecall(1);
      else this.ledger.noteRemoved(1);
    });
  }

  /** 构建批量渲染（模式层在 mobDefs 就绪后调用；素材顺序 = mobIndex）
   *  ★ sinks：每兵种接地补偿（世界单位；与 mobDefs 同序，可省 = 不补偿） */
  buildBatch(scene: import('three').Scene, assets: FrameAssetSource[], sinks?: number[]): void {
    this.batch = new SwarmBatch(scene, assets, sinks);
  }

  get count(): number {
    return this.pool.count;
  }

  /** 生成代理（唯一生成口；账本 spawned 在此 +1）@param force 调试绕过配额闸门 */
  spawn(data: AgentSpawnData, force = false): number {
    if (!force && !this.ledger.canSpawn()) return -1;
    if (!data.uid || data.uid <= 0) data.uid = this.nextUid++;
    const i = this.pool.push(data);
    if (i < 0) return i;
    this.ledger.noteSpawn(1);
    // ★ 步骤 5：同质就近编队 + 首员即队长
    const squad = this.squads.assign(
      data.uid, roleFromCode(this.pool.role[i]), data.x, data.z,
      this.pool.mobIndex[i], this.pool.suicide[i] === 1, this.pool.singleton[i] === 1,
      this.pool.canBuild[i] === 1,
    );
    this.pool.squadId[i] = squad.id;
    this.pool.battalionId[i] = squad.battalionId;
    this.squads.syncMember(data.uid, this.pool.hp[i], this.pool.maxHp[i], data.x, data.z, 0);
    this.syncLeaderFlags(squad.id);
    return i;
  }

  /** 降格：实体 → 代理（模式层回收实体时调用） */
  demote(snap: AgentSnapshot): void {
    const uid = snap.uid && snap.uid > 0 ? snap.uid : this.nextUid++;
    const i = this.pool.push({
      mobIndex: snap.mobIndex,
      x: snap.x, y: snap.y, z: snap.z,
      hp: snap.hp, maxHp: snap.maxHp,
      defense: snap.defense, attackPower: snap.attackPower,
      speed: snap.speed,
      meleeDamage: snap.meleeDamage, meleeRange: snap.meleeRange,
      scale: snap.scale,
      tier: snap.tier,
      aggro: snap.aggro ?? 8,
      wanderSpeed: snap.wanderSpeed ?? 2,
      intent: snap.intent ?? 255,
      // ★ 空中层（2026-09-18）：飞行标记必须跟着降格实体回池，否则回池即落地
      isAir: snap.isAir,
      altitude: snap.altitude,
      // ★ E3b（2026-09-19）：编队/指挥/移动目标全字段透传（原实现只挑子集 → 降格即丢编队）
      uid,
      battalionId: snap.battalionId,
      squadId: snap.squadId,
      formSlot: snap.formSlot,
      corridorIdx: snap.corridorIdx,
      role: snap.role,
      attackType: snap.attackType,
      isLeader: snap.isLeader,
      moveTargetX: snap.moveTargetX,
      moveTargetY: snap.moveTargetY,
      moveTargetZ: snap.moveTargetZ,
      // ★ E3b 步骤 2/3：感知 / AI 状态随降格回池（跨 LOD 不失忆）
      lastSeenX: snap.lastSeenX,
      lastSeenZ: snap.lastSeenZ,
      lastSeenAt: snap.lastSeenAt,
      aggroFrom: snap.aggroFrom,
      aiStateIdx: snap.aiStateIdx,
      aiTimer: snap.aiTimer,
      // ★ 步骤 9b：命令/指令随降格回池（跨 LOD 不失令）
      orderKind: snap.orderKind,
      orderTargetX: snap.orderTargetX,
      orderTargetZ: snap.orderTargetZ,
      orderUntil: snap.orderUntil,
      orderSeq: snap.orderSeq,
      directiveKind: snap.directiveKind,
      directiveTargetX: snap.directiveTargetX,
      directiveTargetZ: snap.directiveTargetZ,
      directiveWard: snap.directiveWard,
      directiveUntil: snap.directiveUntil,
      directiveFire: snap.directiveFire,
      directiveSpeedMul: snap.directiveSpeedMul,
      directiveSeq: snap.directiveSeq,
      // ★ 自爆标签 / 被击免降格 / 远程档随降格回池
      suicide: snap.suicide,
      canBuild: snap.canBuild,
      noDemoteUntil: snap.noDemoteUntil,
      ranged: snap.ranged,
      skin: snap.skin,
      shotSpeed: snap.shotSpeed,
      shotLife: snap.shotLife,
      singleton: snap.singleton,
    });
    if (i < 0) return;
    // ★ 步骤 5：编队归属兜底（正常随快照保留）+ 队长标记同步
    const role = roleFromCode(this.pool.role[i]);
    const squad = this.squads.squadOf(uid)
      ?? (snap.squadId !== undefined && snap.squadId >= 0
        ? this.squads.adopt(uid, snap.squadId, snap.battalionId ?? snap.squadId, role, this.pool.x[i], this.pool.z[i], this.pool.mobIndex[i], this.pool.suicide[i] === 1, this.pool.singleton[i] === 1, this.pool.canBuild[i] === 1)
        : this.squads.assign(uid, role, this.pool.x[i], this.pool.z[i], this.pool.mobIndex[i], this.pool.suicide[i] === 1, this.pool.singleton[i] === 1, this.pool.canBuild[i] === 1));
    this.pool.squadId[i] = squad.id;
    this.pool.battalionId[i] = squad.battalionId;
    this.squads.syncMember(uid, this.pool.hp[i], this.pool.maxHp[i], this.pool.x[i], this.pool.z[i], this.pool.lastSeenAt[i]);
    this.syncLeaderFlags(squad.id);
  }

  // ============================================================
  // 每帧驱动（模式层 explore 阶段调用）
  // ============================================================
  update(dt: number, hooks: SwarmHooks): void {
    const _te = entityPerf.enabled;
    const t0 = _te ? performance.now() : 0;
    this.grid.rebuild(this.pool);
    const t1 = _te ? performance.now() : 0;
    // ★ P2：流场重建（3Hz 或中心移动 > 1 格）——源 = 玩家 + 舰船
    const raster = RasterMap.current;
    this.flowTimer -= dt;
    if (raster && (this.flowTimer <= 0 || this.flow.needsRebuild(hooks.playerX, hooks.playerZ))) {
      this.flowTimer = 1 / SWARM.FLOW_HZ;
      this.flow.rebuild(raster, hooks.playerX, hooks.playerZ, [
        { x: hooks.playerX, z: hooks.playerZ },
        { x: hooks.shipX, z: hooks.shipZ },
      ]);
    }
    const now = performance.now() / 1000;
    this.lastHooks = hooks;
    this.lastPlayerX = hooks.playerX;
    this.lastPlayerZ = hooks.playerZ;

    // ★ 步骤 9：成员状态同步（4Hz；池侧 hp/位置 → 小队表，评级/选举用）
    this.ratingAccum += dt;
    if (this.ratingAccum >= 0.25) {
      this.ratingAccum = 0;
      for (let i = 0; i < this.pool.count; i++) {
        this.squads.syncMember(
          this.pool.swarmUid[i], this.pool.hp[i], this.pool.maxHp[i],
          this.pool.x[i], this.pool.z[i], this.pool.lastSeenAt[i],
        );
      }
    }

    // ★ 指挥器：大队任务周期重发 + S1 工程 + 态势函数（M2：接当日进度）
    this.data.tick(dt, hooks.playerX, hooks.playerZ, hooks.dayT01 ?? -1, hooks.shipX, hooks.shipZ);

    // ★ 队长层调遣（squad/SquadCore.drive）由 main 每帧驱动（成员指令唯一写口 = applyDirective）

    // ★ 卡死回收已收编进新引擎 `engine/TimerManager`（1Hz；驻守/交战豁免 → 净活动范围回收）
    //   ——计时销毁/卡死判决与开火闩锁同源（EngineBridge 驱动）。

    // ★ 步骤 10：大队警觉 → 倾盆而出（玩家近 + 多小队被击；动态算力 + 全图警戒）
    if (now >= this.counterUntil) {
      let n = 0;
      for (const [k, t] of this.recentHits) {
        if (now - t > AUTONOMY.BATTALION_WINDOW_S) this.recentHits.delete(k);
        else n++;
      }
      if (n >= AUTONOMY.COUNTER_SQUADS) {
        let near = false;
        for (const k of this.recentHits.keys()) {
          const s = this.squads.get(k);
          if (!s) continue;
          let cx = 0, cz = 0, m = 0;
          for (const mem of s.members.values()) { cx += mem.x; cz += mem.z; m++; }
          if (m > 0) { cx /= m; cz /= m; }
          if (Math.hypot(cx - hooks.playerX, cz - hooks.playerZ) <= 80) { near = true; break; }
        }
        if (near) {
          this.counterUntil = now + AUTONOMY.COUNTER_S;
          this.flow.paintAlert(hooks.playerX, hooks.playerZ, AUTONOMY.COUNTER_ALERT_R, now, AUTONOMY.COUNTER_S);
        }
      }
    }
    const counter = now < this.counterUntil;
    /** ★ 动态算力：倾盆而出期间提高实体上限与升格预算（增多非代理敌人） */
    const l3Cap = SWARM.L3_CAP + (counter ? AUTONOMY.L3_CAP_BOOST : 0);
    const promoteBudget = SWARM.PROMOTE_PER_FRAME + (counter ? AUTONOMY.PROMOTE_BOOST : 0);

    let promotes = 0;
    /** ★ 本帧远距回收计数（循环结束统一回调，避免每只都跨层调用） */
    const nearR2 = SWARM.L3_RADIUS * SWARM.L3_RADIUS;
    const l2R2 = SWARM.L2_RADIUS * SWARM.L2_RADIUS;

    for (let i = this.pool.count - 1; i >= 0; i--) {
      const p = this.pool;
      if (p.hp[i] <= 0) {
        const mobIndex = p.mobIndex[i];
        const kx = p.x[i], ky = p.y[i], kz = p.z[i];
        this.removeAgent(i, true, true);   // ★ 阵亡：单人只下调评分（全灭才上报）
        this.ledger.reportCasualty(1);     // ★ 伤亡通道（代理）：账本击杀 +1
        hooks.onAgentKilled?.(mobIndex, kx, ky, kz);   // 掉落/遗物/狂暴（与账本无关）
        continue;
      }
      // ★ 掉坑（深坑底）：代理直接结算死亡（实体层掉半血并爬回；代理简化——防永久卡坑底）
      //   ★ 空中层（2026-09-18）：飞行兵悬在空中，不吃坑 —— 否则飞过坑口就被判死
      if (raster && p.isAir[i] !== 1) {
        if (
          raster.tileDefAt(p.x[i], p.z[i]).genRole === 'pit' &&
          raster.surfaceHeightAt(p.x[i], p.z[i]) < DANGER.PIT_H
        ) {
          const mobIndex = p.mobIndex[i];
          const kx = p.x[i], ky = p.y[i], kz = p.z[i];
          this.removeAgent(i, true, true);   // ★ 掉坑 = 阵亡口径
          this.ledger.reportCasualty(1);     // ★ 伤亡通道（代理）：账本击杀 +1
          hooks.onAgentKilled?.(mobIndex, kx, ky, kz);
          continue;
        }
      }
      // 焦点距离（升格/分层用；远距回收已废除——由卡死回收统一接管）
      const dpx = p.x[i] - hooks.playerX, dpz = p.z[i] - hooks.playerZ;
      const dFocus2 = dpx * dpx + dpz * dpz;

      // ---- ★ 步骤 6：被击升格（本帧立即；仍受上限/预算约束） ----
      if (p.forcePromote[i] === 1 && hooks.entityCount + promotes < l3Cap && promotes < promoteBudget) {
        p.forcePromote[i] = 0;
        const snap = p.snapshot(i);
        this.removeAgent(i, false);
        hooks.tierPort?.promote(snap);
        promotes++;
        continue;
      }

      // ---- 升格（可见性/近焦点 + 实体空位 + 帧预算）----
      const visible = hooks.inView ? hooks.inView(p.x[i], p.z[i]) : dFocus2 < nearR2;
      if (visible && hooks.entityCount + promotes < l3Cap && promotes < promoteBudget) {
        const snap = p.snapshot(i);
        this.removeAgent(i, false);   // ★ 升格 = 换载体：保留小队归属/队长
        hooks.tierPort?.promote(snap);
        promotes++;
        continue;
      }
      // ---- 层级 ----
      // ★ P3：受击白闪衰减
      if (p.flash[i] > 0.01) p.flash[i] *= Math.exp(-dt * 6);
      else p.flash[i] = 0;
      const tier = dFocus2 <= l2R2 ? AGENT_TIER_MID : AGENT_TIER_FAR;
      p.tier[i] = tier;
      // ---- 脑 tick（降频 + 个体相位抖动） ----
      p.thinkAcc[i] += dt;
      const thinkGap = 1 / SWARM.THINK_HZ[tier];
      if (p.thinkAcc[i] >= thinkGap * (0.75 + p.phase[i] * 0.5)) {
        p.thinkAcc[i] = 0;
        this.think(i, hooks, now);
      }
      // ---- 移动 tick ----
      p.moveAcc[i] += dt;
      const moveGap = 1 / SWARM.MOVE_HZ[tier];
      if (p.moveAcc[i] >= moveGap) {
        const step = p.moveAcc[i];
        p.moveAcc[i] = 0;
        this.move(i, step);
      }
    }
    const t2 = _te ? performance.now() : 0;
    // ★ E4a 编队 steer（10Hz）+ HPA 簇预热（同拍顺带 2 个簇，长路径查询时基本命中缓存）
    this.steerAccum += dt;
    if (this.steerAccum >= 1 / SWARM.STEER_HZ) {
      this.steerAccum = 0;
      if (raster) this.nav.warm(raster, hooks.playerX, hooks.playerZ);
      this.nav.steerEntities(hooks.activeUnits?.(), this.squads, (sid) => this.squadStateOf?.(sid) ?? null, now,
        (x, z, r) => this.data.rangedPost(x, z, r));
    }
    // ★ 远距回收记账（不算击杀；引擎直管，模式层不参与）
    // ★ 步骤 5：队长变更广播（模式层把标记镜像到 L3 实体）
    if (this.leaderChanges.length > 0) {
      for (const c of this.leaderChanges) hooks.onLeaderChanged?.(c.uid, c.isLeader);
      this.leaderChanges.length = 0;
    }
    // ★ 步骤 9：全灭上报（每队一次；此后小队已注销，不再出现在评级表→无需支援）
    if (this.pendingWiped.length > 0) {
      for (const id of this.pendingWiped) hooks.onSquadWiped?.(id);
      this.pendingWiped.length = 0;
    }
    entityPerf.swarmBrain += t2 - t1;
    entityPerf.swarmAgents = this.pool.count;
    void t0;
  }

  /** 渲染同步（每帧调用；代理位置/贴图批次 → InstancedMesh）
   *  ★ camera + 焦点（玩家）给定时：视野半径内的代理额外绘制头顶血条
   *    （远层敌人 35~90m 无 EnemyBase → 无 HealthBar，这里用实例化血条补齐） */
  syncRender(camera?: import('three').Camera, focusX = 0, focusZ = 0): void {
    if (!this.batch) return;
    const t0 = entityPerf.enabled ? performance.now() : 0;
    const raster = RasterMap.current;
    // ★ 空中层（2026-09-18）：把时间喂给批量同步 → 飞行兵悬停带上下浮动（纯渲染层）
    this.batch.sync(
      this.pool,
      (x, z, y) => raster?.surfaceHeightAtFor(x, z, y) ?? 0,
      camera, focusX, focusZ,
      undefined, // maxDist：走默认（LOD_MAX_DIST）
      performance.now() / 1000,
    );
    entityPerf.swarmRender += (entityPerf.enabled ? performance.now() : 0) - t0;
  }

  // ============================================================
  // 代理行为（P2：流场导航 + 攻击槽 + 攻击令牌 + 警戒场）
  // ============================================================
  private think(i: number, hooks: SwarmHooks, now: number): void {
    const p = this.pool;
    const px = p.x[i], pz = p.z[i];
    const dpx = hooks.playerX - px, dpz = hooks.playerZ - pz;
    const dsx = hooks.shipX - px, dsz = hooks.shipZ - pz;
    const dP2 = dpx * dpx + dpz * dpz;
    const dS2 = dsx * dsx + dsz * dsz;
    // ★ P4：意图优先（导演分工）；无意图 = 就近（旧观感）
    const intent = p.intent[i];
    // ★ 祖宗嘲讽最优先（吸仇恨）：嘲讽圈内强制换目标，无视导演意图/就近
    const taunt = hooks.nearestTaunt?.(px, pz) ?? null;
    let tk: number;
    let gx: number, gz: number;
    if (taunt) {
      tk = AGENT_TARGET_SENTINEL;
      gx = taunt.x;
      gz = taunt.z;
    } else {
      if (intent === INTENT_SHIP) tk = dS2 <= 150 * 150 ? AGENT_TARGET_SHIP : AGENT_TARGET_PLAYER;
      else if (intent === INTENT_PLAYER || intent === INTENT_FLANK) tk = dP2 <= 150 * 150 ? AGENT_TARGET_PLAYER : AGENT_TARGET_SHIP;
      else tk = dP2 <= dS2 ? AGENT_TARGET_PLAYER : AGENT_TARGET_SHIP;
      gx = tk === AGENT_TARGET_PLAYER ? hooks.playerX : hooks.shipX;
      gz = tk === AGENT_TARGET_PLAYER ? hooks.playerZ : hooks.shipZ;
    }
    p.targetKind[i] = tk;
    const tx = gx - px, tz = gz - pz;
    const d = Math.hypot(tx, tz);
    const tick = 1 / SWARM.THINK_HZ[p.tier[i]];

    // ---- ★ 执行层（§5.13）：指令活跃 → 原子掷（移动五选一 + 开火二元，正交） ----
    const dk = directiveFromCode(p.directiveKind[i]);
    const directiveActive = dk !== 'none' && (p.directiveUntil[i] === 0 || now < p.directiveUntil[i]);
    if (directiveActive) {
      // ★ 远程射击判定半径：射程 + 2.5m 余量（"小于 50m 就要开始射击"）
      const fireRange = p.meleeRange[i] + (p.ranged[i] === 1 ? 2.5 : SWARM.MELEE_PAD);
      // ★ 统一决策内核（与 L3 实体同一份：指令×命令×角色×情境 → 两层掷）
      runDirective(this.atoms, p.swarmUid[i], now, dk, orderFromCode(p.orderKind[i]),
        roleBucket(roleFromCode(p.role[i])), p.directiveSeq[i], {
          dist: d, range: fireRange,
          hpRatio: p.maxHp[i] > 0 ? p.hp[i] / p.maxHp[i] : 1,
          flash: p.flash[i], hasTarget: d > 1e-3, firePolicy: p.directiveFire[i],
        }, _run);
      // ★ 已进入攻击距离：前进原子不再覆盖本地走位；后退/横移仍生效（攻击槽失效问题）
      p.atomMove[i] = _run.inRange && _run.move === 'forward' ? 255 : _run.moveIdx;
      p.atomFire[i] = _run.fire ? 1 : 0;
    } else {
      p.atomMove[i] = 255;      // 无指令 → 本地自主（旧行为）
      p.atomFire[i] = 1;
      p.directiveSpeedMul[i] = 1;
    }

    // ---- 警戒场：共享感知 + 个体反应延迟（被同伴/玩家开火刷到 → 延迟后察觉） ----
    const alerted = this.flow.isAlerted(px, pz, now);
    if (alerted) {
      if (p.alertAt[i] <= 0) {
        p.alertAt[i] = now + SWARM.ALERT_DELAY_MIN + Math.random() * SWARM.ALERT_DELAY_SPAN;
      }
    } else {
      p.alertAt[i] = 0;
    }
    const aware = alerted && now >= p.alertAt[i];
    const objective = intent !== INTENT_NONE;
    const taunted = taunt !== null;
    // ★ 无命令自主交战（保底）：无指令时用保底半径（不依赖各兵种短视野）
    const engageR = dk === 'none' ? SWARM.AUTONOMY_ENGAGE_R : 0;
    const chasing = objective || taunted || d <= Math.max(p.aggro[i], engageR) || aware;

    // ---- 攻击冷却 / 令牌释放 ----
    p.attackCd[i] -= tick;
    if (p.attackHold[i] > 0) {
      p.attackHold[i] -= tick;
      if (p.attackHold[i] <= 0 && p.hasToken[i]) {
        p.hasToken[i] = 0;
        const tt = p.tokenTarget[i];
        this.tokenUsed[tt] = Math.max(0, this.tokenUsed[tt] - 1);
      }
    }

    // ---- P4 士气：低血撤退（通用战术；盾/自爆/名册 unit.lowHp='fight' 豁免） ----
    const mobT = hooks.mobTactics?.(p.mobIndex[i]) ?? null;
    const noRetreat = mobT?.unit?.lowHp === 'fight' || p.suicide[i] === 1 || p.role[i] === ROLE_SHIELD;
    if (objective && d < 20 && now >= p.nextRetreatAt[i]
      && p.hp[i] < p.maxHp[i] * SWARM.RETREAT_HP_RATIO
      && !noRetreat) {
      p.retreatUntil[i] = now + SWARM.RETREAT_TIME_MIN + Math.random() * SWARM.RETREAT_TIME_SPAN;
      p.nextRetreatAt[i] = now + SWARM.RETREAT_COOLDOWN;
    }
    const retreating = p.retreatUntil[i] > now;

    if (!chasing || d < 1e-4) {
      // 圈外：家附近游走（轻微偏向目标）+ 释放槽/令牌
      this.releaseSlot(i);
      p.curSpeed[i] = p.wanderSpeed[i];
      p.fromFlow[i] = 0;
      p.wanderTimer[i] -= tick;
      if (p.wanderTimer[i] <= 0) {
        const a = Math.random() * Math.PI * 2;
        // ★ 大范围巡逻（22m；此前 6m 小碎步 → 看起来像原地抽动）
        const r = 6 + Math.random() * 16;
        p.wanderX[i] = p.homeX[i] + Math.cos(a) * r;
        p.wanderZ[i] = p.homeZ[i] + Math.sin(a) * r;
        p.wanderTimer[i] = 5 + Math.random() * 5;
      }
      const wdx = p.wanderX[i] - px, wdz = p.wanderZ[i] - pz;
      const wd = Math.hypot(wdx, wdz);
      const bx = wd > 1e-3 ? wdx / wd : 0, bz = wd > 1e-3 ? wdz / wd : 0;
      const bias = p.bias[i]; // ★ 威胁度驱动（越高越主动朝玩家游走）
      const mx = bx + (d > 1e-4 ? (tx / d) * bias : 0);
      const mz = bz + (d > 1e-4 ? (tz / d) * bias : 0);
      const ml = Math.hypot(mx, mz);
      p.dirX[i] = ml > 1e-4 ? mx / ml : 0;
      p.dirZ[i] = ml > 1e-4 ? mz / ml : 0;
    } else if (retreating) {
      // 低血撤离：背向目标撤（不攻击；释放槽/令牌让给同伴）
      this.releaseSlot(i);
      if (p.hasToken[i]) {
        p.hasToken[i] = 0;
        this.tokenUsed[p.tokenTarget[i]] = Math.max(0, this.tokenUsed[p.tokenTarget[i]] - 1);
      }
      p.curSpeed[i] = p.wanderSpeed[i];
      p.fromFlow[i] = 0;
      const bx = d > 1e-4 ? -tx / d : 0;
      const bz = d > 1e-4 ? -tz / d : 0;
      // 侧向偏移避免笔直倒退成一列
      const side = p.phase[i] < 0.5 ? 1 : -1;
      const mx = bx - bz * 0.35 * side;
      const mz = bz + bx * 0.35 * side;
      const ml = Math.hypot(mx, mz);
      p.dirX[i] = ml > 1e-4 ? mx / ml : bx;
      p.dirZ[i] = ml > 1e-4 ? mz / ml : bz;
    } else {
      // 察觉/进入仇恨 → 刷警戒（同伴延迟响应）
      if (aware) this.flow.paintAlert(px, pz, SWARM.ALERT_PAINT_RADIUS, now, SWARM.ALERT_SECONDS);
      p.curSpeed[i] = p.speed[i] * (p.rageUntil[i] > now ? SWARM.RAGE_SPEED : 1);
      // ★ 感知上报（逻辑单位）：接敌中持续刷新最后目击（小队评级/选举/威胁数用）
      if (aware || d <= p.aggro[i]) {
        p.lastSeenX[i] = gx;
        p.lastSeenZ[i] = gz;
        p.lastSeenAt[i] = now;
      }
      // 目标点：近距占攻击槽（环形包围），远距走流场
      let destX = gx, destZ = gz;
      if (d <= SWARM.SLOT_COMMIT) {
        if (p.slotIdx[i] < 0) p.slotIdx[i] = this.claimSlot(i, tk, gx, gz, px, pz);
        const s = p.slotIdx[i];
        if (s >= 0) {
          const a = (s / SWARM.SLOT_ANGLES) * Math.PI * 2;
          destX = gx + Math.cos(a) * SWARM.SLOT_RADIUS;
          destZ = gz + Math.sin(a) * SWARM.SLOT_RADIUS;
        }
        p.fromFlow[i] = 0;
      } else {
        if (p.slotIdx[i] >= 0) this.releaseSlot(i);
        if (tk === AGENT_TARGET_SENTINEL || p.isAir[i] === 1) {
          // ★ 祖宗静止/飞行兵：不借流场直走（流场是地面路径场，飞兵沿走会贴障碍绕圈）
          p.fromFlow[i] = 0;
        } else {
          p.fromFlow[i] = this.flow.dirAt(px, pz, _flow) ? 1 : 0;
          if (p.fromFlow[i]) {
            destX = px + _flow.x * SWARM.FLOW_LOOKAHEAD;
            destZ = pz + _flow.z * SWARM.FLOW_LOOKAHEAD;
          }
        }
      }
      // ★ 远程不追打（让位本地移动 atomMove=255，否则原子覆盖仍按 directiveTarget 走向玩家）
      if (p.ranged[i] === 1 && tk === AGENT_TARGET_PLAYER) {
        const t = rangedMoveTarget(px, pz, gx, gz, d, p.meleeRange[i], (x, z, r) => this.data.rangedPost(x, z, r));
        destX = t ? t.x : px;
        destZ = t ? t.z : pz;
        p.fromFlow[i] = 0;
        p.atomMove[i] = 255;
      }
      const mx = destX - px, mz = destZ - pz;
      const md = Math.hypot(mx, mz);
      if (md > 0.05) {
        p.dirX[i] = mx / md;
        p.dirZ[i] = mz / md;
      } else {
        p.dirX[i] = 0;
        p.dirZ[i] = 0;
      }
      // 进射程：令牌攻击（同目标同时挥击上限）
      const fireRange = p.meleeRange[i] + (p.ranged[i] === 1 ? 2.5 : SWARM.MELEE_PAD);
      if (d <= fireRange) {
        // ★ 移动/开火正交（用户设计）：指令活跃（原子掷接管）→ **不停步**；
        //   无指令（atomMove=255）→ 保留旧行为（停步挥击，防穿过目标）
        if (p.atomMove[i] === 255) {
          p.dirX[i] = 0;
          p.dirZ[i] = 0;
        }
        // ★ 攻击令牌只约束**近战**挥击可读性；远程走独立冷却（否则大团压上时
        //   3 个令牌被近战占满 → 远程全程哑火：用户实测"远程不射箭"）
        const needToken = p.ranged[i] === 0;
        const tokenOk = !needToken || this.tokenUsed[tk] < SWARM.ATTACK_TOKENS;
        if (p.atomFire[i] === 1 && p.attackHold[i] <= 0 && p.attackCd[i] <= 0 && tokenOk) {
          // ★ 远距 = 掩护性零星散射（慢 + 大散布）；近距（<20m）= 疯狂精准（统一节拍表）
          const prof = fireProfile(d);
          p.attackCd[i] = prof.cd;
          if (needToken) {
            p.hasToken[i] = 1;
            p.tokenTarget[i] = tk;
            this.tokenUsed[tk]++;
            p.attackHold[i] = SWARM.ATTACK_HOLD;
          }
          if (p.ranged[i] === 1) {
            // ★ 远程代理：真弹道（箭/法球）；散布随距离（远散近准）
            hooks.onAgentRanged?.(
              tk, p.meleeDamage[i] + p.attackPower[i], px, pz, gx, gz,
              p.skin[i], p.shotSpeed[i], p.shotLife[i], prof.spread,
            );
          } else {
            hooks.melee(tk, p.meleeDamage[i] + p.attackPower[i], px, pz);
          }
          this.flow.paintAlert(px, pz, SWARM.ALERT_PAINT_RADIUS_ATTACK, now, SWARM.ALERT_SECONDS);
        }
      }
      // ★ 远程保距（2026-09-19）：太近 → 反向拉开（不追脸；边退边打）
      if (p.ranged[i] === 1 && d < p.meleeRange[i] * 0.55 && d > 1e-4) {
        p.dirX[i] = -tx / d;
        p.dirZ[i] = -tz / d;
      }
    }

    // ★ 到位静止（防"左右抽风"）：指令点附近 + 目标不在射程 → 完全站住（不左右来回转）
    if (directiveActive) {
      const hx = p.directiveTargetX[i] - p.x[i];
      const hz = p.directiveTargetZ[i] - p.z[i];
      if (hx * hx + hz * hz < 16 && d > p.meleeRange[i] + SWARM.MELEE_PAD) {
        p.dirX[i] = 0;
        p.dirZ[i] = 0;
        p.atomMove[i] = 255;
      }
    }

    // 贴图前后帧：远离相机 = 背对（'后'）
    const dot = p.dirX[i] * hooks.camForwardX + p.dirZ[i] * hooks.camForwardZ;
    // ★ 迟滞：单阈值 0.25 在朝向临界会逐帧翻转（背面帧缺失时 = 闪现）→ 双阈值
    p.facingBack[i] = dot > (p.facingBack[i] === 1 ? 0.10 : 0.35) ? 1 : 0;
  }

  /** ★ 开火闩锁（新引擎 AttackQueues→TimerManager 置/撤；执行层只读）：缺省全放行 */
  private fireGate: (uid: number) => boolean = () => true;

  /** 接线（main.ts）：引擎开火许可 → 成员指令开火门 */
  setFireGate(fn: ((uid: number) => boolean) | null): void {
    this.fireGate = fn ?? (() => true);
  }

  fireAllowed(uid: number): boolean {
    return this.fireGate(uid);
  }

  /** ★ 统一计时销毁（新引擎 TimerManager.onExpire 回调）：回收代理（归编制）。返回是否找到。 */
  recycleByUid(uid: number): boolean {
    const p = this.pool;
    for (let i = p.count - 1; i >= 0; i--) {
      if (p.swarmUid[i] !== uid) continue;
      this.removeAgent(i, true, false);   // 非击杀离场（unregister=true, killed=false）
      this.ledger.noteRecall(1);          // 归还编制
      return true;
    }
    return false;
  }

  /** 移动积分（★ SteerPick：16 向候选 + softmax 选择；禁止向量合成） */
  private move(i: number, dt: number): void {
    const p = this.pool;
    // ---- 人群分离：本拍只算一次（方向决策里当"反向惩罚"，移动后做一次物理外推） ----
    const t0 = entityPerf.enabled ? performance.now() : 0;
    this.grid.separation(p, i, _sep);
    entityPerf.swarmSep += (entityPerf.enabled ? performance.now() : 0) - t0;
    let dx = p.dirX[i], dz = p.dirZ[i];
    // ★ 指挥链闭合（用户定 2026-09-23）：代理只认"找队长"——朝队长走 + 局部 steer；
    //   队级复杂寻路（可行性走廊/贪心段）全在队长身上；成员任务（taskX/Z）不再驱动移动。
    const squad = this.squads.squadOf(p.swarmUid[i]);
    const isLeader = !!squad && squad.leaderUid === p.swarmUid[i];
    const lead = squad && !isLeader ? squad.members.get(squad.leaderUid) : undefined;
    if (isLeader) {
      // ★ 队长（无成员任务概念；旧 taskX/Z 链已销毁）→ 走队级指令锚点；到位校验见 leaderDir
      const ld = leaderDir(p.directiveTargetX[i] - p.x[i], p.directiveTargetZ[i] - p.z[i],
        p.orderTargetX[i] - p.x[i], p.orderTargetZ[i] - p.z[i]);
      if (ld) { dx = ld.x; dz = ld.z; } else { dx = 0; dz = 0; p.atomMove[i] = 255; }
    } else if (lead) {
      // ★ 成员跟队长（用户定 2026-09-24）：近=直线；掉队且直线被挡 → 长寻路沿走廊绕（Follow）
      //   双阈值滞回（停→>8m 才动；动→<5m 才停）：只在 5~8m 边界来回蹭 = 绕圈源，滞回消抖
      const stopR = followStopR(p.atomMove[i] === 255, lead.x, lead.z, p.orderTargetX[i], p.orderTargetZ[i]);
      const fd = followDir(this.squadStateOf?.(squad!.id) ?? null, p.x[i], p.z[i], lead.x, lead.z,
        stopR, (a, b, c2, d2) => this.walkableLine(a, b, c2, d2));
      if (fd) { dx = fd.x; dz = fd.z; }
      else { dx = 0; dz = 0; p.atomMove[i] = 255; }
    } else if (p.atomMove[i] !== 255) {
      const atom = MOVE_ATOMS[p.atomMove[i]];
      let tx = p.directiveTargetX[i] - p.x[i];
      let tz = p.directiveTargetZ[i] - p.z[i];
      const td = Math.hypot(tx, tz);
      if (td > 0.5) { tx /= td; tz /= td; } else { tx = dx; tz = dz; }
      atomDirection(atom, tx, tz, _atomDir);
      dx = _atomDir.x;
      dz = _atomDir.z;
    }
    // ★ 爬山（共享基础方法 TerrainAssist；L2/L3 同内核）：坡正面混合（水=正常地块，无特殊）
    if (p.isAir[i] !== 1) {
      fallLineBlend(this.data, p.x[i], p.z[i], dx, dz, _dir);
      dx = _dir.x; dz = _dir.z;
    }
    // ★ 硬边界内（被推入/出生点）：即使本拍无期望方向也要逃离
    const inside = this.data.blockedAt(p.x[i], p.z[i]);
    if (dx !== 0 || dz !== 0 || inside) {
      p.hazardTimer[i] -= dt;
      const raster = RasterMap.current;
      const hint = p.y[i];
      const here = raster ? raster.surfaceHeightAtFor(p.x[i], p.z[i], hint) : 0;
      const dangerAt = (hx: number, hz: number): boolean => {
        if (!raster) return false;
        if (p.isAir[i] === 1) return false;   // 空中层豁免地面危险
        if (this.data.blockedAt(hx, hz)) return true;   // 表：硬墙/坑水
        return dangerPointAt(raster, hx, hz, p.x[i], p.z[i], hint);   // 坑/过低/立面（共享内核）
      };
      const res = pickSteer(
        p.x[i], p.z[i], dx, dz, _sep.x, _sep.z,
        p.safeDirX[i], p.safeDirZ[i], p.hazardTimer[i], performance.now() / 1000,
        this.data.blockedAt(p.x[i], p.z[i]),
        dangerAt, this.data,
        p.isAir[i] !== 1,   // ★ 空中层（飞行）不吃地面表分/掩体折扣
        this.squads.squadOf(p.swarmUid[i])?.type,   // ★ L3 兵种分（重构 P1-2；mixed=兵种中立）
      );
      if (!res.hold) {
        p.safeDirX[i] = res.x; p.safeDirZ[i] = res.z; p.hazardTimer[i] = res.until;
        // ★ 重写 P1：两载体同内核——推进/爬坡/立面/贴地走代理池内核（与 L3 同口径）
        const step = p.stepAgent(i, res.x, res.z, p.curSpeed[i] * p.directiveSpeedMul[i], dt, performance.now() / 1000);
        p.x[i] += step.dx; p.z[i] += step.dz;
        if (step.dx !== 0 || step.dz !== 0) p.yaw[i] = Math.atan2(step.dx, step.dz);
      }
    }
    // ---- 人群分离外推（复用本拍已算向量；只做物理推挤，不参与方向决策） ----
    if (_sep.x !== 0 || _sep.z !== 0) {
      p.x[i] += _sep.x; p.z[i] += _sep.z;
    }
  }

  // ============================================================
  // 攻击槽 / 移除清理
  // ============================================================
  /** 占槽：取离自己最近的空扇区（无空位 → -1，直走目标） */
  private claimSlot(i: number, tk: number, gx: number, gz: number, px: number, pz: number): number {
    const owners = this.slotOwner[tk];
    if (!owners) return -1;
    let best = -1;
    let bestD = Infinity;
    for (let s = 0; s < owners.length; s++) {
      if (owners[s] !== -1) continue;
      const a = (s / SWARM.SLOT_ANGLES) * Math.PI * 2;
      const sx = gx + Math.cos(a) * SWARM.SLOT_RADIUS;
      const sz = gz + Math.sin(a) * SWARM.SLOT_RADIUS;
      const d = Math.hypot(sx - px, sz - pz);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best >= 0) owners[best] = i;
    return best;
  }

  private releaseSlot(i: number): void {
    const p = this.pool;
    const s = p.slotIdx[i];
    if (s < 0) return;
    // 目标可能已切换 → 两个目标数组都扫（10×2，可忽略）
    for (const owners of this.slotOwner) {
      if (owners[s] === i) owners[s] = -1;
    }
    p.slotIdx[i] = -1;
  }

  /** 释放代理的槽位与令牌（移除/降格前调用） */
  private releaseAgent(i: number): void {
    const p = this.pool;
    this.releaseSlot(i);
    if (p.hasToken[i]) {
      p.hasToken[i] = 0;
      const tk = p.tokenTarget[i];
      this.tokenUsed[tk] = Math.max(0, this.tokenUsed[tk] - 1);
    }
    p.attackHold[i] = 0;
  }

  /** 把小队队长标记同步到池（仅该队成员；≤256 扫描，代价可忽略） */
  private syncLeaderFlags(squadId: number): void {
    const squad = this.squads.get(squadId);
    if (!squad) return;
    for (let i = 0; i < this.pool.count; i++) {
      if (this.pool.squadId[i] !== squadId) continue;
      this.pool.isLeader[i] = this.pool.swarmUid[i] === squad.leaderUid ? 1 : 0;
    }
  }

  /** ★ 外部（引擎重组等）产生的队长变更：入同一通道，下一帧随 hooks 广播（L3 镜像用） */
  pushLeaderChange(uid: number, isLeader: boolean): void {
    this.leaderChanges.push({ uid, isLeader });
  }

  /** swap-remove 包装：释放槽/令牌 + 修正槽主索引；★ public（迷失销毁等非击杀离场用，
   *  调用方负责 ledger.noteRemoved）；unregister=false（升格路径）→ 小队归属/队长保留 */
  removeAgent(i: number, unregister = true, killed = false): void {
    const last = this.pool.count - 1;
    const uid = this.pool.swarmUid[i];
    this.releaseAgent(i);
    if (i !== last) {
      for (const owners of this.slotOwner) {
        for (let s = 0; s < owners.length; s++) {
          if (owners[s] === last) owners[s] = i;
        }
      }
    }
    this.pool.removeAt(i);
    if (!unregister) return;
    // ★ 步骤 5/9：注销小队归属；队长阵亡/回收 → 本队接任；全灭上报（帧末统一广播）
    const res = this.squads.remove(uid, killed);
    if (res) {
      for (const c of res.changes) this.leaderChanges.push(c);
      this.syncLeaderFlags(res.squadId);
      if (res.wiped) {
        this.pendingWiped.push(res.squadId);
        this.squadGone?.(res.squadId);               // 队长核/引擎 store 清（main 接线）
      }
    }
  }

  // ============================================================
  // 对外：子弹命中 / 承伤 / 警戒（P2）
  // ============================================================

  /** 子弹线段命中代理（返回代理下标；-1 = 未命中） */
  hitTestSegment(x0: number, z0: number, x1: number, z1: number, r: number): number {
    if (this.pool.count === 0) return -1;
    return this.grid.segmentHit(this.pool, x0, z0, x1, z1, r);
  }

  /** 代理承伤（防御减法 + 取整，与实体伤害管线同口径；死亡在下一帧 update 顶部结算） */
  damageAgent(i: number, base: number): number {
    const raw = base - this.pool.defense[i];
    const final = raw > 0 ? Math.max(1, Math.round(raw)) : 0;
    if (final > 0) {
      this.pool.hp[i] -= final;
      this.pool.flash[i] = 1; // ★ P3：受击白闪
      // ★ 步骤 10：被击 → 单位免降格 + 小队警觉 + 大队警觉累积
      const now = performance.now() / 1000;
      this.pool.noDemoteUntil[i] = now + AUTONOMY.UNIT_HOLD_S;
      this.noteHit(this.pool.squadId[i], now);
      // ★ 步骤 6：被击升格（限 L3 范围）：近处代理挨打 → 本帧立即升格（下一帧生效）
      const dxp = this.pool.x[i] - this.lastPlayerX;
      const dzp = this.pool.z[i] - this.lastPlayerZ;
      if (dxp * dxp + dzp * dzp <= SWARM.L3_RADIUS * SWARM.L3_RADIUS) {
        this.pool.forcePromote[i] = 1;
      }
    }
    return final;
  }

  /** 代理坐标（伤害数字/击杀表现） */
  agentX(i: number): number { return this.pool.x[i]; }
  agentY(i: number): number { return this.pool.y[i]; }
  agentZ(i: number): number { return this.pool.z[i]; }

  // ============================================================
  // ★ 代理层索敌（2026-09-17：祖宗远程用）
  // ============================================================
  // 为什么需要：敌人**实体**只在玩家 L3_RADIUS(35m) 内存在，远处只有代理。
  //   祖宗射程 42m > 35m，且站桩不动 → 一旦离开玩家，它眼里一个实体都没有
  //   （EntityManager 查不到），表现为「远处的祖宗不开火」。
  //   所以祖宗必须能直接打代理——代理池就是远处敌人的唯一表示。

  /** ★ 半径内最近的存活代理下标（-1 = 无）。O(count)，祖宗数量少故可逐个调用 */
  nearestAgentIndex(x: number, z: number, radius: number): number {
    const p = this.pool;
    const r2 = radius * radius;
    let best = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < p.count; i++) {
      if (p.hp[i] <= 0) continue;
      const dx = p.x[i] - x, dz = p.z[i] - z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= r2 && d2 < bestD2) { bestD2 = d2; best = i; }
    }
    return best;
  }

  /** ★ 代理是否仍存活（下标越界 / 已被回收 / hp<=0 = false） */
  agentAlive(i: number): boolean {
    return i >= 0 && i < this.pool.count && this.pool.hp[i] > 0;
  }

  /** ★ P4 狂暴（同伴阵亡：附近代理短时加速，冲上去拼命） */
  enrageAt(x: number, z: number, radius: number, seconds: number): void {
    const now = performance.now() / 1000;
    const r2 = radius * radius;
    const p = this.pool;
    for (let i = 0; i < p.count; i++) {
      const dx = p.x[i] - x, dz = p.z[i] - z;
      if (dx * dx + dz * dz <= r2) {
        p.rageUntil[i] = Math.max(p.rageUntil[i], now + seconds);
      }
    }
  }

  /** 刷警戒（玩家开火 / 爆炸等；共享感知入口） */
  alertAt(x: number, z: number, radius: number, seconds: number): void {
    this.flow.paintAlert(x, z, radius, performance.now() / 1000, seconds);
  }

  /** ★ 步骤 9：实体成员同步（模式层 0.25s 节拍喂入；实体不在池内，池侧同步覆盖不到） */
  syncMember(uid: number, hp: number, maxHp: number, x: number, z: number, lastSeenAt: number): void {
    this.squads.syncMember(uid, hp, maxHp, x, z, lastSeenAt);
  }

  /** ★ 步骤 9：实体阵亡/销毁 → 小队注销（全灭上报；单人只下调评分） */
  onEntityKilled(uid: number): void {
    if (uid <= 0) return;
    const res = this.squads.remove(uid, true);
    if (!res) return;
    for (const c of res.changes) this.leaderChanges.push(c);
    this.syncLeaderFlags(res.squadId);
    if (res.wiped) {
      this.pendingWiped.push(res.squadId);
      this.squadGone?.(res.squadId);
    }
  }

  /** ★ 步骤 10：被击上报（代理直调；实体经 enemy_hit → WorldMode → 这里） */
  noteHit(squadId: number, now: number): void {
    if (squadId < 0) return;
    this.squads.alert(squadId, now + AUTONOMY.SQUAD_ALERT_S);
    this.recentHits.set(squadId, now);
  }

  /** ★ 步骤 10：免降格门控（WorldSpawner 降格判定用；含小队警觉与倾盆而出） */
  holdDemote(squadId: number, now: number): boolean {
    if (now < this.counterUntil) return true;
    return squadId >= 0 && this.squads.isAlerted(squadId, now);
  }

  /** ★ 步骤 10：倾盆而出中（动态算力 + 全体免降格/免回收） */
  get counterActive(): boolean {
    return performance.now() / 1000 < this.counterUntil;
  }

  /** ★ 步骤 9：引擎侧信息面（BattalionView 的 squads 面；战术后续消费） */
  ratings(): SquadRating[] {
    return this.squads.ratings(performance.now() / 1000);
  }

  /** ★ P2 初级寻路核验（大队发令门调用；直通 SquadNavigator/HPA 簇缓存） */
  coarseCheck(
    sx: number, sz: number, gx: number, gz: number,
    out: { x: number; z: number }[],
  ): 'ok' | 'blocked' | 'unknown' {
    return this.nav.coarseCheck(sx, sz, gx, gz, out);
  }

  /** ★ P4 白名单探针：队路径重规划计数 */
  get navDbg(): SquadNavigator['dbg'] { return this.nav.dbg; }

  /** ★ 可行性直达检查（工兵选点等）：直线可走（读表） */
  walkableLine(ax: number, az: number, bx: number, bz: number): boolean {
    return this.nav.feas.walkableLine(ax, az, bx, bz);
  }

  /** ★ 有向可达（表图 BFS；可绕障——**允许绕出扇区**）——取点校验用（先 walkableLine 粗筛再调这个） */
  reachable(ax: number, az: number, bx: number, bz: number): boolean {
    const out: { x: number; z: number }[] = [];
    return this.nav.feas.find(ax, az, bx, bz, out) === 'ok';
  }

  /** ★ N1：可行性表 → 小队寻路/命令门（表就绪后可行性寻路接管） */
  attachPassTable(t: PassTable): void {
    this.nav.setPathTable(t);
    this.nav.stampFn = () => this.data.pathStamp;   // ★ 阶段二：掩体代次 → 偏好重算
  }

  /** ★ N1 探针：可行性寻路计数（calls/ok/blocked/outside）+ 最近被拒样本 */
  get feasDbg(): { calls: number; ok: number; blocked: number; outside: number } { return this.nav.feas.dbg; }
  get feasBlockedSamples(): readonly { sx: number; sz: number; gx: number; gz: number }[] {
    return this.nav.feas.blockedRecent;
  }

  /** ★ P3 观测：命令到期回落本地的次数（重构总纲 P3-1 使命化前后对比；probe 读取） */
  private _orderDrops = 0;
  get orderDrops(): number { return this._orderDrops; }

  /** ★ 队长核端口：寻路求解（执行态走廊写入；长短由 ensurePath 内部分流） */
  ensurePathFor(state: SquadOrderState, squad: Squad, now: number): void {
    this.nav.ensurePath(this.squads, squad, state, now);
  }

  /** ★ 队长核端口：成员指令**唯一落地口**（池列写口 / L3 onDirective） */
  applyDirectivePort(
    uid: number, order: TacticalOrder, directive: UnitDirective, until: number, ax: number, az: number,
  ): void {
    const p = this.pool;
    for (let i = 0; i < p.count; i++) {
      if (p.swarmUid[i] !== uid) continue;
      p.orderKind[i] = orderCode(order.kind);
      p.orderTargetX[i] = ax;
      p.orderTargetZ[i] = az;
      p.orderUntil[i] = until;
      p.orderSeq[i] = order.seq;
      p.directiveKind[i] = directiveCode(directive.kind);
      p.directiveTargetX[i] = directive.targetX ?? 0;
      p.directiveTargetZ[i] = directive.targetZ ?? 0;
      p.directiveWard[i] = directive.wardUid ?? 0;
      p.directiveUntil[i] = directive.until;
      p.directiveFire[i] = fireCode(directive.fire);
      p.directiveSpeedMul[i] = directive.speedMul;
      p.directiveSeq[i] = directive.seq;
      return;
    }
    this.lastHooks?.onDirective?.(uid, order, directive, until);
  }

  /** ★ main 接线：执行态单源（队长核） */
  setSquadStateSource(fn: ((id: number) => SquadOrderState | null) | null): void {
    this.squadStateOf = fn;
  }

  /** 该队现令 kind（执行态单源；卡死豁免/查询用） */
  orderKindOf(id: number): string | null {
    return this.squadStateOf?.(id)?.order.kind ?? null;
  }

  /** ★ main 接线：队注销（清队长核 + 引擎 store） */
  setSquadGone(fn: ((id: number) => void) | null): void {
    this.squadGone = fn;
  }

  /** 调试/统计：层级计数 */
  tierCounts(): { far: number; mid: number } {
    let far = 0, mid = 0;
    for (let i = 0; i < this.pool.count; i++) {
      if (this.pool.tier[i] === AGENT_TIER_FAR) far++;
      else mid++;
    }
    return { far, mid };
  }

  /** ★ 舰船起飞统一回收：清空全部存活代理 + 小队/命令/指挥状态；
   *  账本按 **LOD 清除**口径记 recalled（存活 −1，不算击杀，**归还编制**）。
   *  实体侧由模式层 retire('recycled') → enemy_removed(reason='recycled')（同一口径）。 */
  recallAll(): void {
    const n = this.pool.count;
    if (n > 0) this.ledger.noteRecall(n);
    this.resetRuntime();
  }

  /** 运行时状态清空（不含账本；clear 与 recallAll 共用） */
  private resetRuntime(): void {
    for (const s of this.squads.all()) this.squadGone?.(s.id);   // 队长核/引擎 store 清
    this.pool.clear();
    this.squads.clear();
    this.nextUid = 1;
    this.leaderChanges.length = 0;
    this.pendingWiped.length = 0;
    this.ratingAccum = 0;
    this.data.clear();
    this.recentHits.clear();
    this.counterUntil = 0;
    this.lastPlayerX = 0;
    this.lastPlayerZ = 0;
    this.steerAccum = 0;
    this.nav.clear();
    this.atoms.clear();
  }

  /** 模式退出清理（运行时 + 账本） */
  clear(): void {
    this.resetRuntime();
    this.ledger.clear();
  }

  dispose(): void {
    this.casualtyUnsub();
    this.removedUnsub();
    this.clear();
    this.batch?.dispose();
    this.batch = null;
  }
}
