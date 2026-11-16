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
console.log('t | sp1θ | sp1λ | dev | act | C | sp2θ | sp2λ | sp2act');
for (let s = 0; s < Math.round(3.1 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 14 === 0) {
    const g = (n: string): string => {
      const di = body.dofByName(n,0);
      const th = body.dofs[di]!.angle*57.3, la = (dr.pairRef[di] ?? 0)*57.3;
      const b = dr.lastBreakdown[di] as any;
      return th.toFixed(1).padStart(6)+' | '+la.toFixed(1).padStart(6)+' | '+(la-th).toFixed(1).padStart(6)+' | '+((b?.act||0)).toFixed(0).padStart(5);
    };
    const c1 = (dr.pairCTarget?.[body.dofByName('spine1',0)] ?? 0);
    console.log(`${t.toFixed(2)} | ${g('spine1')} | ${c1.toFixed(2)} | ${g('spine2')}`);
  }
}
