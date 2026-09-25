// ============================================================
// CharacterDeathFx —— 角色死亡动画（CharacterBase 组合件）
// ============================================================
// 从 CharacterBase 搬出（《RTS架构.md》E1；行为零变化）：
//   任何角色死亡 → 纹理所有权转移给死亡动画（独立流体撕碎消散，纯表现，
//   不阻塞掉落/结算）。
// ============================================================

import type { FrameAnimatorBase } from './FrameAnimatorBase';
import { CharacterFxManager } from './CharacterFxManager';

export class CharacterDeathFx {
  /** 死亡动画开关（玩家死亡 = 传送复活，不销毁 → Player 覆写 onDeath 时不调用即可） */
  enabled = true;

  /** 触发死亡动画（冻结当前帧 → 流体消散；worldSize = 死亡瞬间贴片世界高） */
  spawn(
    anim: FrameAnimatorBase | null,
    x: number,
    y: number,
    z: number,
    worldSize: number,
  ): void {
    if (!this.enabled || !anim) return;
    CharacterFxManager.spawnDeathAnim(
      anim.source,
      anim.state.frameIndex,
      x,
      y,
      z,
      { worldSize },
    );
  }

  /** 无独立资源需释放（实例由 CharacterFxManager 管理） */
  dispose(): void {
    // no-op：与 EffectSlots/HitDye 保持同构调用面
  }
}
