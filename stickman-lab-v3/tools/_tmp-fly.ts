import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const upZ = (key: string): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return 0;
  const q = body.bodies[ix].rotation();
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  return Math.atan2(uz, uy) * 57.3;
};
const omegaZ = (key: string): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return 0;
  return body.bodies[ix].angvel().z * 57.3;
};
const linVZ = (key: string): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return 0;
  return body.bodies[ix].linvel().z * 100;
};
const dofV = (name: string, axis: number): number => {
  const di = body.dofByName(name, axis);
  return di >= 0 ? (body.dofs[di]?.vel ?? 0) * 57.3 : NaN;
};
let fired = -1;
const N = Math.round(4.4 / w.dt);
const win = Math.round(0.35 / w.dt);
for (let s = 0; s < N; s++) {
  w.advance(1);
  const tilt = Math.abs(ctl.sensors.torsoTilt[1] ?? 0) * 57.3;
  if (fired < 0 && tilt > 8.6) {
    fired = s;
    console.log(`\u5371\u9669\u89e6\u53d1 @t=${(s * w.dt).toFixed(3)}s tilt=${tilt.toFixed(1)}\u00b0 \u2014\u2014 240Hz\u7a97\u53e3\uff1a`);
    console.log('t | tilt\u00b0 | pelvis\u03c9z | \u5927\u817f\u03c9z | \u5c0f\u817f\u03c9z | \u8db3\u03c9z | \u8db3vz cm/s | hip\u8f74 | \u819d\u8f74');
  }
  if (fired >= 0 && s - fired < win && (s - fired) % 2 === 0) {
    const t = ((s - fired) * w.dt * 1000).toFixed(0);
    console.log(`${t} | ${tilt.toFixed(1)} | ${omegaZ('pelvis').toFixed(0)} | ${omegaZ('thigh_r').toFixed(0)} | ${omegaZ('shin_r').toFixed(0)} | ${omegaZ('foot_r').toFixed(0)} | ${linVZ('foot_r').toFixed(0)} | ${dofV('hip_r', 0).toFixed(0)} | ${dofV('knee_r', 0).toFixed(0)}`);
  }
  if (fired >= 0 && s - fired > win) break;
}
if (fired < 0) console.log('\u5168\u7a0b\u672a\u89e6\u53d1 8.6\u00b0');
