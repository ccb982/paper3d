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
import type { BodyOptions } from '../services/physics/PhysicsWorld';
import { FrameAnimatorBase } from '../services/fx/FrameAnimatorBase';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import type { FrameState } from '../services/fx/FrameState';
import type { FxRendererBase } from '../services/render/FxRendererBase';
import type { InputActions } from '../platform/input/InputActions';
import type { CameraFrame } from '../services/camera/CameraController';

/** 物理同步模式：write=位置→刚体（玩家/运动学）；read=刚体→位置（敌人/子弹） */
export type PhysicsMode = 'none' | 'write' | 'read';

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
  }

  /** 子类实现：创建渲染器（FTXQuad / 特效网格） */
  protected abstract createRenderer(scene: THREE.Scene): FxRendererBase | null;

  /** 挂到场景（模式层在构造后调用） */
  attachToScene(scene: THREE.Scene): void {
    this.renderer = this.createRenderer(scene);
  }

  // ============ 更新骨架 ============

  /** 每帧驱动（模式层/EntityManager 调用） */
  update(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    this.onUpdate(dt, input, cameraFrame); // ① 子类行为
    this.syncPhysics();                     // ② 物理同步
    this.anim?.update(dt);                  // ③ 动画推进
    this.syncRender();                      // ④ 渲染同步
    this.em.onEntityMoved(this);            // ⑤ 空间索引移块（集中刷新点）
  }

  /** 子类行为逻辑（覆写） */
  protected onUpdate(_dt: number, _input?: InputActions, _cameraFrame?: CameraFrame): void {
    // 默认无行为
  }

  /** 额外高度偏移（子类覆写：跳跃等） */
  protected heightOffset(): number {
    return 0;
  }

  private syncPhysics(): void {
    const rb = this.entity.rigidBody;
    const physics = this.em.physics;
    if (!rb || !physics || this.physicsMode === 'none') return;
    const p = this.entity.position;
    if (this.physicsMode === 'write') {
      // 位置 → 刚体（玩家/运动学：输入驱动）
      physics.setPosition(rb.handle, p.x, p.y, p.z);
    } else if (this.physicsMode === 'read') {
      // 刚体 → 位置（敌人/子弹：物理驱动）
      const gp = physics.getPosition(rb.handle);
      p.x = gp.x; p.y = gp.y; p.z = gp.z;
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
