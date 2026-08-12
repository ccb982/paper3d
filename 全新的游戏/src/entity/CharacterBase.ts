// ============================================================
// CharacterBase —— 角色基类（EntityBase 子类）
// ============================================================
// 集成：CharacterController（相机相对移动/跳跃/朝向）+ 动画/渲染管线
// 物理：velocity 模式（速度驱动 + 位置读回，碰撞交给 rapier）
// 子类：Player（输入驱动）/ Ally / Enemy（AI 驱动）

import * as THREE from 'three';
import { EntityBase, type EntityBaseOptions } from './EntityBase';
import type { EntityManager } from './EntityManager';
import { CharacterController, type CharacterAnimMap } from '../systems/player/CharacterController';
import type { FrameAssetSource } from '../services/fx/AssetSource';
import type { InputActions } from '../platform/input/InputActions';
import type { CameraFrame } from '../services/camera/CameraController';

export interface CharacterBaseOptions extends EntityBaseOptions {
  /** 动画状态表（状态 → 帧名序列，按朝向分组） */
  animMap: CharacterAnimMap;
  /** 移动速度（世界单位/秒） */
  moveSpeed?: number;
  /** 初始朝向 */
  facing?: string;
}

/** ★ 角色默认碰撞体积（长方体，2D 贴片正反面都扁：
 *   正面（x）宽 0.56 对齐贴片宽度；厚度（z）0.3 薄片；
 *   高 2.0（贴片 2.5 的 80%，脚底到肩部）
 *   模块级常量：super() 时字段尚未初始化，构造参数只能引用常量 */
const DEFAULT_COLLISION_VOLUME = {
  shape: { type: 'cuboid', hx: 0.28, hy: 1.0, hz: 0.15 } as const,
  offsetY: 1.0,
};

export abstract class CharacterBase extends EntityBase {
  readonly controller: CharacterController;
  /** ★ 角色碰撞体积（实例基类属性；子类可覆写为不同体型） */
  readonly collisionVolume: { shape: import('../services/physics/PhysicsWorld').ColliderShape; offsetY: number } = DEFAULT_COLLISION_VOLUME;

  constructor(
    em: EntityManager,
    opts: CharacterBaseOptions,
  ) {
    super(em, {
      kind: opts.kind,
      x: opts.x, y: opts.y, z: opts.z,
      // ★ 物理创建用碰撞体积声明（super 前字段未初始化 → 用常量）
      physics: opts.physics ?? {
        type: 'dynamic',
        options: { shape: DEFAULT_COLLISION_VOLUME.shape, linearDamping: 8, canSleep: false },
      },
      asset: opts.asset,
      animInitial: opts.facing ? { facing: opts.facing } : undefined,
    });
    this.physicsMode = 'velocity';
    if (!this.anim) throw new Error('CharacterBase 需要动画资产');
    this.controller = new CharacterController(this.anim, opts.animMap, opts.moveSpeed ?? 2.5);
  }

  protected override onUpdate(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    if (input && cameraFrame) {
      this.controller.update(dt, input, cameraFrame);
    }
    // ★ 期望速度 → 物理（碰撞交给 rapier；位置下一帧从刚体读回）
    const dir = this.controller.moveDir;
    const speed = this.controller.moveSpeed;
    this.moveVelocity.x = dir.x * speed;
    this.moveVelocity.z = dir.y * speed;
  }

  protected override heightOffset(): number {
    return this.controller.getHeightOffset();
  }

  /** ★ 按纹理宽高比设置角色缩放（避免竖长/横长纹理被压扁）——子类 attach 后调用 */
  protected applyRenderScale(baseSize = 1.5): void {
    if (this.renderer && 'setScaleKeepAspect' in this.renderer) {
      (this.renderer as { setScaleKeepAspect(s: number): void }).setScaleKeepAspect(baseSize);
    }
  }

  /** 角色世界位置（物理读回后，x/z）——相机/模式层读取 */
  get controllerPosition(): { x: number; y: number } {
    return { x: this.entity.position.x, y: this.entity.position.z };
  }

  /** ★ 当前跳跃高度偏移（相机聚焦点跟随用：跳跃时相机跟着升） */
  get jumpHeight(): number {
    return this.controller.getHeightOffset();
  }
}
