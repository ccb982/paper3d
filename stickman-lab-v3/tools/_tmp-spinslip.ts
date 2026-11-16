import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const q = (w.body as any);
const fi = q.indexByKey.get('foot_r');
const yawOf = (key: string): number => {
  const ix = q.indexByKey.get(key);
  if (ix === undefined) return NaN;
  const r = q.bodies[ix].rotation();
  return Math.atan2(2 * (r.w * r.y + r.x * r.z), 1 - 2 * (r.y * r.y + r.z * r.z)) * 57.3;
};
let yaw0 = 0, x0 = 0, z0 = 0, got = false, yawMax = 0, slipMax = 0;
for (let s = 0; s < Math.round(3.8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 2.4 || t > 3.8) continue;
  const b = q.bodies[fi]!;
  const p = b.translation();
  const yaw = yawOf('foot_r');
  if (!got) { yaw0 = yaw; x0 = p.x; z0 = p.z; got = true; }
  const dy = yaw - yaw0;
  const slip = Math.hypot(p.x - x0, p.z - z0) * 1000;
  if (Math.abs(dy) > Math.abs(yawMax)) yawMax = dy;
  if (slip > slipMax) slipMax = slip;
}
console.log(`抬腿后 [2.4→3.8]: 支撑脚 yaw 漂 = ${yawMax.toFixed(1)}° | 最大位移 = ${slipMax.toFixed(1)}mm`);
