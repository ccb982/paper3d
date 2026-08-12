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
import { SpatialGrid } from '../services/space/SpatialGrid';

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
  /** ★ 刚体 handle → 实体基类（碰撞事件分发用） */
  private bodyMap = new Map<number, EntityBase>();
  /** ★ 空间索引（分块遍历：渲染裁剪 / 索敌 / 范围查询；架构 4.1a） */
  private grid = new SpatialGrid<EntityBase>(8);
  private nextId = 1;

  constructor(private physicsWorld: PhysicsWorld | null = null) {
    // ★ 碰撞系统解耦进实体管线：物理事件 → 按 handle 分发 → 实体 onCollision 钩子
    physicsWorld?.onCollision((e) => this.dispatchCollision(e));
  }

  /** ★ 碰撞事件分发（对方无实体 = 静态世界 null） */
  private dispatchCollision(e: { a: number; b: number; started: boolean }): void {
    const a = this.bodyMap.get(e.a);
    const b = this.bodyMap.get(e.b);
    if (a && b) {
      a.onCollision(b, e.started);
      b.onCollision(a, e.started);
    } else if (a) {
      a.onCollision(null, e.started);
    } else if (b) {
      b.onCollision(null, e.started);
    }
  }

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
    this.grid.insert(base);
    // ★ 碰撞分发映射（有刚体的实体）
    if (base.entity.rigidBody) {
      this.bodyMap.set(base.entity.rigidBody.handle, base);
    }
  }

  /** 注销基类实例（EntityBase.dispose 时自动调用） */
  unregister(base: EntityBase): void {
    this.bases.delete(base.entity.id);
    this.grid.remove(base);
    if (base.entity.rigidBody) {
      this.bodyMap.delete(base.entity.rigidBody.handle);
    }
  }

  /** ★ 实体位置集中刷新（EntityBase.update 末尾调用；
   *   空间索引移块，hash 比较，静止实体零成本） */
  onEntityMoved(base: EntityBase): void {
    this.grid.move(base);
  }

  /** ★ 每帧驱动所有基类实体（统一管线入口：行为→物理→动画→渲染同步） */
  update(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    for (const base of this.bases.values()) {
      base.update(dt, input, cameraFrame);
    }
  }

  /** ★ 渲染阶段：只遍历视野覆盖块内的实体（分块裁剪，架构 4.1a） */
  renderAll(camera: Parameters<EntityBase['render']>[0]): void {
    for (const base of this.grid.queryVisible(camera as Parameters<EntityBase['render']>[0])) {
      base.render(camera);
    }
  }

  /** 销毁实体（★ 刚体同步从物理世界移除，防止泄漏） */
  destroy(id: number): void {
    const e = this.entities.get(id);
    if (e?.rigidBody) {
      this.physicsWorld?.removeBody(e.rigidBody.handle);
    }
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

  /** 全部基类实例（模式层组合/调试用） */
  allBases(): EntityBase[] {
    return [...this.bases.values()];
  }

  /** ★ 空间查询：半径内实体（AI 索敌/子弹/技能/拾取） */
  querySphere(x: number, z: number, r: number): EntityBase[] {
    return this.grid.querySphere(x, z, r);
  }

  get count(): number {
    return this.entities.size;
  }

  /** 销毁全部（模式切换/场景卸载） */
  clear(): void {
    for (const base of this.bases.values()) base.dispose();
    this.bases.clear();
    this.entities.clear();
    this.grid.clear();
    this.bodyMap.clear();
  }
}
