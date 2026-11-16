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
console.log('t | CoMz | 足心z | 足内缘 | CoM-内缘 | hip0实 | hip0矩(act) | hip0tauMax | 利用率%');
for (let s = 0; s < Math.round(3.2 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t > 2.4 && s % 24 === 0) {
    const f = ctl.sensors.feet[1]!;
    const comZ = ctl.sensors.com[2]! * 100;
    const medEdge = (f.z - 0.045) * 100;   // 内缘(支撑侧)
    const dh = body.dofByName('hip_r', 0);
    const b = dr.lastBreakdown[dh] as any;
    const act = b ? (b.act||0) : 0;
    const tm = body.dofs[dh].tauMax;
    console.log(`${t.toFixed(2)} | ${comZ.toFixed(1).padStart(6)} | ${(f.z*100).toFixed(1).padStart(6)} | ${medEdge.toFixed(1).padStart(6)} | ${(comZ-medEdge).toFixed(1).padStart(5)} | ${(body.dofs[dh].angle*57.3).toFixed(0).padStart(5)} | ${act.toFixed(0).padStart(5)} | ${tm.toFixed(0)} | ${(Math.abs(act)/tm*100).toFixed(0)}`);
  }
}
