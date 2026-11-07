import { hipErrorsForSide, type HipRightingFrame, type HipRightingErrors } from './hipRightingInput';

/**
 * 髋回正的两个任务（唯一策略）：
 *   JOINT_HOLD   → 关节角修正：posture + sagittal IK
 *   FORCE_RECOVER→ 力链修正：成对 load/unload + legFf
 *
 * forceMode 由 balanceState 的全局选择器给出，本文件不再自己判 mode。
 */
export interface HipRightingStrategyConfig {
  /** 全局选择器：false=JOINT_HOLD，true=FORCE_RECOVER */
  forceModeNow: boolean;

  /** 任务①：左右负载差 → 成对髋力（N·m/N） */
  hipForceK: number;
  /** 任务①：成对髋力上限（N·m） */
  hipForceCap: number;
  /** 任务①：力链沿腿修正 */
  legFfK: number;
  legFfCap: number;

  /** 任务②：posture 小角度 cap */
  hipCap: number;
  hip1Cap: number;
  hipZK: number;
  roll0K: number;
  roll1K: number;

  /** 任务②：矢状关节角修正 */
  sagHipK: number;
  sagHipD: number;
  sagHipCap: number;

  /** 统一 Fz 预算（来自 fzBudget，唯一来源） */
  fzTargetL: number;
  fzTargetR: number;
}

export interface HipRightingStrategyOutput {
  errors: HipRightingErrors;
  sagRel: number;
  /** 任务②：hip0/1/2 关节角增量 */
  hip0Delta: number;
  hip1Delta: number;
  hip2Delta: number;
  /** 任务①：hip2/腿力链前馈（只在 FORCE_RECOVER） */
  hipFf: number;
  /** 任务②：posture 分量，调试用 */
  postureHip0: number;
  postureHip1: number;
  /** 任务①：沿腿力链 */
  legFf: number;
  forceMode: boolean;
  sagHip: number;
  /** 任务①：左右负载差成对力（N·m；正=加载该侧） */
  forceFf: number;
  /** 任务①：差分负载误差（N；正=该侧需要更多负载） */
  loadDiff: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeHipRightingStrategy(
  frame: HipRightingFrame,
  side: 'l' | 'r',
  cfg: HipRightingStrategyConfig,
): HipRightingStrategyOutput {
  const errors = hipErrorsForSide(frame, side);
  const sd = side === 'l' ? frame.left : frame.right;
  const forceMode = cfg.forceModeNow;

  // 任务②：posture（小权限，只在 JOINT_HOLD 生效）
  const postureHip0 = clamp(
    cfg.hipZK * (sd?.hipZErr ?? 0) + cfg.roll0K * frame.roll,
    -Math.abs(cfg.hipCap),
    Math.abs(cfg.hipCap),
  );
  const postureHip1 = clamp(cfg.roll1K * frame.roll, -Math.abs(cfg.hip1Cap), Math.abs(cfg.hip1Cap));
  const sagHip = clamp(
    cfg.sagHipK * errors.eSag + cfg.sagHipD * errors.eSagV,
    -Math.abs(cfg.sagHipCap),
    Math.abs(cfg.sagHipCap),
  );

  // 任务①：力链
  const loadValid = errors.loadValid;
  const fzTarget = side === 'l' ? cfg.fzTargetL : cfg.fzTargetR;
  const fzActual = side === 'l' ? frame.fzL : frame.fzR;
  const legFf = loadValid && forceMode
    ? clamp(-cfg.legFfK * (fzTarget - fzActual), -Math.abs(cfg.legFfCap), Math.abs(cfg.legFfCap))
    : 0;
  // 差分去共模：两腿都欠载/过载不属于 load/unload。
  const fzErrL = cfg.fzTargetL - frame.fzL;
  const fzErrR = cfg.fzTargetR - frame.fzR;
  const loadDiff = side === 'l' ? 0.5 * (fzErrL - fzErrR) : 0.5 * (fzErrR - fzErrL);
  const forceFf = loadValid && forceMode
    ? clamp(cfg.hipForceK * loadDiff, -Math.abs(cfg.hipForceCap), Math.abs(cfg.hipForceCap))
    : 0;

  return {
    errors,
    sagRel: frame.sagRel,
    hip0Delta: postureHip0,
    hip1Delta: postureHip1,
    hip2Delta: forceMode ? 0 : sagHip,
    hipFf: forceMode ? legFf : 0,
    postureHip0,
    postureHip1,
    legFf,
    forceMode,
    sagHip,
    forceFf,
    loadDiff,
  };
}
