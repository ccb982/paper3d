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
const A = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
const V = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.vel ?? 0) * 57.3 : NaN; };
console.log('t | sp1/0角 | sp1/0角速 | sp1/0总矩 | a分量 | s分量 | d分量 | lu分量');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const di = body.dofByName('spine1', 0);
    const b = dr.lastBreakdown[di] as any;
    const tot = b ? ((b.stiff||0)+(b.itb||0)+(b.lum||0)+(b.act||0)+(b.servo||0)+(b.ff||0)+(b.damp||0)) : 0;
    console.log(`${t.toFixed(2)} | ${A('spine1',0).toFixed(1).padStart(5)} | ${V('spine1',0).toFixed(0).padStart(5)} | ${tot.toFixed(0).padStart(5)} | ${(b?.act||0).toFixed(0).padStart(5)} | ${(b?.servo||0).toFixed(0).padStart(5)} | ${(b?.damp||0).toFixed(0).padStart(5)} | ${(b?.lum||0).toFixed(0).padStart(5)}`);
  }
}
