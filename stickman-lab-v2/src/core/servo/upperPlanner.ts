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
const upperCache = new WeakMap<CS, { at: number; out: UpperCommand[] }>();
const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function planUpper(w: World, st: CS, baseBuf: Float64Array | null, baseRamp: number): UpperCommand[] {
  const hz = Math.max(0.5, num('SQC_UPPER_HZ', 5));
  const c0 = upperCache.get(st);
  if (c0 && w.clock - c0.at < 1 / hz) return c0.out;
  let m = upperTarget.get(st);
  if (!m) {
    m = new Map();
    for (const n of ['spine1', 'spine2', 'spine3', 'neck'] as const) {
      for (const ax of [0, 2] as const) {
        const i = w.body.dofByName(n, ax);
        if (i >= 0) m.set(i, w.body.dofs[i]!.angle);
      }
    }
    upperTarget.set(st, m);
  }
  const ffCap = num('SQC_UPPER_FF_CAP', 200);
  const kp = num('SQC_UPPER_KP', 80);
  const kd = num('SQC_UPPER_KD', 10);
  const temp: UpperCommand[] = [];
  let ffSum = 0, ffN = 0;
  for (const [i, target] of m) {
    const d = w.body.dofs[i]!;
    const raw = clamp((baseBuf ? (baseBuf[i] ?? 0) * baseRamp : 0), -ffCap, ffCap);
    if (d.axis === 2 && /^(spine|neck)/.test(d.name)) { ffSum += raw; ffN++; }
    temp.push({ index: i, name: d.name, axis: d.axis, target, kp, kd, cap: 200, ff: raw });
  }
  const commonFf = ffN > 0 ? ffSum / ffN : 0;
  for (const c of temp) if (c.axis === 2 && /^(spine|neck)/.test(c.name)) c.ff = commonFf;
  upperCache.set(st, { at: w.clock, out: temp });
  return temp;
}
