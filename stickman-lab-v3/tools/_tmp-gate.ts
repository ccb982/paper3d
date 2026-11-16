import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t 相位 | 摆fz/W 摆y 支撑fz/W (门: 摆<0.05 摆y>0.02 支>0.75)');
for (let s = 0; s < Math.round(4.8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.6 || t > 4.7) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const ph = ctl.actions.status.phase ?? '?';
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  const W = w.body.sk.massTotal * 9.81;
  console.log(`${t.toFixed(1)} ${ph.padEnd(5)} | ${(fl.fz / W).toFixed(3)} ${fl.y.toFixed(3)} ${(fr.fz / W).toFixed(3)}`);
}
