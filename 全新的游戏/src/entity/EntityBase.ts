// ============================================================
// EntityBase —— 实体基类（所有实体的公共骨架）
// ============================================================
// 职责（架构 2.2）：
//   - 物理联动：经 EntityManager/PhysicsWorld（实体不碰 rapier）
//   - 动画管线联动：assetRef + FrameAnimator（FrameState 衔接层）
//   - 渲染管线联动：FXRenderer（FTXQuad/特效网格）
//   - 更新骨架：① 子类行为 → ② 物理同步 → ③ 动画推进 → ④ 渲染同步
//   - 生命周期：构造注册 → update 每帧 → dispose（三管线资源全释放）
//
// 子类扩展点：
//   - onUpdate(dt, input, cameraFrame)：行为逻辑（AI/控制/飞行/拾取）
//   - createRenderer(scene)：渲染器类型（FTXQuad / 特效网格）
//   - heightOffset()：额外高度偏移（跳跃等）
//   - onDeath() / onTakeDamage()：生命周期钩子

import * as THREE from 'three';
import type { Entity, EntityKind } from './Entity';
import type { EntityManager } from './EntityManager';
import type { BodyOptions, ColliderShape } from '../services/physics/PhysicsWorld';
import { FrameAnimatorBase } from '../services/fx/FrameAnimatorBase';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import type { FrameState } from '../services/fx/FrameState';
import type { FxRendererBase } from '../services/render/FxRendererBase';
import type { InputActions } from '../platform/input/InputActions';
import type { CameraFrame } from '../services/camera/CameraController';

/** 物理同步模式：velocity=速度驱动+位置读回（角色/运动体，碰撞由 rapier 处理）；
 *  read=纯物理驱动（子弹：发射后自由飞行） */
export type PhysicsMode = 'none' | 'velocity' | 'read';

export interface EntityBaseOptions {
  kind: EntityKind;
  x: number;
  y: number;
  z: number;
  /** 需要物理时传入 */
  physics?: { type: 'dynamic' | 'fixed'; options: BodyOptions };
  /** 动画资产（有 → 建 FrameAnimator + FrameState） */
  asset?: FrameAssetSource;
  /** 初始动画状态（朝向等） */
  animInitial?: Partial<FrameState>;
}

export abstract class EntityBase {
  readonly entity: Entity;
  /** ★ 阵营标签（player/ally/enemy/neutral；碰撞过滤/伤害判定用，架构 4.3） */
  camp = 'neutral';
  /** ★ 位置（世界 x/y/z；空间索引/查询统一入口） */
  get position(): { x: number; y: number; z: number } {
    return this.entity.position;
  }
  /** 动画管线（无 asset 时为 null） */
  readonly anim: FrameAnimatorBase | null;
  /** 动画状态（渲染管线读取的衔接层） */
  readonly state: FrameState | null;
  /** 物理同步模式（子类构造时设定） */
  physicsMode: PhysicsMode = 'none';
  /** ★ 可见性（第一人称时隐藏角色自身；setter 同步贴片 mesh.visible，
   *   渲染跳过只是不更新，mesh 仍挂场景 → 必须直接隐藏） */
  get visible(): boolean {
    return this._visible;
  }
  set visible(v: boolean) {
    this._visible = v;
    if (this.renderer) this.renderer.setVisible(v);
  }
  private _visible = true;
  /** ★ 是否面相机（billboard）；false = 固定朝向（setYaw 控制），用于检查背面帧 */
  billboard = true;

  /** ★ 碰撞体积（实例基类属性：形状 + 刚体 y 偏移；null = 无碰撞声明）
   *   子类覆写（角色=胶囊 / 子弹=球）；物理创建与刚体偏移统一从这里取 */
  readonly collisionVolume: { shape: ColliderShape; offsetY: number } | null = null;

  protected renderer: FxRendererBase | null = null;

  constructor(
    protected em: EntityManager,
    opts: EntityBaseOptions,
  ) {
    this.entity = em.create({
      kind: opts.kind,
      x: opts.x, y: opts.y, z: opts.z,
      physics: opts.physics,
    });
    this.anim = opts.asset ? new FrameAnimatorBase(opts.asset, opts.animInitial) : null;
    this.state = this.anim ? this.anim.state : null;
    em.register(this);
    // ★ 刚体初始位置修正：刚体中心 = 实体脚底 + 偏移（如角色胶囊中心在脚底上方）
    if (this.entity.rigidBody && this.physicsBodyOffsetY() !== 0) {
      em.physics?.setPosition(this.entity.rigidBody.handle, opts.x, opts.y + this.physicsBodyOffsetY(), opts.z);
    }
  }

