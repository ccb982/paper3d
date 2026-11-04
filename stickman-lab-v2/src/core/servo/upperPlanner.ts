/** 上身命令层：只生成 spine/neck 目标与前馈，不写执行器。 */
import type { World } from '../world';
import type { CourtState as CS } from '../court';

export interface UpperCommand {
  index: number;
  name: string;
  axis: number;
  target: number;
  kp: number;
  kd: number;
  cap: number;
  ff: number;
}

const upperTarget = new WeakMap<CS, Map<number, number>>();
const upperBase = new WeakMap<CS, Map<number, number>>();
const upperCache = new WeakMap<CS, { at: number; out: UpperCommand[] }>();
const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function planUpper(w: World, st: CS, baseBuf: Float64Array | null, baseRamp: number, hipTargetY?: number, hipActualY?: number, hipVelY?: number): UpperCommand[] {
  const hz = Math.max(0.5, num('SQC_UPPER_HZ', 5));
  const c0 = upperCache.get(st);
  if (c0 && w.clock - c0.at < 1 / hz) return c0.out;
  let m = upperTarget.get(st);
  if (!m) { m = new Map(); upperTarget.set(st, m); }
  let base = upperBase.get(st);
  if (!base) { base = new Map(); upperBase.set(st, base); }
  const leanS1 = -num('SQC_UPPER_LEAN_S1', 0);
  const leanS2 = -num('SQC_UPPER_LEAN_S2', 0.04);
  const leanS3 = -num('SQC_UPPER_LEAN_S3', 0.03);
  const hipHigh = hipTargetY !== undefined && hipActualY !== undefined ? Math.max(0, hipActualY - hipTargetY) : 0;
  const hipBias = -Math.max(0, Math.min(0.25, num('SQC_UPPER_HIP_K', 0) * hipHigh));
  const spineNames = ['spine1', 'spine2', 'spine3'] as const;
  let totalBase = 0, nBase = 0, leanTotal = 0;
  for (const n of spineNames) {
    const i = w.body.dofByName(n, 2); if (i < 0) continue;
    if (!base.has(i)) base.set(i, w.body.dofs[i]!.angle);
    totalBase += base.get(i)!; nBase++;
    leanTotal += n === 'spine1' ? leanS1 : n === 'spine2' ? leanS2 : leanS3;
  }
  const commonTarget = nBase > 0 ? totalBase / nBase + leanTotal / nBase : 0;
  for (const n of spineNames) {
    const i = w.body.dofByName(n, 2); if (i < 0) continue;
    m.set(i, commonTarget + hipBias);
  }
  for (const n of ['spine1', 'spine2', 'spine3', 'neck'] as const) {
    const i0 = w.body.dofByName(n, 0); if (i0 >= 0) { if (!base.has(i0)) base.set(i0, w.body.dofs[i0]!.angle); m.set(i0, base.get(i0)!); }
  }
  { const iN = w.body.dofByName('neck', 2); if (iN >= 0) { if (!base.has(iN)) base.set(iN, w.body.dofs[iN]!.angle); m.set(iN, base.get(iN)!); } }
  const ffCap = num('SQC_UPPER_FF_CAP', 200);
  const kp = num('SQC_UPPER_KP', 120);
  const kd = num('SQC_UPPER_KD', 15);
  const temp: UpperCommand[] = [];
  let ffSum = 0, ffN = 0;
  for (const [i, target] of m) {
    const d = w.body.dofs[i]!;
    const raw = clamp((baseBuf ? (baseBuf[i] ?? 0) * baseRamp : 0), -ffCap, ffCap);
    if (d.axis === 2 && /^(spine|neck)/.test(d.name)) { ffSum += raw; ffN++; }
    temp.push({ index: i, name: d.name, axis: d.axis, target, kp, kd, cap: 200, ff: raw });
  }
  let commonFf = ffN > 0 ? ffSum / ffN : 0;
  let relax = 0;
  if (hipTargetY !== undefined && hipActualY !== undefined) {
    const hipHigh = Math.max(0, hipActualY - hipTargetY);
    const hipVel = hipVelY ?? 0;
    relax = Math.max(0, Math.min(1, hipHigh / 0.05 + Math.max(0, hipVel) / 0.2));
  }
  for (const c of temp) if (c.axis === 2 && /^(spine|neck)/.test(c.name)) { c.ff = commonFf; }
  upperCache.set(st, { at: w.clock, out: temp });
  return temp;
}
