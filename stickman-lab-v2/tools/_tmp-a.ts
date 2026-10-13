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
const W = body.sk.massTotal * 9.81;
console.log('t | shiftT | comZ | comTargetZ | 左fz% | 右fz% | sp1侧 | hipR0角');
for (let s = 0; s < Math.round(8.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (s % 60 === 0) {
    const ct = (ctl as any).comTarget?.[2];
    console.log(`${t.toFixed(2)} | ${((ctl as any).supportState?.phase ?? '?')} | ${(ctl.sensors.com[2]!*100).toFixed(1)} | ${ct !== undefined ? (ct*100).toFixed(1) : '-'} | ${(ctl.sensors.feet[0]!.fz/W*100).toFixed(0)} | ${(ctl.sensors.feet[1]!.fz/W*100).toFixed(0)} | ${ang('spine1',0).toFixed(1)} | ${ang('hip_r',0).toFixed(0)}`);
  }
}
