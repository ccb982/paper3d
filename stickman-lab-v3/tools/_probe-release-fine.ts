/** _probe-release-fine: 法庭释放瞬间 0.2s 高频脚/踝回读 */
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
w.controller = ctl; w.reset(); ctl.actions.idleEnabled = false; ctl.manual.clear(); squatResetLimits(w);
const court = squatCourtSetup(w, ctl, 2.0);
const fi = (sd: 'l'|'r') => w.body.dofByName(`foot_${sd}`, 2);
const fb = (sd: 'l'|'r') => w.body.bodies[w.body.indexByKey.get(`foot_${sd}`)!]!;
const p = (sd: 'l'|'r') => fb(sd).translation();
const v = (sd: 'l'|'r') => fb(sd).linvel();
console.log('t      out  grav   fzL/R       footY L/R    footVY L/R    footVX L/R    foot2 L/R  appL/R');
for (let s = 0; s < Math.round(2.15 / w.dt); s++) {
  const t = s * w.dt;
  supportClean(ctx, 'r'); supportClean(ctx, 'l'); w.advance(1); squatFrame(w, ctl, court);
  if (t < 1.96 || t > 2.12) continue;
  const fl = p('l'), fr = p('r'), vl = v('l'), vr = v('r');
  const dl = w.body.dofs[fi('l')]!, dr = w.body.dofs[fi('r')]!;
  const al = w.executor.ledger[fi('l')]!, ar = w.executor.ledger[fi('r')]!;
  console.log(`${(court.t - court.settle).toFixed(3).padStart(6)} ${w.drive.outputScale.toFixed(2)} ${(w.world.gravity.y!).toFixed(2).padStart(5)} ${w.body.footNormalForce('l',w.dt).toFixed(0)}/${w.body.footNormalForce('r',w.dt).toFixed(0)}  ${(fl.y*100).toFixed(1)}/${(fr.y*100).toFixed(1)}  ${(vl.y*100).toFixed(1)}/${(vr.y*100).toFixed(1)}  ${(vl.x*100).toFixed(1)}/${(vr.x*100).toFixed(1)}  ${(dl.angle*57.3).toFixed(1)}/${(dr.angle*57.3).toFixed(1)}  ${al.applied.toFixed(0)}/${ar.applied.toFixed(0)}`);
}
