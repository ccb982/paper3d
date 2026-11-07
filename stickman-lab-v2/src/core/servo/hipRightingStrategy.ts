import { hipErrorsForSide, type HipRightingFrame, type HipRightingErrors } from './hipRightingInput';

export interface HipRightingStrategyConfig {
  loadHipK: number;
  latHipK: number;
  loadFfK: number;
  latFfK: number;
  loadOn: number;
  sagOn: number;
  chainOn: number;
  legFfK: number;
  legFfCap: number;
  hipCap: number;
  ffCap: number;
  sagHipK: number;
  sagHipD: number;
  sagHipCap: number;
  hipZK: number;
  roll0K: number;
  roll1K: number;
  hip1Cap: number;
  /** 上一帧力链模式（滞回用；缺省 false） */
  prevForceMode?: boolean;
  /** 退出力链模式的阈值比例（滞回；缺省 0.6） */
  modeExitRatio?: number;
  /** 统一 Fz 预算（来自 fzBudget，唯一来源；hip load/unload 直接消费） */
  fzTargetL: number;
  fzTargetR: number;
  /** 任务①：左右负载差 → 成对髋力的增益（N·m/N） */
  hipForceK: number;
  /** 任务①：成对髋力的上限（N·m） */
  hipForceCap: number;
}

export interface HipRightingStrategyOutput {
  errors: HipRightingErrors;
  sagRel: number;
  hip0Delta: number;
  hip1Delta: number;
  hip2Delta: number;
  hipFf: number;
  postureHip0: number;
  postureHip1: number;
  loadHip0: number;
  comHip0: number;
  loadFf: number;
  comFf: number;
  legFf: number;
  forceMode: boolean;
  sagHip: number;
  /** 任务①：左右负载差的成对力命令（N·m；正=加载该侧） */
  forceFf: number;
  /** 任务①的差分负载误差（N；正=该侧需要更多负载） */
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
  const sideSign = side === 'l' ? 1 : -1;
  const cap = Math.abs(cfg.hipCap);
  const hip1Cap = Math.abs(cfg.hip1Cap);
  const ffCap = Math.abs(cfg.ffCap);
  const postureHip0 = clamp(cfg.hipZK * (sd?.hipZErr ?? 0) + cfg.roll0K * frame.roll, -cap, cap);
  const postureHip1 = clamp(cfg.roll1K * frame.roll, -hip1Cap, hip1Cap);
  const loadValid = errors.loadValid;
  const loadHip0 = loadValid ? clamp(cfg.loadHipK * errors.eLoad * sideSign, -cap, cap) : 0;
  const hipRoom = Math.max(0, cap - Math.abs(loadHip0));
  const comHip0 = loadValid ? clamp(cfg.latHipK * errors.eLat, -hipRoom, hipRoom) : 0;
  const loadFf = loadValid ? clamp(cfg.loadFfK * errors.eLoad, -ffCap, ffCap) : 0;
  const ffRoom = Math.max(0, ffCap - Math.abs(loadFf));
  const comFf = errors.gripValid ? clamp(cfg.latFfK * errors.eLat, -ffRoom, ffRoom) : 0;
  const legFfCap = Math.abs(cfg.legFfCap);
  // 左右目标只认 fzBudget（nominal 总重 + XCoM/CoP 几何），
  // 不允许再用实测 eLoad 反推目标（目标追测量 = 内环）。
  const fzTargetL = cfg.fzTargetL;
  const fzTargetR = cfg.fzTargetR;
  const fzTarget = side === 'l' ? fzTargetL : fzTargetR;
  const fzActual = side === 'l' ? frame.fzL : frame.fzR;
  const fPerpAbs = Math.abs(sd?.fPerp ?? 0);
  const modeExit = clamp(cfg.modeExitRatio ?? 0.6, 0.05, 1);
  // 滞回：进入用大误差带，退出用小误差带；不允许每帧切（文档 §10.4）
  const enterForce = loadValid && (Math.abs(errors.eLoad) >= cfg.loadOn || Math.abs(errors.eSag) >= cfg.sagOn || fPerpAbs >= cfg.chainOn);
  const stayForce = loadValid && (Math.abs(errors.eLoad) >= cfg.loadOn * modeExit || Math.abs(errors.eSag) >= cfg.sagOn * modeExit || fPerpAbs >= cfg.chainOn * modeExit);
  const forceMode = cfg.prevForceMode ? stayForce : enterForce;
  // 力链只在 FORCE_CHAIN 模式输出；JOINT_IK 只回目标（文档 §10.4）
  const legFf = loadValid && forceMode ? clamp(-cfg.legFfK * (fzTarget - fzActual), -legFfCap, legFfCap) : 0;
  // 任务①：左右负载差（去共模）→ 成对力。
  // 共模误差（两条腿都欠载/过载）不属于 load/unload，归 base/height，不在这里出力。
  const fzErrL = fzTargetL - frame.fzL;
  const fzErrR = fzTargetR - frame.fzR;
  const loadDiff = side === 'l' ? 0.5 * (fzErrL - fzErrR) : 0.5 * (fzErrR - fzErrL);
  const forceFf = loadValid && forceMode
    ? clamp(cfg.hipForceK * loadDiff, -Math.abs(cfg.hipForceCap), Math.abs(cfg.hipForceCap))
    : 0;
  const sagHip = clamp(
    cfg.sagHipK * errors.eSag + cfg.sagHipD * errors.eSagV,
    -Math.abs(cfg.sagHipCap),
    Math.abs(cfg.sagHipCap),
  );
  return {
    errors,
    sagRel: frame.sagRel,
    hip0Delta: clamp(postureHip0 + loadHip0 + comHip0, -cap, cap),
    hip1Delta: postureHip1,
    hip2Delta: forceMode ? 0 : sagHip,
    hipFf: loadFf + comFf + legFf,
    postureHip0,
    postureHip1,
    loadHip0,
    comHip0,
    loadFf,
    comFf,
    legFf,
    forceMode,
    sagHip,
    forceFf,
    loadDiff,
  };
}
