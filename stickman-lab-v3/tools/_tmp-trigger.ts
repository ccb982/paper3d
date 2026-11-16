import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const diSp = body.dofByName('spine1', 0);
const diHip = body.dofByName('hip_r', 0);
const diKnee = body.dofByName('knee_r', 0);
console.log('t | 躯干tilt | tilt速 | C脊 | C髇 | C膝 | M2 | 足z');
let prevTilt = 0;
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const tilt = ctl.sensors.torsoTilt[1]! * 57.3;
  const rate = (tilt - prevTilt) / w.dt / 57.3;
  prevTilt = tilt;
  if (s % 16 === 0 && t > 2.55 && t < 3.9) {
    const Csp = ctl.warner.drive.pairC[diSp];
    const Ch = diHip >= 0 ? ctl.warner.drive.pairC[diHip] : 0;
    const Ck = diKnee >= 0 ? ctl.warner.drive.pairC[diKnee] : 0;
    const bdH = ctl.warner.drive.lastBreakdown[diHip];
    const fi = body.indexByKey.get('foot_r');
    const ft = body.bodies[fi!].translation();
    console.log(`${t.toFixed(2)} | ${tilt.toFixed(1)} | ${(rate * 57.3).toFixed(0)} | ${(Csp ?? 0).toFixed(2)} | ${(Ch ?? 0).toFixed(2)} | ${(Ck ?? 0).toFixed(2)} | ${(bdH ? bdH.act.toFixed(0) : '?')} | ${(ft.z * 100).toFixed(2)}`);
  }
}
