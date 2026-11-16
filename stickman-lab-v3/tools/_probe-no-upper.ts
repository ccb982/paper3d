import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { estimateHipLevel } from '../src/core/servo/squatHipLevel';

const T_END = Number(process.env.T_END ?? 15);
const PRINT = Number(process.env.PRINT ?? 0.5);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
const upper = ['torso', 'spine1', 'spine2', 'spine3', 'spine4', 'neck', 'head', 'arm_l', 'arm_r', 'hand_l', 'hand_r'];
let low = 0, total = 0;
for (const b of w.sk.bodies) {
  total += b.mass;
  if (/^(thigh|shin|foot|arch|mfoot)_/.test(b.key)) low += b.mass;
}
(globalThis as { process?: { env?: Record<string, string> } }).process!.env!.SQC_PAIR_SCALE = (low / total).toFixed(3);
for (const k of upper) {
  const i = w.body.indexByKey.get(k);
  if (i !== undefined) w.body.bodies[i]!.setGravityScale(0, true);
}
const court: CourtState = squatCourtSetup(w, ctl, 2.0);
const stepCtx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const ang = (n: string, a: number): number => { const i = w.body.dofByName(n, a); return i >= 0 ? w.body.dofs[i]!.angle * 57.3 : NaN; };
const kneeRel = (s: 'l' | 'r'): number => {
  const ki = w.body.dofByName(`knee_${s}`, 2), fi = w.body.dofByName(`foot_${s}`, 0);
  return ki >= 0 && fi >= 0 ? (w.body.dofs[ki]!.anchorWorld[2]! - w.body.dofs[fi]!.anchorWorld[2]!) * 1000 : NaN;
};
let last = -1;
for (let s = 0; s < Math.round(T_END / w.dt); s++) {
  supportClean(stepCtx, 'r'); supportClean(stepCtx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  const t = court.t;
  if (t - last >= PRINT) {
    last = t;
    const h = estimateHipLevel(w, court);
    console.log(`NU t=${t.toFixed(1)} hipRoll=${(h.hipRoll * 57.3).toFixed(1)}° kneeRel=${kneeRel('l').toFixed(1)}/${kneeRel('r').toFixed(1)} foot0=${ang('foot_l', 0).toFixed(1)}/${ang('foot_r', 0).toFixed(1)} hip2=${ang('hip_l', 2).toFixed(1)}/${ang('hip_r', 2).toFixed(1)} load=${(h.loadL * 100).toFixed(0)}/${(h.loadR * 100).toFixed(0)}% fall=${court.fall >= 0 ? court.reason : '-'}`);
  }
  if (court.fall >= 0) break;
}
console.log(`NU_RESULT fall=${court.fall >= 0 ? court.fall.toFixed(2) : 'none'} reason=${court.reason}`);
