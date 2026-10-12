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
/** ★ 单腿刚度（用户定调 2026-10："支撑腿受力不稳→左右共振→摇摆放大"）：进相姿态冻结+弹簧 */
const _pose: Record<string, { knee: number; hip: number; foot: number } | null> = { l: null, r: null };
let _prevPx: number | null = null;   // 跨x 速度估计（§2.103 预测项）
let _comYRef = 0;
let _dyF = 0;
let _sqT = 0;   // 间歇脉冲计时（Morasso 2019）
export function captureComY(ctx: ServoRefs): void { _comYRef = ctx.sensors.com[1]!; }

export function captureSupportPose(ctx: ServoRefs, side: 'l' | 'r'): void {
  const g = (n: string, ax: number) => { const i = ctx.body.dofByName(n, ax); return i >= 0 ? ctx.body.dofs[i]!.angle : 0; };
  _pose[side] = { knee: g(`knee_${side}`, 2), hip: g(`hip_${side}`, 2), foot: g(`foot_${side}`, 2) };
}
export function releaseSupportPose(side: 'l' | 'r'): void { _pose[side] = null; }

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
// ★ 脚部侧向对抗（2026-10-11 从动作层迁入：动作层只发"相/落点"声明，伺服律归伺服层。
//   文献：Kim & Collins 步进式 τ=K×a_ml、K≈30 N·s²、±20 N·m；PCDC=比例于 CoP 偏差；
//   Bianco 2023=内外翻最大 ML 杠杆。加速度主导 + 慢跟随（τ=0.18s）避开快环带宽。
const FOOT_LAT = { k: 800, kv: 0.6, kAcc: 400, cap: 15, tau: 0.18 };   // ★ 45→15（用户：脚别转了——45N·m 直写踝=搓地源）
let _footLatTau = 0, _footLatVPrev = 0;
export function resetFootLateral(): void { _footLatTau = 0; _footLatVPrev = 0; }
export function footLateral(ctx: ServoRefs, support: 'l' | 'r', zRef: number, dt = 1 / 240): void {
  const dz0 = ctx.sensors.com[2]! - zRef;
  const vz0 = ctx.sensors.comVel[2]!;
  const vzRaw = ctx.sensors.rawVel[2]!;   // ★ 原始速度（comVel 是 100ms 低通，差分不出文献量级的 a_ml）
  const az0 = (vzRaw - _footLatVPrev) / Math.max(dt, 1e-6);
  _footLatVPrev = vzRaw;
  const need = FOOT_LAT.kAcc * az0 + FOOT_LAT.k * dz0 + FOOT_LAT.k * FOOT_LAT.kv * vz0;
  const a = 1 - Math.exp(-dt / FOOT_LAT.tau);
  _footLatTau += (Math.max(-FOOT_LAT.cap, Math.min(FOOT_LAT.cap, need)) - _footLatTau) * a;
  const diInv = ctx.body.dofByName(`foot_${support}`, 0);
  if (diInv >= 0) ctx.bal.drive.setTorque(diInv, _footLatTau);
}

export function supportColumn(ctx: ServoRefs, side: 'l' | 'r', dt = 1 / 240): void {
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
  // ★ 对齐保持反射（§2.101：盆骨-腿竖直重合时长最大化）——破裂瞬间触发大腿加深。
  //   |跨x−踝x| > 3cm → 髋伸扭矩按超出量加深（直至 +60Nm）。
  let alignBoost = 0, posTq = 0;
  {
    const body = ctx.body as unknown as { indexByKey: Map<string, number>; bodies: Array<{ translation(): { x: number } }> };
    const ti = body.indexByKey.get('torso');
    const ai = body.indexByKey.get('mfoot_' + side);
    if (ti != null && ai != null) {
      const px = body.bodies[ti]!.translation().x;
      const ax = body.bodies[ai]!.translation().x;
      const err = px - ax;   // 正=跨在踝前方（要对齐到 0）
      // ★ 骨盆位置伺服 PD + 预测（§2.103：用户“发力不及时”→加跨速度阻尼）
      const pv = _prevPx != null ? (px - _prevPx) / (1 / 240) : 0;
      _prevPx = px;
      posTq = Math.max(-150, Math.min(150, -err * 600 - pv * 25));   // 预测项 60→25
      if (Math.abs(err) > 0.03) alignBoost = Math.min(1, (Math.abs(err) - 0.03) / 0.05);
    }
  }
  // ★ 踝的削力形态（§2.110：恒定 ff→响应式 PD）：CoP 越靠前越少推（省额度）
  let tfBase = 30 + push * 0.5;
  {
    const fr2 = ctx.sensors.feet[side === 'l' ? 0 : 1]!;
    if (fr2.copValid && fr2.loaded) {
      const copFwd = fr2.copX - ctx.sensors.com[0]!;
      tfBase = Math.max(5, Math.min(90, 30 - copFwd * 500));
    }
  }
  const tf = tfBase, tk = 90 + push * 0.3, th = -10 - push * 0.05 + posTq - 40 * alignBoost;   // ★ 位置伺服 + 踝削力 PD
  supportCmd[side].foot = tf; supportCmd[side].knee = tk; supportCmd[side].hip = th;
  // ★ 支撑腿绷直（§2.104：用户“腿不绷直”；实测支撑膝 15-19° 全程弯）：
  //   膝关节加角度目标闭环（目标 0°）——腿做承重柱而非软弹簧。
  {
    const dkT = ctx.body.dofByName(`knee_${side}`, 2);
    if (dkT >= 0) ctx.bal.manual.setAngle(`knee_${side}`, 2, -0.05, 300, 15);
  }
  put(`foot_${side}`, 2, tf);
  put(`knee_${side}`, 2, tk);
  put(`hip_${side}`, 2, th);
  // ★ 竖直反下沉（最后写手；用户 2026-10："支撑受力不稳"的几何失稳修复）：
  //   实测踝跖屈 0→0.53 顶限位 + comY 0.946→0.757 下沉 → fz 34↔147% 弹跳。
  //   comY 误差 → 膝增伸 + 踝抗跖屈（KFE anti-squat）。
  if (_comYRef > 0.5) {
    // ★ 抖王修复（2026-10-11，`_probe-hf-joints`：踝屈伸 4.6e3）：dy 低通 τ0.15 + 限速
    const dyRaw = _comYRef - ctx.sensors.com[1]!;
    const aa = 1 - Math.exp(-dt / 0.15);
    _dyF += (dyRaw - _dyF) * aa;
    const dy = _dyF;
    if (dy > 0.005) {
      // ★ 膝立柱抗塌（§2.71：失衡元凶=膝的屈曲回弹 0.25→0.40）：
      //   anti-squat（位置项）+ 屈曲速度制动（膝正屈即外加伸展阻尼）
      const diKv = ctx.body.dofByName(`knee_${side}`, 2);
      const kv = diKv >= 0 ? ctx.body.dofs[diKv]!.vel : 0;
      const brake = kv < 0 ? Math.min(70, -kv * 22) : 0;   // 屈曲速度（负）→ 制动
      const tSq = Math.min(60, 900 * dy);
      put(`knee_${side}`, 2, tk + tSq + brake);
      put(`foot_${side}`, 2, -tSq * 0.6);   // ★ 0.6（0.3 实测最低胸 0.149 更差）
    }
  }
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
