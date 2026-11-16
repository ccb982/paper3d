/** _probe-lift-torque —— 抬腿过程完整力矩回读（用户要求）：
 *  摆动腿（髋/膝/踝）与支撑腿（髋/膝/踝）的净力矩 + 摆腿角度 + 脚高/脚fz。
 *  净力矩 = stiff+itb+lum+act+servo+ff+damp（执行层全部通道之和）。
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
const T = (name: string, ax: number): number => {
  const d = body.dofByName(name, ax);
  if (d < 0) return 0;
  const bd = w.drive.lastBreakdown[d]!;
  return bd.stiff + bd.itb + bd.lum + bd.act + bd.servo + bd.ff + bd.damp;
};
const A = (name: string, ax: number): number => {
  const d = body.dofByName(name, ax);
  return d < 0 ? 0 : body.dofs[d]!.angle;
};

console.log('t     相位      | 摆髋角 摆髋τ  摆膝角 摆膝τ  摆踝角 摆踝τ  | 支髋τ  支膝τ  支踝τ  | 脚y    脚fz');
for (let s = 0; s < Math.round(6.5 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.55 || t > 5.0) continue;
  if (s % Math.round(0.06 / w.dt) !== 0) continue;
  const f = ctl.sensors.feet[0]!;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} | ` +
    `${A('hip_l', 2).toFixed(2).padStart(5)} ${T('hip_l', 2).toFixed(0).padStart(5)}  ${A('knee_l', 2).toFixed(2).padStart(5)} ${T('knee_l', 2).toFixed(0).padStart(5)}  ${A('foot_l', 2).toFixed(2).padStart(5)} ${T('foot_l', 2).toFixed(0).padStart(5)} | ` +
    `${T('hip_r', 2).toFixed(0).padStart(5)} ${T('knee_r', 2).toFixed(0).padStart(5)} ${T('foot_r', 2).toFixed(0).padStart(5)} | ${f.y.toFixed(3)} ${f.fz.toFixed(0).padStart(4)}`,
  );
}
