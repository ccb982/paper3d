import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const q = (w.body as any);
const yawOf = (key: string): number => {
  const ix = q.indexByKey.get(key);
  if (ix === undefined) return NaN;
  const r = q.bodies[ix].rotation();
  return Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.z * r.z)) * 57.3;
};
const j = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.body.dofs[i]!.angle * 57.3 : NaN;
};
console.log('t | 足R_yaw(地) | 髋R_yaw(骨盆相对) | 骨盆R_yaw | 髋L_yaw(摆) | 躯干_yaw');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.2 || t > 4.4) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const ph = ctl.actions.status.phase ?? '?';
  console.log(`${t.toFixed(1)} ${ph.padEnd(5)} | ${yawOf('foot_r').toFixed(1).padStart(7)} | ${j('hip_r', 1).toFixed(1).padStart(7)} | ${yawOf('shin_r').toFixed(1).padStart(6)} | ${j('hip_l', 1).toFixed(1).padStart(6)} | ${yawOf('torso').toFixed(1).padStart(6)}`);
}
