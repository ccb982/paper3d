import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

if (process.env.SQC_WBC === undefined) process.env.SQC_WBC = 'shadow';
if (process.env.SQC_WBC_HZ === undefined) process.env.SQC_WBC_HZ = '15';
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
const f2 = w.body.dofByName('foot_l', 2);
const h2 = w.body.dofByName('hip_l', 2);
let hipY0 = -1;
let maxHipRise = 0;
let maxFootV = 0;
let last = -1;
let dumped = false;
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = court.t;
  const hy = w.body.dofs[h2]!.anchorWorld[1]!;
  if (hipY0 < 0) hipY0 = hy;
  maxHipRise = Math.max(maxHipRise, hy - hipY0);
  maxFootV = Math.max(maxFootV, Math.abs(w.body.dofs[f2]!.vel));
  if (!dumped && process.env.SQC_QP_DUMP === '1' && t >= 1.98) {
    dumped = true;
    const wb = (globalThis as { __WBC?: unknown }).__WBC;
    const q = (globalThis as { __WBC2?: unknown }).__WBC2;
    console.log('DUMP', JSON.stringify({ wb, q }));
  }
  if (t > court.settle - 0.02 && t - last >= 0.1) {
    last = t;
    const g = globalThis as { __WBC2?: { t: number; mode: string; ok: boolean; maxViol: number; qddMax: number; tauMax: number; slackMax: number; sTauMax: number; sJointMax: number; iters: number; prim: number; dual: number; ms: number; fL: number[]; fR: number[] } };
    const q = g.__WBC2;
    const c = ctl.sensors.com;
    console.log(`WS t=${t.toFixed(2)} fall=${court.fall >= 0 ? court.fall.toFixed(2) : '-'} comY=${(c[1]! * 100).toFixed(1)} hipY=${(hy * 100).toFixed(1)} maxHipRise=${(maxHipRise * 100).toFixed(1)} foot2V=${w.body.dofs[f2]!.vel.toFixed(1)} maxFootV=${maxFootV.toFixed(1)}${q ? ` wbc[${q.mode}] ok=${q.ok ? 1 : 0} viol=${q.maxViol.toExponential(1)} qdd=${q.qddMax.toFixed(0)} qddJ=${q.qddJointMax.toFixed(0)} tau=${q.tauMax.toFixed(0)} slack=${q.slackMax.toExponential(1)} it=${q.iters} prim=${q.prim.toExponential(1)} dual=${q.dual.toExponential(1)} ms=${q.ms} fL=${q.fL.map((v) => v.toFixed(0)).join(',')} fR=${q.fR.map((v) => v.toFixed(0)).join(',')} tau=${q.tau.map((v) => v.toFixed(0)).join(',')}` : ''}`);
  }
  if (court.fall >= 0) break;
}
console.log(`DONE fall=${court.fall >= 0 ? court.fall.toFixed(3) : 'none'} maxHipRise=${(maxHipRise * 100).toFixed(1)}cm maxFootV=${maxFootV.toFixed(1)}`);
