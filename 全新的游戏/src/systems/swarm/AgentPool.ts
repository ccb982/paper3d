// ============================================================
// AgentPool —— 蜂群代理池（SoA 定长数组；《蜂群架构.md》§4/§5.5）
// ============================================================
// 远层敌人（L1/L2）的唯一载体：定长 Float32Array/TypedArray 热字段，
// swap-remove 删除，全程零分配；升格为 L3 实体 / 降格回池都走快照拷贝。
// ============================================================

import type { SwarmSnapshot, UnitRole, UnitAttackType } from '../../entity/SwarmUnit';
import { roleCode, roleFromCode, attackCode, attackFromCode } from '../../entity/SwarmUnit';

/** 池容量（= 全图存活上限 200 + 缓冲；《蜂群架构.md》§9） */
export const AGENT_CAPACITY = 256;

/** ★ 空中层默认悬停高度（米，**相对地表**）——名册（`EnemySpec.airAltitude`）未给时的兜底。
 *  引擎层默认值放这里（`AgentPool` 零三方依赖），玩法层（WorldSpawner）负责填入。 */
export const AIR_ALTITUDE_DEFAULT = 2.6;
/** ★ 空中层悬停浮动（幅度 m / 角频率 rad/s）——**纯表现**：只加在渲染/贴地回写上，
 *  不影响 AI 的水平决策；相位用 `AgentPool.phase`（每只随机）错开，避免整队同频上下摆。
 *  L2（SwarmBatch 实例矩阵）与 L3（WorldMode.clampCharacter）两条路径共用，口径必须一致。 */
export const AIR_BOB_AMP = 0.22;
export const AIR_BOB_RATE = 1.35;

/** 目标类型（代理索敌） */
export const AGENT_TARGET_PLAYER = 0;
export const AGENT_TARGET_SHIP = 1;
export const AGENT_TARGET_SENTINEL = 2; // ★ 祖宗（嘲讽圈内强制换仇）

/** 代理层级 */
export const AGENT_TIER_FAR = 1; // L1 远群（冻结帧）
export const AGENT_TIER_MID = 2; // L2 代理（半频动画）

/** 代理生成数据（WorldMode 从 MobDef 提取） */
export interface AgentSpawnData {
  /** 兵种索引（mobDefs 下标；素材/属性/掉落回查用） */
  mobIndex: number;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  defense: number;
  attackPower: number;
  /** 移动速度（m/s） */
  speed: number;
  /** 近战伤害 / 攻击距离（m） */
  meleeDamage: number;
  meleeRange: number;
  /** 贴片世界宽（体型） */
  scale: number;
  tier: number;
  /** 仇恨半径（m；原 AI seePlayer 一致） */
  aggro: number;
  /** 游走速度（m/s；原 AI wander 一致） */
  wanderSpeed: number;
  /** 攻击意图（Director.ts 的 INTENT_*；缺省 255 = 无意图） */
  intent?: number;
  /** 游荡时朝目标的偏向强度（威胁度驱动；缺省 0.12） */
  bias?: number;
  /** ★ 空中层（2026-09-18）：是否飞行单位（不贴地/不绕坑/不涉水/不掉坑判死） */
  isAir?: boolean;
  /** ★ 空中层悬停高度（米，**相对地表**；仅 isAir 有效；0/负 = 视为地面单位） */
  altitude?: number;
  // ---- ★ E3b（2026-09-19）：蜂群编队/指挥/移动目标随快照往返（缺省 = 未编队/无目标） ----
  /** 稳定 uid（升格/降格往返不变） */
  uid?: number;
  battalionId?: number;
  squadId?: number;
  formSlot?: number;
  corridorIdx?: number;
  role?: UnitRole;
  attackType?: UnitAttackType;
  isLeader?: boolean;
  /** ★ 自爆标签（跨 LOD） */
  suicide?: boolean;
  /** ★ 被击免降格截止（秒） */
  noDemoteUntil?: number;
  /** ★ 远程档（瞬时） */
  ranged?: boolean;
  skin?: number;
  shotSpeed?: number;
  shotLife?: number;
  /** 移动目标（三个都给了才视为有效） */
  moveTargetX?: number;
  moveTargetY?: number;
  moveTargetZ?: number;
  /** ★ 感知 / AI 状态（跨 LOD 连续；缺省 = 无/初始） */
  lastSeenX?: number;
  lastSeenZ?: number;
  lastSeenAt?: number;
  aggroFrom?: number;
  aiStateIdx?: number;
  aiTimer?: number;
  /** ★ 步骤 9b：命令/指令（编码；随快照往返） */
  orderKind?: number;
  orderTargetX?: number;
  orderTargetZ?: number;
  orderUntil?: number;
  orderSeq?: number;
  directiveKind?: number;
  directiveTargetX?: number;
  directiveTargetZ?: number;
  directiveWard?: number;
  directiveUntil?: number;
  directiveFire?: number;
  directiveSpeedMul?: number;
  directiveSeq?: number;
}

