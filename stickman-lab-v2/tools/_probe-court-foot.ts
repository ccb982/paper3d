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
for (let s = 0; s < Math.round(2.0 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l'); w.advance(1); squatFrame(w, ctl, court);
}
for (const sd of ['l','r'] as const) {
  for (const k of [`foot_${sd}`, `arch_${sd}`, `mfoot_${sd}`]) {
    const bi = w.body.indexByKey.get(k); if (bi === undefined) continue;
    const rb = w.body.bodies[bi]!, p = rb.translation(), q = rb.rotation();
    const uy = 1 - 2*(q.x*q.x + q.z*q.z);
    const f2 = w.body.dofByName(`foot_${sd}`, 2);
    console.log(`${k} p=(${(p.x*100).toFixed(1)},${(p.y*100).toFixed(1)},${(p.z*100).toFixed(1)}) upY=${uy.toFixed(3)} foot2=${f2>=0?(w.body.dofs[f2]!.angle*57.3).toFixed(1):'-'} fz=${w.body.footNormalForce(sd,w.dt).toFixed(0)}`);
  }
}
console.log(`com=(${(ctl.sensors.com[0]!*100).toFixed(1)},${(ctl.sensors.com[1]!*100).toFixed(1)})`);
