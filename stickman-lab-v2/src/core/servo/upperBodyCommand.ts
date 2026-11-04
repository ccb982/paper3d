/** 上身命令层：一个整体 PD + 逐节逐轴重力前馈。 */
import type { World } from '../world';
import type { CourtState as CS } from '../court';
import { propose, PRI } from '../proposalBus';
import { measureUpperLoads } from './upperForceChain';

const UPPER = ['spine1', 'spine2', 'spine3', 'neck'] as const;
const target = new WeakMap<CS, Map<number, number>>();
const velLp = new WeakMap<World, Map<number, number>>();

const num = (k: string, d: number): number => {
  const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.[k]);
  return Number.isFinite(v) ? v : d;
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

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

export function upperBodyCommand(w: World, st: CS): void {
  const tgt = targetsOf(w, st);
  const g = new Map<string, [number, number, number]>();
  for (const l of measureUpperLoads(w)) g.set(l.name, l.torque);
  const kp = num('SQC_UPPER_KP', 160);
  const kd = num('SQC_UPPER_KD', 24);
  const cap = Math.abs(num('SQC_UPPER_CAP', 120));
  const lp = clamp(num('SQC_UPPER_VEL_LP', 0.35), 0, 1);
  const age = Math.max(0, st.t - st.settle);
  const ramp = Math.min(1, age / Math.max(0.01, num('SQC_UPPER_RAMP', 0.05)));
  let vm = velLp.get(w);
  if (!vm) { vm = new Map(); velLp.set(w, vm); }

  for (const n of UPPER) {
    const gt = g.get(n);
    for (const ax of [0, 1, 2] as const) {
      const i = w.body.dofByName(n, ax);
      if (i < 0) continue;
      const d = w.body.dofs[i]!;
      const v0 = vm.get(i) ?? d.vel;
      const v = v0 + (d.vel - v0) * lp;
      vm.set(i, v);
      const e = (tgt.get(i) ?? d.angle) - d.angle;
      const pd = clamp(kp * e - kd * v, -cap, cap) * ramp;
      const ff = gt ? -gt[ax] : 0;
      const tau = clamp(ff + pd, -d.tauMax, d.tauMax);
      if (tau !== 0) {
        propose({ dof: i, kind: 'ext', pri: PRI.servo, channel: 'support', tau, src: 'squat.upperSupport' });
      }
    }
  }
}
