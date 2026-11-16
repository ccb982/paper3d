import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';

const J = Number(process.env.J ?? 2);
const T_IMP = Number(process.env.T_IMP ?? 2.30);
const T_END = Number(process.env.T_END ?? 3.4);
const TH = Number(process.env.TH ?? 10);

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const torsoIdx = w.body.indexByKey.get('torso')!;

let calibrated = false;
let pushed = false;
let tPush = 0;
let firstDetect = -1;
let peak = 0;
let intZ = 0;
let intX = 0;
let restN = 0;
let restSum = 0;
let restSum2 = 0;
let sample = 0;

console.log(`probe-perception J=${J}Ns tImp=${T_IMP}s th=${TH}N`);
console.log('t      dFx     dFy     dFz     dMx     dMy     dMz     fzL  fzR  contact  slip  xiZ(mm) cmpZ(mm) ttbL(ms) conf');
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (!calibrated && t >= 2.05) {
    w.perception.calibrate(96);
    calibrated = true;
  }
  if (!pushed && t >= T_IMP) {
    w.body.bodies[torsoIdx]!.applyImpulse({ x: 0, y: 0, z: J }, true);
    pushed = true;
    tPush = w.clock;
    console.log(`IMPULSE t=${t.toFixed(3)} Jz=${J}`);
  }
  const p = w.perception;
  if (!pushed) {
    restN++;
    restSum += p.dHat[2]!;
    restSum2 += p.dHat[2]! * p.dHat[2]!;
  } else {
    const dt = w.clock - tPush;
    if (dt >= 0 && dt <= 0.2) {
      intZ += p.dHatHP[2]! * w.dt;
      intX += p.dHatHP[0]! * w.dt;
    }
    if (firstDetect < 0 && Math.hypot(p.dHatHP[0]!, p.dHatHP[2]!) > TH) firstDetect = w.clock;
    peak = Math.max(peak, Math.hypot(p.dHatHP[0]!, p.dHatHP[2]!));
  }
  const around = pushed && w.clock - tPush < 0.08;
  if (around || s % Math.round(0.1 / w.dt) === 0) {
    const fzL = p.feet[0]!.fz, fzR = p.feet[1]!.fz;
    console.log(
      `${t.toFixed(3)} ` +
      `${p.dHat[0]!.toFixed(0).padStart(6)} ${p.dHat[1]!.toFixed(0).padStart(7)} ${p.dHat[2]!.toFixed(0).padStart(7)} ` +
      `${p.dHat[3]!.toFixed(0).padStart(7)} ${p.dHat[4]!.toFixed(0).padStart(7)} ${p.dHat[5]!.toFixed(0).padStart(7)} ` +
      `${fzL.toFixed(0).padStart(4)} ${fzR.toFixed(0).padStart(4)}  ${(p.feet[0]!.contact || p.feet[1]!.contact) ? 'Y' : '-'}       ` +
      `${(p.feet[0]!.slip || p.feet[1]!.slip) ? 'Y' : '-'}    ` +
      `${(p.xi[1]! * 1000).toFixed(1).padStart(7)} ${(p.cmp[1]! * 1000).toFixed(1).padStart(8)} ` +
      `${(Number.isFinite(p.feet[0]!.ttb) ? p.feet[0]!.ttb * 1000 : -1).toFixed(1).padStart(8)} ${p.confidence.toFixed(2)}`,
    );
  }
  sample++;
  if (court && court.fall >= 0 && t >= court.fall + 0.5) break;
}
const lat = firstDetect > 0 && tPush > 0 ? (firstDetect - tPush) * 1000 : -1;
const restMean = restN > 0 ? restSum / restN : 0;
const restRms = restN > 0 ? Math.sqrt(Math.max(0, restSum2 / restN - restMean * restMean)) : 0;
console.log(`RESULT J=${J}Ns  rest dFz mean=${restMean.toFixed(1)}N rms=${restRms.toFixed(1)}N`);
console.log(`  firstDetect=${lat < 0 ? 'none' : `${lat.toFixed(1)}ms`}  peak=${peak.toFixed(0)}N  intZ=${intZ.toFixed(2)}Ns  intX=${intX.toFixed(2)}Ns`);
console.log(`  fall=${court && court.fall >= 0 ? `${court.fall.toFixed(3)}s ${court.reason}` : 'none'}  samples=${sample}`);
