import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
process.env.SQC_KNEE_LAT_HIP_K = '0';
process.env.SQC_KNEE_LAT_FOOT_K = '0';
process.env.SQC_LAT_FOOT = '0';

const SIDE = String(process.env.TEST_SIDE ?? 'l') as 'l' | 'r';
const AXIS = Number(process.env.TEST_AXIS ?? 0);
const TAU = Number(process.env.TEST_TAU ?? 20);
const JOINT = process.env.TEST_JOINT ?? 'hip';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
const i = w.body.dofByName(`${JOINT}_${SIDE}`, AXIS);
const knee = w.body.dofByName(`knee_${SIDE}`, 2);
const kz0 = w.body.dofs[knee]!.anchorWorld[2]!;
for (let s = 0; s < Math.round(2.25 / w.dt); s++) {
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  const t = court.t;
  w.advance(1, () => {
    if (t < 2.0 || t > 2.05) return;
    w.executor.addTorque(i, TAU);
  });
  squatFrame(w, ctl, court);
  if (Math.abs(court.t - 2.2) < 1e-6) {
    const kz = w.body.dofs[knee]!.anchorWorld[2]!;
    const sign = SIDE === 'l' ? 1 : -1;
    console.log(`${JOINT}/${AXIS} ${SIDE} tau=${TAU} dkz=${((kz - kz0) * 1000).toFixed(1)}mm dkzLocal=${((kz - kz0) * 1000 * sign).toFixed(1)}mm`);
    break;
  }
}
