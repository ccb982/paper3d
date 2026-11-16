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
const yOf = (key: string): number => {
  const ix = q.indexByKey.get(key);
  return ix === undefined ? NaN : q.bodies[ix].translation().y * 100;
};
console.log('t | 躯干yaw | 摆脚y | 摆脚fz | 支撑fz | 摆踝x (落地阶段)');
for (let s = 0; s < Math.round(4.9 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.4 || t > 4.7) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  const ph = ctl.actions.status.phase ?? '?';
  const ix = q.indexByKey.get('mfoot_l');
  const p = q.bodies[ix].translation();
  console.log(`${t.toFixed(2)} ${ph.padEnd(5)} | ${yawOf('torso').toFixed(1).padStart(6)} | ${yOf('mfoot_l').toFixed(0).padStart(4)} | ${fl.fz.toFixed(0).padStart(4)} | ${fr.fz.toFixed(0).padStart(4)} | ${(p.x * 100).toFixed(1).padStart(6)}`);
}
