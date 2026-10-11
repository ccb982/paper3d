import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t      comZ    支脚z(实时)  A相捕获基准?  距(用实时脚z)  距(用supportZ0)  支fz');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.8 || t > 4.4) continue;
  if (Math.round(t * 20) % 2 !== 0) continue;
  const comZ = ctl.sensors.com[2]!;
  const fR = ctl.sensors.feet[1]!;
  const dz = comZ - fR.z;
  console.log(`${t.toFixed(2)}  ${comZ.toFixed(3)}  ${fR.z.toFixed(3)}    ${(dz).toFixed(3)}    -   ${fR.fz.toFixed(0)}N`);
}
