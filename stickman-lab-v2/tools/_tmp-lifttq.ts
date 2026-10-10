/** 临时：抬腿（摆动腿）力矩明细直读 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const di = (n: string, ax: number) => w.body.dofByName(n, ax);
const dHip = di('hip_r', 2), dKnee = di('knee_r', 2), dFoot = di('foot_r', 2);
console.log('t     相位      支髋角 支髋τ[基 伺 主 前 阻]       支膝角 支膝τ[基 伺 主 前 阻]       支踝角 支踝τ[基 伺 主 前 阻]      髋目标 膝目标 踝目标');
for (let s = 0; s < Math.round(7 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (t < 3.6 || t > 4.4) continue;
  if (s % Math.round(0.05 / w.dt) !== 0) continue;
  const bd = w.drive.lastBreakdown;
  const f = (d: number) => { const b = bd[d]!; return `${(b.stiff).toFixed(0)} ${b.servo.toFixed(0)} ${b.act.toFixed(0)} ${b.ff.toFixed(0)} ${b.damp.toFixed(0)}`; };
  const ang = (d: number) => (w.body.dofs[d]!.angle).toFixed(2);
  const tgt = (d: number) => Number.isNaN(w.drive.target[d]!) ? ' -' : w.drive.target[d]!.toFixed(2);
  console.log(`${t.toFixed(2)}  ${(ctl.actions.status.phase ?? '-').padEnd(9)} ${ang(dHip)} [${f(dHip)}]  ${ang(dKnee)} [${f(dKnee)}]  ${ang(dFoot)} [${f(dFoot)}]  ${tgt(dHip)} ${tgt(dKnee)} ${tgt(dFoot)}`);
}
