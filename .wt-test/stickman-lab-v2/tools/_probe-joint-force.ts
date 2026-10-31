/** _probe-joint-force.ts —— 各关节受力回读（施加 / τmax / 占比） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const JOBS: Array<[string, number, string]> = [
  ['foot_r', 2, '支踝跖屈'], ['knee_r', 2, '支膝伸'], ['hip_r', 2, '支髋屈伸'], ['hip_r', 0, '支髋外展'],
  ['spine2', 2, '脊2矢状'], ['spine2', 0, '脊2侧向'],
  ['hip_l', 2, '摆髋屈'], ['knee_l', 2, '摆膝'],
];
console.log('t     ' + JOBS.map((j) => j[2].padEnd(8)).join(''));
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.6 || t > 4.6) continue;
  if (s % Math.round(0.1 / w.dt) !== 0) continue;
  const row = JOBS.map(([n, ax]) => {
    const i = w.body.dofByName(n, ax);
    if (i < 0) return '-'.padEnd(8);
    const tau = w.executor.ledger[i]!.applied;
    const mx = w.body.dofs[i]!.tauMax;
    return `${tau.toFixed(0)}/${mx}`.padEnd(8);
  }).join('');
  console.log(`${t.toFixed(1)}  ${row}`);
}
