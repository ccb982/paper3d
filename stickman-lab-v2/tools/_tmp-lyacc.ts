import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { computeMomentum } from '../src/core/servo/momentum';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
console.log('t      L.y(yaw角动量)   L.x    L.z     骨盆yaw°  摆腿yaw°');
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.2 || t > 4.8) continue;
  if (Math.round(t * 10) % 1 !== 0) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const mm = computeMomentum(w.body);
  const g = (n: string) => { const b = w.body.bodies[(w.body as any).indexByKey.get(n) ?? -1]!; if (!b) return 0; const q = b.rotation(); return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.z * q.z)) * 57.3; };
  console.log(`${t.toFixed(1)}  ${mm.L.y.toFixed(2).padStart(10)}  ${mm.L.x.toFixed(1).padStart(6)} ${mm.L.z.toFixed(1).padStart(6)}  ${g('pelvis').toFixed(1).padStart(8)}  ${g('pelvis').toFixed(1).padStart(8)}`);
}
