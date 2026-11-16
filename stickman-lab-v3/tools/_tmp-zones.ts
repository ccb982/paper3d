import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
console.log('t | 躯干tilt° | tilt速°/s | C锁(sp1) | 纯侧力M2 | CoM偏离cm');
const diSp = body.dofByName('spine1', 0);
const dh = body.dofByName('hip_r', 0);
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.5 && s % 24 === 0) {
    const bdH = ctl.warner.drive.lastBreakdown[dh];
    const cz = (ctl.sensors.com[2]! - ctl.sensors.feet[1]!.z - 0.042) * 100;
    const C = ctl.warner.drive.pairC[diSp];
    const tilt = ctl.sensors.torsoTilt[1]! * 57.3;
    const raw = ctl.sensors.torsoAngVel?.[1] ?? 0;
    console.log(`${t.toFixed(2)} | ${tilt.toFixed(1)} | ${(raw * 57.3).toFixed(0)} | ${(C ?? 0).toFixed(2)} | ${(bdH ? bdH.act.toFixed(0) : '?')} | ${cz.toFixed(1)}`);
  }
}
