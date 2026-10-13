import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('t | 右足z cm | 右足vz cm/s | M2活(hip/0) | 足ff | 躯tilt');
for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.50 && t < 2.78 && s % 2 === 0) {
    const fi = body.indexByKey.get('foot_r');
    const ft = body.bodies[fi!].translation();
    const fv = body.bodies[fi!].linvel();
    const dh = body.dofByName('hip_r', 0);
    const bdH = ctl.warner.drive.lastBreakdown[dh];
    const df = body.dofByName('foot_r', 0);
    const bdF = ctl.warner.drive.lastBreakdown[df];
    console.log(`${t.toFixed(3)} | ${(ft.z * 100).toFixed(2)} | ${(fv.z * 100).toFixed(0)} | ${(bdH ? bdH.act.toFixed(0) : '?')} | ${(bdF ? bdF.ff.toFixed(0) : '?')} | ${(ctl.sensors.torsoTilt[1]! * 57.3).toFixed(1)}`);
  }
}
