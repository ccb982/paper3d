// ============================================================
// squad/State —— 执行层命令状态（重写 P4；队长层）
// ============================================================
// 真源：引擎 `engine/OrderWriter` 的 SquadOrder（命令轨）；
// 本文件 = 队长执行态（路径缓存/锚点滞回/生命周期）——由 squad/SquadCore 持有与推进。
// UI/探针只读口 = `engine/SquadView`（旧黑板已删）。
// ============================================================

import type { SquadIntent, SquadOrderKind, TacticalOrder } from '../../../entity/SwarmUnit';
import type { SquadOrder } from '../engine/contracts';
import { GAME_MIN } from '../SwarmConfig';

/** 队长执行态（路径缓存 / 锚点滞回 / 时序） */
export interface SquadOrderState {
  squadId: number;
  order: TacticalOrder;
  issuedAt: number;
  /** 截止（秒；到期回落本地自主） */
  until: number;
  /** 命令来源（引擎命令优先；玩家令同链） */
  source: 'engine' | 'player';
  /** 生效时刻（秒；startAfter 延迟发动） */
  notBefore: number;
  /** 等信号 id（undefined = 无需） */
  signal?: number;
  /** 路径求解时的目标点（位移 > RETARGET_DIST → 重算） */
  pathGoalX: number;
  pathGoalZ: number;
  /** 最近一次求解时刻（秒；超时刷新） */
  pathAt: number;
  /** 最近一次求解失败时刻（秒；失败冷却） */
  pathFailedAt: number;
  /** 寻路轨走廊（覆盖式；命令对象只读） */
  corridor?: { x: number; z: number; climb?: boolean }[];
  /** ★ 路线游标（锁存：沿走廊单调推进的当前路点下标；新走廊→0，清路→undefined） */
  followIdx?: number;
  /** 最近一次求解时的队长位（位移 >12m → 从当前位置重算） */
  pathFromX?: number;
  pathFromZ?: number;
  /** 求解时的代价代次（掩体增删 → 代次变 → 重算偏好） */
  costStamp?: number;
  /** ★ 净推进停滞检测（S3b）：最近一次"有进展"的时刻与当时距目标距离（3s 无进展 → 重算） */
  stallAt?: number;
  stallD?: number;
}

/** 命令 TTL（默认，游戏分钟） */
export const ORDER_TTL_DEFAULT = 30 * GAME_MIN;
/** 使命化 TTL 下限（断供保险；分钟级使命/驻守令寿命下限） */
export const MISSION_TTL_FLOOR = 30 * GAME_MIN;
/** 个体指令 TTL（游戏分钟） */
export const DIRECTIVE_TTL = 6 * GAME_MIN;
/** 队内保命线：个体 hpRatio 低于此值 → `fallback` 撤出 */
export const MEMBER_FALLBACK_HP = 0.3;
/** 驻守型（分钟级）使命 */
export const LONG_LIVED_MISSIONS = new Set(['build', 'guard', 'patrol', 'rear', 'hold']);

/** 意图推导（使命名优先，其次 kind） */
export function intentOfOrder(kind: SquadOrderKind, mission?: string): SquadIntent {
  switch (mission) {
    case 'build': return 'build';
    case 'guard': case 'hold': return 'hold';
    case 'rear': return 'withdraw';
    case 'assault': case 'flank': return 'attack';
    case 'patrol': return 'patrol';
    default: break;
  }
  switch (kind) {
    case 'advance': case 'flank': case 'focus': case 'bound': return 'attack';
    case 'retreat': return 'withdraw';
    case 'protect': case 'garrison': return 'guard';
    default: return 'regroup';
  }
}

/** 缺参降级：绝不发无法执行的命令 */
export function normalizeOrder(order: TacticalOrder): TacticalOrder {
  const o: TacticalOrder = { ...order, seq: order.seq || 1 };
  switch (o.kind) {
    case 'protect':
      if (!o.target && !o.subTargets?.length) o.kind = 'regroup';
      break;
    case 'flank':
      if (!o.path && !o.target) o.kind = 'advance';
      break;
    case 'garrison':
      if (!o.target) o.kind = 'regroup';
      break;
    case 'focus':
      if (!o.target) o.kind = 'advance';
      break;
    case 'advance':
    case 'bound':
      if (!o.target && !o.path) o.kind = 'regroup';
      break;
    case 'retreat':
      if (!o.target) o.kind = 'regroup';
      break;
    case 'regroup':
    default:
      break;
  }
  return o;
}

/** 引擎复合/原子令 → 执行板 kind 语义（导航/镜像同一份映射） */
export function boardKindOf(kind: SquadOrder['kind']): SquadOrderKind {
  switch (kind) {
    case 'act': case 'march': return 'advance';
    case 'defend': case 'garrison': return 'garrison';
    case 'protect': return 'protect';
    case 'patrol': return 'flank';
    default: return 'advance';
  }
}

/** 引擎令 → 执行态 order（TacticalOrder；protect 的 target = 保护点 G） */
export function toBoardOrder(o: SquadOrder): TacticalOrder {
  const kind = boardKindOf(o.kind);
  const target = o.kind === 'protect' && o.anchor ? { ...o.anchor } : { ...o.target };
  const out: TacticalOrder = {
    kind,
    target,
    mission: o.mission,
    seq: o.seq,
    threatX: o.threat?.x,
    threatZ: o.threat?.z,
  } as TacticalOrder;
  // ★ G5 例外（arch-guard 注明）：本文件是"引擎令 → 执行态"适配器，只**转发**引擎令自带 anchor，不产生锚
  if (o.anchor) out.anchor = { ...o.anchor };
  out.intent = intentOfOrder(kind, o.mission);
  return out;
}

/** 由引擎令构建执行态（保留同令的路径缓存） */
export function stateFromOrder(squadId: number, order: SquadOrder, prev: SquadOrderState | null, now: number, ttl: number): SquadOrderState {
  const o = toBoardOrder(order);
  const sameKind = prev?.order.kind === o.kind;
  const near = !!prev?.order.target && !!o.target
    && Math.hypot(prev.order.target!.x - o.target.x, prev.order.target!.z - o.target.z) <= 12;
  const st: SquadOrderState = {
    squadId,
    order: o,
    issuedAt: now,
    until: ttl > 0 ? now + ttl : 0,
    source: order.source === 'player' ? 'player' : 'engine',
    notBefore: now,
    pathGoalX: 0, pathGoalZ: 0, pathAt: 0, pathFailedAt: 0,
  };
  if (prev && sameKind && near) {
    st.pathGoalX = prev.pathGoalX;
    st.pathGoalZ = prev.pathGoalZ;
    st.pathAt = prev.pathAt;
    st.pathFailedAt = prev.pathFailedAt;
    st.corridor = prev.corridor;
    st.followIdx = prev.followIdx;
    st.pathFromX = prev.pathFromX;
    st.pathFromZ = prev.pathFromZ;
    st.stallAt = prev.stallAt;
    st.stallD = prev.stallD;
    st.costStamp = prev.costStamp;
  }
  return st;
}
