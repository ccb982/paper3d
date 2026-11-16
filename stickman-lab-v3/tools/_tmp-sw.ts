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
const fy = (): number => { const ix = body.indexByKey.get('foot_l'); return ix === undefined ? NaN : body.bodies[ix].translation().y * 100; };
const fz = (): number => { const ix = body.indexByKey.get('foot_l'); return ix === undefined ? NaN : body.bodies[ix].translation().z * 100; };
console.log('t | hipL2(屈) | kneeL2 | footL2 | 足高y | 足侧z | 左fz%');
for (let s = 0; s < Math.round(8.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.2 && t < 5.5 && s % 48 === 0) {
    console.log(`${t.toFixed(2)} | ${ang('hip_l',2).toFixed(0).padStart(4)} | ${ang('knee_l',2).toFixed(0).padStart(4)} | ${ang('foot_l',2).toFixed(0).padStart(3)} | ${fy().toFixed(1).padStart(5)} | ${fz().toFixed(1).padStart(6)} | ${(ctl.sensors.feet[0]!.fz/(body.sk.massTotal*9.81)*100).toFixed(0)}`);
  }
}
