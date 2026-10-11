import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const J: Array<[string, number, string]> = [
  ['hip_r', 0, '支髋ab'], ['knee_r', 2, '支膝'], ['foot_r', 2, '支踝'],
  ['spine1', 2, '腰矢'], ['spine2', 2, '脊2矢'],
  ['hip_l', 0, '摆髋ab'], ['hip_l', 2, '摆髋屈'], ['knee_l', 2, '摆膝'],
];
const prev = new Map<string, number>();
console.log('t      ' + J.map(([, , n]) => (n + '(Δ)').padStart(11)).join(''));
let cnt = 0;
for (let s = 0; s < Math.round(4.9 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 4.0 || t > 4.6) continue;
  cnt++;
  if (cnt % 10 !== 0) continue;
  const row = J.map(([n, a, name]) => {
    const d = w.body.dofByName(n, a);
    const ang = w.body.dofs[d]!.angle * 57.3;
    const p = prev.get(name) ?? ang;
    prev.set(name, ang);
    return `${ang.toFixed(0)}(${(ang - p).toFixed(0)})`.padStart(11);
  });
  console.log(`${t.toFixed(2)}  ` + row.join(''));
}
