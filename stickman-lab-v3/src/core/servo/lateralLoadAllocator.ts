export interface LoadAllocOptions {
  hipCap?: number;
  kneeCap?: number;
  hipShare?: number;
}

export interface LoadAllocResult {
  knee2: number;
  hip2: number;
  achieved: number;
  residual: number;
}

const JL_KNEE = 4.07;
const JL_HIP = -2.76;

export function allocateLateralLoad(dLoad: number, opt: LoadAllocOptions = {}): LoadAllocResult {
  const hipCap = Math.abs(opt.hipCap ?? 10);
  const kneeCap = Math.abs(opt.kneeCap ?? 30);
  const hipShare = Math.max(0, Math.min(1, opt.hipShare ?? 0.5));
  const d = Number.isFinite(dLoad) ? dLoad : 0;
  const hip = -Math.sign(d) * Math.min(hipCap, (Math.abs(d) / Math.abs(JL_HIP)) * hipShare);
  let knee = (d - JL_HIP * hip) / JL_KNEE;
  knee = Math.max(-kneeCap, Math.min(kneeCap, knee));
  const achieved = JL_KNEE * knee + JL_HIP * hip;
  return { knee2: knee, hip2: hip, achieved, residual: d - achieved };
}
