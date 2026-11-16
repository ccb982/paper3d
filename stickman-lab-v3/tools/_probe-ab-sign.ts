/** _probe-ab-sign.ts —— 抬腿后实测髋外摆(hip_l/0)符号：目标 ±0.3 → 悬空脚往哪边 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;

for (const tgt of [-0.3, 0, 0.3]) {
  w.reset();
  const m = ctl.manual;
  const id = w.body.dofByName('hip_l', 0);
  let footZ = 0, footY = 0;
  for (let s = 0; s < 420; s++) {
    m.setAngle('hip_l', 2, 0.5, 400, 50);
    m.setAngle('knee_l', 2, -0.8, 400, 50);
    m.setAngle('foot_l', 2, 0.05, 200, 25);
    if (s > 120) m.setAngle('hip_l', 0, tgt, 400, 50);
    w.advance(1);
    if (s > 360 && s % 20 === 0) { footZ = ctl.sensors.feet[0]!.z; footY = ctl.sensors.feet[0]!.y; }
  }
  console.log(`ab目标=${tgt.toFixed(1).padStart(4)}  实际角=${id >= 0 ? w.body.dofs[id]!.angle.toFixed(3).padStart(6) : '-'}  脚Lz=${footZ.toFixed(3).padStart(6)}  脚Ly=${footY.toFixed(3)}`);
}
