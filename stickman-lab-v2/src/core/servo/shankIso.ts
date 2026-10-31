import type { World } from '../world';
import type { ControlModule } from '../control';
import type { CourtState as CS } from '../court';
import { courtStep } from '../court';
import { propose, PRI } from '../proposalBus';
import { sampleFootContact } from './footContact';

interface IsoTarget {
  foot0: number;
  foot1: number;
  foot2: number;
  knee1: number;
  knee2: number;
  footZ: number;
  footY: number;
  contactValid: boolean;
}

const _targets = new WeakMap<CS, { l: IsoTarget; r: IsoTarget }>();

const angle = (w: World, n: string, a: number): number => {
  const i = w.body.dofByName(n, a);
  return i >= 0 ? w.body.dofs[i]!.angle : 0;
};
const vel = (w: World, n: string, a: number): number => {
  const i = w.body.dofByName(n, a);
  return i >= 0 ? w.body.dofs[i]!.vel : 0;
};

function targets(w: World, st: CS) {
  let t = _targets.get(st);
  if (t) return t;
  const one = (s: 'l' | 'r'): IsoTarget => ({
    foot0: angle(w, `foot_${s}`, 0),
    foot1: angle(w, `foot_${s}`, 1),
    foot2: angle(w, `foot_${s}`, 2),
    knee1: angle(w, `knee_${s}`, 1),
    knee2: angle(w, `knee_${s}`, 2),
    footZ: (() => {
      const c = new Float64Array(3);
      return w.body.footCoP(s, w.dt, c) ? c[1]! : w.body.bodies[w.body.indexByKey.get(`foot_${s}`)!]!.translation().z;
    })(),
    footY: w.body.bodies[w.body.indexByKey.get(`foot_${s}`)!]!.translation().y,
    contactValid: w.body.footNormalForce(s, w.dt) > 20,
  });
  t = { l: one('l'), r: one('r') };
  _targets.set(st, t);
  return t;
}

function pd(w: World, name: string, axis: number, target: number, kp: number, kd: number, cap: number): void {
  const i = w.body.dofByName(name, axis);
  if (i < 0) return;
  const d = w.body.dofs[i]!;
  const tau = -kp * (d.angle - target) - kd * d.vel;
  propose({ dof: i, kind: 'ext', pri: PRI.reflex, tau: Math.max(-cap, Math.min(cap, tau)), src: `shankIso.${name}.${axis}`, channel: 'support' });
}

/** 隔离小腿：只控制膝/踝/脚，膝关节以上由外层固定。 */
export function shankIsoFrame(w: World, ctl: ControlModule, st: CS): void {
  courtStep(w, ctl, st);
  // 冻结期就捕获脚目标：此时脚还在地面，避免释放后才捕获到空中位置
  const t = targets(w, st);
  if (!st.released) return;
  for (const s of ['l', 'r'] as const) {
    const q = t[s];
    const fc = sampleFootContact(w, s, q.footZ, q.footY);
    // 抓地模块只给 PD 目标修正；不直接写关节力矩
    if (!fc.contact) {
      for (const [ax, name] of [[1, `knee_${s}`], [2, `knee_${s}`], [0, `foot_${s}`], [1, `foot_${s}`], [2, `foot_${s}`]] as const) {
        const di = w.body.dofByName(name, ax);
        if (di < 0) continue;
        const d = w.body.dofs[di]!;
        const damp = -Math.max(1, Math.min(20, d.tauMax * 0.02)) * d.vel;
        if (Math.abs(damp) > 1e-6) propose({ dof: di, kind: 'ext', pri: PRI.servo, tau: damp, src: `shankIso.damp.${name}.${ax}`, channel: 'passive' });
      }
      continue;
    }
    pd(w, `knee_${s}`, 1, q.knee1, 180, 10, 40);
    const extSign = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SQC_ISO_EXT_SIGN ?? 1);
    pd(w, `knee_${s}`, 2, q.knee2 + extSign * fc.legExtend, 260, 16, 70);
    pd(w, `foot_${s}`, 0, q.foot0 - 0.05 * fc.copErrorZ, 140, 10, 45);
    pd(w, `foot_${s}`, 1, q.foot1, 100, 8, 35);
    pd(w, `foot_${s}`, 2, q.foot2, 180, 12, 60);
    // 脚抓地时，脚底 z 也回到初始位置
    const fi = w.body.dofByName(`foot_${s}`, 0);
    const fb = w.body.bodies[w.body.indexByKey.get(`foot_${s}`)!]!;
    if (fi >= 0 && w.body.footNormalForce(s, w.dt) > 20) {
      const f = fb.translation(), v = fb.linvel();
      const tau = Math.max(-40, Math.min(40, -3000 * (f.z - q.footZ) - 200 * v.z));
      propose({ dof: fi, kind: 'ext', pri: PRI.reflex, tau, src: `shankIso.footZ.${s}`, channel: 'support' });
    }
  }
}
