import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t     channel  |dComX|   |dComZ|   comX    comZ');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.2 || t > 4.5) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  const supIdx = fl.loaded && !fr.loaded ? 0 : fr.loaded && !fl.loaded ? 1 : -1;
  const f = supIdx >= 0 ? ctl.sensors.feet[supIdx]! : null;
  const dX = f && f.copValid ? Math.abs(ctl.sensors.com[0]! - f.copX) : -1;
  const dZ = f && f.copValid ? Math.abs(ctl.sensors.com[2]! - f.copZ) : -1;
  console.log(`${t.toFixed(1)}  ${ctl.channelMode ? 'ON ' : 'off'}  ${dX >= 0 ? dX.toFixed(3) : '  -- '}  ${dZ >= 0 ? dZ.toFixed(3) : '  -- '}  ${ctl.sensors.com[0]!.toFixed(3)}  ${ctl.sensors.com[2]!.toFixed(3)}`);
}
