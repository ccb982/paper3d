/** _probe-latwriters: support hip ab lateral torque decomposition (who makes the big force). */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const abR = body.dofByName('hip_r', 0), abL = body.dofByName('hip_l', 0);
console.log('t      phase    摆髋ab角 摆ab伺服  反作用(-scale) 力偶  支ab_ff 支ab_servo  支fz%  摆动腿质量z');
for (let s = 0; s < Math.round(6.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 6.0 || t > 8.0) continue;   // B 相窗口（A 转移慢，B 在 6-7s）
  if (s % Math.round(0.06 / w.dt) !== 0) continue;
  const bdL = w.drive.lastBreakdown[abL]!, bdR = w.drive.lastBreakdown[abR]!;
  const W = body.sk.massTotal * 9.81;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(8)} ${body.dofs[abL]!.angle.toFixed(2).padStart(6)} ${bdL.servo.toFixed(0).padStart(6)}  ${(-0.5 * bdL.servo).toFixed(0).padStart(10)} ${ctl.lean.coupleNow.toFixed(0).padStart(5)}  ${bdR.ff.toFixed(0).padStart(6)} ${bdR.servo.toFixed(0).padStart(8)}  ${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0).padStart(5)}  ${body.bodies[body.indexByKey.get('thigh_l') ?? 0]!.translation().z.toFixed(2).padStart(7)}`,
  );
}
