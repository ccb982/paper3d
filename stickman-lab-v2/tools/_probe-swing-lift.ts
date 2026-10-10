/** _probe-swing-lift —— 摆动腿为什么提不起来（用户要求）+ 受力大小：
 *  摆动腿三关节：命令/实际/净力矩（含通道明细）；膝体高度（腿折叠指标）；脚高/脚底力。
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
const info = (name: string, ax: number) => {
  const d = body.dofByName(name, ax);
  const bd = w.drive.lastBreakdown[d]!;
  return {
    a: body.dofs[d]!.angle,
    tgt: w.drive.target[d]!,
    kp: w.drive.kp[d]!,
    net: bd.stiff + bd.itb + bd.lum + bd.act + bd.servo + bd.ff + bd.damp,
    servo: bd.servo, ff: bd.ff, damp: bd.damp, act: bd.act,
  };
};
const kneeBody = body.indexByKey.get('knee_l') ?? -1;

console.log('t     相位      髋cmd  髋act  髋τ(净|servo|ff)   膝cmd  膝act  膝τ(净|servo|ff)    膝体y  脚y    脚fz');
for (let s = 0; s < Math.round(6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.6 || t > 4.5) continue;
  if (s % Math.round(0.06 / w.dt) !== 0) continue;
  const h = info('hip_l', 2), k = info('knee_l', 2);
  const fl = ctl.sensors.feet[0]!;
  const ky = kneeBody >= 0 ? body.bodies[kneeBody]!.translation().y : 0;
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ` +
    `${h.tgt.toFixed(2).padStart(6)} ${h.a.toFixed(2).padStart(6)} ${h.net.toFixed(0).padStart(5)}|${h.servo.toFixed(0).padStart(4)}|${h.ff.toFixed(0).padStart(3)}  ` +
    `${k.tgt.toFixed(2).padStart(6)} ${k.a.toFixed(2).padStart(6)} ${k.net.toFixed(0).padStart(5)}|${k.servo.toFixed(0).padStart(4)}|${k.ff.toFixed(0).padStart(3)}  ` +
    `${ky.toFixed(3)} ${fl.y.toFixed(3)} ${fl.fz.toFixed(0).padStart(4)}`,
  );
}
