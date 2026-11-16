import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t      相位        comZ     CoPz    踝z(支撑)  躯体roll°');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.2 || t > 4.2) continue;
  if (Math.abs(t * 5 - Math.round(t * 5)) > 1e-6) continue;
  const ph = ctl.actions.status.phase ?? '?';
  const f = ctl.sensors.feet[1]!;
  const ank = (w.body as any).bodies[(w.body as any).indexByKey.get('mfoot_r')].translation();
  const q = (w.body as any).bodies[(w.body as any).indexByKey.get('torso')].rotation();
  const roll = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * 57.3;
  console.log(`${t.toFixed(1)}  ${ph.padEnd(6)} ${ctl.sensors.com[2]!.toFixed(3)} ${f.copZ.toFixed(3)} ${ank.z.toFixed(3).padStart(7)} ${roll.toFixed(1).padStart(6)}`);
}
