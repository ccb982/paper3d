// ============================================================
// swarm/tiers/contracts —— 分档重写契约（用户定 2026-09-27；《移动执行重写.md》§7.5）
// ============================================================
// 三档各自独立模块（L1/L2/L3），**不得混写**。本文件只放跨档共用的类型：
//   · TierCarry：跨档携带（交接）数据，**零丢失口径**——
//       队长 = 完整快照（`SwarmSnapshot`+`AgentSnapshot` 单一事实源：位置/健康/指令/编队全量）；
//       成员 = 名册（uid/血/槽位）——未物化（L1）时仅名册，物化时按槽位落位；
//       核（SquadCore）按**队 id 持久**，不属于携带数据。
//   · TierHandover：L3↔L2↔L1 的转换唯一接口（实现 = Flux.ts；接线 = main）。
// 只共享两样：命令单源（引擎 → SquadCore）与存储（L2 的 SoA 列）。
// ============================================================

import type { AgentSnapshot, AgentSpawnData } from '../AgentPool';
import type { MobRole } from '../engine/contracts';
import type { SquadType } from '../../../entity/SwarmUnit';

export type TierId = 'L1' | 'L2' | 'L3';

/** 成员名册项（未物化也可存在；uid = 0 → 物化时由池/注册口分配） */
export interface TierCarryMember {
  uid: number;
  hp: number;
  maxHp: number;
  /** 阵型槽位（与 `formationOffset` 的 rank 对齐；0 = 队长） */
  slotRank: number;
}

/** 跨档携带（交接）数据（零丢失口径；队长含完整快照、成员含名册） */
export interface TierCarry {
  squadId: number;
  role: MobRole;
  /** 阵型类型（落位公式 `formationOffset(squadType, rank)` 的键） */
  squadType: SquadType;
  mobIndex: number;
  /** 存活总数（= 名册长度；名册含队长 rank 0 项） */
  alive: number;
  /** 队长完整快照（升/降格搬运的单一事实源） */
  leader: AgentSnapshot;
  /** 成员名册（含队长 rank 0 项；L1 只保留名册） */
  members: TierCarryMember[];
}

/** 档间转换唯一接口：返回 = 是否成功（实现见 Flux；接线在 main） */
export interface TierHandover {
  /** L3→L2：实体回收成代理（成员逐个回池） */
  demoteToL2(c: TierCarry): boolean;
  /** L2→L3：代理升格成实体（队长 + 名册逐个） */
  promoteToL3(c: TierCarry): boolean;
  /** L2→L1：收缩为队长单点（成员转名册；聚合信息已在名册里） */
  collapseToL1(c: TierCarry): boolean;
  /** L1→L2：按预留槽位物化成员代理（挂回既有队） */
  expandFromL1(c: TierCarry): boolean;
}

/** 池物化数据（L1→L2 展开 / 成员重建）：与池出生同一口径 */
export type TierSpawnData = AgentSpawnData;
