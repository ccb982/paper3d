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
console.log('t | 髇R0实 | 髇R0靶 | 偏差 | sp1/0实 | pairRef(sp1) | 偏差2');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const dh = body.dofByName('hip_r', 0);
    const ds = body.dofByName('spine1', 0);
    const refH = (dr.pairRef[dh] ?? 0) * 57.3;
    const refS = (dr.pairRef[ds] ?? 0) * 57.3;
    console.log(`${t.toFixed(2)} | ${A('hip_r',0).toFixed(0).padStart(5)} | ${refH.toFixed(1).padStart(6)} | ${(A('hip_r',0)-refH).toFixed(1).padStart(5)} | ${A('spine1',0).toFixed(1).padStart(5)} | ${refS.toFixed(1).padStart(6)} | ${(A('spine1',0)-refS).toFixed(1)}`);
  }
}
