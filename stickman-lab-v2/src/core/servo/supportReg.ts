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
let _prevPv: number | null = null;   // ★ §2.194 上一帧 pv（两帧平均）
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

/** ★ §2.144 足伺服三态架构（用户定调："站立脚/离地脚/单腿脚各独立一套伺服"）：
 *  · stand  ：双支撑（A/E 相）——轻刚轻阻，接触稳定优先；
 *  · single ：单腿支撑（B/C/D 相支撑脚）——支撑柱发力（supportColumn 内实现）；
 *  · air    ：腾空（摆动脚离地后）——不再发力、轻引导 + 强被动阻尼（肌肉共激活）。
 *  模式由控制层依传感器每帧选择——"脚离地后控制层自动调整参数"。 */
export type FootMode = 'stand' | 'single' | 'air';
export const FOOT_SERVO = {
  stand:  { hipKp: 120, hipKd: 20, kneeKp: 120, kneeKd: 20, ankKp: 60, ankKd: 20, dampBoost: 1.0 },
  single: { hipKp: 120, hipKd: 20, kneeKp: 120, kneeKd: 20, ankKp: 60, ankKd: 20, dampBoost: 2.5 },   // ★ §2.144 支撑腿吸收接触抖
  // ★ §2.159 按论文标定（Zelik 2025 摆动透明度：腿几乎不发力——峰值 2.3N·m）,
  air:    { hipKp: 10,  hipKd: 0.3, kneeKp: 2,  kneeKd: 0.3, ankKp: 2, ankKd: 0.3, dampBoost: 1.0 },
  /** ★ §2.178 该有力有力该轻就轻：折叠运动期强 kp（误差门控），抱到位即转透明 */
  // ★ §2.213 用户：抬腿“快而轻”——分关节轻刹车（旧 200/20 全轴一锅=重；现“动则力、停则透”）
  move:   { hipKp: 70, hipKd: 7, kneeKp: 50, kneeKd: 5, ankKp: 15, ankKd: 2, threshold: 0.20 },
} as const;

