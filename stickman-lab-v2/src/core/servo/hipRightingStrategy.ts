import { hipErrorsForSide, type HipRightingFrame, type HipRightingErrors } from './hipRightingInput';

export interface HipRightingStrategyConfig {
  loadHipK: number;
  latHipK: number;
  loadFfK: number;
  latFfK: number;
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
  const legErr = side === 'l' ? errors.eFzL : errors.eFzR;
  const legFf = clamp(-cfg.legFfK * legErr, -legFfCap, legFfCap);
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
    hip2Delta: sagHip,
    hipFf: loadFf + comFf + legFf,
    postureHip0,
    postureHip1,
    loadHip0,
    comHip0,
    loadFf,
    comFf,
    legFf,
    hipRoom,
    ffRoom,
    sagHip,
  };
}
