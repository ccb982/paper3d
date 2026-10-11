import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t      comZ     vz      az      摆fz   摆vy   摆copZ  支fz   支copZ');
let pvz = 0;
for (let s = 0; s < Math.round(4.8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 4.0 || t > 4.6) continue;
  if (Math.round(t * 50) % 1 !== 0) continue;
  const vz = ctl.sensors.comVel[2]!, az = (vz - pvz) / w.dt; pvz = vz;
  const f0 = ctl.sensors.feet[0]!, f1 = ctl.sensors.feet[1]!;
  console.log(`${t.toFixed(2)}  ${ctl.sensors.com[2]!.toFixed(3)}  ${vz.toFixed(3)}  ${az.toFixed(1)}   ${f0.fz.toFixed(0)}N  ${f0.vy.toFixed(2)}  ${f0.copZ.toFixed(3)}  ${f1.fz.toFixed(0)}N  ${f1.copZ.toFixed(3)}`);
}
