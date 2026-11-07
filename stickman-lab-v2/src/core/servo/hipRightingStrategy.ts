import { hipErrorsForSide, type HipRightingFrame, type HipRightingErrors } from './hipRightingInput';

export interface HipRightingStrategyConfig {
  loadHipK: number;
  latHipK: number;
  loadFfK: number;
  latFfK: number;
  fzBiasK: number;
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
  /** 统一 Fz 预算（来自 fzBudget）；缺省时退回旧 bias 公式 */
  fzTargetL?: number;
  fzTargetR?: number;
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
  fzTargetL: number;
  fzTargetR: number;
  forceMode: boolean;
  supportSide: 'l' | 'r' | null;
  hipRoom: number;
  ffRoom: number;
  sagHip: number;
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
  const fzTotal = frame.fzL + frame.fzR;
  let fzTargetL: number;
  let fzTargetR: number;
  if (cfg.fzTargetL !== undefined && cfg.fzTargetR !== undefined) {
    // 统一预算：支撑与 legFf 读同一组目标（fzBudget.ts）
    fzTargetL = cfg.fzTargetL;
    fzTargetR = cfg.fzTargetR;
  } else {
    const bias = loadValid ? clamp(-cfg.fzBiasK * errors.eLoad * fzTotal * 0.5, -fzTotal * 0.35, fzTotal * 0.35) : 0;
    fzTargetL = Math.max(0, fzTotal * 0.5 + bias);
    fzTargetR = Math.max(0, fzTotal * 0.5 - bias);
  }
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
  const supportSide = Math.abs(errors.eLoad) >= cfg.loadOn ? (errors.eLoad > 0 ? 'r' : 'l') : null;
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
    fzTargetL,
    fzTargetR,
    forceMode,
    supportSide,
    hipRoom,
    ffRoom,
    sagHip,
  };
}