/** 代理快照（升格/降格搬运；★ v2 字段以实体侧 SwarmSnapshot 为基，单一事实源） */
export interface AgentSnapshot extends SwarmSnapshot {
  mobIndex: number;
  x: number;
  y: number;
  z: number;
  hp: number;
  maxHp: number;
  defense: number;
  attackPower: number;
  speed: number;
  meleeDamage: number;
  meleeRange: number;
  scale: number;
  tier: number;
  yaw: number;
  /** 仇恨半径 / 游走速度（降格携带，缺省由模式层补） */
  aggro?: number;
  wanderSpeed?: number;
  /** 攻击意图（缺省 = 无意图/环境刷新） */
  intent?: number;
  /** ★ 空中层（升格搬运必须携带，否则飞兵一升格就落地） */
  isAir?: boolean;
  altitude?: number;
  /** ★ 远程档 / 自爆 / 免降格（降格携带；瞬时项） */
  ranged?: boolean;
  skin?: number;
  shotSpeed?: number;
  shotLife?: number;
  suicide?: boolean;
  noDemoteUntil?: number;
}

export class AgentPool {
  count = 0;

  // ---- 位置/朝向 ----
  readonly x = new Float32Array(AGENT_CAPACITY);
  readonly y = new Float32Array(AGENT_CAPACITY);
  readonly z = new Float32Array(AGENT_CAPACITY);
  readonly yaw = new Float32Array(AGENT_CAPACITY);
  /** 期望移动方向（单位向量；0 = 静止） */
  readonly dirX = new Float32Array(AGENT_CAPACITY);
  readonly dirZ = new Float32Array(AGENT_CAPACITY);

  // ---- 属性 ----
  readonly hp = new Float32Array(AGENT_CAPACITY);
  readonly maxHp = new Float32Array(AGENT_CAPACITY);
  readonly defense = new Float32Array(AGENT_CAPACITY);
  readonly attackPower = new Float32Array(AGENT_CAPACITY);
  readonly speed = new Float32Array(AGENT_CAPACITY);
  readonly meleeDamage = new Float32Array(AGENT_CAPACITY);
  readonly meleeRange = new Float32Array(AGENT_CAPACITY);
  readonly scale = new Float32Array(AGENT_CAPACITY);
  readonly mobIndex = new Int16Array(AGENT_CAPACITY);

  // ---- 状态/计时 ----
  readonly tier = new Uint8Array(AGENT_CAPACITY);
  /** 索敌目标（AGENT_TARGET_*） */
  readonly targetKind = new Uint8Array(AGENT_CAPACITY);
  /** 贴图帧位（0 = 前 / 1 = 后；实例化批渲染用） */
  readonly facingBack = new Uint8Array(AGENT_CAPACITY);
  /** 决策累计 / 移动累计 / 攻击冷却（秒） */
  readonly thinkAcc = new Float32Array(AGENT_CAPACITY);
  readonly moveAcc = new Float32Array(AGENT_CAPACITY);
  readonly attackCd = new Float32Array(AGENT_CAPACITY);
  /** 个体相位（0~1）：决策/移动 tick 抖动，消灭"整齐划一" */
  readonly phase = new Float32Array(AGENT_CAPACITY);
  /** 危险地形绕行缓存（方向 + 冷却） */
  readonly safeDirX = new Float32Array(AGENT_CAPACITY);
  readonly safeDirZ = new Float32Array(AGENT_CAPACITY);
  readonly hazardTimer = new Float32Array(AGENT_CAPACITY);

