import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { allocateLateralLoad } from '../src/core/servo/lateralLoadAllocator';

const DLOAD = Number(process.env.DLOAD ?? 60);
const T_IMP = Number(process.env.T_IMP ?? 2.2);
const HOLD = Number(process.env.HOLD ?? 0.5);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const HIPS = Number(process.env.HIPS ?? 0.5);
const alloc = allocateLateralLoad(DLOAD, { hipShare: HIPS });
const kl = w.body.dofByName('knee_l', 2);
const kr = w.body.dofByName('knee_r', 2);
const hl = w.body.dofByName('hip_l', 2);
const hr = w.body.dofByName('hip_r', 2);

let sumL = 0, sumR = 0, n = 0;
for (let s = 0; s < Math.round(2.8 / w.dt); s++) {
  const t0 = w.clock;
  w.advance(1, () => {
    if (t0 < T_IMP || t0 > T_IMP + HOLD) return;
    if (kl >= 0) w.executor.addTorque(kl, alloc.knee2);
    if (kr >= 0) w.executor.addTorque(kr, -alloc.knee2);
    if (hl >= 0) w.executor.addTorque(hl, alloc.hip2);
    if (hr >= 0) w.executor.addTorque(hr, -alloc.hip2);
  });
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (t >= 2.5 && t <= 2.7) {
    sumL += w.body.footNormalForce('l', w.dt);
    sumR += w.body.footNormalForce('r', w.dt);
    n++;
  }
}
const fzL = sumL / Math.max(1, n), fzR = sumR / Math.max(1, n);
console.log(`RESULT DLOAD=${DLOAD} hips=${HIPS} knee2=${alloc.knee2.toFixed(2)} hip2=${alloc.hip2.toFixed(2)} pred=${alloc.achieved.toFixed(1)} residual=${alloc.residual.toFixed(1)} actual=${(fzL - fzR).toFixed(1)} total=${(fzL + fzR).toFixed(1)} fzL=${fzL.toFixed(1)} fzR=${fzR.toFixed(1)}`);
