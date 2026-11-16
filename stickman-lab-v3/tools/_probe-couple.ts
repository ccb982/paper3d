/** _probe-couple: couple law three vars (u, u-star, uF) + output tau. */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

let uF = 0;
console.log('t      phase      fl    fr    u      ustar  uF     tau-couple  footRz  CoPz');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.4 || t > 6.2) continue;
  if (s % Math.round(0.15 / w.dt) !== 0) continue;
  const fl = ctl.sensors.feet[0]!.fz, fr = ctl.sensors.feet[1]!.fz;
  const zl = ctl.sensors.feet[0]!.z, zr = ctl.sensors.feet[1]!.z;
  const zc = (zl + zr) / 2, span = Math.abs(zr - zl);
  const copZ = ctl.sensors.feet[1]!.copZ;
  const u = (fr - fl) / Math.max(1, fl + fr);
  const k = 1 - Math.exp(-w.dt / 0.05);
  uF += (u - uF) * k;
  const uStar = Math.max(-0.97, Math.min(0.97, span > 0.02 ? -(copZ - zc) / (span / 2) : -copZ / 0.16));
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(10)} ${fl.toFixed(0).padStart(5)} ${fr.toFixed(0).padStart(5)} ${u.toFixed(2).padStart(6)} ${uStar.toFixed(2).padStart(6)} ${uF.toFixed(2).padStart(6)}  ${ctl.lean.coupleNow.toFixed(0).padStart(6)}  ${zr.toFixed(2).padStart(6)} ${copZ.toFixed(3).padStart(7)}`,
  );
}
