import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const warner: any = (ctl as any).warner;
console.log('bendSign 现值 =', warner?.opt?.bendSign);
// 保持默认 -1
ctl.actions.play('singleLegR');
console.log('t     comX    vX     胸高');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.0 || t > 4.3) continue;
  if (Math.abs(t * 5 - Math.round(t * 5)) > 1e-6) continue;
  console.log(`${t.toFixed(1)} ${ctl.sensors.com[0]!.toFixed(3)} ${ctl.sensors.comVel[0]!.toFixed(2).padStart(6)} ${ctl.sensors.com[1]!.toFixed(3)}`);
}
