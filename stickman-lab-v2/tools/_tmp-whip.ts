import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const g = (n: string, ax: number): number => {
  const i = w.body.dofByName(n, ax);
  return i >= 0 ? w.body.dofs[i]!.angle * 57.3 : NaN;
};
const yOf = (key: string): number => {
  const ix = (w.body as any).indexByKey.get(key);
  return ix === undefined ? NaN : (w.body as any).bodies[ix].translation().y * 100;
};
console.log('t      liftT  髋L2   膝L2   足L2  | 足y   | 足L_fz  支撑fz  | 髋L0 髋L1');
let liftT = 0, lastPh = '';
for (let s = 0; s < Math.round(3.6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  const ph = ctl.actions.status.phase ?? '?';
  if (ph === 'B抬腿') liftT += w.dt; else liftT = 0;
  if (t < 3.02 || t > 3.35) continue;
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  console.log(`${t.toFixed(3)} ${liftT.toFixed(2)}  ${g('hip_l', 2).toFixed(1).padStart(6)} ${g('knee_l', 2).toFixed(1).padStart(6)} ${g('foot_l', 2).toFixed(1).padStart(6)} | ${yOf('mfoot_l').toFixed(1).padStart(5)} | ${fl.fz.toFixed(0).padStart(5)}N ${fr.fz.toFixed(0).padStart(5)}N | ${g('hip_l', 0).toFixed(1).padStart(5)} ${g('hip_l', 1).toFixed(1).padStart(5)}`);
  lastPh = ph;
}
console.log('last phase:', lastPh);
