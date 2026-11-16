import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const M = w.body.sk.massTotal;
let vPrev = 0;
console.log('t | 支撑fz | CoM_z | CoM_vz | 侧向力=m*az (N) | az');
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.3 || t > 3.9) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const fr = ctl.sensors.feet[1]!;
  const vz = ctl.sensors.rawVel[2]!;
  const az = (vz - vPrev) / w.dt;
  vPrev = vz;
  console.log(`${t.toFixed(2)} | ${fr.fz.toFixed(0).padStart(5)} | ${ctl.sensors.com[2]!.toFixed(3).padStart(7)} | ${ctl.sensors.comVel[2]!.toFixed(2).padStart(6)} | ${(M * az).toFixed(0).padStart(6)} | ${az.toFixed(1).padStart(7)}`);
}
