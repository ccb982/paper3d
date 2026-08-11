// ============================================================
// Entity —— 实体容器（组合式：实体 + 可选物理引用）
// ============================================================
// 纯数据容器。物理通过 RigidBodyRef 引用（handle 由 PhysicsWorld 分配），
// 实体本身不碰 rapier。未来扩展组件（Transform/Health/AI/Weapon...）。

export type EntityKind = 'player' | 'ground' | 'enemy' | 'bullet' | 'item' | 'decoration';

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
