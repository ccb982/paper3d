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
import type { RasterMap } from '../services/map/RasterMap';
import { levelForDistance, LOD_MAX_DIST } from '../services/lod';

export interface EntityCreateOptions {
  kind: EntityKind;
  x: number;
  y: number;
  z: number;
  /** 需要物理时传入（动态/运动学/固定由 shape+调用方决定） */
  physics?: { type: 'dynamic' | 'kinematic' | 'fixed'; options: BodyOptions };
}

export class EntityManager {
  private entities = new Map<number, Entity>();
  /** 基类实例集合（管线驱动：update/renderAll；★ 按 entity.id 索引，碰撞分发用） */
  private bases = new Map<number, EntityBase>();
  /** ★ 统一空间层（RasterMap：实体索引 + 梯形剔除 + 地形数据；架构 3.10） */
  private raster: RasterMap;
  private nextId = 1;

  constructor(private physicsWorld: PhysicsWorld | null = null, raster?: RasterMap) {
    // ★ 碰撞系统解耦进实体管线：物理事件 → 按 handle 分发 → 实体 onCollision 钩子
    physicsWorld?.onCollision((e) => this.dispatchCollision(e));
    if (!raster) throw new Error('EntityManager 需要 RasterMap（统一空间层）');
    this.raster = raster;
  }

  /** ★ 碰撞事件分发（按 userData=entity.id 查实体；★ 不能用 handle——
   *   rapier handle 复用会让旧事件误伤新实体。0/缺失 = 静态世界 null） */
  private dispatchCollision(e: { aId: number; bId: number; started: boolean }): void {
    const a = this.bases.get(e.aId);
    const b = this.bases.get(e.bId);
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

  /** 创建实体（带物理则自动注册刚体；★ userData = entity.id 注入碰撞体） */
  create(opts: EntityCreateOptions): Entity {
    const id = this.nextId++;
    const entity: Entity = {
      id,
      kind: opts.kind,
      position: { x: opts.x, y: opts.y, z: opts.z },
    };
    if (opts.physics && this.physicsWorld) {
      const handle = opts.physics.type === 'fixed'
        ? this.physicsWorld.addFixed({ x: opts.x, y: opts.y, z: opts.z }, opts.physics.options.shape, id)
        : opts.physics.type === 'kinematic'
          ? this.physicsWorld.addKinematic({ x: opts.x, y: opts.y, z: opts.z }, opts.physics.options.shape, id)
          : this.physicsWorld.addDynamic({ x: opts.x, y: opts.y, z: opts.z }, { ...opts.physics.options, userData: id });
      entity.rigidBody = { handle, type: opts.physics.type };
    }
    this.entities.set(entity.id, entity);
    return entity;
  }

  /** 注册基类实例（EntityBase 构造时自动调用） */
  register(base: EntityBase): void {
    this.bases.set(base.entity.id, base);
    this.raster.insert(base);
  }

  /** 注销基类实例（EntityBase.dispose 时自动调用） */
  unregister(base: EntityBase): void {
    this.bases.delete(base.entity.id);
    this.raster.remove(base);
  }

  /** ★ 实体位置集中刷新（EntityBase.update 末尾调用；
   *   空间层移块，hash 比较，静止实体零成本） */
  onEntityMoved(base: EntityBase): void {
    this.raster.move(base);
  }

  /** ★ 每帧驱动所有基类实体（统一管线入口：行为→物理→动画→渲染同步） */
  update(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    for (const base of this.bases.values()) {
      base.update(dt, input, cameraFrame);
    }
  }

  /** ★ 渲染阶段：2D 梯形（相机视锥地面投影）内实体 → 距离分级 LOD →
   *   lod0-2 渲染（lod2 渐隐）、lod3 消失不渲染（架构 3.10）。
   *   实体不持有 LOD 状态——只接收距离（applyViewDistance），表现即时应用 */
  renderAll(camera: Parameters<EntityBase['render']>[0]): void {
    const cam = camera.position;
    for (const base of this.raster.queryFrustum(camera as Parameters<EntityBase['render']>[0], LOD_MAX_DIST)) {
      const dx = base.position.x - cam.x;
      const dz = base.position.z - cam.z;
      const d = Math.hypot(dx, dz);
      base.applyViewDistance(d);
      if (levelForDistance(d) < 3) base.render(camera);
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
    return this.raster.querySphere(x, z, r);
  }

  /** ★ 射线路径查询：只返回射线经过的 cell 内的实体（瞄准检测候选集） */
  queryRay(origin: { x: number; z: number }, dir: { x: number; z: number }, maxDist: number): EntityBase[] {
    return this.raster.queryRay(origin, dir, maxDist);
  }

  get count(): number {
    return this.entities.size;
  }

  /** 销毁全部（模式切换/场景卸载） */
  clear(): void {
    for (const base of this.bases.values()) base.dispose();
    this.bases.clear();
    this.entities.clear();
    this.raster.clear();
  }
}
