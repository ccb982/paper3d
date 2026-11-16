import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
ctl.actions.idleEnabled = false;
w.reset(); w.switchPoseState('stand');
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
const cop = new Float64Array(3);
const body = w.body;
const ankX = (): number => body.dofs[body.dofByName('foot_l', 2)]!.anchorWorld[0]!;
for (let i = 0; i < Math.round(5 / w.dt); i++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  const t = w.clock;
  const tau = t < 1.2 ? 0 : t < 2.2 ? 50 : t < 3.2 ? -50 : 0;
  for (const sd of ['l', 'r'] as const) {
    ctl.manual.setAngle(`foot_${sd}`, 2, 0, 20, 3);
    ctl.manual.setTorque(`foot_${sd}`, 2, tau);
  }
  w.advance(1);
  if (Math.abs(t * 20 - Math.round(t * 20)) < 1e-6 && t > 1.2) {
    const ok = body.footCoP('l', w.dt, cop);
    const rel = ok ? (cop[0]! - ankX()) * 100 : NaN;
    const a = body.dofs[body.dofByName('foot_l', 2)]!.angle * 57.3;
    console.log(`FS t=${t.toFixed(2)} tau=${tau} copRel=${rel.toFixed(1)} ankle=${a.toFixed(1)} comX=${(ctl.sensors.com[0]! * 100).toFixed(1)}`);
  }
}
