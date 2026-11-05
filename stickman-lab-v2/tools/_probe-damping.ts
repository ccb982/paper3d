import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, squatResetLimits } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = false;
ctl.manual.clear();
squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
const axes: Array<[string, number]> = [
  ['hip_l', 0], ['hip_l', 2], ['knee_l', 2], ['foot_l', 0], ['foot_l', 2],
  ['hip_r', 0], ['hip_r', 2], ['knee_r', 2], ['foot_r', 0], ['foot_r', 2],
];
let lastLog = -1;
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  supportClean(stepCtx, 'r');
  supportClean(stepCtx, 'l');
  w.advance(1);
  if (court.released && court.t >= 3.0 && court.t < 3.8 && court.t - lastLog >= 0.35) {
    lastLog = court.t;
    console.log(`DAMP t=${court.t.toFixed(2)}`);
    for (const [n, a] of axes) {
      const i = w.body.dofByName(n, a);
      const p = i >= 0 ? w.drive.dampingParts[i] : undefined;
      if (!p) continue;
      const f = (v: number): string => Number.isFinite(v) ? v.toFixed(2) : 'nan';
      const l = w.executor.ledger[i];
      console.log(`${n}/${a} ang=${(w.headlessDofAngle ? 0 : 0)} act=${f(p.actuator)} ref=${f(p.reflex)} tgt=${f(p.target)} bmax=${f(p.bmax)} joint=${f(p.joint)} used=${f(p.applied)} target=${f(p.targetValue)} kp=${f(p.targetKp)} cmd=${f(l?.cmd ?? 0)} app=${f(l?.applied ?? 0)}`);
    }
  }
  squatFrame(w, ctl, court);
  if (court.fall >= 0) break;
}
console.log(`DAMP_END t=${court.t.toFixed(2)} fall=${court.fall >= 0 ? court.fall.toFixed(2) : 'none'}`);
