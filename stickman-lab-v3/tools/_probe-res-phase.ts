/** _probe-res-phase.ts —— 共振增长段的信号相位（comZ/vz/lean 指令/髋角） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
let pushed = false;
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  const t = s * w.dt;
  if (!pushed && t >= 0.5) {
    for (const b of w.body.bodies) b.applyImpulse({ x: 0, y: 0, z: b.mass() * 0.4 }, true);
    pushed = true;
  }
  w.advance(1);
  if (t >= 1.4 && s % 12 === 0 && t < 3.2) {
    const lean = ctl.lastProposal?.reflexDirectives.find((d) => d.id === 'lean')?.params;
    const hipR = w.body.dofs[w.body.dofByName('hip_r', 0)]!.angle;
    const hipL = w.body.dofs[w.body.dofByName('hip_l', 0)]!.angle;
    console.log(
      `t=${t.toFixed(2)} comZ=${ctl.sensors.com[2]!.toFixed(3)} vz=${ctl.sensors.comVel[2]!.toFixed(2)}` +
      ` lean(h=${(lean?.hip ?? 0).toFixed(2)} s=${(lean?.spine ?? 0).toFixed(2)} a=${(lean?.arm ?? 0).toFixed(2)})` +
      ` hipR=${hipR.toFixed(2)} hipL=${hipL.toFixed(2)}`
    );
  }
}
