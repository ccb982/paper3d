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
console.log('t | sp1/2实 | sp1/2λ | sp1C | sp2C | sp3C | hipR2实 | hip2λ | hip2C');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const r = (n: string, ax: number): any => { const di = body.dofByName(n, ax); return { c: dr.pairC[di] ?? 0, ref: (dr.pairRef[di] ?? 0) * 57.3 }; };
    const s1 = r('spine1', 2), s2 = r('spine2', 2), s3 = r('spine3', 2), h2 = r('hip_r', 2);
    console.log(`${t.toFixed(2)} | ${A('spine1',2).toFixed(1).padStart(5)} | ${s1.ref.toFixed(1).padStart(6)} | ${s1.c.toFixed(2)} | ${s2.c.toFixed(2)} | ${s3.c.toFixed(2)} | ${A('hip_r',2).toFixed(0).padStart(5)} | ${h2.ref.toFixed(1).padStart(6)} | ${h2.c.toFixed(2)}`);
  }
}
