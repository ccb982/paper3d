// ============================================================
// SwarmSystem —— 蜂群调度器（《蜂群架构.md》§5.1/§5.5；P1 数据层）
// ============================================================
// 职责：
//   · 代理池 + 人群网格 + 批量渲染的唯一持有者与驱动者
//   · 分层（L1/L2）决策与移动 tick（降频 + 个体相位抖动）
//   · 升格（近处 → EnemyBase）/ 降格（远处实体 → 代理）/ 远距回收
// P1 说明：暂无流场/攻击槽（P2）；代理用"直线逼近 + 分离 + 坑绕行"，
//   行为与旧远距 AI 的观感一致（远处本来就以追击为主）。
// ============================================================

import { RasterMap } from '../../services/map/RasterMap';
import { entityPerf } from '../../entity/EntityPerf';
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
import { SquadTable, type SquadRating } from './SquadTable';
import { SquadTactics, squadBucket, roleBucket, SquadLeaderAI } from './SquadTactics';
import {
  roleFromCode, orderCode, directiveCode, fireCode, orderFromCode, directiveFromCode,
  type TacticalOrder, type UnitDirective,
} from '../../entity/SwarmUnit';
import {
  AtomExecutor, MOVE_ATOMS, resolveWeights, atomDirection,
} from '../../entity/AtomExecutor';
import { INTENT_PLAYER, INTENT_SHIP, INTENT_FLANK, INTENT_NONE } from './Director';
import type { FrameAssetSource } from '../../services/fx/AssetSource';

/** 分层/回收参数（《蜂群架构.md》§9；集中可调） */
export const SWARM = {
  /** L3 实体层：升格半径 / 实体上限 */
  L3_RADIUS: 35,
  L3_CAP: 30,
  /** L2 代理层半径（L3~L2 = 代理半频） */
  L2_RADIUS: 80,
  /** L1 远群半径（超出即回收） */
  L1_RADIUS: 140,
  /** 降格半径（实体 > 此距离 → 回代理） */
  DEMOTE_RADIUS: 40,
  /** 升格预算（每帧最多几只；防一圈同时升级的尖刺） */
  PROMOTE_PER_FRAME: 2,
  /** 决策频率（Hz）：索引 = tier（1/2） */
  THINK_HZ: [0, 2, 5],
  /** 移动积分频率（Hz）：索引 = tier（1/2） */
  MOVE_HZ: [0, 10, 20],
  /** 近战额外射程余量（米；进入即停下挥击） */
  MELEE_PAD: 0.4,
  /** 攻击冷却区间（秒） */
  ATTACK_CD_MIN: 0.8,
  ATTACK_CD_SPAN: 0.4,
  /** 危险地形（坑）前瞻距离（米；仅非流场方向使用） */
  HAZARD_PROBE: 1.8,
  /** ★ 2026-09-14 敌群地形限制：深水判定（水深 > 此值视为不可涉水） */
  DEEP_WATER: 0.8,
  /** ★ 高台立面陡升阈值（米；配合"不延续"判定区分墙与插值坡） */
  MOVE_STEP_MAX: 0.6,

  // ---- P2：流场 / 攻击槽 / 警戒场 ----
  /** 流场重建频率（Hz） */
  FLOW_HZ: 3,
  /** 流场前瞻距离（米；用方向取前瞻点，保证收敛） */
  FLOW_LOOKAHEAD: 8,
  /** 攻击槽：环上扇区数 / 环半径 */
  SLOT_ANGLES: 10,
  SLOT_RADIUS: 1.7,
  /** 距目标多近开始占槽（米） */
  SLOT_COMMIT: 25,
  /** 同一目标同时挥击上限（攻击令牌数） */
  ATTACK_TOKENS: 3,
  /** 令牌/挥击保持窗口（秒） */
  ATTACK_HOLD: 0.3,
  /** P4 士气：低血撤退阈值 / 撤退时长区间 / 撤退冷却 / 狂暴速度倍率与时长 */
  RETREAT_HP_RATIO: 0.3,
  RETREAT_TIME_MIN: 2,
  RETREAT_TIME_SPAN: 2,
  RETREAT_COOLDOWN: 8,
  RAGE_SPEED: 1.25,
  RAGE_SECONDS: 5,
  RAGE_RADIUS: 12,
  /** ★ 无命令自主交战保底半径（米；《实体架构.md》§5.12） */
  AUTONOMY_ENGAGE_R: 16,
  /** 警戒场：持续时间 / 反应延迟区间 / 察觉时刷出的半径 / 挥击时刷出的半径 */
  ALERT_SECONDS: 6,
  ALERT_DELAY_MIN: 0.2,
  ALERT_DELAY_SPAN: 1.3,
  ALERT_PAINT_RADIUS: 12,
  ALERT_PAINT_RADIUS_ATTACK: 10,
} as const;

