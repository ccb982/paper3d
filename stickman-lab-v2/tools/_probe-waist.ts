/** _probe-waist: lumbar lateral activity readback (spine1-3 axis0 angles + targets). */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const s1 = body.dofByName('spine1', 0), s2 = body.dofByName('spine2', 0), s3 = body.dofByName('spine3', 0);
const tg = (i: number) => (Number.isNaN(w.drive.target[i]!) ? '   -' : w.drive.target[i]!.toFixed(3));
const deg = (i: number) => (body.dofs[i]!.angle * 180 / Math.PI).toFixed(1).padStart(5);
console.log('t      phase      sp1°    sp2°    sp3°    targets(1/2/3)      comZ    骨盆滚°');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.8 || t > 6.2) continue;
  if (s % Math.round(0.12 / w.dt) !== 0) continue;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${deg(s1)} ${deg(s2)} ${deg(s3)}  ${tg(s1)} ${tg(s2)} ${tg(s3)}  ${ctl.sensors.com[2]!.toFixed(3).padStart(6)} ${(ctl.sensors.torsoTilt[1]! * 180 / Math.PI).toFixed(1).padStart(6)}`,
  );
}
