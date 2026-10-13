import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs } from '../src/core/servo/unified';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dr = ctl.warner.drive as any;
const A = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
console.log('t | tiltRel | sp1实 | sp1λ | dev | sp1C | hipR0实 | hipC');
for (let s = 0; s < Math.round(3.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.85 && s % 12 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const ds = body.dofByName('spine1', 0);
    const dh = body.dofByName('hip_r', 0);
    const refS = (dr.pairRef[ds] ?? 0) * 57.3;
    console.log(`${t.toFixed(2)} | ${U.tiltRelDeg.toFixed(0).padStart(5)} | ${A('spine1',0).toFixed(1).padStart(5)} | ${refS.toFixed(1).padStart(6)} | ${(refS-A('spine1',0)).toFixed(1).padStart(5)} | ${(dr.pairC[ds]??0).toFixed(2)} | ${A('hip_r',0).toFixed(0).padStart(5)} | ${(dr.pairC[dh]??0).toFixed(2)}`);
  }
}
