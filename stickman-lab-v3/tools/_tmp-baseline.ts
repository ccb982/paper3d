import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
const body = w.body as any;
const upTilt = (key: string): string => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return 'n/a';
  const q = body.bodies[ix].rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  const tilt = Math.atan2(uz, uy) * 57.3;
  const fwd = Math.atan2(-ux, uy) * 57.3;
  return `Uz=${tilt.toFixed(1)} Ux=${fwd.toFixed(1)}`;
};
for (let s = 0; s < Math.round(0.12 / w.dt); s++) w.advance(1);
console.log('\u9759\u6b62\u57fa\u7ebf t=0.12s\uff1a');
for (const k of ['spine1', 'spine2', 'spine3', 'spine4', 'torso', 'head']) {
  console.log(`  ${k}: ${upTilt(k)}`);
}
console.log(`  \u4f20\u611f\u5668 torsoTilt=[${(ctl.sensors.torsoTilt[0]! * 57.3).toFixed(1)}, ${(ctl.sensors.torsoTilt[1]! * 57.3).toFixed(1)}]`);
