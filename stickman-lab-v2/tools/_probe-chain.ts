/** _probe-chain.ts —— 单腿站立力链诊断：地面→踝→膝→髋→骨盆→腰→躯干
 *  输出（每 0.1s）：支撑脚 fz/CoP、支撑腿三关节力矩（ledger）、骨盆侧倾角、躯干侧倾角、CoM。 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const W = w.sk.massTotal * 9.81;
const iHipR = w.body.dofByName('hip_r', 2), iKneeR = w.body.dofByName('knee_r', 2), iFootR = w.body.dofByName('foot_r', 2);
const iHipR0 = w.body.dofByName('hip_r', 0);
const hipR = () => w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld;
const hipL = () => w.body.dofs[w.body.dofByName('hip_l', 2)]!.anchorWorld;
const sp4 = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3')!;
const tau = (i: number) => (i >= 0 ? w.executor.ledger[i]!.applied : 0);
console.log('t     支撑R% 脚踝τ  膝τ   髋屈τ 髋外展τ | 骨盆倾° 躯干倾° | comZ   comX | 髋屈角 膝角 踝x 髋x 膝x  [膝通道: 弹性 ITB 主动 伺服 前馈 阻尼]');
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  if (s % 48 !== 0) continue;
  const f = ctl.sensors.feet[1]!;
  const hR = hipR(), hL = hipL();
  const pelvisTilt = Math.atan2(hL[1]! - hR[1]!, Math.abs(hL[2]! - hR[2]!) + 1e-6) * 180 / Math.PI; // 骨盆横轴对水平（Δy/Δz）
  const sp = w.body.bodies[sp4]!.translation();
  const trunkLean = Math.atan2(sp.x - (hR[0]! + hL[0]!) / 2, sp.y - (hR[1]! + hL[1]!) / 2) * 180 / Math.PI;
  console.log(
    `${(s * w.dt).toFixed(2)}  ${(f.fz / W * 100).toFixed(0).padStart(5)} ` +
    `${tau(iFootR).toFixed(0).padStart(5)} ${tau(iKneeR).toFixed(0).padStart(5)} ${tau(iHipR).toFixed(0).padStart(5)} ${tau(iHipR0).toFixed(0).padStart(7)} | ` +
    `${pelvisTilt.toFixed(1).padStart(6)} ${trunkLean.toFixed(1).padStart(7)} | ${ctl.sensors.com[2]!.toFixed(3).padStart(6)} ${ctl.sensors.com[0]!.toFixed(3).padStart(6)} | ` +
    `${w.body.dofs[iHipR]!.angle.toFixed(2).padStart(5)} ${w.body.dofs[iKneeR]!.angle.toFixed(2).padStart(5)} ` +
    `${f.x.toFixed(2).padStart(5)} ${hR[0]!.toFixed(2).padStart(5)} ${(w.body.dofs[iKneeR]!.anchorWorld[0]!).toFixed(2).padStart(5)}  ` +
    (() => {
      const b = w.drive.lastBreakdown[iKneeR];
      return b ? `[${b.stiff.toFixed(0).padStart(4)} ${b.itb.toFixed(0).padStart(4)} ${b.act.toFixed(0).padStart(4)} ${b.servo.toFixed(0).padStart(4)} ${b.ff.toFixed(0).padStart(4)} ${b.damp.toFixed(0).padStart(4)}]` : '';
    })());
}
