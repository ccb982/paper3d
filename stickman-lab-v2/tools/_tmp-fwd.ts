import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const d2 = w.body.dofByName('spine2', 2);
console.log('t      comX(前+)  vx     躯干弯角°  支踝τ  摆髋屈°');
for (let s = 0; s < Math.round(4.3 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.2 || t > 4.2 || Math.round(t * 10) % 1 !== 0) continue;
  if (Math.abs(t * 10 - Math.round(t * 10)) > 1e-6) continue;
  const b = w.drive.lastBreakdown[w.body.dofByName('foot_r', 2)]!;
  const hipL = w.body.dofs[w.body.dofByName('hip_l', 2)]!;
  console.log(`${t.toFixed(1)}  ${ctl.sensors.com[0]!.toFixed(3)}  ${ctl.sensors.comVel[0]!.toFixed(2)}   ${(w.body.dofs[d2]!.angle * 57.3).toFixed(1)}   ${(b.servo + b.act + b.stiff).toFixed(0)}   ${(hipL.angle * 57.3).toFixed(0)}`);
}
