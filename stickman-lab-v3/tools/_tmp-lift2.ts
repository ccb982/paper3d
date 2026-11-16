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
const fy = (): number => {
  const ix = body.indexByKey.get('foot_l');
  return ix === undefined ? NaN : body.bodies[ix].translation().y * 100;
};
const fzL = (): number => ctl.sensors.feet[0]!.fz / (body.sk.massTotal * 9.81) * 100;
const fzR = (): number => ctl.sensors.feet[1]!.fz / (body.sk.massTotal * 9.81) * 100;
console.log('t | 左足高y | 左fz% | 右fz% | hipL/2(屈+) | kneeL/2 | 步态');
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.3 && s % 12 === 0) {
    console.log(`${t.toFixed(2)} | ${fy().toFixed(1)} | ${fzL().toFixed(0)} | ${fzR().toFixed(0)} | ${ang('hip_l', 2).toFixed(0)} | ${ang('knee_l', 2).toFixed(0)} | ${ctl.warner.drive.legReflex.side ?? '-'}`);
  }
}
