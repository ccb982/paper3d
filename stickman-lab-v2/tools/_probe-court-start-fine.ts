/** _probe-court-start-fine: 法庭开始 0~0.3s 高频脚/踝回读 */
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
for (let s = 0; s < Math.round(0.3 / w.dt); s++) {
  const t = s * w.dt;
  supportClean(ctx, 'r'); supportClean(ctx, 'l'); w.advance(1); squatFrame(w, ctl, court);
  if (s % 2) continue;
  const fl = fb('l').translation(), fr = fb('r').translation();
  const vl = fb('l').linvel(), vr = fb('r').linvel();
  const dl = w.body.dofs[fi('l')]!, dr = w.body.dofs[fi('r')]!;
  const al = w.executor.ledger[fi('l')]!, ar = w.executor.ledger[fi('r')]!;
  const upl = fb('l').rotation(); const upv = { x: 2*(upl.x*upl.z+upl.w*upl.y), y: 1-2*(upl.x*upl.x+upl.z*upl.z), z: 2*(upl.y*upl.z-upl.w*upl.x) };
  console.log(`${t.toFixed(3)} out=${w.drive.outputScale.toFixed(2)} g=${(w.world.gravity.y!).toFixed(1)} fz=${w.body.footNormalForce('l',w.dt).toFixed(0)}/${w.body.footNormalForce('r',w.dt).toFixed(0)} y=${(fl.y*100).toFixed(1)}/${(fr.y*100).toFixed(1)} vy=${(vl.y*100).toFixed(1)}/${(vr.y*100).toFixed(1)} vx=${(vl.x*100).toFixed(1)}/${(vr.x*100).toFixed(1)} f2=${(dl.angle*57.3).toFixed(1)}/${(dr.angle*57.3).toFixed(1)} app=${al.applied.toFixed(0)}/${ar.applied.toFixed(0)} upL=${upv.y.toFixed(3)}`);
}
