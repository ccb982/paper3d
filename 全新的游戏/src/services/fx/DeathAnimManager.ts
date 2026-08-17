// ============================================================
// DeathAnimManager —— 死亡动画组合层（角色基类自动管线）
// ============================================================
// 单例：模式层启动时 init(scene, renderer)，之后任何角色死亡
// （CharacterBase.onDeath）自动调用 spawn——角色基类不感知管理器
// 细节，只调用静态方法。每帧 update 推进（流体 + 淡出），播完回收。
// 与实体完全解耦：实体销毁/掉落/结算不阻塞，死亡动画独立推进。

import * as THREE from 'three';
import { DeathAnimEffect, type DeathAnimOptions } from './DeathAnimEffect';
import type { FrameAssetSource } from './AssetSource';

export class DeathAnimManager {
  private static instance: DeathAnimManager | null = null;
  private active: DeathAnimEffect[] = [];
  private scene: THREE.Scene | null = null;
  private renderer: THREE.WebGLRenderer | null = null;

  /** 模式层启动时注册（scene + renderer 供死亡动画创建网格/流体） */
  static init(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
    const inst = DeathAnimManager.instance ?? new DeathAnimManager();
    inst.scene = scene;
    inst.renderer = renderer;
    DeathAnimManager.instance = inst;
  }

  /** ★ 角色死亡入口（CharacterBase.onDeath 自动调用；asset 需支持 createDeathFluidEffect） */
  static spawn(
    asset: FrameAssetSource,
    frameIndex: number,
    x: number,
    y: number,
    z: number,
    options?: DeathAnimOptions,
  ): void {
    const inst = DeathAnimManager.instance;
    if (!inst?.scene || !inst.renderer) return; // 未初始化：静默跳过
    const creator = (asset as unknown as {
      createDeathFluidEffect?: (renderer: THREE.WebGLRenderer, frameIndex: number) => unknown;
    });
    if (!creator.createDeathFluidEffect) return; // 资产不支持：跳过
    const anim = new DeathAnimEffect(inst.scene, asset as never, frameIndex, inst.renderer, options);
    anim.play(x, y, z);
    inst.active.push(anim);
  }

  /** 每帧推进（播完移除；billboard 面相机在 update 内处理） */
  static update(dt: number, camera: THREE.Camera): void {
    const inst = DeathAnimManager.instance;
    if (!inst) return;
    for (let i = inst.active.length - 1; i >= 0; i--) {
      if (inst.active[i].update(dt, camera)) {
        inst.active[i].dispose();
        inst.active.splice(i, 1);
      }
    }
  }

  /** 全部销毁（模式销毁/场景卸载时调用） */
  static dispose(): void {
    const inst = DeathAnimManager.instance;
    if (!inst) return;
    for (const a of inst.active) a.dispose();
    inst.active.length = 0;
    inst.scene = null;
    inst.renderer = null;
  }
}
