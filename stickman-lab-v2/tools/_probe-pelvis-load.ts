/** _probe-pelvis-load —— 盆骨承重回读（用户要求）：
 *  骨盆高度/骨盆侧倾（滚转）/支撑髋外展(实际 vs 目标 vs 力矩)/spine1 角/支撑负载。
 *  判据：① 骨盆高度不塌 ② 骨盆滚转≈0 ③ 外展不饱和且实际≈目标 = 承得住。
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
const chestI = body.indexByKey.get('spine4') ?? 0;
const abR = body.dofByName('hip_r', 0);
const sp1_0 = body.dofByName('spine1', 0);
const sp1_2 = body.dofByName('spine1', 2);

console.log('t     相位      骨盆y   骨盆滚转° 支髋ab实际 目标  τ(ff|servo)   sp1侧屈° sp1弯°  支撑fz%  胸y');
for (let s = 0; s < Math.round(6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.5 || t > 5.0) continue;
  if (s % Math.round(0.08 / w.dt) !== 0) continue;
  const bd = w.drive.lastBreakdown[abR]!;
  const fzR = ctl.sensors.feet[1]!.fz / (body.sk.massTotal * 9.81) * 100;
  const tgt = w.drive.target[abR];
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${body.bodies[pelvisI]!.translation().y.toFixed(3)}  ` +
    `${(ctl.sensors.torsoTilt[1]! * 180 / Math.PI).toFixed(1).padStart(7)}  ${body.dofs[abR]!.angle.toFixed(3).padStart(8)} ${Number.isNaN(tgt!) ? '  -' : tgt!.toFixed(3).padStart(6)}  ` +
    `${bd.ff.toFixed(0).padStart(5)}|${bd.servo.toFixed(0).padStart(5)}  ${(body.dofs[sp1_0]!.angle * 180 / Math.PI).toFixed(1).padStart(6)} ${(body.dofs[sp1_2]!.angle * 180 / Math.PI).toFixed(1).padStart(6)}  ` +
    `${fzR.toFixed(0).padStart(6)}  ${body.bodies[chestI]!.translation().y.toFixed(3)}`,
  );
}
