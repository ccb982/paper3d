import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const J = Number(process.env.J ?? 1);
const T_IMP = Number(process.env.T_IMP ?? 2.4);
const T_END = Number(process.env.T_END ?? 3.6);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const ti = w.body.indexByKey.get('torso')!;

let fired = false;
let tFire = 0;
let peakPos = 0;
let peakNeg = 0;
let peakZ = -Infinity;
let minZ = Infinity;
let firstReversal = -1;
let brakingFrames = 0;
let totalFrames = 0;
let overshoot = 0;
let prevVel = 0;

for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (!fired && t >= T_IMP) {
    w.body.bodies[ti]!.applyImpulse({ x: 0, y: 0, z: J }, true);
    fired = true;
    tFire = w.clock;
  }
  if (!fired) continue;
  const L = w.lateral.state;
  const dt = w.clock - tFire;
  if (dt < 0 || dt > 1.0) continue;
  totalFrames++;
  if (L.comVelZ > peakPos) peakPos = L.comVelZ;
  if (L.comVelZ < peakNeg) peakNeg = L.comVelZ;
  if (L.comZ > peakZ) peakZ = L.comZ;
  if (L.comZ < minZ) minZ = L.comZ;
  if (firstReversal < 0 && L.reversed) firstReversal = dt;
  if (L.braking) brakingFrames++;
  overshoot = Math.max(overshoot, L.overshoot);
  prevVel = L.comVelZ;
  if (dt < 0.12 && Math.round(dt / w.dt) % 4 === 0) {
    console.log(`t=${t.toFixed(3)} z=${(L.comZ * 1000).toFixed(2)} v=${(L.comVelZ * 1000).toFixed(1)} dF=${L.dHatHPZ.toFixed(0)} mdir=${L.motionDir} spd=${(L.motionSpeed * 1000).toFixed(1)} fdir=${L.forceDir} dot=${L.forceMotionDot} brake=${L.braking ? 'Y' : '-'} rev=${L.reversed ? 'Y' : '-'} over=${(L.overshoot * 1000).toFixed(1)}`);
  }
}
console.log(`RESULT J=${J} peak+vel=${(peakPos * 1000).toFixed(1)}mm/s peak-vel=${(peakNeg * 1000).toFixed(1)}mm/s peakZ=${(peakZ * 1000).toFixed(2)}mm minZ=${(minZ * 1000).toFixed(2)}mm firstReversal=${firstReversal < 0 ? 'none' : `${(firstReversal * 1000).toFixed(0)}ms`} braking=${(100 * brakingFrames / Math.max(1, totalFrames)).toFixed(0)}% overshoot=${(overshoot * 1000).toFixed(2)}mm`);
console.log(`  fall=${court && court.fall >= 0 ? `${court.fall.toFixed(3)}s ${court.reason}` : 'none'}`);