  // ---- 游走/仇恨（与原 AI 观感等价：远离目标时在家附近游走 + 轻微偏向目标） ----
  /** 出生锚点（游走中心） */
  readonly homeX = new Float32Array(AGENT_CAPACITY);
  readonly homeZ = new Float32Array(AGENT_CAPACITY);
  /** 游走当前目标点 / 换点计时 */
  readonly wanderX = new Float32Array(AGENT_CAPACITY);
  readonly wanderZ = new Float32Array(AGENT_CAPACITY);
  readonly wanderTimer = new Float32Array(AGENT_CAPACITY);
  /** 仇恨半径（原 AI seePlayer.radius）与游走速度 */
  readonly aggro = new Float32Array(AGENT_CAPACITY);
  readonly wanderSpeed = new Float32Array(AGENT_CAPACITY);
  /** 当前移动速度（think 决策时写入：追击 = speed / 游走 = wanderSpeed） */
  readonly curSpeed = new Float32Array(AGENT_CAPACITY);
  /** 游荡偏向强度（威胁度驱动） */
  readonly bias = new Float32Array(AGENT_CAPACITY);

  // ---- P5：空中层（2026-09-18；《蜂群架构.md》§25）----
  /** 是否飞行单位（1 = 独立空中层：不贴地、不绕坑/水、不掉坑判死、直线导航） */
  readonly isAir = new Uint8Array(AGENT_CAPACITY);
  /** 悬停高度（米，**相对地表**；仅 isAir=1 有效；≤0 = 按地面单位处理） */
  readonly altitude = new Float32Array(AGENT_CAPACITY);

  // ---- P2：攻击槽 / 攻击令牌 / 警戒反应 ----
  /** 攻击槽索引（-1 = 未占；按目标扇区环形占位） */
  readonly slotIdx = new Int8Array(AGENT_CAPACITY);
  /** 是否持有攻击令牌（同目标同时挥击上限） */
  readonly hasToken = new Uint8Array(AGENT_CAPACITY);
  /** 令牌所属目标（释放计数用；目标切换时仍能归还原计数器） */
  readonly tokenTarget = new Uint8Array(AGENT_CAPACITY);
  /** 令牌保持剩余时间（挥击窗口；到点释放） */
  readonly attackHold = new Float32Array(AGENT_CAPACITY);
  /** 本 tick 方向来自流场（1 = 移动时跳过坑探测：流场已编码危险） */
  readonly fromFlow = new Uint8Array(AGENT_CAPACITY);
  /** 警戒反应到点时间（0 = 未触发；now ≥ 该值 → 已察觉） */
  readonly alertAt = new Float32Array(AGENT_CAPACITY);

  // ---- P3：受击反馈 ----
  /** 受击白闪量（0~1；命中置 1，指数衰减；实例化批渲染消费） */
  readonly flash = new Float32Array(AGENT_CAPACITY);

