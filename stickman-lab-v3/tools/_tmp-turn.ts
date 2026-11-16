import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const wv = (k: string): string => {
  const ix = body.indexByKey.get(k);
  if (ix === undefined) return 'n/a';
  const a = body.bodies[ix].angvel();
  return (a.x * 57.3).toFixed(0) + '/' + (a.y * 57.3).toFixed(0) + '/' + (a.z * 57.3).toFixed(0);
};
const tq = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  const b = di >= 0 ? ctl.warner.drive.lastBreakdown[di] as any : null;
  return b ? (b.act + b.servo + b.ff + b.damp) : 0;
};
console.log('t | torso ω(x/y/z) | hip_l/1矩 | hip_r/1矩 | spine1/1矩 | hip_l/0矩 | 左足vz');
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.5 && s % 24 === 0) {
    const ix = body.indexByKey.get('foot_l');
    console.log(`${t.toFixed(2)} | ${wv('torso')} | ${tq('hip_l', 1).toFixed(0)} | ${tq('hip_r', 1).toFixed(0)} | ${tq('spine1', 1).toFixed(0)} | ${tq('hip_l', 0).toFixed(0)} | ${(body.bodies[ix].linvel().z * 100).toFixed(0)}`);
  }
}
