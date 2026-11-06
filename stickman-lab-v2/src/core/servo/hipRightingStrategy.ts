import type { HipRightingErrors } from './hipRightingInput';

export interface HipRightingStrategyInput extends HipRightingErrors {
  sideSign: number;
  postureHip0: number;
  loadHipK: number;
  latHipK: number;
  loadFfK: number;
  latFfK: number;
  hipCap: number;
  ffCap: number;
}

export interface HipRightingStrategyOutput {
  hip0Delta: number;
  hipFf: number;
  postureHip0: number;
  loadHip0: number;
  comHip0: number;
  loadFf: number;
  comFf: number;
  hipRoom: number;
  ffRoom: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function computeHipRightingStrategy(i: HipRightingStrategyInput): HipRightingStrategyOutput {
  const cap = Math.abs(i.hipCap);
  const ffCap = Math.abs(i.ffCap);
  const postureHip0 = clamp(i.postureHip0, -cap, cap);
  const loadValid = i.loadValid;
  const loadHip0 = loadValid ? clamp(i.loadHipK * i.eLoad * i.sideSign, -cap, cap) : 0;
  const hipRoom = Math.max(0, cap - Math.abs(loadHip0));
  const comHip0 = loadValid ? clamp(i.latHipK * i.eLat, -hipRoom, hipRoom) : 0;
  const loadFf = loadValid ? clamp(i.loadFfK * i.eLoad, -ffCap, ffCap) : 0;
  const ffRoom = Math.max(0, ffCap - Math.abs(loadFf));
  const comFf = i.gripValid ? clamp(i.latFfK * i.eLat, -ffRoom, ffRoom) : 0;
  return {
    hip0Delta: clamp(postureHip0 + loadHip0 + comHip0, -cap, cap),
    hipFf: loadFf + comFf,
    postureHip0,
    loadHip0,
    comHip0,
    loadFf,
    comFf,
    hipRoom,
    ffRoom,
  };
}
