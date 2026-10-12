import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const q = (w.body as any);
const ix = q.indexByKey.get('foot_r');
console.log('t | 支撑足Px(前) Pz(侧) | 滑速vx vz | 支撑fz | 支撑CoPx');
let x0 = 0, z0 = 0, first = true;
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.2 || t > 4.2) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const b = q.bodies[ix]!;
  const p = b.translation();
  const v = b.linvel();
  if (first) { x0 = p.x; z0 = p.z; first = false; }
  const f = ctl.sensors.feet[1]!;
  console.log(`${t.toFixed(1)} | ${((p.x - x0) * 1000).toFixed(1).padStart(6)} ${((p.z - z0) * 1000).toFixed(1).padStart(6)} | ${(v.x * 100).toFixed(1).padStart(5)} ${(v.z * 100).toFixed(1).padStart(5)} | ${f.fz.toFixed(0).padStart(4)} | ${f.copX.toFixed(3)}`);
}
