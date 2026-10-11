import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const names = ['spine1', 'spine2', 'spine3', 'hip_r', 'knee_r', 'hip_l', 'knee_l'];
const hf = new Map<string, { p: number; e: number }>();
console.log('t      ' + names.map((n) => n.padStart(8)).join('') + '   |加速度和(抽搐)');
for (let s = 0; s < Math.round(5.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.8 || t > 5.0) continue;
  let jer = 0; void hf;
  if (Math.round(t * 10) % 1 !== 0) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const row = names.map((n) => (w.body.dofs[w.body.dofByName(n, 2)]!.angle * 57.3).toFixed(0).padStart(8));
  console.log(`${t.toFixed(1)}  ` + row.join('') + `   |${jer.toFixed(1)}`);
}