/** ★ 自主 LOD / 大队警戒参数（2026-09-19；《实体架构.md》§5.10；集中可调） */
export const AUTONOMY = {
  /** 单位被击免降格窗口（秒） */
  UNIT_HOLD_S: 6,
  /** 小队警觉窗口（秒；任一成员被击 → 全队） */
  SQUAD_ALERT_S: 8,
  /** 大队警觉统计窗口（秒） */
  BATTALION_WINDOW_S: 12,
  /** 触发倾盆而出所需“不同小队被击”数 */
  COUNTER_SQUADS: 3,
  /** 倾盆而出持续（秒） */
  COUNTER_S: 20,
  /** 倾盆而出全图警戒半径（米） */
  COUNTER_ALERT_R: 220,
  /** 倾盆而出动态算力：L3 上限 / 每帧升格 加成 */
  L3_CAP_BOOST: 15,
  PROMOTE_BOOST: 4,
} as const;

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
  /** 升格：由模式层创建 EnemyBase 并注册 */
  promote: (snap: AgentSnapshot) => void;
  /** 代理近战结算（targetKind：0=玩家 / 1=舰船 / 2=祖宗；x/z = 代理位置——祖宗结算定位用） */
  melee: (targetKind: number, dmg: number, x: number, z: number) => void;
  /** ★ 祖宗嘲讽：查询 (x,z) 嘲讽圈内最近的祖宗位置（null = 圈外；返回对象会被复用） */
  nearestTaunt?: (x: number, z: number) => { x: number; z: number } | null;
  /** 代理被击杀（掉落/遗物击杀统计由模式层结算） */
  onAgentKilled?: (mobIndex: number, x: number, y: number, z: number) => void;
  /** ★ 代理被远距回收（2026-09-16 击杀统计）：**不算击杀**，模式层据此扣减当日配额。
   *  与 onAgentKilled 严格互斥：回收路径只发本回调，不发 onAgentKilled。 */
  onAgentRecalled?: (count: number) => void;
  /** ★ 步骤 5：队长变更（池侧选举/接任）→ 模式层镜像到 L3 实体 */
  onLeaderChanged?: (uid: number, isLeader: boolean) => void;
  /** ★ 步骤 9：**全灭才上报**（单人阵亡只下调评分，不发事件） */
  onSquadWiped?: (squadId: number) => void;
  /** ★ 步骤 9b：命令/指令 → L3 实体（池侧写列；实体不在池内，走 uid 映射） */
  onDirective?: (uid: number, order: TacticalOrder, directive: UnitDirective, until: number) => void;
  /** ★ 远程代理射击（真弹道；模式层按 skin 选池：0=箭 / 1=法球） */
  onAgentRanged?: (
    targetKind: number, dmg: number, x: number, z: number,
    tx: number, tz: number, skin: number, speed: number, life: number,
  ) => void;
}

const _sep = { x: 0, z: 0 };
const _flow = { x: 0, z: 0 };
const _atomDir = { x: 0, z: 0 };

export class SwarmSystem {
  readonly pool = new AgentPool();
  /** ★ 步骤 5：小队注册表 + 队长（同质就近编队；《实体架构.md》§5.5） */
  readonly squads = new SquadTable();
  /** ★ 稳定 uid 分配器（spawn/demote 缺省分配；升降格往返不变） */
  private nextUid = 1;
  /** ★ 队长变更待广播（帧末统一回调，避免循环内跨层） */
  private readonly leaderChanges: { uid: number; isLeader: boolean }[] = [];
  /** ★ 步骤 9：待上报的全灭小队（帧末统一回调） */
  private readonly pendingWiped: number[] = [];
  /** ★ 步骤 9：成员状态同步节拍（4Hz） */
  private ratingAccum = 0;
  /** ★ 步骤 9b：小队黑板 + 命令分解（同质默认矩阵） */
  readonly tactics = new SquadTactics();
  /** ★ 步骤 9b：分解节拍（2Hz） */
  private tacticsAccum = 0;
  /** ★ 步骤 9d：队长自主发令（1Hz；引擎命令优先） */
  private readonly leaderAI = new SquadLeaderAI();
  /** ★ 步骤 10：大队警觉（squadId → 最近被击秒） */
  private readonly recentHits = new Map<number, number>();
  /** ★ 步骤 10：倾盆而出截止（秒；0 = 未触发） */
  private counterUntil = 0;
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

