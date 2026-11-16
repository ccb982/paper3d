import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const ang = (n: string, ax: number): number => {
  const di = body.dofByName(n, ax);
  return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN;
};
const yawOf = (k: string): number => {
  const ix = body.indexByKey.get(k);
  if (ix === undefined) return NaN;
  const q = body.bodies[ix].rotation();
  return Math.atan2(2 * (q.w * q.y + q.z * q.x), 1 - 2 * (q.y * q.y + q.z * q.z)) * 57.3;
};
console.log('t | 躯干世界Yaw | hipL/1 | hipR/1 | sp1/1 | sp2/1 | sp3/1');
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    console.log(`${t.toFixed(2)} | ${yawOf('spine4').toFixed(0)} | ${ang('hip_l', 1).toFixed(0)} | ${ang('hip_r', 1).toFixed(0)} | ${ang('spine1', 1).toFixed(0)} | ${ang('spine2', 1).toFixed(0)} | ${ang('spine3', 1).toFixed(0)}`);
  }
}
