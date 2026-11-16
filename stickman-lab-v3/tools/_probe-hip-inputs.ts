import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
let last = -1;
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (!court.released || court.t - last < 0.1) continue;
  last = court.t;
  const h = (globalThis as { __HIP_INPUTS?: Record<string, number> }).__HIP_INPUTS;
  const com = ctl.sensors.com;
  const vel = ctl.sensors.comVel;
  const f0 = ctl.sensors.feet[0]!, f1 = ctl.sensors.feet[1]!;
  const g = 9.81;
  const comY = com[1]!;
  const xcomTrue = com[2]! + vel[2]! * Math.sqrt(Math.max(0.3, comY) / g);
  const cop = (f0.fz + f1.fz) > 1e-6 ? (f0.fz * (f0.copValid ? f0.copZ : com[2]!) + f1.fz * (f1.copValid ? f1.copZ : com[2]!)) / (f0.fz + f1.fz) : com[2]!;
  const f = (v: unknown): string => Number.isFinite(Number(v)) ? Number(v).toFixed(3) : 'nan';
  console.log(`t=${court.t.toFixed(2)} comX=${f(com[0])} comZ=${f(com[2])} comY=${f(comY)} vZ=${f(vel[2])} fz=${f0.fz.toFixed(0)}/${f1.fz.toFixed(0)} copZ=${f(cop)}`);
  console.log(`  eSag=${f(h?.eSag)} eLat=${f(h?.eLat)} eLoad=${f(h?.eLoad)} eH=${f(h?.eH)} xcomInput=${f(h?.xcomZ)} xcomTrue=${f(xcomTrue)}`);
  if (court.fall >= 0) break;
}
console.log(`END t=${court.t.toFixed(2)} fall=${court.fall >= 0 ? court.fall.toFixed(2) : 'none'}`);
