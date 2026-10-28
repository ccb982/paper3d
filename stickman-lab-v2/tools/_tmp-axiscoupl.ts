/** _tmp-axiscoupl: 踝三轴的世界方向 + 关节轴耦合矩阵
 *  关键：绕 roll 轴写力矩，会不会漏成 pitch？
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, type CourtState } from '../src/core/servo/squat';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;

console.log('════ 踝三轴的世界方向（蹲姿）════');
for (const sd of ['l'] as const) {
  for (const ax of [0, 1, 2] as const) {
    const i = body.dofByName(`foot_${sd}`, ax);
    if (i < 0) continue;
    const d = body.dofs[i]!;
    const a = d.axisWorld;
    console.log(`foot_${sd}/${ax}  angle=${(d.angle * 57.3).toFixed(2)}°  axisWorld=[${a[0]!.toFixed(3)}, ${a[1]!.toFixed(3)}, ${a[2]!.toFixed(3)}]  |y|=${Math.abs(a[1]!).toFixed(3)}`);
  }
  // 腿链各轴
  for (const [nm, ax] of [['knee_l', 2], ['knee_l', 0], ['hip_l', 2], ['hip_l', 0], ['hip_l', 1], ['knee_l', 1]] as const) {
    const i = body.dofByName(nm, ax);
    if (i < 0) continue;
    const d = body.dofs[i]!;
    const a = d.axisWorld;
    console.log(`${nm}/${ax}          angle=${(d.angle * 57.3).toFixed(2)}°  axisWorld=[${a[0]!.toFixed(3)}, ${a[1]!.toFixed(3)}, ${a[2]!.toFixed(3)}]  |y|=${Math.abs(a[1]!).toFixed(3)}`);
  }
}

console.log('\n════ 耦合：绕 X 轴写 1 N·m，在各轴产生多少力矩分量？════');
// 关节轴在世界系 → 对父刚体施加的力矩方向 = axisWorld
// 如果轴不是纯 x/y/z，则"绕 roll 轴"在世界系里含 pitch 分量
const axNames = ['x(前)', 'y(上)', 'z(侧)'];
for (const [nm, ax, label] of [['foot_l', 0, '踝 roll'], ['foot_l', 2, '踝 pitch'], ['knee_l', 0, '膝额状'], ['hip_l', 0, '髋额状'], ['hip_l', 1, '髋扭转']] as const) {
  const i = body.dofByName(nm, ax);
  if (i < 0) continue;
  const a = body.dofs[i]!.axisWorld;
  const ang = Math.atan2(a[2]!, a[0]!) * 57.3;
  const tilt = Math.acos(Math.min(1, Math.abs(a[0]!))) * 57.3;
  console.log(`${label.padEnd(8)} ${nm}/${ax}  轴在世界系与"前(x)"夹角=${ang.toFixed(1)}°  与纯x轴夹角=${tilt.toFixed(1)}°  → 写1N·m时漏到矢状(x)的比例=${Math.abs(a[0]!).toFixed(3)}`);
}

console.log('\n════ 髋/膝链的几何耦合：轴0 力矩如何传到 CoM 侧向 ════');
const hipL = body.dofByName('hip_l', 0), hipR = body.dofByName('hip_r', 0);
const kneeL = body.dofByName('knee_l', 0), kneeR = body.dofByName('knee_r', 0);
const footL = body.dofByName('foot_l', 0);
const geo = (i: number): string => {
  const a = body.dofs[i]!.anchorWorld;
  return `x=${(a[0]! * 100).toFixed(1)} z=${(a[2]! * 100).toFixed(1)}`;
};
console.log(`  髋L锚 ${geo(hipL)}   髋R锚 ${geo(hipR)}`);
console.log(`  膝L锚 ${geo(kneeL)}   膝R锚 ${geo(kneeR)}`);
console.log(`  踝L锚 ${geo(footL)}`);
const coM = ctl.sensors.com;
console.log(`  CoM x=${(coM[0]! * 100).toFixed(1)} z=${(coM[2]! * 100).toFixed(1)}`);
// 足间距 vs 膝间距
const kneeGap = Math.abs(body.dofs[kneeL]!.anchorWorld[2]! - body.dofs[kneeR]!.anchorWorld[2]!);
const ankGap = Math.abs(body.dofs[footL]!.anchorWorld[2]! - body.dofs[body.dofByName('foot_r', 0)]!.anchorWorld[2]!);
console.log(`  膝间距=${(kneeGap * 100).toFixed(1)}cm  踝间距=${(ankGap * 100).toFixed(1)}cm  → 膝比踝${kneeGap > ankGap ? '外' : '内'} ${((kneeGap - ankGap) * 100).toFixed(1)}cm`);
