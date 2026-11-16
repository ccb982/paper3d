import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const ang = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
const P = (k: string): any => { const ix = body.indexByKey.get(k); if (ix === undefined) return null; const t = body.bodies[ix].translation(); return { x: t.x*100, y: t.y*100, z: t.z*100 }; };
console.log('t | 左足 x/y/z | hipL0 | hipL1 | hipL2 | kneeL0 | kneeL1 | kneeL2 | footL0 | 左fz%');
for (let s = 0; s < Math.round(4.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.9 && t < 4.3 && s % 24 === 0) {
    const f = P('foot_l');
    console.log(`${t.toFixed(2)} | ${f.x.toFixed(0)}/${f.y.toFixed(0)}/${f.z.toFixed(0)} | ${ang('hip_l',0).toFixed(0).padStart(4)} | ${ang('hip_l',1).toFixed(0).padStart(4)} | ${ang('hip_l',2).toFixed(0).padStart(4)} | ${ang('knee_l',0).toFixed(0).padStart(4)} | ${ang('knee_l',1).toFixed(0).padStart(4)} | ${ang('knee_l',2).toFixed(0).padStart(4)} | ${ang('foot_l',0).toFixed(0).padStart(4)} | ${(ctl.sensors.feet[0]!.fz/(body.sk.massTotal*9.81)*100).toFixed(0)}`);
  }
}
