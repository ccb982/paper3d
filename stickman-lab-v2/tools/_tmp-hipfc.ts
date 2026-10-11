import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const dH = w.body.dofByName('hip_r', 2);
const dK = w.body.dofByName('knee_r', 2);
const net = (d: number) => { const b = w.drive.lastBreakdown[d]!; return { v: b.stiff + b.itb + b.lum + b.act + b.servo + b.ff + b.damp, s: b.servo, st: b.stiff, a: b.act, ff: b.ff }; };
console.log('t      支髋角°  支髋τ(净/servo/stiff/act/ff)          支膝角°  支膝τ');
for (let s = 0; s < Math.round(5.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.8 || t > 5.0) continue;
  if (Math.round(t * 10) % 1 !== 0) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const h = net(dH), k = net(dK);
  console.log(`${t.toFixed(1)}  ${(w.body.dofs[dH]!.angle * 57.3).toFixed(0).padStart(6)}  τ=${h.v.toFixed(0).padStart(4)} (sv${h.s.toFixed(0)} st${h.st.toFixed(0)} ac${h.a.toFixed(0)} ff${h.ff.toFixed(0)})   ${(w.body.dofs[dK]!.angle * 57.3).toFixed(0).padStart(5)}   ${k.v.toFixed(0)}`);
}
