import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t     摆髋/1(yaw)°  摆髋/0(ab)°  摆髋/2(屈)°  支髋/1°  骨盆yaw°');
for (let s = 0; s < Math.round(4.9 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.2 || t > 4.8) continue;
  if (Math.round(t * 10) % 1 !== 0) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const g = (n: string, a: number) => { const d = w.body.dofByName(n, a); return d < 0 ? 0 : w.body.dofs[d]!.angle * 57.3; };
  const pi = (w.body as any).indexByKey.get('pelvis') ?? 6;
  const q = w.body.bodies[pi]!.rotation();
  const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) * 57.3;
  console.log(`${t.toFixed(1)}  ${g('hip_l', 1).toFixed(1).padStart(10)}  ${g('hip_l', 0).toFixed(1).padStart(10)}  ${g('hip_l', 2).toFixed(0).padStart(10)}  ${g('hip_r', 1).toFixed(1).padStart(8)}  ${yaw.toFixed(1).padStart(8)}`);
}
