import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const MODE = String(process.env.V3_SQUAT_CMD ?? '1');
const T = Number(process.env.T_END ?? 3.8);
const w = new World(); const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false; w.controller = ctl; w.reset(); w.switchPoseState('stand');
ctl.actions.play('squatDown');
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const man = ctl.manual as unknown as { angle: Float64Array; torque: Float64Array };
const di = (n: string, a: number): number => w.body.dofByName(n, a);
const ids = { h: di('hip_l',2), k: di('knee_l',2), f: di('foot_l',2), h0: di('hip_l',0), k0: di('knee_l',0), f0: di('foot_l',0), s1: di('spine1',2) };
const f = (v: number | undefined, n = 1): string => (Number.isFinite(v as number) ? (v as number).toFixed(n) : '-');
const q = (i: number): number => MODE === '1' ? (globalThis as any).__SQD_CMD?.qRef?.[i] : man.angle[i];
const tq = (i: number): number => MODE === '1' ? ((globalThis as any).__SQD_CMD?.tauGravity?.[i] ?? 0) + ((globalThis as any).__SQD_CMD?.ff?.[i] ?? 0) : (man.torque[i] ?? 0);
console.log('mode t p hipT hipA kneeT kneeA footT footA hip0T hip0A knee0T knee0A foot0T foot0A sp1T sp1A tauH tauK tauF fzL fzR');
for (let i = 0; i < Math.round(T / w.dt); i++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l'); w.advance(1);
  const t = w.clock;
  if (t < 2.0 || t > 2.6) continue;
  if (i % Math.round(0.05 / w.dt) !== 0) continue;
  const g = (globalThis as any).__SQD_DBG;
  const fzL = w.body.footNormalForce('l', w.dt), fzR = w.body.footNormalForce('r', w.dt);
  console.log(`${MODE} ${t.toFixed(2)} ${f(g?.p,3)} ${f(q(ids.h)*57.3)} ${f(w.body.dofs[ids.h]!.angle*57.3)} ${f(q(ids.k)*57.3)} ${f(w.body.dofs[ids.k]!.angle*57.3)} ${f(q(ids.f)*57.3)} ${f(w.body.dofs[ids.f]!.angle*57.3)} ${f(q(ids.h0)*57.3)} ${f(w.body.dofs[ids.h0]!.angle*57.3)} ${f(q(ids.k0)*57.3)} ${f(w.body.dofs[ids.k0]!.angle*57.3)} ${f(q(ids.f0)*57.3)} ${f(w.body.dofs[ids.f0]!.angle*57.3)} ${f(q(ids.s1)*57.3)} ${f(w.body.dofs[ids.s1]!.angle*57.3)} ${f(tq(ids.h),0)} ${f(tq(ids.k),0)} ${f(tq(ids.f),0)} ${f(fzL,0)} ${f(fzR,0)}`);
}
