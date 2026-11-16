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
  if (ix === undefined) return 0;
  const q = body.bodies[ix].rotation();
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y)) * 57.3;
};
const keys = ['spine1', 'spine2', 'spine3', 'spine4', 'torso', 'head', 'thigh_r', 'shin_r', 'foot_r', 'shoulder_l', 'shoulder_r'];
const upTilt = (key: string): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return 0;
  const q = body.bodies[ix].rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  return Math.atan2(uz, uy) * 57.3;
};
const pk: Record<string, number> = {};
const bump = (k: string, v: number): void => { pk[k] = Math.max(pk[k] ?? 0, Math.abs(v)); };
const dump = (label: string): void => {
  console.log(`[${label}] ` + Object.entries(pk).map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' '));
};
console.log('逐相上身各节侧倾峰值（度°；规格±10）');
let lastPh = '';
for (let s = 0; s < Math.round(4.3 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const ph = ctl.actions.status.phase ?? '?';
  if (ph !== lastPh) {
    if (lastPh !== '') { dump(lastPh + '\u5185\u5cf0\u503c'); for (const k of Object.keys(pk)) pk[k] = 0; }
    lastPh = ph;
  }
  for (const k of keys) bump(k + '_R', roll(k));
  for (const k of ['spine2', 'spine3', 'spine4', 'head']) bump(k + '_U', upTilt(k));
  bump('sensor_torsoTilt', (ctl.sensors.torsoTilt[1] ?? 0) * 57.3);
  bump('CoMz_cm', (ctl.sensors.com[2]! - ctl.sensors.feet[1]!.z) * 100);
}
dump(lastPh + '\u5185\u5cf0\u503c');
