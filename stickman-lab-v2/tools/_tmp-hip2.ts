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
console.log('t | hip2θ | hip2λ | dev | act | C | 腰合 | fz');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.3 && s % 20 === 0) {
    const d2 = body.dofByName('hip_r',2);
    const th = body.dofs[d2]!.angle*57.3, la = (dr.pairRef[d2] ?? 0)*57.3;
    const b = dr.lastBreakdown[d2] as any;
    const c = (dr.pairCTarget?.[d2] ?? 0);
    const g = (n: string): number => { const di = body.dofByName(n, 2); if (di<0) return 0; const bb = dr.lastBreakdown[di] as any; return bb ? ((bb.stiff||0)+(bb.act||0)+(bb.servo||0)+(bb.ff||0)+(bb.damp||0)) : 0; };
    const spSum = g('spine1')+g('spine2')+g('spine3');
    console.log(`${t.toFixed(2)} | ${th.toFixed(1).padStart(7)} | ${la.toFixed(1).padStart(7)} | ${(la-th).toFixed(1).padStart(6)} | ${((b?.act||0)).toFixed(0).padStart(4)} | ${c.toFixed(2)} | ${spSum.toFixed(0).padStart(5)} | ${ctl.sensors.feet[1]!.fz.toFixed(0)}`);
  }
}
