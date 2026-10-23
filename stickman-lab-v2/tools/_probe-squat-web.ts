import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits, type CourtState } from '../src/core/servo/squat';

const SEEDS = Number(process.env.SEEDS ?? 5);
const T_END = Number(process.env.T_END ?? 15);
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
for (let seed = 1; seed <= SEEDS; seed++) {
  Math.random = mulberry32(seed * 100 + 1);
  (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
  w.controller = ctl;
  w.reset();
  ctl.actions.idleEnabled = true;
  const tPre = Number(process.env.TPRE ?? (0.8 + Math.random() * 4.0));
  for (let s = 0; s < Math.round(tPre / w.dt); s++) w.advance(1);
  ctl.actions.abort();
  ctl.actions.idleEnabled = false;
  ctl.manual.clear();
  w.controller = ctl;
  w.driveEnabled = true;
  w.reset();
  ctl.resetCourt();
  squatResetLimits(w);
  const court: CourtState = squatCourtSetup(w, ctl, 2.0);
  for (let s = 0; s < Math.round(T_END / w.dt); s++) {
    w.advance(1);
    squatFrame(w, ctl, court);
    if (court.fall >= 0) break;
  }
  console.log(`WEBSEED seed=${seed} tPre=${tPre.toFixed(2)} fall=${court.fall >= 0 ? (court.fall - court.settle).toFixed(3) : 'none'}`);
}
