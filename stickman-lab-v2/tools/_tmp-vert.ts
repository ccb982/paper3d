import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t | comY cm | comVy cm/s | L载% | R载% | 总%');
for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.49 && t < 2.60 && s % 2 === 0) {
    const W = (w.body as any).sk.massTotal * 9.81;
    const fL = ctl.sensors.feet[0]!.fz / W * 100;
    const fR = ctl.sensors.feet[1]!.fz / W * 100;
    console.log(`${t.toFixed(3)} | ${(ctl.sensors.com[1]! * 100).toFixed(2)} | ${((ctl.sensors.comVel[1] ?? 0) * 100).toFixed(1)} | ${fL.toFixed(0)} | ${fR.toFixed(0)} | ${(fL + fR).toFixed(0)}`);
  }
}
