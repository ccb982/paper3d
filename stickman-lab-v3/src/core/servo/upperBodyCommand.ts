/** 上身命令层：只生成基础前馈、目标与髋高修正，不写执行器。 */
import type { World } from '../world';
import type { CourtState as CS } from '../court';
import { measureUpperLoads } from './upperForceChain';

const UPPER = ['spine1', 'spine2', 'spine3', 'neck'] as const;
const target = new WeakMap<CS, Map<number, number>>();
const height0 = new WeakMap<CS, number>();
const heightVel = new WeakMap<World, number>();
interface RightState { active: boolean; on: boolean; next: number }
const rightState = new WeakMap<CS, RightState>();

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface UpperCommand {
  base: Map<number, number>;
  targets: Map<number, number>;
  hCorr: number;
  ramp: number;
}

function targetsOf(w: World, st: CS): Map<number, number> {
  let m = target.get(st);
  if (m) return m;
  m = new Map();
  for (const n of UPPER) {
    for (const ax of [0, 1, 2] as const) {
      const i = w.body.dofByName(n, ax);
      if (i >= 0) m.set(i, w.body.dofs[i]!.angle);
    }
  }
  target.set(st, m);
  return m;
}

export function upperBodyCommand(w: World, st: CS): UpperCommand {
  const tgt = targetsOf(w, st);
  const base = new Map<number, number>();
  for (const l of measureUpperLoads(w)) {
    for (const ax of [0, 1, 2] as const) {
      const i = w.body.dofByName(l.name, ax);
      if (i >= 0) base.set(i, -l.torque[ax]);
    }
  }
  const age = Math.max(0, st.t - st.settle);
  const ramp = Math.min(1, age / Math.max(0.01, num('SQC_UPPER_RAMP', 0.05)));
  const chest = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3');
  let hCorr = 0;
  if (chest !== undefined) {
    const cb = w.body.bodies[chest]!;
    const h = cb.translation().y;
    let h0 = height0.get(st);
    if (h0 === undefined) { h0 = h; height0.set(st, h0); }
    const vy0 = heightVel.get(w) ?? cb.linvel().y;
    const hl = clamp(num('SQC_UPPER_H_VEL_LP', 0.3), 0, 1);
    const vy = vy0 + (cb.linvel().y - vy0) * hl;
    heightVel.set(w, vy);
    const e = h - h0;
    const hi = Math.abs(num('SQC_UPPER_H_DEAD_HI', 0.008));
    const lo = Math.abs(num('SQC_UPPER_H_DEAD_LO', 0.004));
    let rs = rightState.get(st);
    if (!rs) { rs = { active: false, on: false, next: 0 }; rightState.set(st, rs); }
    if (rs.active) {
      if (Math.abs(e) < lo) rs.active = false;
    } else if (Math.abs(e) > hi && age > 0) {
      rs.active = true;
      rs.on = true;
      rs.next = w.clock + Math.abs(num('SQC_UPPER_H_ON', 0.2));
    }
    if (rs.active) {
      if (w.clock >= rs.next) {
        rs.on = !rs.on;
        rs.next = w.clock + (rs.on ? Math.abs(num('SQC_UPPER_H_ON', 0.2)) : Math.abs(num('SQC_UPPER_H_OFF', 0.3)));
      }
      if (rs.on) {
        const hkp = num('SQC_UPPER_H_KP', 1500);
        const hkd = num('SQC_UPPER_H_KD', 120);
        const hcap = Math.abs(num('SQC_UPPER_H_CAP', 20));
        hCorr = clamp(-hkp * e - hkd * vy, -hcap, hcap) * ramp;
      }
    }
  }
  return { base, targets: tgt, hCorr, ramp };
}
