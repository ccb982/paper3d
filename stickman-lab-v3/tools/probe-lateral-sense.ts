import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const J = Number(process.env.J ?? 1);
const T_IMP = Number(process.env.T_IMP ?? 2.30);
const T_END = Number(process.env.T_END ?? 3.20);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const torsoIdx = w.body.indexByKey.get('torso')!;

let pushed = false;
let tPush = 0;
let firstOnset = -1;
let restFrames = 0;
let restAlarms = 0;
let peakScore = 0;
let peakDf = 0;
let peakVel = 0;

console.log(`probe-lateral-sense J=${J}Ns tImp=${T_IMP}`);
console.log('t      comZ(mm) vZ(mm/s) copZ(mm) xiZ(mm) dFzHP(N) loadDiff(N) roll(deg) score  onset');
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (!pushed && t >= T_IMP) {
    w.body.bodies[torsoIdx]!.applyImpulse({ x: 0, y: 0, z: J }, true);
    pushed = true;
    tPush = w.clock;
    console.log(`IMPULSE t=${t.toFixed(3)} Jz=${J}`);
  }
  const L = w.lateral.state;
  if (!pushed) {
    restFrames++;
    if (L.onset) restAlarms++;
  } else {
    if (firstOnset < 0 && L.onset) firstOnset = w.clock;
    peakScore = Math.max(peakScore, L.changeScore);
    peakDf = Math.max(peakDf, Math.abs(L.dHatHPZ));
    peakVel = Math.max(peakVel, Math.abs(L.comVelZ));
  }
  if (pushed && w.clock - tPush < 0.10) {
    console.log(
      `${t.toFixed(3)} ${(L.comZ * 1000).toFixed(1).padStart(7)} ${(L.comVelZ * 1000).toFixed(0).padStart(7)} ` +
      `${(L.copZ * 1000).toFixed(1).padStart(7)} ${(L.xiZ * 1000).toFixed(1).padStart(7)} ` +
      `${L.dHatHPZ.toFixed(0).padStart(7)} ${L.loadDiff.toFixed(0).padStart(10)} ` +
      `${(L.roll * 57.3).toFixed(2).padStart(7)} ${L.changeScore.toFixed(2).padStart(5)}  ${L.onset ? 'Y' : '-'}`,
    );
  }
  if (!pushed && s % Math.round(0.1 / w.dt) === 0) {
    console.log(
      `${t.toFixed(3)} ${(L.comZ * 1000).toFixed(1).padStart(7)} ${(L.comVelZ * 1000).toFixed(0).padStart(7)} ` +
      `${(L.copZ * 1000).toFixed(1).padStart(7)} ${(L.xiZ * 1000).toFixed(1).padStart(7)} ` +
      `${L.dHatHPZ.toFixed(0).padStart(7)} ${L.loadDiff.toFixed(0).padStart(10)} ` +
      `${(L.roll * 57.3).toFixed(2).padStart(7)} ${L.changeScore.toFixed(2).padStart(5)}  ${L.onset ? 'Y' : '-'}`,
    );
  }
  if (court && court.fall >= 0 && t >= court.fall + 0.5) break;
}
const lat = firstOnset > 0 && tPush > 0 ? (firstOnset - tPush) * 1000 : -1;
console.log(`RESULT J=${J}Ns restAlarms=${restAlarms}/${restFrames} (${(100 * restAlarms / Math.max(1, restFrames)).toFixed(1)}%)`);
console.log(`  firstOnset=${lat < 0 ? 'none' : `${lat.toFixed(1)}ms`} peakScore=${peakScore.toFixed(2)} peakDf=${peakDf.toFixed(0)}N peakVel=${(peakVel * 1000).toFixed(0)}mm/s`);
console.log(`  fall=${court && court.fall >= 0 ? `${court.fall.toFixed(3)}s ${court.reason}` : 'none'}`);
