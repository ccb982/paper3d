/** _probe-shin-amp.ts —— 蹬地段小腿角位置的真实振荡幅值（480Hz） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World({ physicsHz: 480 });
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('pushRise');
const knee = w.body.dofByName('knee_l', 2);
for (let s = 0; s < Math.round(3.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 1.2 && t < 2.6 && s % 40 === 0) {
    console.log(`t=${t.toFixed(2)} 膝θ=${w.body.dofs[knee]!.angle.toFixed(4)} ω=${w.body.dofs[knee]!.vel.toFixed(2)}`);
  }
}
