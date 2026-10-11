/** _probe-force-chain: vertical force transmission up the support leg (find the breaks). */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const idx = (k: string) => body.indexByKey.get(k) ?? -1;
let vS = 0, vT = 0, vP = 0;
console.log('t      phase      地面Fz  传到膝  传到髋  传到骨盆  骨盆/地面');
for (let s = 0; s < Math.round(8.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.6 || t > 7.5) continue;
  if (s % Math.round(0.15 / w.dt) !== 0) continue;
  const footF = ctl.sensors.feet[1]!.fz;
  const shinV = body.bodies[idx('shin_r')]?.linvel().y ?? 0;
  const thighV = body.bodies[idx('thigh_r')]?.linvel().y ?? 0;
  const pelvisV = body.bodies[idx('torso')]?.linvel().y ?? 0;
  const aS = (shinV - vS) / w.dt; vS = shinV;
  const aT = (thighV - vT) / w.dt; vT = thighV;
  const aP = (pelvisV - vP) / w.dt; vP = pelvisV;
  const mS = body.bodies[idx('shin_r')]?.mass() ?? 0;
  const mT = body.bodies[idx('thigh_r')]?.mass() ?? 0;
  const mP = body.bodies[idx('torso')]?.mass() ?? 0;
  const toKnee = footF + mS * (9.81 + aS);
  const toHip = toKnee + mT * (9.81 + aT);
  const toPelvis = toHip + mP * (9.81 + aP);
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${footF.toFixed(0).padStart(6)} ${toKnee.toFixed(0).padStart(7)} ${toHip.toFixed(0).padStart(7)} ${toPelvis.toFixed(0).padStart(9)}  ${(toPelvis / Math.max(1, footF) * 100).toFixed(0).padStart(5)}%`,
  );
}
