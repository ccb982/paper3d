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
const pos = (k: string): number => {
  const ix = body.indexByKey.get(k);
  return ix === undefined ? NaN : body.bodies[ix].translation().z * 100;
};
console.log('t | 左hip0角 | 右hip0角 | 左足z | 右足z | 内移差(左-右) | com z');
for (let s = 0; s < Math.round(5.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.5 && s % 24 === 0) {
    const lf = pos('foot_l'), rf = pos('foot_r');
    console.log(`${t.toFixed(2)} | ${ang('hip_l', 0).toFixed(0)} | ${ang('hip_r', 0).toFixed(0)} | ${lf.toFixed(1)} | ${rf.toFixed(1)} | ${(rf - lf).toFixed(1)} | ${(ctl.sensors.com[2]! * 100).toFixed(1)}`);
  }
}
