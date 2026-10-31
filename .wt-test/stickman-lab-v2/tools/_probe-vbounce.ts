/** _probe-vbounce: support vertical force bounce trace -- find the oscillation source. */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const kR = body.dofByName('knee_r', 2), fR = body.dofByName('foot_r', 2);
const W = body.sk.massTotal * 9.81;
console.log('t      phase    支fz%  comY   vy    支膝角  膝τ(servo|ff|damp)  支踝角  踝τ(servo|ff|damp)');
for (let s = 0; s < Math.round(6.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 4.6 || t > 5.8) continue;
  if (s % Math.round(0.04 / w.dt) !== 0) continue;
  const bk = w.drive.lastBreakdown[kR]!, bf = w.drive.lastBreakdown[fR]!;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(8)} ${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0).padStart(5)} ${ctl.sensors.com[1]!.toFixed(3)} ${ctl.sensors.comVel[1]!.toFixed(2).padStart(6)}  ` +
    `${body.dofs[kR]!.angle.toFixed(3).padStart(7)}  ${bk.servo.toFixed(0).padStart(5)}|${bk.ff.toFixed(0).padStart(4)}|${bk.damp.toFixed(0).padStart(4)}  ` +
    `${body.dofs[fR]!.angle.toFixed(3).padStart(7)}  ${bf.servo.toFixed(0).padStart(5)}|${bf.ff.toFixed(0).padStart(4)}|${bf.damp.toFixed(0).padStart(4)}`,
  );
}
