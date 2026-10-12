import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = (w.body as any);
const torsoIdx = body.indexByKey.get('torso');
let prevRoll = 0, prevRate = 0;
console.log('t      roll°    rollRate°/s  rollAcc°/s²  | 本帧外力候选(膝_h fz, 摆腿fz)');
for (let s = 0; s < Math.round(3.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.2 || t > 3.2) continue;
  if (Math.abs(t * 40 - Math.round(t * 40)) > 1e-6) continue;
  const q = body.bodies[torsoIdx].rotation();
  const roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * 57.3;
  const rate = (roll - prevRoll) / (1 / 40);
  const acc = (rate - prevRate) / (1 / 40);
  prevRoll = roll; prevRate = rate;
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  console.log(`${t.toFixed(2)} ${roll.toFixed(2).padStart(7)} ${rate.toFixed(1).padStart(11)} ${acc.toFixed(1).padStart(11)}  | 左${fl.fz.toFixed(0)} 右${fr.fz.toFixed(0)}`);
}
