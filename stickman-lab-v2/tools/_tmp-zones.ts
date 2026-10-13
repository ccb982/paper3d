import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('t | 躯干tilt° | CoM偏移cm | M2活 | 足vz');
for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.50 && t < 2.75 && s % 4 === 0) {
    const fi = body.indexByKey.get('foot_r');
    const fv = body.bodies[fi!].linvel();
    const dh = body.dofByName('hip_r', 0);
    const bdH = ctl.warner.drive.lastBreakdown[dh];
    const cz = (ctl.sensors.com[2]! - ctl.sensors.feet[1]!.z) * 100;
    console.log(`${t.toFixed(2)} | ${(ctl.sensors.torsoTilt[1]! * 57.3).toFixed(1)} | ${cz.toFixed(1)} | ${(bdH ? bdH.act.toFixed(0) : '?')} | ${(fv.z * 100).toFixed(0)}`);
  }
}
