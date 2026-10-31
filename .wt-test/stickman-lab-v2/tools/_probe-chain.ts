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
const iHipL2 = w.body.dofByName('hip_l', 2), iKneeL = w.body.dofByName('knee_l', 2), iHipL0 = w.body.dofByName('hip_l', 0);
let lastTilt = 0;
const hipR = () => w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld;
const hipL = () => w.body.dofs[w.body.dofByName('hip_l', 2)]!.anchorWorld;
const sp4 = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3')!;
const tau = (i: number) => (i >= 0 ? w.executor.ledger[i]!.applied : 0);
console.log('drive 同一实例 =', (ctl.warner.drive === w.drive), ' ff类型 =', typeof (w.drive as unknown as { ff?: unknown }).ff);
console.log('t     支撑R% | 摆腿: 髋屈τ 膝τ 外摆τ | 支撑: 髋外展τ 膝τ | 骨盆倾° d倾/s | comZ vz');
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  if (s % 48 !== 0) continue;
  const f = ctl.sensors.feet[1]!;
  const hR = hipR(), hL = hipL();
  const pelvisTilt = Math.atan2(hL[1]! - hR[1]!, Math.abs(hL[2]! - hR[2]!) + 1e-6) * 180 / Math.PI; // 骨盆横轴对水平（Δy/Δz）
  const sp = w.body.bodies[sp4]!.translation();
  const trunkLean = Math.atan2(sp.x - (hR[0]! + hL[0]!) / 2, sp.y - (hR[1]! + hL[1]!) / 2) * 180 / Math.PI;
  const dTilt = (pelvisTilt - lastTilt) / (48 * w.dt);
  lastTilt = pelvisTilt;
  console.log(
    `${(s * w.dt).toFixed(2)}  ${(f.fz / W * 100).toFixed(0).padStart(5)} | ` +
    `${tau(iHipL2).toFixed(0).padStart(6)} ${tau(iKneeL).toFixed(0).padStart(4)} ${tau(iHipL0).toFixed(0).padStart(6)} | ` +
    `${tau(iHipR0).toFixed(0).padStart(7)} ${tau(iKneeR).toFixed(0).padStart(5)} | ` +
    (() => {
      const b = w.drive.lastBreakdown[iHipR0];
      const tg = (w.drive as unknown as { target: Float64Array }).target[iHipR0]!;
      const ac = w.body.dofs[iHipR0]!.angle;
      return b ? `[支髋: 伺服${b.servo.toFixed(0)} 前馈${b.ff.toFixed(0)} 目标${Number.isNaN(tg) ? 'NaN' : tg.toFixed(3)} 实际${ac.toFixed(3)}] ` : '';
    })() +
    `${pelvisTilt.toFixed(1).padStart(6)} ${dTilt.toFixed(1).padStart(6)} | ${ctl.sensors.com[2]!.toFixed(3).padStart(6)} ${ctl.sensors.comVel[2]!.toFixed(2).padStart(5)} | ` +
    (() => {
      const fr2 = ctl.sensors.feet[1]!, fl2 = ctl.sensors.feet[0]!;
      const tot = fr2.fz + fl2.fz + 1e-6;
      const copEff = (fr2.fz * fr2.copZ + fl2.fz * fl2.copZ) / tot;
      const h = Math.max(0.3, ctl.sensors.com[1]!);
      const a = 9.81 / h * (ctl.sensors.com[2]! - copEff);
      const sp4y = w.body.bodies[sp4]!.translation().y;
      const hipY = w.body.dofs[w.body.dofByName('hip_r', 2)]!.anchorWorld[1]!;
      const kAng = w.body.dofs[iKneeR]!.angle;
      const sp2i = w.body.dofByName('spine2', 2);
      const sp2a = sp2i >= 0 ? w.body.dofs[sp2i]!.angle : 0;
      const spA = (n: string, ax: number) => { const i = w.body.dofByName(n, ax); return i >= 0 ? w.body.dofs[i]!.angle : 0; };
      const tgt = (n: string, ax: number) => { const i = w.body.dofByName(n, ax); const t = i >= 0 ? (w.drive as unknown as { target: Float64Array }).target[i]! : NaN; return Number.isNaN(t) ? '-' : t.toFixed(2); };
      const ankA = spA('foot_r', 2), ankT = tau(iFootR);
      const b2 = w.drive.lastBreakdown[iHipR];
      const sp = `承重竖链: 踝角${ankA.toFixed(2)} 踝τ${ankT.toFixed(0)} 髋屈τ${tau(iHipR).toFixed(0)}[弹${b2?.stiff.toFixed(0)} 主${b2?.act.toFixed(0)} 伺${b2?.servo.toFixed(0)} 前${b2?.ff.toFixed(0)} 阻${b2?.damp.toFixed(0)}]`;
      // ★ 矢状冲量读表（用户定调）：摆腿髋屈τ（反应源）+ 支撑矢状三关节 + vx
      const iHipL2 = w.body.dofByName('hip_l', 2);
      const bL2 = iHipL2 >= 0 ? w.drive.lastBreakdown[iHipL2] : undefined;
      const iKneeR2 = w.body.dofByName('knee_r', 2);
      const vx = ctl.sensors.comVel[0]!;
      const sag = `矢状: vx=${vx.toFixed(2)} 摆髋屈τ=${iHipL2 >= 0 ? tau(iHipL2).toFixed(0) : '-'}[伺${bL2?.servo.toFixed(0)}] 支膝τ=${iKneeR2 >= 0 ? tau(iKneeR2).toFixed(0) : '-'}`;
      return `${sp} | ${sag} | CoP_R=${fr2.copZ.toFixed(3)} eff=${copEff.toFixed(3)} a=${a.toFixed(1)} | 胸y=${sp4y.toFixed(3)} 髋y=${hipY.toFixed(3)} 膝角=${kAng.toFixed(2)} 脊2=${sp2a.toFixed(2)}`;
    })());
}