  /** 构建批量渲染（模式层在 mobDefs 就绪后调用；素材顺序 = mobIndex）
   *  ★ sinks：每兵种接地补偿（世界单位；与 mobDefs 同序，可省 = 不补偿） */
  buildBatch(scene: import('three').Scene, assets: FrameAssetSource[], sinks?: number[]): void {
    this.batch = new SwarmBatch(scene, assets, sinks);
  }

  get count(): number {
    return this.pool.count;
  }

  spawn(data: AgentSpawnData): number {
    if (!data.uid || data.uid <= 0) data.uid = this.nextUid++;
    const i = this.pool.push(data);
    if (i < 0) return i;
    // ★ 步骤 5：同质就近编队 + 首员即队长
    const squad = this.squads.assign(data.uid, roleFromCode(this.pool.role[i]), data.x, data.z, this.pool.mobIndex[i], this.pool.suicide[i] === 1);
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
      noDemoteUntil: snap.noDemoteUntil,
      ranged: snap.ranged,
      skin: snap.skin,
      shotSpeed: snap.shotSpeed,
      shotLife: snap.shotLife,
    });
    if (i < 0) return;
    // ★ 步骤 5：编队归属兜底（正常随快照保留）+ 队长标记同步
    const role = roleFromCode(this.pool.role[i]);
    const squad = this.squads.squadOf(uid)
      ?? (snap.squadId !== undefined && snap.squadId >= 0
        ? this.squads.adopt(uid, snap.squadId, snap.battalionId ?? snap.squadId, role, this.pool.x[i], this.pool.z[i], this.pool.mobIndex[i], this.pool.suicide[i] === 1)
        : this.squads.assign(uid, role, this.pool.x[i], this.pool.z[i], this.pool.mobIndex[i], this.pool.suicide[i] === 1));
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

    // ★ 步骤 9d：队长自主发令（1Hz；看到玩家 → 进攻；残血 → 撤退）
    this.leaderAI.tick(dt, this.squads, this.tactics, hooks.playerX, hooks.playerZ, now);

    // ★ 步骤 9b：命令分解（2Hz；黑板 → 个体指令；池写列 / 实体走 hook）
    this.tacticsAccum += dt;
    if (this.tacticsAccum >= 0.5) {
      this.tacticsAccum = 0;
      this.applyOrders(now, hooks);
    }

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
    let recalled = 0;
    const nearR2 = SWARM.L3_RADIUS * SWARM.L3_RADIUS;
    const l2R2 = SWARM.L2_RADIUS * SWARM.L2_RADIUS;
    const l1R2 = SWARM.L1_RADIUS * SWARM.L1_RADIUS;

    for (let i = this.pool.count - 1; i >= 0; i--) {
      const p = this.pool;
      if (p.hp[i] <= 0) {
        const mobIndex = p.mobIndex[i];
        const kx = p.x[i], ky = p.y[i], kz = p.z[i];
        this.removeAgent(i, true, true);   // ★ 阵亡：单人只下调评分（全灭才上报）
        hooks.onAgentKilled?.(mobIndex, kx, ky, kz);
        continue;
      }
      // ★ 掉坑（深坑底）：代理直接结算死亡（实体层掉半血并爬回；代理简化——防永久卡坑底）
      //   ★ 空中层（2026-09-18）：飞行兵悬在空中，不吃坑 —— 否则飞过坑口就被判死
      if (raster && p.isAir[i] !== 1) {
        if (
          raster.tileDefAt(p.x[i], p.z[i]).genRole === 'pit' &&
          raster.surfaceHeightAt(p.x[i], p.z[i]) < -1.2
        ) {
          const mobIndex = p.mobIndex[i];
          const kx = p.x[i], ky = p.y[i], kz = p.z[i];
          this.removeAgent(i, true, true);   // ★ 掉坑 = 阵亡口径
          hooks.onAgentKilled?.(mobIndex, kx, ky, kz);
          continue;
        }
      }
      // ---- 回收（距玩家/舰船都超 L1_RADIUS） ----
      const dpx = p.x[i] - hooks.playerX, dpz = p.z[i] - hooks.playerZ;
      const dsx = p.x[i] - hooks.shipX, dsz = p.z[i] - hooks.shipZ;
      const dFocus2 = dpx * dpx + dpz * dpz;
      const dShip2 = dsx * dsx + dsz * dsz;
      if (Math.min(dFocus2, dShip2) > l1R2) {
        // ★ 步骤 10：被击 / 小队警觉 / 倾盆而出期间免回收（交火中的不许被远距清除）
        if (counter || p.noDemoteUntil[i] > now || this.holdDemote(p.squadId[i], now)) continue;
        // ★ 2026-09-16：远距清除 = **不算击杀**（只回收，不报 onAgentKilled）；
        //   计入 recalled，帧末统一回调 → 模式层扣减当日敌人配额
        this.removeAgent(i);
        recalled++;
        continue;
      }
      // ---- 升格（近玩家 + 实体空位 + 帧预算） ----
      if (dFocus2 < nearR2 && hooks.entityCount + promotes < l3Cap && promotes < promoteBudget) {
        const snap = p.snapshot(i);
        this.removeAgent(i, false);   // ★ 升格 = 换载体：保留小队归属/队长
        hooks.promote(snap);
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
    // ★ 远距回收统一回调（不算击杀；模式层据此扣减当日配额）
    if (recalled > 0) hooks.onAgentRecalled?.(recalled);
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
      const sit = {
        inRange: d <= p.meleeRange[i] + SWARM.MELEE_PAD,
        rangeRatio: d / Math.max(1e-3, p.meleeRange[i] + SWARM.MELEE_PAD),
        lowHp: p.hp[i] < p.maxHp[i] * 0.3,
        justHit: p.flash[i] > 0.5,
        hasTarget: d > 1e-3,
      };
      const w = resolveWeights(dk, orderFromCode(p.orderKind[i]), roleBucket(roleFromCode(p.role[i])), sit);
      const atom = this.atoms.step(p.swarmUid[i], now, p.directiveSeq[i], w, sit.justHit);
      p.atomMove[i] = MOVE_ATOMS.indexOf(atom.move);
      p.atomFire[i] = atom.fire ? 1 : 0;
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

    // ---- P4：士气（低血撤退；同伴阵亡由 WorldMode 触发狂暴） ----
    if (objective && d < 20 && now >= p.nextRetreatAt[i] && p.hp[i] < p.maxHp[i] * SWARM.RETREAT_HP_RATIO) {
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
        const r = Math.random() * 6;
        p.wanderX[i] = p.homeX[i] + Math.cos(a) * r;
        p.wanderZ[i] = p.homeZ[i] + Math.sin(a) * r;
        p.wanderTimer[i] = 2 + Math.random() * 3;
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
          // ★ 祖宗是静止目标：不借流场，直走（流场只指向玩家/舰船）
          // ★ 空中层（2026-09-18）：飞行兵走**直线** —— 流场是地面路径场（编码坑/水/立面），
          //   飞兵用不上，而且沿流场走会贴着地面障碍绕圈（与"独立空中层"不符）
          p.fromFlow[i] = 0;
        } else {
          p.fromFlow[i] = this.flow.dirAt(px, pz, _flow) ? 1 : 0;
          if (p.fromFlow[i]) {
            destX = px + _flow.x * SWARM.FLOW_LOOKAHEAD;
            destZ = pz + _flow.z * SWARM.FLOW_LOOKAHEAD;
          }
        }
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
      if (d <= p.meleeRange[i] + SWARM.MELEE_PAD) {
        // ★ 移动/开火正交（用户设计）：指令活跃（原子掷接管）→ **不停步**；
        //   无指令（atomMove=255）→ 保留旧行为（停步挥击，防穿过目标）
        if (p.atomMove[i] === 255) {
          p.dirX[i] = 0;
          p.dirZ[i] = 0;
        }
        if (p.atomFire[i] === 1 && p.attackHold[i] <= 0 && p.attackCd[i] <= 0 && this.tokenUsed[tk] < SWARM.ATTACK_TOKENS) {
          p.attackCd[i] = SWARM.ATTACK_CD_MIN + Math.random() * SWARM.ATTACK_CD_SPAN;
          p.hasToken[i] = 1;
          p.tokenTarget[i] = tk;
          this.tokenUsed[tk]++;
          p.attackHold[i] = SWARM.ATTACK_HOLD;
          if (p.ranged[i] === 1) {
            // ★ 远程代理：真弹道（箭/法球），射程边缘开火（不追脸）
            hooks.onAgentRanged?.(tk, p.meleeDamage[i] + p.attackPower[i], px, pz, gx, gz, p.skin[i], p.shotSpeed[i], p.shotLife[i]);
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

    // 贴图前后帧：远离相机 = 背对（'后'）
    const dot = p.dirX[i] * hooks.camForwardX + p.dirZ[i] * hooks.camForwardZ;
    // ★ 迟滞：单阈值 0.25 在朝向临界会逐帧翻转（背面帧缺失时 = 闪现）→ 双阈值
    p.facingBack[i] = dot > (p.facingBack[i] === 1 ? 0.10 : 0.35) ? 1 : 0;
  }

  /** 移动积分（危险地形绕行：坑/深水/高台立面，无论流场还是直行都探测） */
  private move(i: number, dt: number): void {
    const p = this.pool;
    let dx = p.dirX[i], dz = p.dirZ[i];
    // ★ 执行层：指令原子覆盖方向（forward/back/strafe/hold；危险地形绕行仍生效）
    if (p.atomMove[i] !== 255) {
      const atom = MOVE_ATOMS[p.atomMove[i]];
      let tx = p.directiveTargetX[i] - p.x[i];
      let tz = p.directiveTargetZ[i] - p.z[i];
      const td = Math.hypot(tx, tz);
      if (td > 0.5) { tx /= td; tz /= td; } else { tx = dx; tz = dz; }
      atomDirection(atom, tx, tz, _atomDir);
      dx = _atomDir.x;
      dz = _atomDir.z;
    }
    if (dx !== 0 || dz !== 0) {
      // ---- 危险地形绕行：前瞻探测 → 转向 ±90°，缓存 0.4s ----
      //   ★ 2026-09-14：探测常态开启（原先只探非流场方向）——流场也可能指向深水/立面；
      //   深水（敌人不涉水）与高台立面（只能走插值坡）一并阻挡
      p.hazardTimer[i] -= dt;
      const raster = RasterMap.current;
      const probe = SWARM.HAZARD_PROBE;
      // ★ 第二层高度（浮空洞顶）：按代理当前高度选层——洞顶上的代理不会把洞当坑
      const hint = p.y[i];
      const here = raster ? raster.surfaceHeightAtFor(p.x[i], p.z[i], hint) : 0;
      const danger = (ux: number, uz: number): boolean => {
        if (!raster) return false;
        // ★ 空中层（2026-09-18）：飞行兵不受地面危险约束（坑/深水/高台立面）
        //   → 直接飞过去；也不吃"绕行 ±90°"的绕路（与"独立空中寻路 = 直线"一致）
        if (p.isAir[i] === 1) return false;
        const hx = p.x[i] + ux * probe, hz = p.z[i] + uz * probe;
        const role = raster.tileDefAt(hx, hz).genRole;
        const h = raster.surfaceHeightAtFor(hx, hz, hint);
        if (role === 'pit' && h < -1.2) return true;
        if (role === 'liquid' && h < -SWARM.DEEP_WATER) return true; // 深水
        // 高台立面：0.45m 陡升 > 阈值且 1.2m 无同斜率延续 → 墙（插值坡放行）
        const hn = raster.surfaceHeightAtFor(p.x[i] + ux * 0.45, p.z[i] + uz * 0.45, hint);
        const hf = raster.surfaceHeightAtFor(p.x[i] + ux * 1.2, p.z[i] + uz * 1.2, hint);
        const rn = hn - here, rf = hf - hn;
        return rn > SWARM.MOVE_STEP_MAX && rf < rn * 0.5;
      };
      if (danger(dx, dz)) {
        if (p.hazardTimer[i] <= 0) {
          // 两侧 ±90° 优先选不危险的一侧（避免"绕开墙却撞进水里"）
          const base = Math.atan2(dz, dx);
          const offs = p.phase[i] < 0.5 ? [Math.PI / 2, -Math.PI / 2] : [-Math.PI / 2, Math.PI / 2];
          let a = base + offs[0];
          for (const off of offs) {
            const c = base + off;
            if (!danger(Math.cos(c), Math.sin(c))) { a = c; break; }
          }
          p.safeDirX[i] = Math.cos(a);
          p.safeDirZ[i] = Math.sin(a);
          p.hazardTimer[i] = 0.4;
        }
        dx = p.safeDirX[i];
        dz = p.safeDirZ[i];
      }
      const sp = p.curSpeed[i] * p.directiveSpeedMul[i] * dt;   // ★ 执行层：限速（默认 1）
      p.x[i] += dx * sp;
      p.z[i] += dz * sp;
      if (Math.abs(dx) > 1e-4 || Math.abs(dz) > 1e-4) p.yaw[i] = Math.atan2(dx, dz);
    }
    // ---- 人群分离（网格 3×3 邻域） ----
    const t0 = entityPerf.enabled ? performance.now() : 0;
    this.grid.separation(p, i, _sep);
    entityPerf.swarmSep += (entityPerf.enabled ? performance.now() : 0) - t0;
    if (_sep.x !== 0 || _sep.z !== 0) {
      p.x[i] += _sep.x;
      p.z[i] += _sep.z;
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

  /** swap-remove 包装：释放槽/令牌 + 修正槽主索引（尾元素 → 空出的下标）
   *  ★ unregister=false（升格路径）：换载体不是死亡，小队归属/队长保留 */
  private removeAgent(i: number, unregister = true, killed = false): void {
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
        this.tactics.board.dropSquad(res.squadId);   // ★ 全灭 → 黑板同步清
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
      this.tactics.board.dropSquad(res.squadId);
    }
  }

  /** ★ 步骤 10：被击上报（代理在 damageAgent 内直调；实体经 enemy_hit → WorldMode → 这里） */
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

  /** ★ 步骤 9b：发令（引擎/测试入口；参数校验+缺参降级在 SquadTactics 内） */
  issueOrder(squadId: number, order: TacticalOrder, ttl?: number): void {
    this.tactics.issue(squadId, order, performance.now() / 1000, ttl);
  }

  /** ★ 步骤 9b：把小队命令分解成个体指令（池写列；实体经 onDirective 推送） */
  private applyOrders(now: number, hooks: SwarmHooks): void {
    for (const squad of this.squads.all()) {
      const state = this.tactics.board.get(squad.id);
      if (!state) continue;
      if (state.until > 0 && now > state.until) {
        this.tactics.board.dropSquad(squad.id);   // 命令到期 → 回落本地自主
        continue;
      }
      const directive = this.tactics.decompose(squad, squadBucket(squad.type), now);
      const ox = state.order.target?.x ?? 0;
      const oz = state.order.target?.z ?? 0;
      for (const uid of squad.members.keys()) {
        let found = false;
        for (let i = 0; i < this.pool.count; i++) {
          if (this.pool.swarmUid[i] !== uid) continue;
          this.pool.orderKind[i] = orderCode(state.order.kind);
          this.pool.orderTargetX[i] = ox;
          this.pool.orderTargetZ[i] = oz;
          this.pool.orderUntil[i] = state.until;
          this.pool.orderSeq[i] = state.order.seq;
          this.pool.directiveKind[i] = directiveCode(directive.kind);
          this.pool.directiveTargetX[i] = directive.targetX ?? 0;
          this.pool.directiveTargetZ[i] = directive.targetZ ?? 0;
          this.pool.directiveWard[i] = directive.wardUid ?? 0;
          this.pool.directiveUntil[i] = directive.until;
          this.pool.directiveFire[i] = fireCode(directive.fire);
          this.pool.directiveSpeedMul[i] = directive.speedMul;
          this.pool.directiveSeq[i] = directive.seq;
          found = true;
          break;
        }
        if (!found) hooks.onDirective?.(uid, state.order, directive, state.until);
      }
    }
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

  clear(): void {
    this.pool.clear();
    this.squads.clear();
    this.tactics.clear();
    this.nextUid = 1;
    this.leaderChanges.length = 0;
    this.pendingWiped.length = 0;
    this.ratingAccum = 0;
    this.tacticsAccum = 0;
    this.leaderAI.clear();
    this.recentHits.clear();
    this.counterUntil = 0;
    this.atoms.clear();
  }

  dispose(): void {
    this.clear();
    this.batch?.dispose();
    this.batch = null;
  }
}
