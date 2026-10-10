/** _probe-swing-push —— 摆动腿是否在"蹬地"（用户怀疑）：
 *  摆动脚 fz（正=压地/负=被拽）、摆动腿三关节净矩（伸展=蹬地方向）、与支撑腿对照。
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
const net = (name: string, ax: number): { a: number; t: number } => {
  const d = body.dofByName(name, ax);
  if (d < 0) return { a: 0, t: 0 };
  const bd = w.drive.lastBreakdown[d]!;
  const t = bd.stiff + bd.itb + bd.lum + bd.act + bd.servo + bd.ff + bd.damp;
  return { a: body.dofs[d]!.angle, t };
};

console.log('t     相位      摆脚y   摆脚fz(N) 摆膝角 摆膝净τ  摆髋角 摆髋净τ  支膝净τ  支踝净τ  支撑fz(N)');
for (let s = 0; s < Math.round(6 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.5 || t > 4.9) continue;
  if (s % Math.round(0.06 / w.dt) !== 0) continue;
  const fl = ctl.sensors.feet[0]!;
  const fr = ctl.sensors.feet[1]!;
  const kL = net('knee_l', 2), hL = net('hip_l', 2), kR = net('knee_r', 2), fR = net('foot_r', 2);
  console.log(
    `${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${fl.y.toFixed(3)} ${fl.fz.toFixed(0).padStart(7)}  ` +
    `${kL.a.toFixed(2).padStart(5)} ${kL.t.toFixed(0).padStart(7)}  ${hL.a.toFixed(2).padStart(5)} ${hL.t.toFixed(0).padStart(7)}  ` +
    `${kR.t.toFixed(0).padStart(7)} ${fR.t.toFixed(0).padStart(7)}  ${fr.fz.toFixed(0).padStart(7)}`,
  );
}
