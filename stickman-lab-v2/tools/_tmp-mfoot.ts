import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const mi = body.indexByKey.get('mfoot_l') ?? -1;
const fi = body.indexByKey.get('foot_l') ?? -1;
console.log('t     相位      前足体y  脚体y    前足-脚体Δ  脚fz');
for (let s = 0; s < Math.round(5.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.6 || t > 5.2) continue;
  if (s % Math.round(0.08 / w.dt) !== 0) continue;
  const my = body.bodies[mi]!.translation().y;
  const fy = body.bodies[fi]!.translation().y;
  console.log(`${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${my.toFixed(3)}  ${fy.toFixed(3)}  ${(my - fy).toFixed(3).padStart(7)}  ${ctl.sensors.feet[0]!.fz.toFixed(0).padStart(5)}`);
}
