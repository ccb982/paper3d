/** _probe-spine-tq: spine1-3 lateral servo torque readback (kp=500?). */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const d1 = body.dofByName('spine1', 0), d2 = body.dofByName('spine2', 0);
console.log('t      phase     sp1角°   sp1_τ(伺)sp1_kp  sp2角°   sp2_τ(伺)  腰目标');
for (let s = 0; s < Math.round(9.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.5 || t > 8.0) continue;
  if (s % Math.round(0.15 / w.dt) !== 0) continue;
  const b1 = w.drive.lastBreakdown[d1]!, b2 = w.drive.lastBreakdown[d2]!;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${(body.dofs[d1]!.angle * 180 / Math.PI).toFixed(1).padStart(6)} ${b1.servo.toFixed(0).padStart(8)} ${w.drive.kp[d1]!.toFixed(0).padStart(6)}  ${(body.dofs[d2]!.angle * 180 / Math.PI).toFixed(1).padStart(6)} ${b2.servo.toFixed(0).padStart(8)}  ${Number.isNaN(w.drive.target[d1]!) ? ' -' : w.drive.target[d1]!.toFixed(3)}`,
  );
}