  // ---- ★ E3b（2026-09-19）：蜂群编队 / 指挥 / 移动目标（降格不再丢编队） ----
  /** 稳定 uid（0 = 未分配；跨 LOD 身份） */
  readonly swarmUid = new Int32Array(AGENT_CAPACITY);
  readonly battalionId = new Int16Array(AGENT_CAPACITY).fill(-1);
  readonly squadId = new Int16Array(AGENT_CAPACITY).fill(-1);
  readonly formSlot = new Int8Array(AGENT_CAPACITY).fill(-1);
  readonly corridorIdx = new Int16Array(AGENT_CAPACITY).fill(-1);
  /** 兵种角色 / 攻击类型（SoA 编码；换算走 roleCode/attackCode） */
  readonly role = new Uint8Array(AGENT_CAPACITY);
  readonly attackType = new Uint8Array(AGENT_CAPACITY);
  /** 本队队长标记（指挥权；dormant 不允许） */
  readonly isLeader = new Uint8Array(AGENT_CAPACITY);
  /** ★ 自爆标签（0 = 普通；1 = 自爆单位） */
  readonly suicide = new Uint8Array(AGENT_CAPACITY);
  /** ★ 步骤 10：被击免降格截止（秒） */
  readonly noDemoteUntil = new Float32Array(AGENT_CAPACITY);
  /** ★ 远程档（瞬时；降格时由名册重填）：0 = 近战 / 1 = 远程；skin 0=箭 1=法球 */
  readonly ranged = new Uint8Array(AGENT_CAPACITY);
  readonly skin = new Uint8Array(AGENT_CAPACITY);
  readonly shotSpeed = new Float32Array(AGENT_CAPACITY).fill(26);
  readonly shotLife = new Float32Array(AGENT_CAPACITY).fill(2.4);
  /** 移动目标（hasMoveTarget=1 时有效；hold 语义） */
  readonly moveTargetX = new Float32Array(AGENT_CAPACITY);
  readonly moveTargetY = new Float32Array(AGENT_CAPACITY);
  readonly moveTargetZ = new Float32Array(AGENT_CAPACITY);
  readonly hasMoveTarget = new Uint8Array(AGENT_CAPACITY);
  /** ★ 感知 / AI 状态（E3b 步骤 2/3：跨 LOD 不失忆；步骤 9 接线填值） */
  readonly lastSeenX = new Float32Array(AGENT_CAPACITY);
  readonly lastSeenZ = new Float32Array(AGENT_CAPACITY);
  readonly lastSeenAt = new Float32Array(AGENT_CAPACITY);
  readonly aggroFrom = new Int32Array(AGENT_CAPACITY);
  readonly aiStateIdx = new Uint8Array(AGENT_CAPACITY);
  readonly aiTimer = new Float32Array(AGENT_CAPACITY);
  /** ★ 步骤 9b：命令 / 个体指令（编码见 SwarmUnit.ORDER_CODES/DIRECTIVE_CODES/FIRE_*） */
  readonly orderKind = new Uint8Array(AGENT_CAPACITY);
  readonly orderTargetX = new Float32Array(AGENT_CAPACITY);
  readonly orderTargetZ = new Float32Array(AGENT_CAPACITY);
  readonly orderUntil = new Float32Array(AGENT_CAPACITY);
  readonly orderSeq = new Int32Array(AGENT_CAPACITY);
  readonly directiveKind = new Uint8Array(AGENT_CAPACITY);
  readonly directiveTargetX = new Float32Array(AGENT_CAPACITY);
  readonly directiveTargetZ = new Float32Array(AGENT_CAPACITY);
  readonly directiveWard = new Int32Array(AGENT_CAPACITY);
  readonly directiveUntil = new Float32Array(AGENT_CAPACITY);
  readonly directiveFire = new Uint8Array(AGENT_CAPACITY);
  readonly directiveSpeedMul = new Float32Array(AGENT_CAPACITY).fill(1);
  readonly directiveSeq = new Int32Array(AGENT_CAPACITY);
  /** ★ 执行层（瞬时，不入快照）：当前移动原子（255 = 无覆盖）/ 开火决策（1 = 可开火） */
  readonly atomMove = new Uint8Array(AGENT_CAPACITY).fill(255);
  readonly atomFire = new Uint8Array(AGENT_CAPACITY).fill(1);

  // ---- P4：导演意图 / 士气 ----
  /** 攻击意图（Director.ts 的 INTENT_*；255 = 无意图） */
  readonly intent = new Uint8Array(AGENT_CAPACITY);
  /** 低血撤退截止 / 下次可撤退时间 / 狂暴截止（秒，performance.now/1000） */
  readonly retreatUntil = new Float32Array(AGENT_CAPACITY);
  readonly nextRetreatAt = new Float32Array(AGENT_CAPACITY);
  readonly rageUntil = new Float32Array(AGENT_CAPACITY);

