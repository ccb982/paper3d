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
  if (ix === undefined) return NaN;
  const q = body.bodies[ix].rotation();
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  const uz = 2 * (q.y * q.z + q.w * q.x);
  return Math.atan2(uz, uy) * 57.3;
};
const yOf = (key: string): number => {
  const ix = body.indexByKey.get(key);
  return ix === undefined ? NaN : body.bodies[ix].translation().y * 100;
};
const dofA = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN;
};
console.log('\u65f6\u95f4 | \u53f3\u8db3y | \u53f3\u8db3\u6eda\ufe0f | \u5c0f\u817f\u6eda | \u5927\u817f\u6eda | \u8db3/0\u89d2 | \u8db3/0\u901f | \u9501\u8bef\u5dee\u00b0 | \u53f3\u8f7d%');
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  const ph = ctl.actions.status.phase ?? '?';
  if (ph === 'B\u62ac\u817f' && s % 8 === 0 && s * w.dt < 2.95) {
    const t = (s * w.dt).toFixed(2);
    const lockErr = (ctl.warner.drive.legReflex.footErr ?? 0) * 57.3;
    const diF = body.dofByName('foot_r', 0);
    const v = diF >= 0 ? (body.dofs[diF]?.vel ?? 0) * 57.3 : NaN;
    const fz = ctl.sensors.feet[1]!.fz / (body.sk.massTotal * 9.81) * 100;
    console.log(`${t} | ${yOf('foot_r').toFixed(1)} | ${upZ('foot_r').toFixed(0)} | ${upZ('shin_r').toFixed(0)} | ${upZ('thigh_r').toFixed(0)} | ${dofA('foot_r', 0).toFixed(1)} | ${v.toFixed(0)} | ${lockErr.toFixed(1)} | ${fz.toFixed(0)}`);
  }
}