  /** 子类实现：创建渲染器（FTXQuad / 特效网格） */
  protected abstract createRenderer(scene: THREE.Scene): FxRendererBase | null;

  /** 挂到场景（模式层在构造后调用） */
  attachToScene(scene: THREE.Scene): void {
    this.renderer = this.createRenderer(scene);
  }

  // ============ 更新骨架 ============

  /** 上一帧位置（碰撞回退用） */
  private prevX = 0;
  private prevZ = 0;

  /** 每帧驱动（模式层/EntityManager 调用） */
  update(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    this.onUpdate(dt, input, cameraFrame);  // ① 子类行为（含速度目标计算）
    this.syncPhysics();                     // ② 物理同步（velocity→速度写入；read→位置读回）
    this.anim?.update(dt);                  // ③ 动画推进
    this.syncRender();                      // ④ 渲染同步
    this.em.onEntityMoved(this);            // ⑤ 空间索引移块（集中刷新点）
  }

  /** 子类行为逻辑（覆写） */
  protected onUpdate(_dt: number, _input?: InputActions, _cameraFrame?: CameraFrame): void {
    // 默认无行为
  }

  /** ★ 期望速度（velocity 模式：syncPhysics 写入刚体；角色子类设置） */
  moveVelocity = { x: 0, z: 0 };

  /** 额外高度偏移（子类覆写：跳跃等） */
  protected heightOffset(): number {
    return 0;
  }

  /** ★ 刚体位置相对实体位置的 y 偏移（脚底系 → 刚体中心）——默认取碰撞体积声明 */
  protected physicsBodyOffsetY(): number {
    return this.collisionVolume?.offsetY ?? 0;
  }
  /** 刚体中心偏移（公开：模式层贴地钳制等外部同步用） */
  get bodyOffsetY(): number {
    return this.physicsBodyOffsetY();
  }

  private syncPhysics(): void {
    const rb = this.entity.rigidBody;
    const physics = this.em.physics;
    if (!rb || !physics || this.physicsMode === 'none') return;
    const p = this.entity.position;
    if (this.physicsMode === 'velocity') {
      // ★ 速度驱动：只覆盖 x/z（保留 y 速度 → 重力下落不被清零）；碰撞交给 rapier
      physics.setVelocityXZ(rb.handle, this.moveVelocity.x, this.moveVelocity.z);
      // 位置读回（物理结算结果 → 实体；y 减胶囊中心偏移回脚底系）
      const gp = physics.getPosition(rb.handle);
      p.x = gp.x; p.y = gp.y - this.physicsBodyOffsetY(); p.z = gp.z;
    } else if (this.physicsMode === 'read') {
      // 刚体 → 位置（子弹：物理驱动）
      const gp = physics.getPosition(rb.handle);
      p.x = gp.x; p.y = gp.y - this.physicsBodyOffsetY(); p.z = gp.z;
    }
  }

  private syncRender(): void {
    if (!this.renderer) return;
    const p = this.entity.position;
    this.renderer.setPosition(p.x, p.y + this.heightOffset(), p.z);
    if (this.state) {
      this.renderer.setFlip(this.state.flipX, this.state.flipY);
    }
  }

  /** 渲染当前帧（模式层 render 阶段遍历调用；不可见时跳过） */
  render(camera: THREE.Camera): void {
    if (!this.visible || !this.renderer || !this.state) return;
    // billboard：2D 贴片永远面向相机（3D 场景）；否则固定朝向（setYaw 由子类控制）
    if (this.billboard && 'setBillboard' in this.renderer) {
      (this.renderer as { setBillboard(c: THREE.Camera): void }).setBillboard(camera);
    }
    this.renderer.render(this.state, null);
  }

  // ============ 生命周期 ============

  /** ★ 碰撞回调（实体管线按刚体 handle 分发；覆写 = 命中处理）
   *   other = 碰撞对方实体；null = 静态世界（地面/墙）
   *   started = 接触开始（true）/ 结束（false） */
  onCollision(_other: EntityBase | null, _started: boolean): void {
    // 默认无处理（角色碰撞由物理响应，子弹/伤害逻辑覆写）
  }

  /** 死亡钩子（子类覆写：掉落/结算） */
  onDeath(): void {
    // 默认：从管线销毁
  }

  /** 销毁（动画/渲染/管线资源全释放） */
  dispose(): void {
    this.anim?.dispose();
    this.renderer?.dispose();
    this.em.unregister(this);
    this.em.destroy(this.entity.id);
  }
}
