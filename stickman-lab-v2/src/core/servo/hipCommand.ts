import type { HipRightingStrategyOutput } from './hipRightingStrategy';

/**
 * 髋神经命令：只输出目标 + 分源前馈，不写关节力矩。
 *
 * 神经/肌肉边界（docs/神经命令层架构-2026-11-06.md §11）：
 *   这里只允许出现「神经信号」——目标角、前馈/补偿力、active/fade。
 *   不允许出现关节空间 PD 律（K·e − D·v）：原来的 hip2TrackFf 已迁入
 *   HipTaskPD 的肌肉牵张反射（pdGroups.ts），命令层不再计算。
 *
 * 前馈来源保持分开：
 *   baseFf   基础力（IK 平衡前馈，经髋高门控）
 *   heightFf 髋高支撑力（H* 误差 → 沿腿力命令）
 *   rightFf  回正力（负载/CoM/力链）
 *   hipFf = baseFf + heightFf·relax系数 + rightFf
 */
export interface HipCommandInput {
  baseHip0Target: number;
  baseHip1Target: number;
  /** 基础力（IK 平衡前馈；已经过 gate） */
  baseGatedFf: number;
  /** 髋高支撑力（H* − H；神经层力命令，不是关节 PD） */
  heightFf: number;
  relax: number;
  hipOn: boolean;
  rightStrength: number;
  /** 神经命令淡入淡出（0..1；模式切换用） */
  rightFade: number;
  strategy: HipRightingStrategyOutput;
  hip2Target: number;
}

export interface HipCommandOutput {
  hip0Target: number;
  hip1Target: number;
  hip2Target: number;
  hipFf: number;
  /** 分源回读：总 ff 由这三项相加 */
  baseFf: number;
  heightFf: number;
  rightFf: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeHipCommand(i: HipCommandInput): HipCommandOutput {
  const fade = clamp(i.rightFade, 0, 1);
  const rightFf = i.hipOn ? fade * i.rightStrength * i.strategy.hipFf : 0;
  return {
    hip0Target: i.baseHip0Target + (i.hipOn ? fade * i.strategy.hip0Delta : 0),
    hip1Target: i.baseHip1Target + (i.hipOn ? fade * i.strategy.hip1Delta : 0),
    hip2Target: i.hip2Target,
    hipFf: i.baseGatedFf + i.heightFf * (1 - 0.8 * i.relax) + rightFf,
    baseFf: i.baseGatedFf,
    heightFf: i.heightFf,
    rightFf,
  };
}
