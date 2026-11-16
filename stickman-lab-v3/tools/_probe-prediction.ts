import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

process.env.V3_AR_MODE = process.env.V3_AR_MODE ?? 'monitor';
const T_END = Number(process.env.T_END ?? 4.0);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
let lastPrint = -1;
console.log('t comX comZ vX vZ copX copZ xiX xiZ predXiX predXiZ over targetX targetZ brakeX brakeZ err');
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (t - lastPrint < 0.1 - 1e-9) continue;
  lastPrint = t;
  const p = ctl.prediction.get();
  const n = p.now;
  const h = p.horizon[p.horizon.length - 1] ?? n;
  const f = (v: number): string => v.toFixed(3);
  console.log(
    `${t.toFixed(2)} ${f(n.x)} ${f(n.z)} ${f(n.vx)} ${f(n.vz)} ${f(n.copX)} ${f(n.copZ)} ${f(n.xiX)} ${f(n.xiZ)} ${f(h.xiX)} ${f(h.xiZ)} ${f(p.overshoot)} ${f(p.targetX)} ${f(p.targetZ)} ${f(p.brakeX)} ${f(p.brakeZ)} ${f(p.modelError)}`,
  );
  if (court && court.fall >= 0 && t >= court.fall + 0.1) break;
}
console.log(`RESULT fall=${court && court.fall >= 0 ? `${Math.max(0, court.fall - court.settle).toFixed(3)}s ${court.reason}` : 'none'}`);
