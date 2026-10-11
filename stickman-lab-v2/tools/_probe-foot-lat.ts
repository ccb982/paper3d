/** _probe-foot-lat: verify per-step foot lateral feedforward (drive ff on foot inv axis). */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const M = w.body.sk.massTotal;
const invR = w.body.dofByName('foot_r', 0);
let vPrev = 0;
console.log('t      phase      latGRF(N)  footLat_ff(Nm)  inv角°   CoPz    支fz%');
for (let s = 0; s < Math.round(9.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.5 || t > 8.5) continue;
  if (s % Math.round(0.15 / w.dt) !== 0) continue;
  const vz = ctl.sensors.comVel[2]!;
  const az = (vz - vPrev) / w.dt; vPrev = vz;
  const fr = ctl.sensors.feet[1]!;
  const bd = w.drive.lastBreakdown[invR]!;
  const W = M * 9.81;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${(M * az).toFixed(0).padStart(8)} ${bd.ff.toFixed(0).padStart(12)}  ${(w.body.dofs[invR]!.angle * 180 / Math.PI).toFixed(1).padStart(5)}  ${fr.copZ.toFixed(3).padStart(7)} ${(fr.fz / W * 100).toFixed(0).padStart(5)}`,
  );
}
