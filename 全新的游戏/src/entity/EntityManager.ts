// ============================================================
// EntityManager —— 实体管理器
// ============================================================
// 创建/销毁/遍历实体。实体"是否需要物理"由创建参数决定：
//   physics 传 BodyOptions → 通过 PhysicsWorld 建刚体（本管理器不碰 rapier）
//   不传 → 纯逻辑/视觉实体（装饰/资源点）
// 解耦：EntityManager 依赖 PhysicsWorld 接口，不直接调用 rapier。

import type { Entity, EntityKind, RigidBodyRef } from './Entity';
import type { PhysicsWorld, BodyOptions } from '../services/physics/PhysicsWorld';
import type { EntityBase } from './EntityBase';
import type { InputActions } from '../platform/input/InputActions';
import type { CameraFrame } from '../services/camera/CameraController';

export interface EntityCreateOptions {
  kind: EntityKind;
  x: number;
  y: number;
  z: number;
  /** 需要物理时传入（动态/固定由 shape+调用方决定） */
  physics?: { type: 'dynamic' | 'fixed'; options: BodyOptions };
}

export class EntityManager {
  private entities = new Map<number, Entity>();
  /** 基类实例集合（管线驱动：update/renderAll） */
  private bases = new Map<number, EntityBase>();
  private nextId = 1;

  constructor(private physicsWorld: PhysicsWorld | null = null) {}

  /** 物理世界（实体基类同步用） */
  get physics(): PhysicsWorld | null {
    return this.physicsWorld;
  }

  /** 创建实体（带物理则自动注册刚体） */
  create(opts: EntityCreateOptions): Entity {
    const entity: Entity = {
      id: this.nextId++,
      kind: opts.kind,
      position: { x: opts.x, y: opts.y, z: opts.z },
    };
    if (opts.physics && this.physicsWorld) {
      const handle = opts.physics.type === 'fixed'
        ? this.physicsWorld.addFixed({ x: opts.x, y: opts.y, z: opts.z }, opts.physics.options.shape)
        : this.physicsWorld.addDynamic({ x: opts.x, y: opts.y, z: opts.z }, opts.physics.options);
      entity.rigidBody = { handle, type: opts.physics.type };
    }
    this.entities.set(entity.id, entity);
    return entity;
  }

  /** 注册基类实例（EntityBase 构造时自动调用） */
  register(base: EntityBase): void {
    this.bases.set(base.entity.id, base);
  }

  /** 注销基类实例（EntityBase.dispose 时自动调用） */
  unregister(base: EntityBase): void {
    this.bases.delete(base.entity.id);
  }

  /** ★ 每帧驱动所有基类实体（统一管线入口：行为→物理→动画→渲染同步） */
  update(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    for (const base of this.bases.values()) {
      base.update(dt, input, cameraFrame);
    }
  }

  /** ★ 渲染阶段：遍历所有实体画当前帧 */
  renderAll(camera: Parameters<EntityBase['render']>[0]): void {
    for (const base of this.bases.values()) {
      base.render(camera);
    }
  }

  /** 销毁实体（刚体由 PhysicsWorld 管理，后续补 removeBody） */
  destroy(id: number): void {
    this.entities.delete(id);
  }

  get(id: number): Entity | undefined {
    return this.entities.get(id);
  }

  /** 按类型遍历 */
  all(kind?: EntityKind): Entity[] {
    if (!kind) return [...this.entities.values()];
    return [...this.entities.values()].filter((e) => e.kind === kind);
  }

  /** 全部基类实例（模式层组合用） */
  allBases(): EntityBase[] {
    return [...this.bases.values()];
  }

  get count(): number {
    return this.entities.size;
  }

  /** 销毁全部（模式切换/场景卸载） */
  clear(): void {
    for (const base of this.bases.values()) base.dispose();
    this.bases.clear();
    this.entities.clear();
  }
}
