import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
process.env.SQC_SQUAT_DBG = '1';
process.env.SQC_HIP_LOAD_K = '0';
process.env.SQC_HIP_LOAD_FF = '0';
const STEP_K = Number(process.env.STEP_K ?? 0);
const STEP_FF = Number(process.env.STEP_FF ?? 0);
const STEP_T = Number(process.env.STEP_T ?? 2.5);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.driveEnabled = true;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
let stepped = false;
for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  if (!stepped && court.t >= STEP_T) {
    stepped = true;
    process.env.SQC_HIP_LOAD_K = String(STEP_K);
    process.env.SQC_HIP_LOAD_FF = String(STEP_FF);
  }
  squatFrame(w, ctl, court);
  if (!stepped) continue;
  const rel = court.t - STEP_T;
  if (rel < -1e-9 || rel > 0.2 + 1e-9) continue;
  if (Math.abs(rel * 100 - Math.round(rel * 100)) > 0.5) continue;
  const f0 = ctl.sensors.feet[0]!; const f1 = ctl.sensors.feet[1]!;
  const d = (globalThis as { __SQUAT_DBG?: Record<string, { hip0T?: number; hipFf?: number }> }).__SQUAT_DBG;
  const h = (globalThis as { __HIP_INPUTS?: { eLoad?: number; eLat?: number } }).__HIP_INPUTS;
  console.log(`rel=${rel.toFixed(2)} eLoad=${(h?.eLoad ?? 0).toFixed(3)} eLat=${(h?.eLat ?? 0).toFixed(3)} fz=${f0.fz.toFixed(0)}/${f1.fz.toFixed(0)} dFz=${(f0.fz-f1.fz).toFixed(0)} hip0L=${(((d?.l?.hip0T ?? 0)*57.29578)).toFixed(2)} hip0R=${(((d?.r?.hip0T ?? 0)*57.29578)).toFixed(2)} hipFfL=${(d?.l?.hipFf ?? 0).toFixed(0)} hipFfR=${(d?.r?.hipFf ?? 0).toFixed(0)}`);
  if (court.fall >= 0) break;
}
