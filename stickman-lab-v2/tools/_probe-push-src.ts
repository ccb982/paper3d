/** _probe-push-src.ts —— 空中挺腰：驱动各通道幅值 + 姿势/重力消融 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

function run(label: string, noPosture: boolean): void {
  const w = new World();
  const ctl = new ControlModule(w, { postureTone: noPosture ? 0 : 8 });
  if (noPosture) ctl.warner.opt.gravityComp = false;
  w.controller = ctl;
  w.reset();
  ctl.actions.play('pushRise');
  let lifted = false;
  const knee = w.body.dofByName('knee_l', 2);
  let w0 = 0, w1 = 0, jit = 0, n = 0;
  const sums = { passive: 0, active: 0, servo: 0, ff: 0, damp: 0 };
  for (let s = 0; s < Math.round(2.8 / w.dt); s++) {
    const t = s * w.dt;
    if (!lifted && t >= 0.8) {
      for (const b of w.body.bodies) {
        const p = b.translation();
        b.setTranslation({ x: p.x, y: p.y + 1.0, z: p.z }, true);
      }
      lifted = true;
    }
    w.advance(1);
    const v = w.body.dofs[knee]!.vel;
    const d2 = v - 2 * w1 + w0;
    if (t > 1.2 && t < 2.6) {
      jit += d2 * d2; n++;
      const st = w.drive.stats;
      sums.passive += st.passive; sums.active += st.active; sums.servo += st.servo;
      sums.ff += st.ff; sums.damp += st.damp;
    }
    w0 = w1; w1 = v;
  }
  console.log(
    `${label}：膝 HF=${(jit / n).toExponential(2)}  各通道均值：被动${(sums.passive / n).toFixed(0)} 激活${(sums.active / n).toFixed(0)} 伺服${(sums.servo / n).toFixed(0)} 前馈${(sums.ff / n).toFixed(0)} 阻尼${(sums.damp / n).toFixed(0)}`
  );
}
run('空中-默认      ', false);
run('空中-关姿势重力', true);
