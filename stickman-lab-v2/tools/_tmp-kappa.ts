import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { computeMomentum } from '../src/core/servo/momentum';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t      |L|总     L.y      kappa.x(额) kappa.y(yaw) kappa.z(矢)   [Herr 人类: ~0.95]');
for (let s = 0; s < Math.round(4.8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.3 || t > 4.7) continue;
  if (Math.round(t * 10) % 1 !== 0) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const mm = computeMomentum(w.body);
  const tot = Math.hypot(mm.L.x, mm.L.y, mm.L.z);
  console.log(`${t.toFixed(1)}  ${tot.toFixed(2).padStart(8)}  ${mm.L.y.toFixed(2).padStart(6)}   ${mm.kappa.x.toFixed(2).padStart(8)}  ${mm.kappa.y.toFixed(2).padStart(8)}  ${mm.kappa.z.toFixed(2).padStart(8)}`);
}
