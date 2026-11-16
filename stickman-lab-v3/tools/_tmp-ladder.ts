import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const upTiltZ = (key: string): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return 0;
  const q = body.bodies[ix].rotation();
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  return Math.atan2(uz, uy) * 57.3;
};
const jointAng = (name: string): number => {
  const di = body.dofByName(name, 0);
  if (di < 0) return 999;
  return (body.dofState?.[di]?.angle ?? NaN) * 57.3;
};
let peak = 0, peakT = 0;
for (let s = 0; s < Math.round(4.3 / w.dt); s++) {
  w.advance(1);
  const tilt = Math.abs(ctl.sensors.torsoTilt[1] ?? 0) * 57.3;
  if (tilt > peak) { peak = tilt; peakT = s * w.dt; }
}
console.log(`\u6700\u5927\u4e0a\u8eaf\u503e\u659c=${peak.toFixed(1)}\u00b0 @t=${peakT.toFixed(2)}s \u2014\u2014 \u91cd\u8dd1\u5230\u90a3\u4e00\u523b\u6253\u68af\u5b50`);
w.reset(); ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round((peakT + 0.02) / w.dt); s++) w.advance(1);
const ladder = ['pelvis', 'torso', 'spine2', 'spine3', 'spine4', 'head'];
console.log('\u4e16\u754c\u7cfb\u503e\u659c\u68af\u5b50\uff08uz\u00b0\uff09:');
for (const k of ladder) {
  let found = '';
  for (const key of body.indexByKey.keys()) if (String(key).includes(k)) { found = String(key); break; }
  console.log(`  ${k.padEnd(8)} = ${upTiltZ(k).toFixed(1)}${body.indexByKey.get(k) === undefined ? '  (\u65e0\u6b64\u4f53,' + found + ')' : ''}`);
}
console.log('\u5173\u8282\u8bfb\u6570\u5ea6\uff08axis0\uff09:');
for (const j of ['spine1', 'spine2', 'spine3', 'hip_r', 'hip_l', 'ankle_r', 'knee_r']) {
  console.log(`  ${j.padEnd(8)} = ${jointAng(j).toFixed(1)}`);
}
