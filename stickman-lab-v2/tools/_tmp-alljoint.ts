import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const J: Array<[string, number, string]> = [
  ['spine1', 0, '腰侧'], ['spine2', 0, '脊2侧'], ['spine3', 0, '脊3侧'],
  ['spine1', 2, '腰矢'], ['spine2', 2, '脊2矢'], ['spine3', 2, '脊3矢'],
  ['hip_r', 0, '支髋ab'], ['hip_r', 2, '支髋屈'], ['knee_r', 2, '支膝'], ['foot_r', 0, '支踝翻'], ['foot_r', 2, '支踝屈'],
  ['hip_l', 0, '摆髋ab'], ['hip_l', 2, '摆髋屈'], ['knee_l', 2, '摆膝'],
  ['shoulder_l', 0, '左肩ab'], ['shoulder_r', 0, '右肩ab'], ['shoulder_l', 2, '左肩屈'], ['shoulder_r', 2, '右肩屈'],
];
console.log('t     ' + J.map(([, , n]) => n.padStart(7)).join(''));
for (let s = 0; s < Math.round(4.3 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.4 || t > 4.2) continue;
  if (Math.round(t * 10) % 1 !== 0) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const row = J.map(([n, a]) => { const d = w.body.dofByName(n, a); return (d < 0 ? 0 : w.body.dofs[d]!.angle * 57.3).toFixed(0).padStart(7); });
  console.log(`${t.toFixed(1)}  ` + row.join(''));
}
