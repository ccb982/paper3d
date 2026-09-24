// ============================================================
// entity/base/contracts —— 实体侧契约（重写 P1）
// ============================================================
// 分层铁律：**实体层不依赖 systems/**（与 TerrainAssist 同口径）——
// 引擎/小队可以依赖实体，反过来不行。命令侧契约见 systems/swarm/engine/contracts。
// ============================================================

// ---------- 能力（实体基类统一接口；铁律 10：L2/L3 同内核） ----------

export type AbilityId = 'climb' | 'cover' | 'unstuck' | 'despawn';

export interface AbilityRequest {
  id: AbilityId;
  /** climb/cover：目标点；unstuck：脱困方向点；despawn：无 */
  x?: number;
  z?: number;
  /** 超时（实秒；到点/超时即退出） */
  timeout: number;
}

// ---------- 升降格汇报（铁律 7：实体自己升降，变化后向引擎汇报） ----------

export interface EntityTierReport {
  uid: number;
  from: 1 | 2 | 3;
  to: 1 | 2 | 3;
  /** 升降格原因（调试/账本） */
  why: string;
}
