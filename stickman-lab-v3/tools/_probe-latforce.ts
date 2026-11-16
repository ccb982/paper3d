/** _probe-latforce: lateral force on support leg during lift + sources.
 *  latGRF ~= M*az(comZ). Sources: pad ankle-inv ti, couple tau, ab servo.
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const M = w.body.sk.massTotal;
let vPrev = 0;
console.log('t      phase      az(m/s2)  latGRF(N)  padDz  padTi(N)  力偶τ   支髋abτ(servo|ff)  支踝inv');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.5 || t > 5.6) continue;
  if (s % Math.round(0.12 / w.dt) !== 0) continue;
  const v = ctl.sensors.comVel[2]!;
  const az = (v - vPrev) / w.dt; vPrev = v;
  const padT = ctl.pad.getTarget('r');
  const fzR = ctl.sensors.feet[1]!.fz;
  const ti = 0.6 * Math.max(0, fzR) * padT.dz;
  const diAb = w.body.dofByName('hip_r', 0);
  const bdAb = w.drive.lastBreakdown[diAb]!;
  const invA = w.body.dofs[w.body.dofByName('foot_r', 0)]!.angle;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${az.toFixed(1).padStart(7)} ${(M * az).toFixed(0).padStart(8)}  ${padT.dz.toFixed(3).padStart(6)} ${ti.toFixed(0).padStart(8)}  ${ctl.lean.coupleNow.toFixed(0).padStart(5)}  ${(bdAb.servo).toFixed(0).padStart(5)}|${(bdAb.ff).toFixed(0).padStart(4)}  ${invA.toFixed(2).padStart(6)}`,
  );
}
