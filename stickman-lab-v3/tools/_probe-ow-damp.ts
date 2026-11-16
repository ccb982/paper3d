import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

process.env.V3_AR_MODE = 'assist';
process.env.SQC_PD_DBG = '1';
const T_END = Number(process.env.T_END ?? 6.0);
const T_IMP = Number(process.env.T_IMP ?? 2.1);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
let court: CourtState | null = squatCourtSetup(w, ctl, 2.0);
const torsoIdx = w.body.indexByKey.get('torso')!;
const names = ['hip_l/2', 'hip_r/2', 'knee_l/2', 'knee_r/2', 'foot_l/2', 'foot_r/2'];
const stat = new Map(names.map((n) => [n, { active: 0, maxOw: 0, maxWin: 0, maxHold: 0 }]));
let fired = false;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(stepCtx, 'r');
  supportClean(stepCtx, 'l');
  w.advance(1);
  if (court) squatFrame(w, ctl, court);
  const t = court ? court.t : w.clock;
  if (!fired && t >= T_IMP) {
    w.body.bodies[torsoIdx]!.applyImpulse({ x: 0, y: 0, z: 2 }, true);
    fired = true;
  }
  const parts = (globalThis as { __PD_PARTS?: Record<string, Record<string, number>> }).__PD_PARTS ?? {};
  for (const n of names) {
    const p = parts[n];
    if (!p) continue;
    const s0 = stat.get(n)!;
    const ow = Math.abs(p.owDamp ?? 0);
    if (ow > 1e-6) s0.active++;
    s0.maxOw = Math.max(s0.maxOw, ow);
    s0.maxWin = Math.max(s0.maxWin, p.owWin ?? 0);
    s0.maxHold = Math.max(s0.maxHold, p.owHold ?? 0);
  }
  if (court && court.fall >= 0 && t >= court.fall + 0.05) break;
}
for (const [n, s0] of stat) {
  console.log(`${n} active=${s0.active} maxOw=${s0.maxOw.toFixed(2)} maxWin=${s0.maxWin.toFixed(2)} maxHold=${s0.maxHold.toFixed(3)}`);
}
console.log(`RESULT fall=${court && court.fall >= 0 ? `${Math.max(0, court.fall - court.settle).toFixed(3)}s ${court.reason}` : 'none'}`);
