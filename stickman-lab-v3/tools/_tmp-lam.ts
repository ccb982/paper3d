import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dr = ctl.warner.drive as any;
console.log('t | sp1θ | sp1λ | dev | sp2θ | sp2λ | dev | C(sp1)');
for (let s = 0; s < Math.round(2.7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 1.9 && s % 24 === 0) {
    const d1 = body.dofByName('spine1',0), d2 = body.dofByName('spine2',0);
    const th1 = body.dofs[d1]!.angle*57.3, la1 = (dr.pairRef[d1] ?? 0)*57.3;
    const th2 = body.dofs[d2]!.angle*57.3, la2 = (dr.pairRef[d2] ?? 0)*57.3;
    const c1 = (dr.pairCTarget?.[d1] ?? 0);
    console.log(`${t.toFixed(2)} | ${th1.toFixed(2).padStart(6)} | ${la1.toFixed(2).padStart(6)} | ${(la1-th1).toFixed(2).padStart(6)} | ${th2.toFixed(2).padStart(6)} | ${la2.toFixed(2).padStart(6)} | ${(la2-th2).toFixed(2).padStart(6)} | ${c1.toFixed(2)}`);
  }
}
