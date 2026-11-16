/** _probe-c-trace.ts —— 蹬地后恢复段胸高/膝角追踪 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('pushRise');
const knee = w.body.dofByName('knee_l', 2);
const chest = w.body.indexByKey.get('spine4')!;
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (s % 36 === 0) {
    console.log(`t=${t.toFixed(2)} 胸=${w.body.bodies[chest]!.translation().y.toFixed(3)} 膝θ=${w.body.dofs[knee]!.angle.toFixed(3)}`);
  }
}
