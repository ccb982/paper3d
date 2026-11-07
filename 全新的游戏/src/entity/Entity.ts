// ============================================================
// Entity —— 实体容器（组合式：实体 + 可选物理引用）
// ============================================================
// 纯数据容器。物理通过 RigidBodyRef 引用（handle 由 PhysicsWorld 分配），
// 实体本身不碰 rapier。未来扩展组件（Transform/Health/AI/Weapon...）。

/**
 * ★ 实体类别。
 * ★ 'structure'（2026-11-07 新增）：**结构件碰撞体**（水泥台座等）——
 *   与 'ground'（地形，可被挖）区分：
 *   · 地形命中 → 走 resolveImpact 挖地块（playBulletImpact）
 *   · 结构件命中 → **子弹反弹**（不挖地形）——水泥台座不该被挖出坑。
 */
export type EntityKind = 'player' | 'ground' | 'structure' | 'enemy' | 'bullet' | 'item' | 'decoration' | 'ship' | 'npc';

export interface RigidBodyRef {
  /** rapier 刚体 handle（由 PhysicsWorld 分配） */
  handle: number;
  /** 刚体类型 */
  type: 'dynamic' | 'fixed' | 'kinematic';
}
export interface Entity {
  id: number;
  kind: EntityKind;
  /** 世界位置（玩法坐标：y 为高度） */
  position: { x: number; y: number; z: number };
  /** 有物理的实体持有刚体引用 */
  rigidBody?: RigidBodyRef;
  /** 自定义数据（后续组件挂载点） */
  data?: Record<string, unknown>;
}
