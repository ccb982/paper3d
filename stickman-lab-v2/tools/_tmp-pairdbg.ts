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
console.log('t | hipR0 ang | pairRef | pairC | pairCTarget | bd.act | legReflex.pelvisDamp');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.7 && s % 12 === 0) {
    const di = body.dofByName('hip_r', 0);
    const b = dr.lastBreakdown[di] as any;
    console.log(`${t.toFixed(2)} | ${(body.dofs[di].angle*57.3).toFixed(1)} | ${(dr.pairRef[di]??0).toFixed(3)} | ${(dr.pairC[di]??0).toFixed(2)} | ${(dr.pairCTarget[di]??0).toFixed(2)} | ${(b?.act||0).toFixed(0)} | ${dr.legReflex.pelvisDamp.toFixed(0)}`);
  }
}
