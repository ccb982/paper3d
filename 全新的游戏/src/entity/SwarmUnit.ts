// ============================================================
// SwarmUnit —— 蜂群单位数据面 / 载体契约（《实体架构.md》§5.3 / §9.4）
// ============================================================
// ★ 铁律：entity/ 不引 systems/swarm/ —— 本文件是实体侧的唯一类型面，
//   systems/swarm 的 AgentSnapshot 以本文件 SwarmSnapshot 为基（systems→entity 合法）。
// ★ 字段全部非可选、有默认值（散兵 / 未编队 / 地面 / 近战）；v2 由 SwarmTierPort 填值。
// ============================================================

import type { RetireReason } from './EntityBase';

/** 兵种角色（大编队配比 / 阵型软约束依据） */
export type UnitRole = 'shield' | 'assault' | 'grunt' | 'ranged' | 'flyer';

/** 攻击类型：none 无 / melee 近战 / ranged 远程弹道 / bombard 轰炸（飞行兵） */
export type UnitAttackType = 'none' | 'melee' | 'ranged' | 'bombard';

/** AgentPool SoA 用的 Uint8 常量（与 AGENT_TARGET_* 同风格） */
export const ATTACK_NONE = 0, ATTACK_MELEE = 1, ATTACK_RANGED = 2, ATTACK_BOMBARD = 3;

/** ★ 兵种角色 SoA 编码（AgentPool 存 Uint8；顺序即编码，勿改动既有值） */
export const ROLE_GRUNT = 0, ROLE_SHIELD = 1, ROLE_ASSAULT = 2, ROLE_RANGED = 3, ROLE_FLYER = 4;
export const ROLE_ORDER: readonly UnitRole[] = ['grunt', 'shield', 'assault', 'ranged', 'flyer'];
export const ATTACK_ORDER: readonly UnitAttackType[] = ['none', 'melee', 'ranged', 'bombard'];

/** 联合类型 ↔ SoA 编码（唯一换算口；代理池与快照搬运共用） */
export function roleCode(r: UnitRole): number {
  const i = ROLE_ORDER.indexOf(r);
  return i < 0 ? ROLE_GRUNT : i;
}
export function roleFromCode(c: number): UnitRole {
  return ROLE_ORDER[c] ?? 'grunt';
}
export function attackCode(t: UnitAttackType): number {
  const i = ATTACK_ORDER.indexOf(t);
  return i < 0 ? ATTACK_MELEE : i;
}
export function attackFromCode(c: number): UnitAttackType {
  return ATTACK_ORDER[c] ?? 'melee';
}

/** ★ 移动意图（Brain → Simulate 下发；hold 语义） */
export interface SteerIntent {
  /** 单位方向（0,0 = 停） */
  dirX: number;
  dirZ: number;
  /** m/s（0 = 停） */
  speed: number;
  /** formation=编队槽位 / flow=流场 / local=本地 AI / none=停 */
  source: 'formation' | 'flow' | 'local' | 'none';
  /** 目标点（编队槽位 / 走廊；可缺省——方向驱动时不带） */
  targetX?: number;
  targetY?: number;
  targetZ?: number;
}

/** ★ 实体侧数据面（EnemyBase 实现；玩家/友军不实现） */
export interface SwarmUnit {
  /** 稳定 uid（升格/降格往返不变；替代裸 index） */
  swarmUid: number;
  /** 当前载体：L3 实体 = 'entity'；L1/L2 代理 = 'agent' */
  readonly carrier: 'entity' | 'agent';
  /** ★ 激活态（单一单位模型，2026-09-19）：dormant = 能力门控（代理）；active = 全能力（L3） */
  readonly activation: 'dormant' | 'active';
  /** ★ 是否本队队长（指挥资格只挂 active；dormant 恒 false） */
  isLeader: boolean;
  /** ★ 是否代理载体（carrier==='agent' 派生位；实体恒 false） */
  readonly isAgent: boolean;
  /** 大编队（-1 = 未编队；权威在 Squad.battalion，实体只存副本） */
  battalionId: number;
  /** 小编队（-1 = 散兵/未编队） */
  squadId: number;
  /** 阵型槽位（-1 = 未分配） */
  formSlot: number;
  /** 沿走廊推进进度（waypoint 索引） */
  corridorIdx: number;
  /** 兵种角色 */
  role: UnitRole;
  /** 是否空中单位（飞天：不进地面导航/车道/工事代价/陷阱） */
  readonly isAir: boolean;
  /** 空中悬停高度（米，相对地表；地面恒 0） */
  readonly altitude: number;
  /** 移动目标点（世界坐标；编队槽位/寻路下发，hold 语义；null = 无目标） */
  moveTarget: { x: number; y: number; z: number } | null;
  /** 攻击类型 */
  attackType: UnitAttackType;
}

/** ★ 跨载体快照的"实体侧字段"面（AgentSnapshot 以此为基，见 systems/swarm/AgentPool） */
export interface SwarmSnapshot {
  uid?: number;
  battalionId?: number;
  squadId?: number;
  formSlot?: number;
  corridorIdx?: number;
  role?: UnitRole;
  moveTargetX?: number;
  moveTargetY?: number;
  moveTargetZ?: number;
  attackType?: UnitAttackType;
  /** v2：现有缺失项（降格不再依赖模式层猜） */
  intent?: number;
  bias?: number;
  aggro?: number;
  wanderSpeed?: number;
  // ---- ★ 2026-09-19：单一单位模型（感知/指挥/AI 连续性；缺省 = 无/初始） ----
  /** 是否本队队长（指挥权标记；dormant 不允许） */
  isLeader?: boolean;
  /** 感知（属于逻辑单位，跨 LOD 保留）：最后目击 + 仇恨来源 */
  lastSeenX?: number;
  lastSeenZ?: number;
  lastSeenAt?: number;
  aggroFrom?: number;
  /** 休眠 AI 状态（降格抽干 / 升格回灌 → 不失忆、不重置巡逻） */
  aiStateIdx?: number;
  aiTimer?: number;
}

/** ★ 蜂群载体完整契约（L3 实体实现；友军远期可选） */
export interface SwarmCarrier extends SwarmUnit {
  /** ★ 唯一控制权切换点（只允许在 Phase 4 切换） */
  controlSource: 'swarm' | 'local';
  /** Phase 1→2：swarm 下发移动意图（hold 语义；null = 清除） */
  applySteer(intent: SteerIntent | null): void;
  /** Phase 4 升格：快照灌入实体（只覆盖快照携带的字段） */
  hydrate(snap: SwarmSnapshot): void;
  /** Phase 4 降格：实体抽干为快照（只含实体侧字段；def 派生项由桥接层补） */
  drain(): SwarmSnapshot;
  /** 统一退役入口（EntityBase.retire） */
  retire(reason: RetireReason): void;
}
