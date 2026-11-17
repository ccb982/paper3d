import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const T = Number(process.env.T_END ?? 1.2);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const ci = (n: string, a: number): number => w.body.dofByName(n, a);
const kiL = ci('knee_l', 2);
const kiR = ci('knee_r', 2);
const hiL = ci('hip_l', 2);
const hiR = ci('hip_r', 2);
const ang = (i: number): number => i >= 0 ? w.body.dofs[i]!.angle * 57.2958 : 0;
const vel = (i: number): number => i >= 0 ? w.body.dofs[i]!.vel : 0;
const tau = (i: number): number => i >= 0 ? w.executor.ledger[i]?.applied ?? 0 : 0;
console.log('t mode kneeL kneeR kneeVL kneeVR tauKL tauKR hipL hipR sp1Z sp1X sp2Z sp2X sp3Z sp3X fzL fzR y');
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
for (let k = 0; k < Math.round(T / w.dt); k++) {
  supportClean(stepCtx, 'r');
  supportClean(stepCtx, 'l');
  w.advance(1);
  if (k % Math.round(0.02 / w.dt) !== 0) continue;
  const t = w.clock;
  const fzL = w.body.footNormalForce('l', w.dt);
  const fzR = w.body.footNormalForce('r', w.dt);
  const y = w.body.bodies[w.body.indexByKey.get('spine4') ?? 0]!.translation().y;
  const sp = (n: string, a: number): number => { const i = w.body.dofByName(n, a); return i >= 0 ? w.body.dofs[i]!.angle * 57.2958 : 0; };
  console.log(
    `${t.toFixed(3)} ${process.env.V3_LOWER_CMD ?? '0'} ${ang(kiL).toFixed(2)} ${ang(kiR).toFixed(2)} ${vel(kiL).toFixed(2)} ${vel(kiR).toFixed(2)} ${tau(kiL).toFixed(0)} ${tau(kiR).toFixed(0)} ${ang(hiL).toFixed(2)} ${ang(hiR).toFixed(2)} ${sp('spine1',2).toFixed(1)} ${sp('spine1',0).toFixed(1)} ${sp('spine2',2).toFixed(1)} ${sp('spine2',0).toFixed(1)} ${sp('spine3',2).toFixed(1)} ${sp('spine3',0).toFixed(1)} ${fzL.toFixed(0)} ${fzR.toFixed(0)} ${y.toFixed(3)}`,
  );
}
