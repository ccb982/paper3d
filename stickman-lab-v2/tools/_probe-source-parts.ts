import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const STIM = (process.env.STIM ?? 'push').trim();
const TARGET = (process.env.TARGET ?? 'torso').trim();
const J = Number(process.env.J ?? 1);
const T_IMP = Number(process.env.T_IMP ?? 2.6);
const T_END = Number(process.env.T_END ?? 2.7);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const ti = w.body.indexByKey.get(TARGET);
const fl = w.body.indexByKey.get('foot_l');
const fr = w.body.indexByKey.get('foot_r');

let fired = false;
let calibrated2 = false;
let tFire = 0;
let baseTaken = false;
let baseScores: Record<string, number> = {};
let firstPart = -1;
let firstLatency = 0;
let sourceCaptured = false;
let firedPart = 'none';
let firedSource = 'none';
let firedDir = 0;
let firedScore = 0;
let firedLoad = 0;
let firedDf = 0;
let firedSlip = false;
let firedSupport = 'none';
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (!calibrated2 && t >= T_IMP - 0.4) { w.lateral.calibrate(); calibrated2 = true; }
  if (!baseTaken && t >= T_IMP - 0.02) {
    baseScores = {};
    for (const k of Object.keys(w.lateral.parts)) baseScores[k] = w.lateral.parts[k]!.score;
    baseTaken = true;
  }
  if (!fired && t >= T_IMP) {
    fired = true;
    tFire = w.clock;
    if (STIM === 'ground') {
      if (fl !== undefined) w.body.bodies[fl]!.applyImpulse({ x: 0, y: J, z: 0 }, true);
      if (fr !== undefined) w.body.bodies[fr]!.applyImpulse({ x: 0, y: J, z: 0 }, true);
    } else if (ti !== undefined && STIM !== 'load') {
      w.body.bodies[ti]!.applyImpulse({ x: 0, y: 0, z: J }, true);
    }
  }
  const dt = w.clock - tFire;
  if (fired && STIM === 'load' && dt >= 0 && dt <= 0.2 && ti !== undefined) {
    w.body.bodies[ti]!.applyImpulse({ x: 0, y: J * w.dt, z: 0 }, true);
  }
  if (fired && dt >= 0.05 && !sourceCaptured) {
    const L = w.lateral.state;
    firedSource = L.source;
    firedLoad = L.loadDiff;
    firedDf = L.dHatHPZ;
    firedSlip = w.perception.feet[0]!.slip || w.perception.feet[1]!.slip;
    firedSupport = w.perception.support;
    sourceCaptured = true;
  }
  if (fired && dt >= 0 && dt <= 0.10 && firstPart < 0) {
    const L = w.lateral.state;
    for (const k of Object.keys(w.lateral.parts)) {
      const sc = w.lateral.parts[k]!.score - (baseScores[k] ?? 0);
      if (sc > 0.8) {
        firstPart = 1;
        firstLatency = dt * 1000;
        firedPart = k;
        firedSource = L.source;
        firedDir = Math.sign(w.lateral.parts[k]!.vzRel) || L.partDirection;
        firedScore = w.lateral.parts[k]!.score;
        firedLoad = L.loadDiff;
        firedDf = L.dHatHPZ;
        firedSlip = w.perception.feet[0]!.slip || w.perception.feet[1]!.slip;
        firedSupport = w.perception.support;
        break;
      }
    }
  }
}
console.log(`RESULT STIM=${STIM} TARGET=${TARGET} J=${J} source=${firedSource} part=${firedPart} dir=${firedDir} lat=${firstLatency.toFixed(1)}ms score=${firedScore.toFixed(2)} loadDiff=${firedLoad.toFixed(0)} dHat=${firedDf.toFixed(0)} slip=${firedSlip} support=${firedSupport}`);
console.log(`  fall=${court && court.fall >= 0 ? `${court.fall.toFixed(3)}s ${court.reason}` : 'none'}`);
