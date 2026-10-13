import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { observe as obs } from '../src/core/servo/unified';
import { balanceScale } from '../src/core/servo/supportReg';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body as any;
const dr = ctl.warner.drive as any;
const A = (n: string, ax: number): number => { const di = body.dofByName(n, ax); return di >= 0 ? (body.dofs[di]?.angle ?? 0) * 57.3 : NaN; };
const r = (n: string, ax: number): any => { const di = body.dofByName(n, ax); return { c: dr.pairC[di] ?? 0, ref: (dr.pairRef[di] ?? 0) * 57.3 }; };
console.log('t | tiltRel | 余量cm | sp1实/λ/C | sp2 C | sp3 C | hip0实/λ/C');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const U = obs({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const bs = balanceScale({ bal: ctl.warner, body, sensors: ctl.sensors } as any, 'r');
    const mg = Math.min(bs.marginLat ?? 0, bs.marginMed ?? 0);
    const s1 = r('spine1', 0), s2 = r('spine2', 0), s3 = r('spine3', 0), h0 = r('hip_r', 0);
    console.log(`${t.toFixed(2)} | ${U.tiltRelDeg.toFixed(0).padStart(5)} | ${(mg*100).toFixed(1).padStart(5)} | ${A('spine1',0).toFixed(1).padStart(5)}/${s1.ref.toFixed(1).padStart(5)}/${s1.c.toFixed(2)} | ${s2.c.toFixed(2)} | ${s3.c.toFixed(2)} | ${A('hip_r',0).toFixed(0).padStart(5)}/${h0.ref.toFixed(1).padStart(5)}/${h0.c.toFixed(2)}`);
  }
}
