/** _probe-kick: find the big lateral ejection source in C. Fine trace: comZ, vz,
 *  couple, pad ti, ab servo/ff, swing foot lateral state. */
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
const fl = body.indexByKey.get('foot_l') ?? 0;
let vPrev = 0;
console.log('t      phase     comZ    vz     az    力偶  padTi  ab(servo|ff) 摆脚z 摆脚vz  支fz%');
for (let s = 0; s < Math.round(6.4 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 4.5 || t > 5.8) continue;
  if (s % Math.round(0.06 / w.dt) !== 0) continue;
  const vz = ctl.sensors.comVel[2]!;
  const az = (vz - vPrev) / w.dt; vPrev = vz;
  const bd = w.drive.lastBreakdown[abR]!;
  const ft = body.bodies[fl]!;
  const padT = ctl.pad.getTarget('r');
  const W = body.sk.massTotal * 9.81;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(8)} ${ctl.sensors.com[2]!.toFixed(3).padStart(6)} ${vz.toFixed(2).padStart(6)} ${az.toFixed(0).padStart(5)} ${ctl.lean.coupleNow.toFixed(0).padStart(5)} ${(0.6 * ctl.sensors.feet[1]!.fz * padT.dz).toFixed(0).padStart(5)}  ${bd.servo.toFixed(0).padStart(5)}|${bd.ff.toFixed(0).padStart(4)}  ${ft.translation().z.toFixed(2).padStart(5)} ${ft.linvel().z.toFixed(1).padStart(6)}  ${(ctl.sensors.feet[1]!.fz / W * 100).toFixed(0).padStart(4)}`,
  );
}
