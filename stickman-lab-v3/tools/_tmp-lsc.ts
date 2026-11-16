import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const g = globalThis as any;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
let n36 = 0;
for (let s = 0; s < Math.round(5.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 3.6 && t < 3.65) g.__LSC = [];
  if (t >= 3.65 && g.__LSC) n36 += g.__LSC.length, g.__LSC = [];
}
console.log('liftSwing calls in 3.65-5.2:', n36);
