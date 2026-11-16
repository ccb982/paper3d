import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
process.env.SQC_SQUAT_DBG = '1';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
const app = (n: string, a: number): number => {
  const i = w.body.dofByName(n, a);
  return i >= 0 ? w.executor.ledger[i]!.applied : 0;
};
let last = -1;
for (let s = 0; s < Math.round(2.9 / w.dt); s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (!court.released || court.t < 1.98 || court.t > 2.60) continue;
  if (court.t - last < 0.05 - 1e-9) continue;
  last = court.t;
  const g = globalThis as { __SQUAT_DBG?: Record<string, Record<string, number>> };
  const d = g.__SQUAT_DBG?.l;
  const dr = g.__SQUAT_DBG?.r;
  if (!d || !dr) continue;
  const fzL = w.body.footNormalForce('l', w.dt);
  const fzR = w.body.footNormalForce('r', w.dt);
  console.log(
    `${court.t.toFixed(2)} fm=${d.forceMode ? 1 : 0} on=${d.hipForceOn} ` +
    `diff=${d.loadDiff.toFixed(0)}/${dr.loadDiff.toFixed(0)} ff=${d.hipForceFf.toFixed(1)}/${dr.hipForceFf.toFixed(1)} ` +
    `fz=${fzL.toFixed(0)}/${fzR.toFixed(0)} err=${(343 - fzL).toFixed(0)}/${(343 - fzR).toFixed(0)} ` +
    `h0T=${(d.hip0T * 57.3).toFixed(1)}/${(dr.hip0T * 57.3).toFixed(1)} ` +
    `h0app=${app('hip_l', 0).toFixed(1)}/${app('hip_r', 0).toFixed(1)} fall=${court.fall.toFixed(2)}`,
  );
  if (court.fall >= 0) break;
}
