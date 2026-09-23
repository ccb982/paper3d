// ============================================================
// CharacterFxManager —— 角色表现特效运行时（角色基类自动管线）
// ============================================================
// 单例：模式层启动时 init(scene, renderer)。角色基类（CharacterBase）
// 自动处理的两类表现特效统一由此运行时提供资源与托管：
//   ① 死亡动画（DeathAnimEffect 实例列表：流体撕碎纹理 → 淡出 → 回收）
//   ② 受击染料（角色基类持有独立流体，创建时从这里取 renderer）
// 角色基类只调用静态方法，不感知管理器细节。
// 与实体完全解耦：实体销毁/掉落/结算不阻塞。

import * as THREE from 'three';
import { DeathAnimEffect, type DeathAnimOptions } from './DeathAnimEffect';
import type { FrameAssetSource } from './AssetSource';

export class CharacterFxManager {
  private static instance: CharacterFxManager | null = null;
  private active: DeathAnimEffect[] = [];
  private scene: THREE.Scene | null = null;
  private renderer: THREE.WebGLRenderer | null = null;

  /** 模式层启动时注册（scene + renderer 供受击染料/死亡动画创建网格与流体） */
  static init(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
    const inst = CharacterFxManager.instance ?? new CharacterFxManager();
    inst.scene = scene;
    inst.renderer = renderer;
    CharacterFxManager.instance = inst;
  }

  /** ★ 角色死亡入口（CharacterBase.onDeath 自动调用；asset 需支持 createDeathFluidEffect） */
  static spawnDeathAnim(
    asset: FrameAssetSource,
    frameIndex: number,
    x: number,
    y: number,
    z: number,
    options?: DeathAnimOptions,
  ): void {
    const inst = CharacterFxManager.instance;
    if (!inst?.scene || !inst.renderer) return; // 未初始化：静默跳过
    const creator = (asset as unknown as {
      createDeathFluidEffect?: (renderer: THREE.WebGLRenderer, frameIndex: number) => unknown;
    });
    if (!creator.createDeathFluidEffect) return; // 资产不支持：跳过
    const anim = new DeathAnimEffect(inst.scene, asset as never, frameIndex, inst.renderer, options);
    anim.play(x, y, z);
    inst.active.push(anim);
  }

  /** ★ 渲染资源：角色表现流体（受击染料等）创建时取渲染器；未初始化返回 null */
  static get renderer(): THREE.WebGLRenderer | null {
    return CharacterFxManager.instance?.renderer ?? null;
  }

  /** 每帧推进死亡动画（播完移除；billboard 面相机在 update 内处理） */
  static update(dt: number, camera: THREE.Camera): void {
    const inst = CharacterFxManager.instance;
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
    const inst = CharacterFxManager.instance;
    if (!inst) return;
    for (const a of inst.active) a.dispose();
    inst.active.length = 0;
    inst.scene = null;
    inst.renderer = null;
  }
}
