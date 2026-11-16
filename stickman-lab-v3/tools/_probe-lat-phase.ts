import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import type { AssistSnapshot } from '../src/core/servo/assistRighting';
import type { PredictionState } from '../src/core/prediction/predictionLayer';

process.env.V3_AR_MODE = 'assist';
const T_END = Number(process.env.T_END ?? 5.0);
const T_IMP = Number(process.env.T_IMP ?? 2.1);
const J = Number(process.env.J ?? 2);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const torsoIdx = w.body.indexByKey.get('torso')!;
let fired = false;
let lastPrint = -1;
const f = (v: number, n = 3): string => (Number.isFinite(v) ? v.toFixed(n) : '∞');
console.log('t comZ vZ xi xiP tgt phase scale | fzL fzR copZ | rootEz rootAz rootG | cmdScale');
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(stepCtx, 'r');
  supportClean(stepCtx, 'l');
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (!fired && t >= T_IMP) {
    w.body.bodies[torsoIdx]!.applyImpulse({ x: 0, y: 0, z: J }, true);
    fired = true;
    console.log(`IMPULSE t=${t.toFixed(3)} Jz=${J}`);
  }
  if (t - lastPrint < 0.1 - 1e-9) continue;
  lastPrint = t;
  const p = (globalThis as { __PRED?: PredictionState }).__PRED;
  const gx = (globalThis as { __LAT_XI?: number; __LAT_PHASE?: string; __LAT_SCALE?: number });
  const ar = (globalThis as { __V3_AR?: AssistSnapshot }).__V3_AR;
  const fzL = ctl.perception.feet[0]!.fz;
  const fzR = ctl.perception.feet[1]!.fz;
  const fzSum = Math.max(1e-6, fzL + fzR);
  const copZ = (fzL * ctl.perception.feet[0]!.copZ + fzR * ctl.perception.feet[1]!.copZ) / fzSum;
  const cmdScale = gx.__LAT_SCALE ?? NaN;
  const dbg = (globalThis as { __PRED_TICK?: number; __PRED_LAST?: number; __PRED_DT?: number });
  console.log(
    `${t.toFixed(2)} tick=${dbg.__PRED_TICK ?? 0} dt=${f(dbg.__PRED_DT ?? NaN,4)} last=${f(dbg.__PRED_LAST ?? NaN,3)} pT=${f(p?.t ?? NaN,2)} z=${f(p?.now.z ?? NaN)} v=${f(p?.now.vz ?? NaN)} gx=${f(gx.__LAT_XI ?? NaN)} ${f(ctl.sensors.com[2]!)} ${f(ctl.sensors.comVel[2]!)} ${f(p?.lateralXi ?? NaN)} ${f(p?.lateralXiPred ?? NaN)} ${f(p?.targetZ ?? NaN)} ${p?.lateralPhase ?? '-'} ${f(p?.lateralScale ?? NaN, 2)} | ` +
    `${f(fzL, 0)} ${f(fzR, 0)} ${f(copZ)} | ${f(ar?.root.ez ?? NaN)} ${f(ar?.root.az ?? NaN)} ${f(ar?.root.gain ?? NaN, 2)} | ${f(cmdScale, 2)}`,
  );
  if (court && court.fall >= 0 && t >= court.fall + 0.1) break;
}
console.log(`RESULT fall=${court && court.fall >= 0 ? `${Math.max(0, court.fall - court.settle).toFixed(3)}s ${court.reason}` : 'none'}`);
