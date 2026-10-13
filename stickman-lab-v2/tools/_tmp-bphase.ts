import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const keys: string[] = [];
for (const k of body.indexByKey.keys()) keys.push(String(k));
console.log('\u4f53\u6bb5\u952e\uff1a', keys.filter((k) => /hip|pelv|root|swing|foot_l|thigh_l/.test(k)).join(','));
const upZ = (key: string): number => {
  const ix = body.indexByKey.get(key);
  if (ix === undefined) return NaN;
  const q = body.bodies[ix].rotation();
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  return Math.atan2(uz, uy) * 57.3;
};
const dofA = (name: string, axis: number): number => {
  const di = body.dofByName(name, axis);
  return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN;
};
let lastPh = '';
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  const ph = ctl.actions.status.phase ?? '?';
  if (ph !== lastPh) { lastPh = ph; if (ph === 'B\u62ac\u817f') console.log('B\u76f8\u5f00\u59cb 60Hz\uff1at | \u8eaf\u5e72tilt | CoMz | \u5de6\u8db3z cm | \u5de6hip\u03b8 | \u5de6hip\u503c | \u53f3hip\u03b8'); }
  if (ph === 'B\u62ac\u817f' && s % 8 === 0) {
    const t = (s * w.dt).toFixed(2);
    const cz = (ctl.sensors.com[2]! - ctl.sensors.feet[1]!.z) * 100;
    const lf = ctl.sensors.feet[0]!;
    console.log(`${t} | ${(ctl.sensors.torsoTilt[1]! * 57.3).toFixed(1)} | ${cz.toFixed(1)} | ${(lf.z * 100).toFixed(1)} | ${dofA('hip_l', 0).toFixed(0)} | ${(body.dofs[body.dofByName('hip_l', 0)]?.vel * 57.3).toFixed(0)} | ${dofA('hip_r', 0).toFixed(0)}`);
  }
}
