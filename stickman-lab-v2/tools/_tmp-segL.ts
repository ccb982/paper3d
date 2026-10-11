import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { computeMomentum } from '../src/core/servo/momentum';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
for (let s = 0; s < Math.round(3.65 / w.dt); s++) { w.advance(1); }
const mm = computeMomentum(w.body);
const rows = [...mm.segs.entries()].map(([k, v]) => ({ k, x: v.x, y: v.y, z: v.z })).sort((a, b) => Math.abs(b.y) - Math.abs(a.y));
console.log('t=3.65s（L_y 峰值窗）节段分账（kg·m²/s）：');
console.log('段名'.padEnd(12) + 'L.x'.padStart(9) + 'L.y'.padStart(9) + 'L.z'.padStart(9));
for (const r of rows) console.log(r.k.padEnd(12) + r.x.toFixed(2).padStart(9) + r.y.toFixed(2).padStart(9) + r.z.toFixed(2).padStart(9));
console.log(`合计        ${mm.L.x.toFixed(2).padStart(9)}${mm.L.y.toFixed(2).padStart(9)}${mm.L.z.toFixed(2).padStart(9)}`);
