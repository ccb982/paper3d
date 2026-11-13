// ============================================================
// src/fx/index.ts —— 游戏内唯一特效播放器的公开出口
// ============================================================
// 游戏业务代码只从这里取运行时与类型；不要直接 import 内部通道。
// effects-player / src/vendor/player 均不是播放器，禁止从游戏侧引用其播放 API。
// ============================================================

export { FxRuntime } from './runtime/FxRuntime';
export type { FxRuntimeOptions } from './runtime/FxRuntime';
export type { MoonRenderBackend, MoonSource, MoonView } from './channels/MoonChannel';
export type {
  FxBeamHandle,
  FxBeamSpec,
  FxEffectKind,
  FxExplosionSpec,
  FxHandle,
  FxHitSpec,
  FxPickupGlowSpec,
  FxPoint,
  FxSpawnSpec,
} from './core/types';
export type { FxChannel } from './runtime/FxChannel';
export type { FxHitHandle } from './channels/HitEffectChannel';
export { createMoonSource } from './channels/MoonSourceFromAsset';
export type { MoonAssetBinding } from './channels/MoonSourceFromAsset';