/** 足态解析：本脚 fz < 5%W → 腾空；对侧也载 → 站立；否则单腿支撑 */
export function footModeOf(ctx: ServoRefs, side: 'l' | 'r'): FootMode {
  const W = ctx.body.sk.massTotal * 9.81;
  const self = ctx.sensors.feet[side === 'l' ? 0 : 1]!.fz;
  if (self < 0.05 * W) return 'air';
  const other = ctx.sensors.feet[side === 'l' ? 1 : 0]!.fz;
  return other < 0.05 * W ? 'single' : 'stand';
}

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
const FOOT_LAT = { k: 1200, kv: 0.6, kAcc: 400, cap: 120, tau: 0.18 };   // ★ §2.162 拓抓地：腔额状负荷下滚动 8.6cm→k800→1200/cap60→120;   // ★ 60 保留（用户：效果挺好）   // ★ cap 非瓶颈（实测 60 无效：need本身小）
let _footLatTau = 0, _footLatVPrev = 0;
let _copFwdF = 0, _kvF = 0;   // ★ §2.138 CoP/速度低通（踝 tf 与膝 brake 抗抖）
export function resetFootLateral(): void { _footLatTau = 0; _footLatVPrev = 0; }
export function footLateral(ctx: ServoRefs, support: 'l' | 'r', zRef: number, dt = 1 / 240): void {
  // （足部倾斜闭环实验：对齐55%纪录但危险动量8×崩——足部纠偏灌侧向动量；回滚待"上游对齐"路线）
  // （文献机制保留：足平→距下中立→胫骨对齐→膝髋回正；但须在上游先立直，踝不是纠偏端）
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
  // ★ 支撑腿肌肉反射注入（§2.118：世界倾角 → 本地纠偏误差；驱动层做弹簧+阻尼）
  //   目标：大腿竖直（倾角→0）+ 足底平贴（倾角→0）。B 相实测腿本就竖直（误差≈0，不干扰），
  //   C 相塌线时误差大→强恢复（大腿 −27°→误差 0.47rad→188 N·m@K400）。
  {
    const rollOf = (key: string): number => {
      const ix = ctx.body.indexByKey.get(key);
      if (ix === undefined) return 0;
      const q = ctx.body.bodies[ix]!.rotation();
      return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.z * q.z + q.y * q.y));
    };
    const sgn = side === 'r' ? 1 : -1;
    const r = ctx.bal.drive.legReflex;
    r.side = side;
    r.hipErr = -sgn * rollOf(`thigh_${side}`);
    r.footErr = -sgn * rollOf(`foot_${side}`);
    // ★ 骨盆滚转阻尼对偶（§2.119：只吃滚转速度，±60 N·m 上限；不抢位置=不伤对齐）
    r.pelvisDamp = Math.max(-200, Math.min(200, -300 * (ctx.sensors.torsoAngVel[1] ?? 0)));   // ★ 60/60→300/200（强阻尼=吸能非修正）
  }
  // ★ 主动任务发力（§2.34）：支撑柱=Winter 标准值（踝跖屈/膝伸/髋伸），动作层直接写；
  //   卸载补偿并入（单写手）；当拍命令发布给 pad 同源化（零延迟，治抖）
  const other = side === 'l' ? 'r' : 'l';
  const W = ctx.body.sk.massTotal * 9.81;
  const lostW = ctx.sensors.feet[other === 'l' ? 0 : 1]!.fz;
  const push = Math.min(120, Math.max(0, lostW) * 0.5);   // ★ §2.138 连续化（原 0.01W 硬阈值→轻触时 0↔60 跳变=抖源）
  // ★ §2.142 离地自动调参（用户）：摆动腿脚离地(fz小)→其被动阻尼×3（肌肉共激活）；触地即回 1（保落地顺应）
  {
    const other = side === 'l' ? 'r' : 'l';
    const m = footModeOf(ctx, other);
    ctx.bal.drive.legReflex.swingAirBoost = m === 'air' ? FOOT_SERVO.air.dampBoost : 1.0;
    const mSelf = footModeOf(ctx, side);
    ctx.bal.drive.legReflex.supDampBoost = mSelf === 'single' ? FOOT_SERVO.single.dampBoost : 1.0;
  }
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
      // ★ §2.194 两帧平均速度（用户：下移会跳）：原逐帧差×240=噪声放大器→posTq ±半百 120Hz 交替
      const pvRaw = _prevPx != null ? (px - _prevPx) / (1 / 240) : 0;
      _prevPx = px;
      const pv = 0.5 * (pvRaw + (_prevPv ?? pvRaw));
      _prevPv = pvRaw;
      posTq = Math.max(-55, Math.min(55, -err * 140 - pv * 10));   // ★ §2.189 盆骨轻：220/±90→140/±55
      if (Math.abs(err) > 0.03) alignBoost = Math.min(1, (Math.abs(err) - 0.03) / 0.05);
    }
  }
  // ★ 踝的削力形态（§2.110：恒定 ff→响应式 PD）：CoP 越靠前越少推（省额度）
  let tfBase = 30 + push * 0.5;
  {
    const fr2 = ctx.sensors.feet[side === 'l' ? 0 : 1]!;
    if (fr2.copValid && fr2.loaded) {
      const copFwdRaw = fr2.copX - ctx.sensors.com[0]!;
      _copFwdF += (copFwdRaw - _copFwdF) * (1 - Math.exp(-dt / 0.06));   // ★ §2.138 低通 τ0.06（原始 CoP 噪声直接进 tf=抖源）
      tfBase = Math.max(5, Math.min(90, 30 - _copFwdF * 250));   // 系数 500→250
    }
  }
  const tf = tfBase, tk = 18 + push * 0.3, th = -10 - push * 0.05 + posTq - 18 * alignBoost;   // ★ §2.193 tk 90→18（论文值~16；原90=单腿 B相蹬飞躯体的弹射器！）   // ★ 位置伺服 + 踝削力 PD
  supportCmd[side].foot = tf; supportCmd[side].knee = tk; supportCmd[side].hip = th;
  // ★ 支撑腿绷直（§2.104：用户“腿不绷直”；实测支撑膝 15-19° 全程弯）：
  //   膝关节加角度目标闭环（目标 0°）——腿做承重柱而非软弹簧。
  // （§2.191 并链：膝位置伺服撤除——支撑柱=纯力矩单写手）
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
      const kvRaw = diKv >= 0 ? ctx.body.dofs[diKv]!.vel : 0;
      _kvF += (kvRaw - _kvF) * (1 - Math.exp(-dt / 0.04));   // ★ §2.138 速度低通（噪声×22 直接进力矩=抖源）
      const kv = _kvF;
      const brake = 0;   // 【审计】屈膝反射 OFF   // 屈曲速度（负）→ 制动
      // ★ §2.190 抗塌 PD化（用户：躬躬+蹬地挺腰时脚一直跳）：P录只有位置项→与躯体垂直模态共振；加速度阻尼
      const tSq = Math.min(60, Math.max(0, 900 * dy - 150 * (ctx.sensors.comVel[1] ?? 0)));
      put(`knee_${side}`, 2, tk + tSq + brake);
      // ★ §2.137 拖王修复（用户：踝写法导致高频抖）：原为**覆盖式 toggle**（dy 跨 0.005 阀值时
      //   踝力矩在 tf（±30N·m）与 -tSq×0.6 之间硬跳）——改为连续叠加：踝 = 基线 tf + 抗塌增量
      put(`foot_${side}`, 2, tf - tSq * 0.6);
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
