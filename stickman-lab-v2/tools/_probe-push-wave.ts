/** _probe-push-wave.ts —— 空中挺腰·恒定力矩段的膝端口波形（每步采样 0.1s） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('pushRise');
let lifted = false;
const knee = w.body.dofByName('knee_l', 2);
const shin = w.body.indexByKey.get('shin_l')!;
for (let s = 0; s < Math.round(1.7 / w.dt); s++) {
  const t = s * w.dt;
  if (!lifted && t >= 0.8) {
    for (const b of w.body.bodies) {
      const p = b.translation();
      b.setTranslation({ x: p.x, y: p.y + 1.0, z: p.z }, true);
    }
    lifted = true;
  }
  w.advance(1);
  if (t >= 1.5 && t < 1.62) {
    const d = w.body.dofs[knee]!;
    console.log(`t=${t.toFixed(4)} 膝θ=${d.angle.toFixed(4)} ω=${d.vel.toFixed(2)} τ=${w.executor.ledger[knee]!.applied.toFixed(0)} 胸y=${w.body.bodies[shin]!.translation().y.toFixed(3)}`);
  }
}
