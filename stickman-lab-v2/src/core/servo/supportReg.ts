/**
 * 伺服 · 支撑调节（support regulation）——**唯一伺服**的支撑项（2026-10 收编）。
 *
 * 用户定调：只有一个伺服系统；单脚站立（及所有单支撑动作）**使用**本模块，
 * 逻辑只在这里维护一份（此前散在动作层 stepPhases 里 = 重复伺服）。
 * 调用方 = 动作层相位（时序由动作掌握，B/C/D/E 各自该写的才写）；
 * 写入只走 manual/drive（提案制，不直写 Executor 物理量）。
 * 文献：Winter 支撑力矩框架（踝主/膝次/髋辅）；APA（Cordo & Nashner 1982 /
 *       Bouisset & Zattara 1987 / Aruin & Latash 1998 高不稳抑制）；Uebayashi 2026
 *       单腿发起躯干肌提前 110ms。
 */
import type { StabilityWarner } from '../stability';
import type { Body } from '../body';
import type { Sensors } from '../sensors';
import { POSTURE } from './posture';

/** ★ 当拍支撑命令发布（§2.34 治抖：pad 同源化用**当拍命令**而非上一拍台账——消相位滞后） */
export const supportCmd = {
  l: { foot: 0, knee: 0, hip: 0 },
  r: { foot: 0, knee: 0, hip: 0 },
};

export interface ServoRefs {
  bal: StabilityWarner;
  body: Body;
  sensors: Sensors;
}

/** ── L0 姿势层（支撑柱；2026-10 力矩正常化实验）──
 *  膝伸力矩通道 +45：方向=标准（伸展），量=本系统刀刃最优（+80/+100/+60 均反降；
 *  负载屈矩 ~−100，+45 使净矩 −57~−86 仍屈但抬腿动力学最稳——支撑柱的完整达标
 *  需与踝（pad CoP 冲突）/髋（重力补偿耦合）一起做整体律，非本模块单点可达）。 */
export function supportColumn(ctx: ServoRefs, side: 'l' | 'r'): void {
  // ★ 主动任务发力（§2.34）：支撑柱=Winter 标准值（踝跖屈/膝伸/髋伸），动作层直接写；
  //   卸载补偿并入（单写手）；当拍命令发布给 pad 同源化（零延迟，治抖）
  const other = side === 'l' ? 'r' : 'l';
  const W = ctx.body.sk.massTotal * 9.81;
  const lostW = ctx.sensors.feet[other === 'l' ? 0 : 1]!.fz;
  const push = lostW > 0.01 * W ? Math.min(120, lostW * 0.5) : 0;
  const put = (j: string, ax: number, t: number): void => {
    const di = ctx.body.dofByName(j, ax);
    if (di >= 0) ctx.bal.drive.setTorque(di, t);
  };
  const tf = 90 + push * 0.5, tk = 50 + push * 0.3, th = -10 - push * 0.05;   // 【试】髋伸展小量（−25 后倾/−0 前倾）
  supportCmd[side].foot = tf; supportCmd[side].knee = tk; supportCmd[side].hip = th;
  put(`foot_${side}`, 2, tf);
  put(`knee_${side}`, 2, tk);
  put(`hip_${side}`, 2, th);
}

/** 反作用补偿（APA 前馈）：摆动髋外摆的指令力矩反作用由支撑髋反向预载。 */
export function reactionComp(ctx: ServoRefs, side: 'l' | 'r', scale: number): void {
  const other = side === 'l' ? 'r' : 'l';
  const diS = ctx.body.dofByName(`hip_${side}`, 0);
  const diL = ctx.body.dofByName(`hip_${other}`, 0);
  if (diS < 0 || diL < 0) return;
  const cmd = ctx.bal.drive.lastBreakdown[diL]?.servo ?? 0;
  ctx.bal.drive.setTorque(diS, -scale * cmd);
}

/** ── L1-Future 骨盆前移预激活（§2.18；用户定调"脊柱弯了屁股还在后面被拽倒"）──
 *  随弯腰（|bend|）联动的支撑髋**伸展前馈**——把骨盆同步前移（文献 CVCF 2019：
 *  后向扰动=脊柱+髋伸展前移骨盆）。与动作层 (a) 的直接写构成**双保险**。 */
export function pelvisForward(ctx: ServoRefs, side: 'l' | 'r', bend: number): void {
  const di = ctx.body.dofByName(`hip_${side}`, 2);
  if (di < 0) return;
  ctx.bal.drive.setTorque(di, -90 * Math.abs(bend));   // 伸展（负）；随弯深联动
}

/** 躯干支撑：L0 tonic（`posture.POSTURE.trunkTonic`，常开）+ L1-Future 的 APA 增量
 *  （随摆腿屈髋指令提前支撑——单写入者=tonic+APA 求和，保持 drive.setTorque 的覆盖语义）。 */
export function trunkSupport(ctx: ServoRefs, side: 'l' | 'r'): void {
  const other = side === 'l' ? 'r' : 'l';
  const diL2 = ctx.body.dofByName(`hip_${other}`, 2);
  const swingFlex = diL2 >= 0 ? Math.max(0, ctx.bal.drive.lastBreakdown[diL2]?.servo ?? 0) : 0;
  for (const sn of ['spine1', 'spine2', 'spine3']) {
    const di = ctx.body.dofByName(sn, 2);
    if (di < 0) continue;
    ctx.bal.drive.setTorque(di, POSTURE.trunkTonic - 0.4 * swingFlex);
  }
}
