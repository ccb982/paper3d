import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const py = (k: string): number => { const ix = body.indexByKey.get(k); return ix === undefined ? NaN : body.bodies[ix].translation().y * 100; };
const ang = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
console.log('t | 左膝高y | 右膝高y | hipL2 | 左足y | hip R脉');
for (let s = 0; s < Math.round(3.8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.3 && s % 24 === 0) {
    console.log(`${t.toFixed(2)} | ${py('knee_l').toFixed(1).padStart(6)} | ${py('knee_r').toFixed(1).padStart(6)} | ${ang('hip_l',2).toFixed(0).padStart(4)} | ${py('foot_l').toFixed(1).padStart(5)} | ${ang('hip_r',2).toFixed(0)}`);
  }
}
