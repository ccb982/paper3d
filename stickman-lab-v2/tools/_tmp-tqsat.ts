import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const J: Array<[string, number]> = [['hip_r', 2], ['hip_r', 0], ['knee_r', 2], ['foot_r', 2], ['spine2', 2], ['hip_l', 2]];
console.log('t      ' + J.map(([n, a]) => `${n}/${a}`.padStart(16)).join(''));
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 4.0 || t > 4.8) continue;
  if (Math.round(t * 5) % 1 !== 0) continue;
  if (Math.abs(t * 5 - Math.round(t * 5)) > 1e-6) continue;
  const row = J.map(([n, a]) => {
    const d = w.body.dofByName(n, a);
    const l = (w.executor as any).ledger?.[d] ?? (w.executor as any).l?.[d];
    const lim = w.body.dofs[d]!.tauMax ?? '?';
    const sat = l?.saturated ? 'SAT' : '';
    return `${(l?.applied ?? 0).toFixed(0)}/${lim}${sat}`.padStart(16);
  });
  console.log(`${t.toFixed(1)}  ` + row.join(''));
}
