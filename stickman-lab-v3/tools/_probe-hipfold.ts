/** _probe-hipfold: hip (pelvis) lateral forces readback -- find the sideways fold transient. */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const abR = body.dofByName('hip_r', 0);
const abL = body.dofByName('hip_l', 0);
console.log('t      phase      支髋ab角 abL角  支髋ab τ(净|servo)  骨盆滚°  骨盆y   支fz%');
for (let s = 0; s < Math.round(8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.4 || t > 7.0) continue;
  if (s % Math.round(0.1 / w.dt) !== 0) continue;
  const bd = w.drive.lastBreakdown[abR]!;
  const W = body.sk.massTotal * 9.81;
  console.log(
    `${t.toFixed(1)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${body.dofs[abR]!.angle.toFixed(3).padStart(7)} ${body.dofs[abL]!.angle.toFixed(2).padStart(6)} ` +
    `${(bd.stiff + bd.itb + bd.servo + bd.ff + bd.damp).toFixed(0).padStart(5)}|${bd.servo.toFixed(0).padStart(5)}  ${(ctl.sensors.torsoTilt[1]! * 180 / Math.PI).toFixed(1).padStart(6)} ${body.bodies[body.indexByKey.get('torso') ?? 0]!.translation().y.toFixed(3)} ${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0).padStart(5)}`,
  );
}
