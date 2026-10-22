import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { allocateLateralLoad } from '../src/core/servo/lateralLoadAllocator';

const J = Number(process.env.J ?? 2);
const T_IMP = Number(process.env.T_IMP ?? 2.1);
const DLOAD = Number(process.env.DLOAD ?? 90);
const HOLD = Number(process.env.HOLD ?? 0.2);
const T_END = Number(process.env.T_END ?? 5.0);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const torsoIdx = w.body.indexByKey.get('torso')!;
const alloc = allocateLateralLoad(DLOAD);
const kl = w.body.dofByName('knee_l', 2);
const kr = w.body.dofByName('knee_r', 2);
const hl = w.body.dofByName('hip_l', 2);
const hr = w.body.dofByName('hip_r', 2);
let fired = false;
let last = -1;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (!fired && t >= T_IMP) {
    w.body.bodies[torsoIdx]!.applyImpulse({ x: 0, y: 0, z: J }, true);
    fired = true;
  }
  if (fired && t <= T_IMP + HOLD) {
    if (kl >= 0) w.executor.addTorque(kl, alloc.knee2);
    if (kr >= 0) w.executor.addTorque(kr, -alloc.knee2);
    if (hl >= 0) w.executor.addTorque(hl, alloc.hip2);
    if (hr >= 0) w.executor.addTorque(hr, -alloc.hip2);
  }
  if (t - last >= 0.1 - 1e-9) {
    last = t;
    const L = w.lateral.state;
    console.log(`t=${t.toFixed(2)} com=${(L.comZ * 1000).toFixed(1)} v=${(L.comVelZ * 1000).toFixed(0)} cop=${(L.copZ * 1000).toFixed(1)} load=${L.loadDiff.toFixed(0)} fall=${court && court.fall >= 0 ? court.fall.toFixed(2) : '-'}`);
  }
  if (court && court.fall >= 0 && t >= court.fall + 0.1) break;
}
console.log(`RESULT J=${J} DLOAD=${DLOAD} HOLD=${HOLD} fall=${court && court.fall >= 0 ? `${court.fall.toFixed(3)} ${court.reason}` : 'none'}`);
