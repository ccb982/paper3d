// ============================================================
// CharacterBase —— 角色基类（EntityBase 子类）
// ============================================================
// 集成：CharacterController（相机相对移动/跳跃/朝向）+ 动画/渲染管线
// 物理：write 模式（位置由控制层驱动 → 刚体）
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

export abstract class CharacterBase extends EntityBase {
  readonly controller: CharacterController;

  constructor(
    em: EntityManager,
    opts: CharacterBaseOptions,
  ) {
    super(em, {
      kind: opts.kind,
      x: opts.x, y: opts.y, z: opts.z,
      physics: opts.physics ?? { type: 'dynamic', options: { shape: { type: 'ball', radius: 0.15 }, linearDamping: 8, canSleep: false } },
      asset: opts.asset,
      animInitial: opts.facing ? { facing: opts.facing } : undefined,
    });
    this.physicsMode = 'write';
    if (!this.anim) throw new Error('CharacterBase 需要动画资产');
    this.controller = new CharacterController(this.anim, opts.animMap, opts.moveSpeed ?? 2.5);
    // 玩法坐标（x/z 平面）初始化
    this.controller.position = { x: opts.x, y: opts.z };
  }

  protected override onUpdate(dt: number, input?: InputActions, cameraFrame?: CameraFrame): void {
    if (input && cameraFrame) {
      this.controller.update(dt, input, cameraFrame);
    }
    // 玩法坐标 → 实体世界坐标（x/z 平面；y = 地面高度由模式层设置）
    const cp = this.controller.position;
    this.entity.position.x = cp.x;
    this.entity.position.z = cp.y;
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

  /** 角色玩法坐标（x/z）——相机/模式层读取 */
  get controllerPosition(): { x: number; y: number } {
    return { ...this.controller.position };
  }

  /** ★ 当前跳跃高度偏移（相机聚焦点跟随用：跳跃时相机跟着升） */
  get jumpHeight(): number {
    return this.controller.getHeightOffset();
  }
}
