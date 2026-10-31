/** _probe-tilt-ab.ts —— 支撑腿倾角 vs 支撑髋外摆目标 的映射（找"竖直"对应的角） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;

for (const tgt of [-0.24, -0.12, 0, 0.12]) {
  w.reset();
  const m = ctl.manual;
  // 先把重心压到右脚（模拟单支撑）：直接写 com 目标
  for (let s = 0; s < 720; s++) {
    m.setAngle('hip_r', 0, tgt, 150, 20);
    ctl.warner.setComTarget(-0.16, 0);
    w.advance(1);
  }
  const hz = w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld[2]!;
  const hy = w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld[1]!;
  const f = ctl.sensors.feet[1]!;
  const tilt = Math.atan2(f.z - hz, Math.max(0.2, hy - f.y)) * 180 / Math.PI;
  console.log(`髋R0目标=${tgt.toFixed(2).padStart(5)}  实际=${w.body.dofs[w.body.dofByName('hip_r', 0)]!.angle.toFixed(3).padStart(6)}  髋锚z=${hz.toFixed(3)}  脚z=${f.z.toFixed(3)}  支腿倾角=${tilt.toFixed(1).padStart(5)}°  comZ=${ctl.sensors.com[2]!.toFixed(3)}`);
}
