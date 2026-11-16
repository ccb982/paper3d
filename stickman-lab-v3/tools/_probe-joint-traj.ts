/** _probe-joint-traj —— 单脚动作全程关节轨迹回读（用户要求）：
 *  摆动腿(左) 髋屈/膝/踝 —— 抬起→保持→放下 的完整变化。
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
const ang = (n: string, ax: number) => { const i = body.dofByName(n, ax); return i >= 0 ? body.dofs[i]!.angle : 0; };
const tgt = (n: string, ax: number) => { const i = body.dofByName(n, ax); return i >= 0 && !Number.isNaN(w.drive.target[i]!) ? w.drive.target[i]! : NaN; };

console.log('t     相位      摆髋角(目标)   摆膝角(目标)   摆踝角(目标)   脚x     脚y     脚z');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.4 || t > 6.4) continue;
  if (s % Math.round(0.1 / w.dt) !== 0) continue;
  const f = ctl.sensors.feet[0]!;
  const f2 = (v: number) => (Number.isNaN(v) ? '  -' : v.toFixed(2));
  console.log(
    `${t.toFixed(1)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ` +
    `${ang('hip_l', 2).toFixed(2)}(${f2(tgt('hip_l', 2))})  ${ang('knee_l', 2).toFixed(2)}(${f2(tgt('knee_l', 2))})  ${ang('foot_l', 2).toFixed(2)}(${f2(tgt('foot_l', 2))})  ` +
    `${f.x.toFixed(2)} ${f.y.toFixed(3)} ${f.z.toFixed(2)}`,
  );
}
