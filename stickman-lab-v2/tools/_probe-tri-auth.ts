import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { estimateSquatTaskState } from '../src/core/servo/squatArch';

const J = Number(process.env.J ?? 0.5);
const T_IMP = Number(process.env.T_IMP ?? 4.0);
const T_END = Number(process.env.T_END ?? 8.0);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
const court: CourtState = squatCourtSetup(w, ctl, 2.0);
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const torso = w.body.indexByKey.get('torso')!;
let fired = false;
let peakHip = 0;
let peakLoad = 0;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  const t = court.t;
  if (!fired && t >= T_IMP) {
    w.body.bodies[torso]!.applyImpulse({ x: 0, y: 0, z: J }, true);
    fired = true;
    console.log(`IMPULSE t=${t.toFixed(2)} J=${J}`);
  }
  supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const st = estimateSquatTaskState(w);
  peakHip = Math.max(peakHip, Math.abs(st.hipErrZ));
  peakLoad = Math.max(peakLoad, Math.abs(st.loadL - st.loadR));
  if (court.fall >= 0) break;
}
console.log(`AUTH J=${J} tri=${process.env.SQC_HIP_TRI ?? '0'} peakHip=${(peakHip * 1000).toFixed(1)}mm peakLoad=${(peakLoad * 100).toFixed(0)}% fall=${court.fall >= 0 ? court.fall.toFixed(2) : 'none'}`);
