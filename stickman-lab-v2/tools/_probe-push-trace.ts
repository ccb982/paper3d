/** _probe-push-trace.ts —— 挺腰段膝/踝时序（角/角速/施加力矩） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('pushRise');
const knee = w.body.dofByName('knee_l', 2);
const ankle = w.body.dofByName('foot_l', 2);
const hip = w.body.dofByName('hip_l', 2);
for (let s = 0; s < Math.round(2.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 1.6 && t < 2.0 && s % 2 === 0) {
    const dk = w.body.dofs[knee]!, da = w.body.dofs[ankle]!, dh = w.body.dofs[hip]!;
    console.log(
      `t=${t.toFixed(3)} 膝θ=${dk.angle.toFixed(3)} ω=${dk.vel.toFixed(1)} τ=${w.executor.ledger[knee]!.applied.toFixed(0)}/150` +
      ` 踝ω=${da.vel.toFixed(1)} τ=${w.executor.ledger[ankle]!.applied.toFixed(0)}` +
      ` 髋ω=${dh.vel.toFixed(1)} τ=${w.executor.ledger[hip]!.applied.toFixed(0)}`
    );
  }
}
