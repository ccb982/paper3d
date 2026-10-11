import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const rev = new Map<number, string>();
for (const [k, i] of (w.body as any).indexByKey as Map<string, number>) rev.set(i, k);
console.log('t      comX    vx(全身)  摆腿p_x(kg·m/s)  躯干弯角°  髋屈角°');
for (let s = 0; s < Math.round(4.3 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.2 || t > 4.2) continue;
  if (Math.round(t * 20) % 2 !== 0) continue;
  let pLeg = 0;
  for (const [i, k] of rev) {
    if (/(thigh|shin|foot)_l/.test(k)) { const b = w.body.bodies[i]!; pLeg += b.mass() * b.linvel().x; }
  }
  const dS2 = w.body.dofByName('spine2', 2);
  const dHip = w.body.dofByName('hip_l', 2);
  console.log(`${t.toFixed(2)}  ${ctl.sensors.com[0]!.toFixed(3)}  ${ctl.sensors.comVel[0]!.toFixed(2)}   ${pLeg.toFixed(2)}   ${(w.body.dofs[dS2]!.angle * 57.3).toFixed(1)}   ${(w.body.dofs[dHip]!.angle * 57.3).toFixed(0)}`);
}
