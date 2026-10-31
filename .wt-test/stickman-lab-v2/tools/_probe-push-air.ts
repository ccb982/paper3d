/** _probe-push-air.ts —— 因果隔离：挺腰在空中做（无地面），HF 是否仍在 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(label: string, air: boolean): void {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: 8 });
  w.controller = ctl;
  w.reset();
  ctl.actions.play('pushRise');
  let lifted = false;
  const knee = w.body.dofByName('knee_l', 2);
  let w0 = 0, w1 = 0, jit = 0, n = 0;
  for (let s = 0; s < Math.round(2.8 / w.dt); s++) {
    const t = s * w.dt;
    if (air && !lifted && t >= 0.8) {
      for (const b of w.body.bodies) {
        const p = b.translation();
        b.setTranslation({ x: p.x, y: p.y + 1.0, z: p.z }, true);
      }
      lifted = true;
    }
    w.advance(1);
    const v = w.body.dofs[knee]!.vel;
    const d2 = v - 2 * w1 + w0;
    if (t > 1.2 && t < 2.6) { jit += d2 * d2; n++; }
    w0 = w1; w1 = v;
  }
  console.log(`${label}：膝 HF 能量=${(jit / n).toExponential(2)}`);
}
run('地面挺腰  ', false);
run('空中挺腰  ', true);
