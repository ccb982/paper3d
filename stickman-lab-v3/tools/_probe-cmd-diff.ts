import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const T = Number(process.env.T_END ?? 4);
const w = new World(); const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false; w.controller = ctl; w.reset(); w.switchPoseState('stand');
ctl.actions.play('squatDown');
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const di = (n: string, a: number): number => w.body.dofByName(n, a);
const k = di('knee_l', 2), h = di('hip_l', 2), s1 = di('spine1', 2);
const f = (v: number, n = 1): string => (Number.isFinite(v) ? v.toFixed(n) : '-');
console.log('t phase kneeTgt kneeQ kneeTau kneeKp hipTgt hipQ hipTau sp1Tgt sp1Tau fzL fzR');
for (let i = 0; i < Math.round(T / w.dt); i++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l'); w.advance(1);
  const t = w.clock; if (t < 1.9 || t > 4.0) continue;
  if (i % Math.round(0.1 / w.dt) !== 0) continue;
  const cmd = (globalThis as { __SQD_CMD?: { qRef: Float64Array; kp?: Float64Array } }).__SQD_CMD;
  const q = (idx: number): number => cmd ? cmd.qRef[idx]! : NaN;
  const tau = (idx: number): number => w.executor.ledger[idx]?.applied ?? 0;
  const fzL = w.body.footNormalForce('l', w.dt), fzR = w.body.footNormalForce('r', w.dt);
  console.log(`${t.toFixed(2)} ${ctl.actions.status.phase ?? '-'} ${f(q(k)*57.3)} ${f(w.body.dofs[k]!.angle*57.3)} ${f(tau(k),0)} ${f(cmd?.kp?.[k] ?? 0,0)} ${f(q(h)*57.3)} ${f(w.body.dofs[h]!.angle*57.3)} ${f(tau(h),0)} ${f(q(s1)*57.3)} ${f(tau(s1),0)} ${f(fzL,0)} ${f(fzR,0)}`);
}
