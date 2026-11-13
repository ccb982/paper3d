// ============================================================
// src/fx/core/types.ts —— 特效运行时的纯数据契约
// ============================================================
// 禁止 import 'three'：这一层要能在 Node / Worker / 测试里跑。
// 游戏内唯一的特效播放器是 src/fx；本文件只描述"要播什么"，
// 不涉及任何 GPU / Three 类型。
// ============================================================

/** 当前已接入统一运行时（src/fx）的效果种类 */
export type FxEffectKind = 'explosion' | 'moon' | 'pickupGlow' | 'beam' | 'hit';

/** 世界坐标点（纯数据，不依赖 Three.Vector3） */
export interface FxPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 程序化爆炸：几何参数驱动，无资产依赖 */
export interface FxExplosionSpec {
  readonly kind: 'explosion';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
}

/** 拾取金色粒子（8 粒子向外飞散 + 上浮 + 淡出，约 0.6s） */
export interface FxPickupGlowSpec {
  readonly kind: 'pickupGlow';
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** 无人机激光束（外红内白 + 两端光斑，默认 0.55s） */
export interface FxBeamSpec {
  readonly kind: 'beam';
  readonly start: FxPoint;
  readonly end: FxPoint;
  /** 生命时长（秒，默认 0.55） */
  readonly lifetime?: number;
  /** 束宽（世界单位，默认 5） */
  readonly width?: number;
  /** 射出点光斑尺寸（默认 0.5） */
  readonly originSize?: number;
  /** 击中点光斑尺寸（默认 0.75） */
  readonly hitSize?: number;
}

/** 击中特效（形状/烘焙图像由 configureHitEffects 预置，spec 只描述位置与尺寸） */
export interface FxHitSpec {
  readonly kind: 'hit';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 世界尺寸（quad 边长，默认 1.5） */
  readonly worldSize?: number;
}

export type FxSpawnSpec = FxExplosionSpec | FxPickupGlowSpec | FxBeamSpec | FxHitSpec;

/** spawn 返回的句柄：只负责撤销这一次实例，不动运行时本身 */
export interface FxHandle {
  readonly kind: FxEffectKind;
  dispose(): void;
}

/** 光束句柄：光束是"持续效果"，端点每帧可能变（目标移动） */
export interface FxBeamHandle extends FxHandle {
  /** 是否还在播（播完自动归还池，之后 active=false） */
  readonly active: boolean;
  /** 刷新两端（起点 = 施法者，终点 = 受击点/目标当前位置） */
  setEndpoints(start: FxPoint, end: FxPoint): void;
}
