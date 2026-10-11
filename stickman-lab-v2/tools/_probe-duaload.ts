/** _probe-duaload —— 双脚承重vs重心侧移全程回读（用户要求）：
 *  看支撑脚何时到 ~95-100%、何时开始塌。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');

const body = w.body;
const pelvisI = body.indexByKey.get('torso') ?? 0;
console.log('t     相位      摆Lfz%  支Rfz%   comZ    vz     骨盆滚°  骨盆y');
for (let s = 0; s < Math.round(8 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.4 || t > 6.4) continue;
  if (s % Math.round(0.1 / w.dt) !== 0) continue;
  const W = body.sk.massTotal * 9.81;
  const fl = ctl.sensors.feet[0]!, fr = ctl.sensors.feet[1]!;
  console.log(
    `${t.toFixed(1)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${(fl.fz / W * 100).toFixed(0).padStart(6)} ${(fr.fz / W * 100).toFixed(0).padStart(7)}  ` +
    `${ctl.sensors.com[2]!.toFixed(3).padStart(6)} ${ctl.sensors.comVel[2]!.toFixed(2).padStart(5)}  ${(ctl.sensors.torsoTilt[1]! * 180 / Math.PI).toFixed(1).padStart(6)} ${body.bodies[pelvisI]!.translation().y.toFixed(3)}`,
  );
}
