import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const roll = (key: string): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return NaN;
  const q = body.bodies[ix].rotation();
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * 57.3;
};
const pos = (key: string): { x: number; y: number; z: number } => {
  const ix = body.indexByKey.get(key);
  return ix === undefined ? { x: NaN, y: NaN, z: NaN } : body.bodies[ix].translation();
};
console.log('t 相 | 物理CoM: z cm y cm | 躯干体: z y | 支撑脚: z | 摆脚: z y | 躯干R° 大腿R° 小腿R° | comZ−footZ');
for (let s = 0; s < Math.round(4.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.4 || t > 4.5) continue;
  if (Math.abs(t * 20 - Math.round(t * 20)) > 1e-6) continue;
  const com = { x: ctl.sensors.com[0]!, y: ctl.sensors.com[1]!, z: ctl.sensors.com[2]! };
  const tr = pos('torso');
  const fz = ctl.sensors.feet[1]!;
  const fl = pos('mfoot_l');
  console.log(`${t.toFixed(2)} ${(ctl.actions.status.phase ?? '?').slice(0, 1)} | ${(com.z * 100).toFixed(1).padStart(6)} ${(com.y * 100).toFixed(1).padStart(5)} | ${(tr.z * 100).toFixed(1).padStart(6)} ${(tr.y * 100).toFixed(1).padStart(5)} | ${(fz.z * 100).toFixed(1).padStart(6)} | ${(fl.z * 100).toFixed(1).padStart(6)} ${(fl.y * 100).toFixed(1).padStart(5)} | ${roll('torso').toFixed(0).padStart(4)} ${roll('thigh_r').toFixed(0).padStart(4)} ${roll('shin_r').toFixed(0).padStart(4)} | ${((com.z - fz.z) * 100).toFixed(1).padStart(6)}`);
}