  push(d: AgentSpawnData): number {
    if (this.count >= AGENT_CAPACITY) return -1;
    const i = this.count++;
    this.x[i] = d.x; this.y[i] = d.y; this.z[i] = d.z;
    this.yaw[i] = 0;
    this.dirX[i] = 0; this.dirZ[i] = 0;
    this.hp[i] = d.hp; this.maxHp[i] = d.maxHp;
    this.defense[i] = d.defense; this.attackPower[i] = d.attackPower;
    this.speed[i] = d.speed;
    this.meleeDamage[i] = d.meleeDamage; this.meleeRange[i] = d.meleeRange;
    this.scale[i] = d.scale; this.mobIndex[i] = d.mobIndex;
    this.tier[i] = d.tier;
    this.targetKind[i] = AGENT_TARGET_PLAYER;
    this.facingBack[i] = 0;
    this.thinkAcc[i] = Math.random() * 0.2;
    this.moveAcc[i] = Math.random() * 0.05;
    this.attackCd[i] = 0.4 + Math.random() * 0.8;
    this.phase[i] = Math.random();
    this.safeDirX[i] = 0; this.safeDirZ[i] = 0;
    this.hazardTimer[i] = 0;
    this.homeX[i] = d.x; this.homeZ[i] = d.z;
    this.wanderX[i] = d.x; this.wanderZ[i] = d.z;
    this.wanderTimer[i] = Math.random() * 3;
    this.aggro[i] = d.aggro;
    this.wanderSpeed[i] = d.wanderSpeed;
    this.curSpeed[i] = d.wanderSpeed;
    this.slotIdx[i] = -1;
    this.hasToken[i] = 0;
    this.tokenTarget[i] = 0;
    this.attackHold[i] = 0;
    this.fromFlow[i] = 0;
    this.alertAt[i] = 0;
    this.flash[i] = 0;
    this.intent[i] = d.intent ?? 255;
    this.bias[i] = d.bias ?? 0.12;
    this.isAir[i] = d.isAir ? 1 : 0;
    this.altitude[i] = d.altitude ?? 0;
    this.retreatUntil[i] = 0;
    this.nextRetreatAt[i] = 0;
    this.rageUntil[i] = 0;
    // ★ E3b：蜂群字段（缺省 = 未编队/散兵/近战/无目标）
    this.swarmUid[i] = d.uid ?? 0;
    this.battalionId[i] = d.battalionId ?? -1;
    this.squadId[i] = d.squadId ?? -1;
    this.formSlot[i] = d.formSlot ?? -1;
    this.corridorIdx[i] = d.corridorIdx ?? -1;
    this.role[i] = roleCode(d.role ?? 'grunt');
    this.attackType[i] = attackCode(d.attackType ?? 'melee');
    this.isLeader[i] = d.isLeader ? 1 : 0;
    this.suicide[i] = d.suicide ? 1 : 0;
    this.noDemoteUntil[i] = d.noDemoteUntil ?? 0;
    this.ranged[i] = d.ranged ? 1 : 0;
    this.skin[i] = d.skin ?? 0;
    this.shotSpeed[i] = d.shotSpeed ?? 26;
    this.shotLife[i] = d.shotLife ?? 2.4;
    const hasMt = d.moveTargetX !== undefined && d.moveTargetZ !== undefined;
    this.hasMoveTarget[i] = hasMt ? 1 : 0;
    this.moveTargetX[i] = hasMt ? d.moveTargetX! : 0;
    this.moveTargetY[i] = hasMt ? (d.moveTargetY ?? 0) : 0;
    this.moveTargetZ[i] = hasMt ? d.moveTargetZ! : 0;
    this.lastSeenX[i] = d.lastSeenX ?? 0;
    this.lastSeenZ[i] = d.lastSeenZ ?? 0;
    this.lastSeenAt[i] = d.lastSeenAt ?? 0;
    this.aggroFrom[i] = d.aggroFrom ?? 0;
    this.aiStateIdx[i] = d.aiStateIdx ?? 0;
    this.aiTimer[i] = d.aiTimer ?? 0;
    this.orderKind[i] = d.orderKind ?? 0;
    this.orderTargetX[i] = d.orderTargetX ?? 0;
    this.orderTargetZ[i] = d.orderTargetZ ?? 0;
    this.orderUntil[i] = d.orderUntil ?? 0;
    this.orderSeq[i] = d.orderSeq ?? 0;
    this.directiveKind[i] = d.directiveKind ?? 0;
    this.directiveTargetX[i] = d.directiveTargetX ?? 0;
    this.directiveTargetZ[i] = d.directiveTargetZ ?? 0;
    this.directiveWard[i] = d.directiveWard ?? 0;
    this.directiveUntil[i] = d.directiveUntil ?? 0;
    this.directiveFire[i] = d.directiveFire ?? 0;
    this.directiveSpeedMul[i] = d.directiveSpeedMul ?? 1;
    this.directiveSeq[i] = d.directiveSeq ?? 0;
    this.atomMove[i] = 255;
    this.atomFire[i] = 1;
    return i;
  }

