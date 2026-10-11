import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;
const net = (d: number) => { const b = w.drive.lastBreakdown[d]!; return b.stiff + b.itb + b.lum + b.act + b.servo + b.ff + b.damp; };
const cols: Array<[string, number]> = [['hip_r', 0], ['knee_r', 2], ['foot_r', 2], ['foot_r', 0], ['hip_l', 0], ['hip_l', 2], ['knee_l', 2]];
console.log('t      相位   ' + cols.map(([n, a]) => `${n}/${a}`.padStart(11)).join(''));
let prevT = 0;
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 4.0 || t > 5.4) continue;
  if (t - prevT < 0.1) continue;
  prevT = t;
  const ph = ctl.actions.phaseName ?? '?';
  const vals = cols.map(([n, a]) => { const d = body.dofByName(n, a); return d < 0 ? 0 : net(d); });
  console.log(`${t.toFixed(1)}  ${String(ph).padEnd(6)} ` + vals.map((v) => v.toFixed(0).padStart(11)).join(''));
}
