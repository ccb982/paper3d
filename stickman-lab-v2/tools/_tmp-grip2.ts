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
console.log('t | fz(N) | |fx|(N) | 需求μ | 踝0矩 | 踝2矩 | CoPz(跑出半宽4.5cm?) | 半宽用率');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.3 && s % 16 === 0) {
    const f = ctl.sensors.feet[1]!;
    const d1 = body.dofByName('foot_r',0), d2 = body.dofByName('foot_r',2);
    const b1 = dr.lastBreakdown[d1] as any, b2 = dr.lastBreakdown[d2] as any;
    const tq1 = ((b1?.act||0)+(b1?.servo||0)+(b1?.stiff||0));
    const tq2 = ((b2?.act||0)+(b2?.servo||0)+(b2?.ff||0)+(b2?.stiff||0));
    const copRel = (f.copZ - f.z) / 0.045;
    console.log(`${t.toFixed(2)} | ${f.fz.toFixed(0).padStart(4)} | ${(Math.abs(f.fx||0)).toFixed(0).padStart(5)} | ${((Math.abs(f.fx||0))/Math.max(1,f.fz)).toFixed(2).padStart(5)} | ${tq1.toFixed(0).padStart(5)} | ${tq2.toFixed(0).padStart(5)} | ${(f.copZ-f.z).toFixed(3).padStart(7)} | ${(copRel*100).toFixed(0).padStart(4)}%`);
  }
}