  /** swap-remove（尾元素填位；所有数组同步搬移） */
  removeAt(i: number): void {
    const last = this.count - 1;
    if (i !== last) this.copy(last, i);
    this.count = last;
  }

  private copy(from: number, to: number): void {
    this.x[to] = this.x[from]; this.y[to] = this.y[from]; this.z[to] = this.z[from];
    this.yaw[to] = this.yaw[from];
    this.dirX[to] = this.dirX[from]; this.dirZ[to] = this.dirZ[from];
    this.hp[to] = this.hp[from]; this.maxHp[to] = this.maxHp[from];
    this.defense[to] = this.defense[from]; this.attackPower[to] = this.attackPower[from];
    this.speed[to] = this.speed[from];
    this.meleeDamage[to] = this.meleeDamage[from]; this.meleeRange[to] = this.meleeRange[from];
    this.scale[to] = this.scale[from]; this.mobIndex[to] = this.mobIndex[from];
    this.tier[to] = this.tier[from]; this.targetKind[to] = this.targetKind[from];
    this.facingBack[to] = this.facingBack[from];
    this.thinkAcc[to] = this.thinkAcc[from]; this.moveAcc[to] = this.moveAcc[from];
    this.attackCd[to] = this.attackCd[from]; this.phase[to] = this.phase[from];
    this.safeDirX[to] = this.safeDirX[from]; this.safeDirZ[to] = this.safeDirZ[from];
    this.hazardTimer[to] = this.hazardTimer[from];
    this.homeX[to] = this.homeX[from]; this.homeZ[to] = this.homeZ[from];
    this.wanderX[to] = this.wanderX[from]; this.wanderZ[to] = this.wanderZ[from];
    this.wanderTimer[to] = this.wanderTimer[from];
    this.aggro[to] = this.aggro[from];
    this.wanderSpeed[to] = this.wanderSpeed[from];
    this.curSpeed[to] = this.curSpeed[from];
    this.slotIdx[to] = this.slotIdx[from];
    this.hasToken[to] = this.hasToken[from];
    this.tokenTarget[to] = this.tokenTarget[from];
    this.attackHold[to] = this.attackHold[from];
    this.fromFlow[to] = this.fromFlow[from];
    this.alertAt[to] = this.alertAt[from];
    this.flash[to] = this.flash[from];
    this.intent[to] = this.intent[from];
    this.bias[to] = this.bias[from];
    this.isAir[to] = this.isAir[from];
    this.altitude[to] = this.altitude[from];
    this.retreatUntil[to] = this.retreatUntil[from];
    this.nextRetreatAt[to] = this.nextRetreatAt[from];
    this.rageUntil[to] = this.rageUntil[from];
    // ★ E3b：新列必须同步搬移（漏一列 = swap-remove 后静默丢值）
    this.swarmUid[to] = this.swarmUid[from];
    this.battalionId[to] = this.battalionId[from];
    this.squadId[to] = this.squadId[from];
    this.formSlot[to] = this.formSlot[from];
    this.corridorIdx[to] = this.corridorIdx[from];
    this.role[to] = this.role[from];
    this.attackType[to] = this.attackType[from];
    this.isLeader[to] = this.isLeader[from];
    this.suicide[to] = this.suicide[from];
    this.noDemoteUntil[to] = this.noDemoteUntil[from];
    this.ranged[to] = this.ranged[from];
    this.skin[to] = this.skin[from];
    this.shotSpeed[to] = this.shotSpeed[from];
    this.shotLife[to] = this.shotLife[from];
    this.moveTargetX[to] = this.moveTargetX[from];
    this.moveTargetY[to] = this.moveTargetY[from];
    this.moveTargetZ[to] = this.moveTargetZ[from];
    this.hasMoveTarget[to] = this.hasMoveTarget[from];
    this.lastSeenX[to] = this.lastSeenX[from];
    this.lastSeenZ[to] = this.lastSeenZ[from];
    this.lastSeenAt[to] = this.lastSeenAt[from];
    this.aggroFrom[to] = this.aggroFrom[from];
    this.aiStateIdx[to] = this.aiStateIdx[from];
    this.aiTimer[to] = this.aiTimer[from];
    this.orderKind[to] = this.orderKind[from];
    this.orderTargetX[to] = this.orderTargetX[from];
    this.orderTargetZ[to] = this.orderTargetZ[from];
    this.orderUntil[to] = this.orderUntil[from];
    this.orderSeq[to] = this.orderSeq[from];
    this.directiveKind[to] = this.directiveKind[from];
    this.directiveTargetX[to] = this.directiveTargetX[from];
    this.directiveTargetZ[to] = this.directiveTargetZ[from];
    this.directiveWard[to] = this.directiveWard[from];
    this.directiveUntil[to] = this.directiveUntil[from];
    this.directiveFire[to] = this.directiveFire[from];
    this.directiveSpeedMul[to] = this.directiveSpeedMul[from];
    this.directiveSeq[to] = this.directiveSeq[from];
    this.atomMove[to] = this.atomMove[from];
    this.atomFire[to] = this.atomFire[from];
  }

