/** _probe-swing-cmd —— 摆动腿命令流回读（用户要求）：谁在指挥脚上去/下来。
 *  读：驱动目标（=各写手最终命令）、实际角、脚高、相位。
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
const dK = body.dofByName('knee_l', 2);
const dH = body.dofByName('hip_l', 2);
const dF = body.dofByName('foot_l', 2);
const tg = (d: number) => (Number.isNaN(w.drive.target[d]!) ? '   -' : w.drive.target[d]!.toFixed(2).padStart(6));
const ac = (d: number) => body.dofs[d]!.angle.toFixed(2).padStart(6);

console.log('t     相位      脚y    膝目标 膝实际  髋目标 髋实际  踝目标 踝实际  kp膝  脚fz');
for (let s = 0; s < Math.round(6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.6 || t > 4.9) continue;
  if (s % Math.round(0.05 / w.dt) !== 0) continue;
  const fl = ctl.sensors.feet[0]!;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${fl.y.toFixed(3)} ${tg(dK)} ${ac(dK)}  ${tg(dH)} ${ac(dH)}  ${tg(dF)} ${ac(dF)}  ${(w.drive.kp[dK] ?? 0).toFixed(0).padStart(4)} ${fl.fz.toFixed(0).padStart(5)}`,
  );
}
