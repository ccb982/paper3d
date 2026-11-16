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
const ang = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
console.log('t | kneeL2角 | pairC | pairRef(rad) | pairCap');
for (let s = 0; s < Math.round(4.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 3.0 && s % 24 === 0) {
    const di = body.dofByName('knee_l', 2);
    console.log(`${t.toFixed(2)} | ${ang('knee_l',2).toFixed(0).padStart(5)} | ${(dr.pairC[di]??0).toFixed(2)} | ${(dr.pairRef[di]??0).toFixed(2)} | ${(dr.pairCap[di]??0).toFixed(0)}`);
  }
}