  /** 快照（升格用；★ E3b：全列导出——编队/指挥/意图/移动目标随升格带回实体） */
  snapshot(i: number): AgentSnapshot {
    const out: AgentSnapshot = {
      mobIndex: this.mobIndex[i],
      x: this.x[i], y: this.y[i], z: this.z[i],
      hp: this.hp[i], maxHp: this.maxHp[i],
      defense: this.defense[i], attackPower: this.attackPower[i],
      speed: this.speed[i],
      meleeDamage: this.meleeDamage[i], meleeRange: this.meleeRange[i],
      scale: this.scale[i], tier: this.tier[i],
      yaw: this.yaw[i],
      isAir: this.isAir[i] === 1,
      altitude: this.altitude[i],
      uid: this.swarmUid[i],
      battalionId: this.battalionId[i],
      squadId: this.squadId[i],
      formSlot: this.formSlot[i],
      corridorIdx: this.corridorIdx[i],
      role: roleFromCode(this.role[i]),
      attackType: attackFromCode(this.attackType[i]),
      isLeader: this.isLeader[i] === 1,
      suicide: this.suicide[i] === 1,
      noDemoteUntil: this.noDemoteUntil[i],
      intent: this.intent[i],
      bias: this.bias[i],
      aggro: this.aggro[i],
      wanderSpeed: this.wanderSpeed[i],
      lastSeenX: this.lastSeenX[i],
      lastSeenZ: this.lastSeenZ[i],
      lastSeenAt: this.lastSeenAt[i],
      aggroFrom: this.aggroFrom[i],
      aiStateIdx: this.aiStateIdx[i],
      aiTimer: this.aiTimer[i],
      orderKind: this.orderKind[i],
      orderTargetX: this.orderTargetX[i],
      orderTargetZ: this.orderTargetZ[i],
      orderUntil: this.orderUntil[i],
      orderSeq: this.orderSeq[i],
      directiveKind: this.directiveKind[i],
      directiveTargetX: this.directiveTargetX[i],
      directiveTargetZ: this.directiveTargetZ[i],
      directiveWard: this.directiveWard[i],
      directiveUntil: this.directiveUntil[i],
      directiveFire: this.directiveFire[i],
      directiveSpeedMul: this.directiveSpeedMul[i],
      directiveSeq: this.directiveSeq[i],
    };
    if (this.hasMoveTarget[i] === 1) {
      out.moveTargetX = this.moveTargetX[i];
      out.moveTargetY = this.moveTargetY[i];
      out.moveTargetZ = this.moveTargetZ[i];
    }
    return out;
  }

  clear(): void {
    this.count = 0;
  }
}
