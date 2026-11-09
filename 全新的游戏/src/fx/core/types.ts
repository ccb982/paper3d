// ============================================================
// src/fx/core/types.ts —— 特效运行时的纯数据契约
// ============================================================
// 禁止 import 'three'：这一层要能在 Node / Worker / 测试里跑。
// 游戏内唯一的特效播放器是 src/fx；本文件只描述"要播什么"，
// 不涉及任何 GPU / Three 类型。
// ============================================================

/** 当前已接入统一运行时（src/fx）的效果种类 */
export type FxEffectKind = 'explosion' | 'moon';

/** 程序化爆炸：几何参数驱动，无资产依赖 */
export interface FxExplosionSpec {
  readonly kind: 'explosion';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

export type FxSpawnSpec = FxExplosionSpec;

/** spawn 返回的句柄：只负责撤销这一次实例，不动运行时本身 */
export interface FxHandle {
  readonly kind: FxEffectKind;
  dispose(): void;
}
