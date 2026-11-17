import './_env-web';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

process.env.V3_LOWER_CMD = '1';
const T = Number(process.env.T_END ?? 5);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const chest = w.body.indexByKey.get('spine4') ?? 0;
const y0 = w.body.bodies[chest]!.translation().y;
for (let s = 0; s < Math.round(T / w.dt); s++) {
  w.advance(1);
  if (s % Math.round(0.5 / w.dt) !== 0) continue;
  const y = w.body.bodies[chest]!.translation().y;
  const fz = w.body.footNormalForce('l', w.dt) + w.body.footNormalForce('r', w.dt);
  console.log(`t=${(s * w.dt).toFixed(1)} y=${y.toFixed(3)} fz=${(fz / (w.sk.massTotal * 9.81) * 100).toFixed(0)}% com=(${(ctl.sensors.com[0]!*100).toFixed(1)},${(ctl.sensors.com[2]!*100).toFixed(1)})`);
}
console.log(`RESULT y=${(w.body.bodies[chest]!.translation().y - y0).toFixed(3)}`);
