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
console.log('t | 相位 | hipR0 | hipR2 | sp1/2 | sp2/2 | sp3/2 | CoMy cm');
for (let s = 0; s < Math.round(11.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 6.5 && s % 96 === 0) {
    const ph = ctl.actions.status.phase ?? '?';
    const com = ctl.sensors.com;
    console.log(`${t.toFixed(1)} | ${ph} | ${ang('hip_r', 0).toFixed(0)} | ${ang('hip_r', 2).toFixed(0)} | ${ang('spine1', 2).toFixed(0)} | ${ang('spine2', 2).toFixed(0)} | ${ang('spine3', 2).toFixed(0)} | ${(com[1]! * 100).toFixed(0)}`);
  }
}
