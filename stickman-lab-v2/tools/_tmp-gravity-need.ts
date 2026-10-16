/** _tmp-gravity-need.ts —— 法庭标准态：对抗重力的精确关节力矩（浮动基座互补模型） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { courtSetup } from '../src/core/court';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 0 });
w.controller = ctl;
w.reset();
courtSetup(w, ctl, 2.0);
const body = w.body;
const out = new Float64Array(body.dofs.length);
body.gravityComp(out, w.world.gravity.y, 'r');   // 支撑侧=右 → 支撑腿用互补（扛上方全身）
console.log('══ 法庭标准态：对抗重力需要的精确力矩（N·m）══');
for (const [jn, ax] of [
  ['hip_r', 0], ['hip_r', 2], ['knee_r', 0], ['knee_r', 2], ['foot_r', 0], ['foot_r', 2],
  ['hip_l', 2], ['knee_l', 2], ['spine1', 2], ['spine2', 2], ['spine3', 2],
] as Array<[string, number]>) {
  const di = body.dofByName(jn, ax);
  if (di < 0) continue;
  console.log(`  ${jn}/${ax}:  ${out[di]!.toFixed(1)}`);
}
console.log('── 轴方向（b1父/b2子）──');
for (const [jn, ax] of [['hip_r', 0], ['hip_r', 2], ['knee_r', 0], ['knee_r', 2], ['foot_r', 0], ['foot_r', 2]] as Array<[string, number]>) {
  const di = body.dofByName(jn, ax);
  if (di < 0) continue;
  const d = body.dofs[di]!;
  const b1 = body.bodies[d.b1]!, b2 = body.bodies[d.b2]!;
  const p1 = b1.translation(), p2 = b2.translation();
  const dx = p2.x - p1.x, dy = p2.y - p1.y, dz = p2.z - p1.z;
  const u = d.axisWorld;
  console.log(`  ${jn}/${ax}: u=(${u[0]!.toFixed(2)},${u[1]!.toFixed(2)},${u[2]!.toFixed(2)}) 子−父=(${dx.toFixed(2)},${dy.toFixed(2)},${dz.toFixed(2)}) u·(子−父)=${(u[0]! * dx + u[1]! * dy + u[2]! * dz).toFixed(3)}`);
}
console.log(`com=(${(ctl.sensors.com[0]! * 100).toFixed(1)},${(ctl.sensors.com[2]! * 100).toFixed(1)})cm 体重=${(body.sk.massTotal * 9.81).toFixed(0)}N`);
