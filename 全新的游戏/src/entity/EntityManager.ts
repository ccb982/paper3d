// ============================================================
// EntityManager —— 实体管理器
// ============================================================
// 创建/销毁/遍历实体。实体"是否需要物理"由创建参数决定：
//   physics 传 BodyOptions → 通过 PhysicsWorld 建刚体（本管理器不碰 rapier）
//   不传 → 纯逻辑/视觉实体（装饰/资源点）
// 解耦：EntityManager 依赖 PhysicsWorld 接口，不直接调用 rapier。

import type { Entity, EntityKind } from './Entity';
import type { PhysicsWorld, BodyOptions } from '../services/physics/PhysicsWorld';
import type { EntityBase } from './EntityBase';
import type { InputActions } from '../platform/input/InputActions';
import type { CameraFrame } from '../services/camera/CameraController';
import type { RasterMap } from '../services/map/RasterMap';
import { levelForDistance, LOD_MAX_DIST } from '../services/lod';
import type { Visibility } from '../services/visibility';
import { entityPerf } from './EntityPerf';

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
        ? this.physicsWorld.addFixed(
            { x: opts.x, y: opts.y, z: opts.z }, opts.physics.options.shape, id,
            opts.physics.options.tileSlot, opts.physics.options.rotation,
            opts.physics.options.extraColliders, opts.physics.options.shapeOffset,
            opts.physics.options.collisionGroups,
          )
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

  /** ★ Phase 2 Simulate：全部实体跑玩法相（行为→物理→空间索引；结算/查询在此时可见新位置） */
  simulate(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    // ★ 阶段耗时聚合归零（EntityBase.simulate/present 内累加；main.ts HUD 读取）
    entityPerf.behavior = 0; entityPerf.phys = 0; entityPerf.anim = 0;
    entityPerf.render = 0; entityPerf.moved = 0; entityPerf.shadow = 0;
    entityPerf.move = 0; entityPerf.sepOther = 0; entityPerf.sepStatic = 0; entityPerf.dye = 0;
    entityPerf.count = 0;
    for (const base of this.bases.values()) {
      base.simulate(dt, input, cameraFrame);
      entityPerf.count++;
    }
  }

  /** ★ Phase 5 Present：全部实体跑表现相（动画→渲染同步→特效→影子；视锥外自动跳过表现） */
  present(dt: number): void {
    for (const base of this.bases.values()) {
      base.present(dt);
    }
  }

  /** 兼容入口：Simulate + Present 连跑（旧调用方用；WorldMode 已改显式两相） */
  update(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    this.simulate(dt, input, cameraFrame);
    this.present(dt);
  }

  /** ★★ 渲染阶段（2026-11-07 架构重构）：**真 3D 视锥**裁剪 + 距离 LOD。
   *
   *   判据源唯一：`services/visibility.ts` 的 Visibility（真 3D 视锥，含 y）。
   *   ★ 为什么改成线性遍历（不再走 RasterMap 空间索引）：
   *     · 旧路径 = 「相机视锥投到地面的 2D 梯形」→ 实测误杀约 46% 屏幕内地面点
   *       （src/__probe_vis.ts）⇒ 近处敌人被判出视锥 → 贴片停在旧位置（鬼影）。
   *     · 实体总数有界（L3 上限 128 + 友军 + 子弹 ≈ 200）⇒ 线性判定更快更准，
   *       也不必扫 7.8 万格子。空间索引保留给玩法查询（querySphere/queryRay）。
   *
   *   ★ 出视锥 = **隐藏贴片**（不再只是"不更新"）：
   *     旧实现只跳过 present() 的同步 ⇒ 贴片冻结在旧位置继续画在屏幕上
   *     （FTXQuad.mesh.frustumCulled=false ⇒ three.js 也不裁）⇒ 鬼影。
   *
   *   ★ lodExempt 实体（主角/舰船/子弹/友军）绕过视锥裁剪与距离 LOD，
   *     始终 applyViewDistance(0) 全量渲染（VAT 连续时钟不因距离冻结）。
   */
  renderAll(camera: Parameters<EntityBase['render']>[0], vis: Visibility): void {
    const cam = camera.position;
    for (const base of this.bases.values()) {
      if (base.lodExempt) continue; // 豁免实体走下方全量渲染
      const dx = base.position.x - cam.x;
      const dz = base.position.z - cam.z;
      const d = Math.hypot(dx, dz);
      // ★ 距离粗筛：超出 LOD_MAX_DIST 直接判不可见（不浪费视锥测试）
      if (d > LOD_MAX_DIST) {
        base.setCulled(true);
        continue;
      }
      // ★ 真 3D 视锥（含 y；用实体身体中心高度，不是脚底）
      const vis3d = vis.isVisible(base.position.x, base.position.y + 0.9, base.position.z);
      base.setCulled(!vis3d);
      if (!vis3d) continue;
      base.applyViewDistance(d);
      if (levelForDistance(d) < 3) base.render(camera);
    }
    // ★ 豁免实体：全量渲染（不裁剪、不 LOD 衰减）
    for (const base of this.bases.values()) {
      if (!base.lodExempt) continue;
      base.setCulled(false);
      base.applyViewDistance(0);
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

  /** ★ 按实体 id 取基类实例（组合层判定用：阵营/类型过滤等） */
  baseOf(id: number): EntityBase | undefined {
    return this.bases.get(id);
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

  /** ★ 活体实体数（EntityBase：角色/道具/子弹/舰船；不含地形/装饰物理记录）
   *  ——HUD"实体数"应读这个；count 含每 chunk 地面 + 每装饰物碰撞体记录 */
  get baseCount(): number {
    return this.bases.size;
  }

  /** ★ 记录按 kind 计数（HUD 诊断"105 到底是什么"；复用对象零分配） */
  private kindTally: Record<string, number> = {
    player: 0, ground: 0, enemy: 0, bullet: 0, item: 0, decoration: 0, ship: 0,
  };
  kindCounts(): Record<string, number> {
    const o = this.kindTally;
    o.player = o.ground = o.enemy = o.bullet = o.item = o.decoration = o.ship = 0;
    for (const e of this.entities.values()) o[e.kind]++;
    return o;
  }

  /** 销毁全部（模式切换/场景卸载；走统一退役入口 mode_cleanup） */
  clear(): void {
    for (const base of this.bases.values()) base.retire('mode_cleanup');
    this.bases.clear();
    this.entities.clear();
    this.raster.clear();
  }
}
