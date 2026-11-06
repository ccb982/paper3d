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
  const g = globalThis as { __SQC_MODE?: string };
  console.log(`t=${court.t.toFixed(2)} mode=${g.__SQC_MODE ?? '-'} comZ=${(ctl.sensors.com[2]! * 100).toFixed(1)} fz=${ctl.sensors.feet[0]!.fz.toFixed(0)}/${ctl.sensors.feet[1]!.fz.toFixed(0)}`);
  if (court.fall >= 0) break;
}
console.log(`END t=${court.t.toFixed(2)} fall=${court.fall >= 0 ? court.fall.toFixed(2) : 'none'}`);
