import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const b = w.body as any;
console.log('body总数(含mid)=', b.bodies.length, ' | 常规体=', b.sk.bodies.length);
for (const j of ['foot_l', 'foot_r', 'knee_l', 'knee_r', 'hip_l', 'hip_r', 'ankle_l', 'ankle_r']) {
  const parts: string[] = [];
  for (const ax of [0, 1, 2]) {
    const di = w.body.dofByName(j, ax);
    if (di < 0) { parts.push(`${ax}:--`); continue; }
    const d = b.dofs[di]!;
    const mid = d.b1 >= b.sk.bodies.length || d.b2 >= b.sk.bodies.length ? 'MID' : 'normal';
    parts.push(`${ax}:${mid}(b1=${d.b1},b2=${d.b2},ax=[${d.axisLocal.x.toFixed(2)},${d.axisLocal.y.toFixed(2)},${d.axisLocal.z.toFixed(2)}])`);
  }
  console.log(j.padEnd(8), parts.join(' | '));
}
