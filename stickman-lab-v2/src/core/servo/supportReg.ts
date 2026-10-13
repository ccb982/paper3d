import { computeMomentum } from './momentum';
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
/** ★ §2.246 天平（真实重量感知）：伺服层共享的平衡读数——基于实测 fz/CoP（接触力学，不是运动学推断）。
 *  人类的平衡感（前庭+足底压力分布）的机器等价。 */
export interface BalanceScale {
  /** 实测承重（N）与占体重比 */
  fz: number; wFrac: number;
  /** 实测压力中心（世界系，仅 loaded+copValid 时有效） */
  copX: number; copZ: number; valid: boolean;
  /** 距内侧边缘（失稳高发侧）/外侧边缘（m）——正=还有余量，负=已越 */
  marginMed: number; marginLat: number;
  /** 天平读数：CoP 相对脚中心偏移（m）——重量压在哪边 */
  tilt: number;
  /** ★ Quijoux 2021 标准量：CoP 侧向速度（m/s，低通）——失稳预测的核心变量 */
  copVz: number;
  /** ★ TTB（time-to-boundary，Hertel 系）= 边缘余量/速度（s）；负=已向外 */
  ttbMed: number; ttbLat: number;
  /** ★★ §2.254 Hof 稳定性余量 MoS：XcoM 到脚缘的距离（m）——「能不能救」的正确读数 */
  xcomZ: number; mosMed: number; mosLat: number;
  /** 是否还可挽回（mosMed>0 且 mosLat>0） */
  recoverable: boolean;
  /** ★★ §2.256 机器人判据补充：质心额状角动量 Lx（kg·m²/s，飞轮能力） */
  Lx: number;
  /** ★ 轨道能量（Sugihara，单位质量 m²/s²）：>0=CoM 将越过 CoP */
  eOrb: number;
  /** ★★ §2.257 反应延迟预测余量（用户：判定有问题；Geng2024 单腿延迟204ms）：
   *  LIPM 解析预测 t+τ 后的位置→边缘距离；提前 τ 告警 */
  mosPredMed: number; mosPredLat: number;
  /** 预测可挽回 */
  recoverablePred: boolean;
}
const FOOT_HALF_W = 0.045;
/** ★ §2.248 单腿支点切换（用户）：踝关节轴的世界 z（真实力偶支点） */
function ankleZOf(ctx: ServoRefs, side: 'l' | 'r'): number {
  const di = ctx.body.dofByName(`foot_${side}`, 2);
  return di >= 0 ? ctx.body.dofs[di]!.anchorWorld[2]! : ctx.sensors.feet[side === 'l' ? 0 : 1]!.z;
}
let _bCopPrev = 0, _bCopVf = 0, _bCopInit = false;
let _bCopZf = 0, _bCopZInit = false;
/** ★ §2.247 天平驱动的单腿侧向误差：真实 CoP 偏移（仅支撑脚侧，带预倾偏置） */
export function copeErr(ctx: ServoRefs, side: 'l' | 'r'): number {
  const bs = balanceScale(ctx, side);
  if (!bs.valid) return 0;
  const footZ = ctx.sensors.feet[side === 'l' ? 0 : 1]!.z;
  return bs.tilt;   // ★ §2.248 支点换踝轴后偏置待重定（先干净验证）
}

export function balanceScale(ctx: ServoRefs, side: 'l' | 'r'): BalanceScale {
  const s = ctx.sensors.feet[side === 'l' ? 0 : 1]!;
  const W = ctx.body.sk.massTotal * 9.81;
  const valid = s.loaded && s.copValid;
  const hw = FOOT_HALF_W;
  const medEdge = side === 'l' ? s.z - hw : s.z + hw;
  const latEdge = side === 'l' ? s.z + hw : s.z - hw;
  const marginMed = valid ? (side === 'l' ? s.copZ - medEdge : medEdge - s.copZ) : NaN;
  const marginLat = valid ? (side === 'l' ? latEdge - s.copZ : s.copZ - latEdge) : NaN;
  let copVz = 0;
  if (valid) {
    if (!_bCopZInit) { _bCopZf = s.copZ; _bCopZInit = true; }
    _bCopZf += (s.copZ - _bCopZf) * (1 - Math.exp(-(1 / 240) / 0.04));   // 控制用低通 τ0.04
    if (!_bCopInit) { _bCopPrev = s.copZ; _bCopInit = true; }
    const dt = 1 / 240;
    _bCopVf += ((s.copZ - _bCopPrev) / dt - _bCopVf) * (1 - Math.exp(-dt / 0.05));
    _bCopPrev = s.copZ;
    copVz = _bCopVf;
  }
  const ttbOf = (marg: number): number => {
    if (!Number.isFinite(marg)) return NaN;
    if (marg <= 0) return -1;
    return copVz !== 0 ? Math.abs(marg / copVz) : Infinity;
  };
  // ★ §2.254 MoS：XcoM（全身）到脚缘——踝 CoP 余量只是接触状态，能不能救看 XcoM
  const comZ = ctx.sensors.com[2]!; const vZc2 = ctx.sensors.comVel[2]!;
  const w0 = Math.sqrt(9.81 / Math.max(0.5, ctx.sensors.com[1]!));
  const xcomZ = comZ + vZc2 / w0;
  let LxNow = 0;
  try { LxNow = computeMomentum(ctx.body).L.x; } catch { LxNow = 0; }
  // ★ §2.259 支撑域 = **所有承重脚的并集**（用户：抬脚后才用支撑脚判）：
  //   双脚站立 = 两脚并集；单腿时摆脚卸载→自然退化为支撑脚单独判。
  // ★ §2.257 反应延迟预测：LIPM 解析解 x(τ) = p + (x−p)cosh(ωτ) + (v/ω)sinh(ωτ)，τ=0.2s
  const tauP = 0.2;
  const xPredZ = s.copZ + (comZ - s.copZ) * Math.cosh(w0 * tauP) + (vZc2 / w0) * Math.sinh(w0 * tauP);
  let hiS = medEdge, loS = latEdge;
  {
    const loaded = ctx.sensors.feet.filter((f) => f.loaded);
    if (loaded.length > 0) {
      let hiA = -Infinity, loA = Infinity;
      for (const f of loaded) { hiA = Math.max(hiA, f.z + FOOT_HALF_W); loA = Math.min(loA, f.z - FOOT_HALF_W); }
      hiS = hiA; loS = loA;
    }
  }
  const mosMed = side === 'l' ? (xcomZ - hiS) : (hiS - xcomZ);   // ★ §2.259 边缘→XcoM（承重脚并集）
  const mosLat = side === 'l' ? (loS - xcomZ) : (xcomZ - loS);
  return {
    fz: s.fz, wFrac: s.fz / W,
    copX: s.copX, copZ: s.copZ, valid,
    marginMed, marginLat,
    tilt: valid ? s.copZ - ankleZOf(ctx, side) : NaN,   // ★ §2.248 支点=踔轴
    copVz,
    ttbMed: ttbOf(marginMed), ttbLat: ttbOf(marginLat),
    xcomZ, mosMed, mosLat,
    recoverable: xcomZ > loS && xcomZ < hiS,
    Lx: LxNow,
    eOrb: 0.5 * vZc2 * vZc2 - 0.5 * w0 * w0 * (comZ - s.copZ) * (comZ - s.copZ),
    mosPredMed: side === 'l' ? (xPredZ - hiS) : (hiS - xPredZ),
    mosPredLat: side === 'l' ? (loS - xPredZ) : (xPredZ - loS),
    recoverablePred: xPredZ > loS && xPredZ < hiS,
  };
}

/** ★ §2.216 踝额状锁锚点（单腿承重升沿捕获，同步释放） */
const _ank0Lock: { l: number | null; r: number | null } = { l: null, r: null };
let _goldenL = 0, _goldenR = 0;   // ★ §2.227 黄金窗口计时（承重上升沿起算，0.25s 内 D×3）
/** ★ §2.243 内收/外展共收缩锚（承重升沿捕获髋额状角） */
const _hip0Lock: { l: number | null; r: number | null } = { l: null, r: null };
let _prevVzRawB = 0, _azF = 0;   // ★ §2.228 加速度前瞻（原始速度差分×低通 τ0.03）
/** ★ §2.265 修正段（用户：有力且慢、彻底改变腿的走势）：检漂→锁方向→慢起→持续强推→反转后释放 */
let _fixT = 0, _fixDir = 0, _fixRamp = 0, _fixCool = 0;
let _tau2F = 0;   // ★ §2.274 τ低通（漂移档高增益把120Hz噪声放大成自振荡）
let _pelvVf = 0;   // ★ §2.220 骨盆滚速低通（原始噪声×300=cap200逐帧砸）
export function resetFootLateral(): void { _footLatTau = 0; _footLatVPrev = 0; _ank0Lock.l = null; _ank0Lock.r = null; }
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
    // ★ §2.216 踝额状“锁竖直”（用户定调：踝发力时应锁住、腿别侧偏）：
    //   原：world 足平贴地目标（小腿跟着躯干倒）+Kd15 在小惯量踝轴上 40Hz 自激 ±102（陀螺上椭）。
    //   新：单腿承重升沿捕获踝内外翻相对角为锚，PD 锁回（足平地→小腿恒竖直）。
    {
      const df0 = ctx.body.dofByName(`foot_${side}`, 0);
      const loaded0 = ctx.sensors.feet[side === 'l' ? 0 : 1]!.fz > 0.25 * ctx.body.sk.massTotal * 9.81;
      if (df0 >= 0) {
        if (loaded0) {
          if (_ank0Lock[side] === null) {
            _ank0Lock[side] = ctx.body.dofs[df0]!.angle;
            if (side === 'l') _goldenL = 0; else _goldenR = 0;
            const dh0 = ctx.body.dofByName(`hip_${side}`, 0);
            _hip0Lock[side] = dh0 >= 0 ? ctx.body.dofs[dh0]!.angle : null;
          }
          // ★ §2.270 用户：“脚的抓地做不到了”——撤回 T=2s 慢回正（它软了锁），锁锚固定
          r.footErr = _ank0Lock[side]! - ctx.body.dofs[df0]!.angle;
        } else {
          _ank0Lock[side] = null;
          _hip0Lock[side] = null;
          r.footErr = 0;
        }
      }
      if (side === 'l') _goldenL += dt; else _goldenR += dt;
    }
    // ★ §2.217 足贴地守卫（用户：“足部要始终贴地保证发力”）：
    //   foot 世界滚角→回平小额病矩（±120 N·m/rad、±40）——与软锁叠加，防边缘焕起失去接触。
    {
      const diF = ctx.body.dofByName(`foot_${side}`, 0);
      if (diF >= 0) ctx.bal.drive.setTorque(diF, Math.max(-40, Math.min(40, -120 * sgn * rollOf(`foot_${side}`))));
    }
    // ★ §2.219 骨盆搬运 PD（用户：“光承重腿不该让自己侧倒”；Winter：侧向=髋策略）：
    //   原仅阻尼（±200）——骨盆稳稳骑在“决窗杆”顶上无人管，一旦有偏差只有跌倒。
    //   新增位置项：CoM侧向偏差（CoM−支撑脚）→髋外展把骨盆搬回脚上方。
    //   kpZ=900 N·m/m ≈ 1.3×体重（扶住侧偏的物理量级；Inman 全偏载 112 N·m）。
    const dZ = ctx.sensors.com[2]! - ctx.sensors.feet[side === 'l' ? 0 : 1]!.z;
    // ★ §2.220 探针回读：骰外展 60↔195 以 10Hz 逐帧交替——原始 torsoAngVel（噪声 ±6.4）×300 直接牵满 ±200 cap，净转向为零。低通τ0.05 后再提位置项。
    _pelvVf += ((ctx.sensors.torsoAngVel[1] ?? 0) - _pelvVf) * (1 - Math.exp(-dt / 0.05));
    // ★ §2.221 Hof 2007 机制②显式实现：侧向 CoM 加速度由“髋外展旋转上躯”产生
    //   τ = (m_up·h_up)·a_des；髋转矩反作用由踝额状锁+贴地守卫锤到地面（前岛延伸“撑住”）。
    //   a_des = PD(CoM 侧向) ——D 用 CoM 速度（低通过的），不再用符号混乱的躯干角速。
    // ★ §2.247 天平驱动（用户：脊柱/腿的发力全依赖天平读数）：真实 CoP 偏差+速度，非运动学
    const vZc = ctx.sensors.comVel[2] ?? 0;   // ★ §2.248 回运动学（天平保留为感知/触发层）
    // ★ §2.226 间歇控制（Asai 2009/Loram 2011/Suzuki 2012）：“不停左右拉扯”的物理形式——
    //   鞍形稳定流形附近（s=v+ω₀·dZ≈0）：PD关（沿流形自滑行=自然摇摆）；
    //   偏离流形：开一个**温和**PD（文献：增益远小于连续型仍稳）。
    const omega0 = Math.sqrt(9.81 / Math.max(0.5, ctx.sensors.com[1]!));
    const sMan = vZc + omega0 * dZ;
    const m2On = Math.abs(dZ) > 1e-9 || Math.abs(sMan) > 1e-9;   // ★ §2.235 用户：>0cm 就得发力（死区彻底拿掉，连续调节）
    // ★ §2.227 黄金窗口（用户：前0.1s 才是保持平衡的黄金时间）：刚承重 0.25s 内 D 权×3——
    //   转移来速 −8cm/s 进来就刹（Masani 速度优先），而非拖到 185ms 才爆一锤（实测：早期反而凹到 64）。
    const golden = (side === 'l' ? _goldenL : _goldenR) < 0.25;
    // ★ §2.228 加速度前瞻（用户：伺服层要捦捉小加速度预测、提前发力）：
    //   原始速度差分出 az（comVel 是100ms低通差不出）→ 预测项 +τ_pred·az（τ_pred≈0.125s，即 12×0.125=1.5）
    const vzRawB = ctx.sensors.rawVel[2] ?? 0;
    _azF += ((vzRawB - _prevVzRawB) / Math.max(dt, 1e-6) - _azF) * (1 - Math.exp(-dt / 0.018));   // ★ §2.230 Welch&Ting09：加速度编码=瞬态限时（肌梭动态响应）→τ0.03→0.018
    _prevVzRawB = vzRawB;
    // ★ §2.230 加速度项：α=3、限幅±1.5 m/s²（即 τ≤22.5）——原 5.0 无限幅在帧间噪声上爆 282→9 翻跳
    const aAcc = Math.max(-2.0, Math.min(2.0, 4.0 * _azF));
    const aDes = m2On ? -(120 * dZ + 20 * vZc + aAcc) : 0;   // ★ §2.248 判决：CoP不是内环误差信号（它是内环的输出）——回运动学 dZ；eCop两符号均发散留档
    // ★ §2.227 黄金窗口远端先发（Horak：踝最先 73-110ms；回读：窗口内踝额状 −2~−7=静默）：
    //   承重后 0.25s 内踝额状 = CoM 速度刹车（与贴地守卫合并写入）
    {
      const diF = ctx.body.dofByName(`foot_${side}`, 0);
      if (diF >= 0) {
        let t = -120 * sgn * rollOf(`foot_${side}`);
        // ★ §2.270 用户方案B：“踝在一开始就得大发力”——黄金窗口大发力（原值；扩展版失控 vZ−115 已撤）
        if (golden) t += Math.max(-45, Math.min(45, -sgn * (800 * dZ + 400 * vZc)));
        ctx.bal.drive.setTorque(diF, Math.max(-60, Math.min(60, t)));
      }
    }
    // ★ §2.255 侧向 M-mode（Krishnamoorthy&Latash 03：固定权重表×单标量，全同号——治对拉）
    //   权重：髋 .45 / 脊柱1-3 各 .15 / 踝 .10；总需求 T=33·aDes（髋份量保持☆记录档量级）
    // ★ §2.261 实测标定+增益调度：静止=×15（☆记录档）；漂移≥2.5cm/s 渐变到 ×100（实测-300才按得住）
    const drift = Math.max(Math.abs(vZc) - 0.005, 0);
    const wDrift = Math.min(1, drift / 0.02);
    let tau2 = (15 + 85 * wDrift) * aDes;   // ★ §2.279fix az解耦实测无净益→回可用档   // ★ §2.264 试×150(腿重配)=外冲跑飞(0.0616)→回纪录档×100
    // ★ §2.274 τ低通30ms（漂移档高增益下，az噪声×100=±200N·m@120Hz自振荡的根治）
    _tau2F += (tau2 - _tau2F) * (1 - Math.exp(-dt / 0.03));
    tau2 = _tau2F;
    // ★ §2.265 修正段：有力且慢——持续强推才能彻底改腿走势
    if (_fixT > 0) {
      _fixT -= dt;
      _fixRamp = Math.min(1, _fixRamp + dt / 0.15);   // ★ §2.266 更慢：慢起 60→150ms
      const rev = Math.sign(vZc) === -_fixDir && Math.abs(vZc) > 0.01;   // 速度已反转
      // 就高不就低：保持方向，幅值 max(260×ramp, 同向 PD)
      const agree = _fixDir * tau2 > 0;
      const mag = Math.max(260 * _fixRamp, agree ? Math.abs(tau2) : 0);
      tau2 = _fixDir * mag;
      if (_fixT <= 0 || rev) { _fixT = 0; _fixCool = 0.25; }
    } else {
      _fixCool = Math.max(0, _fixCool - dt);
      const goldT = side === 'l' ? _goldenL : _goldenR;
      if (_fixCool <= 0 && goldT > 0.6 && Math.abs(vZc) > 0.018) {   // ★ §2.265 门控：承重>0.6s后（转移期豁免）
        _fixT = 0.80; _fixDir = -Math.sign(vZc); _fixRamp = 0;   // ★ §2.266 更持久：0.3→0.8s
      }
    }
    // ★ §2.242 单腿段默认预置偏置（用户：预先多发力补偿/两侧对称必摔；
    //   文献：Inman 静态需求 112N·m + APA 预激活（Aruin&Latash95/Mouchnino96）；
    //   边界判决实验：恒力−100 静态锁死全身，− = 背离抬腿侧方向）：
    //   对侧腾空时，支撑髋额状恒定−BIAS
    // ★ §2.273 用户：大腿发力不应该有阻尼——ITB 被动(台账−100~−147)也在吃 act；漂移期让位(45→6)
    ctx.bal.drive.opt.itbStiffness = Math.abs(vZc) > 0.02 ? 6 : 45;
    // ★ §2.276 （240Hz铁证）：支撑髋额状上有**帧陈旧伺服目标**（servo=−280 常驻）
    //   与 M2 的 act(+330) 正面对消——净力只剩±34。该轴归纯力矩：清掉伺服目标。
    {
      const diH0c = ctx.body.dofByName(`hip_${side}`, 0);
      if (diH0c >= 0) ctx.bal.drive.clearAngle(diH0c);
    }
    // ★ §2.285 危险姿态锁（用户：上身还是急速到很危险的角度，需要在危险姿态锁上）：
    //   躯干世界滚角>8.6° → 脊柱三节强回正（单边虚拟墙，仅挡越界，不碰小摆）
    {
      const tilt = ctx.sensors.torsoTilt[1] ?? 0;
      const DANGER = 0.15;
      if (Math.abs(tilt) > DANGER) {
        const sgnT = Math.sign(tilt);
        const mag = Math.min(140, (Math.abs(tilt) - DANGER) * 1500);
        for (const sn of ['spine1', 'spine2', 'spine3']) {
          const diS2 = ctx.body.dofByName(sn, 0);
          const manS2 = ctx.bal.manual;
          if (diS2 >= 0 && (!manS2 || manS2.torqueOf(diS2) === 0)) {
            ctx.bal.drive.setTorque(diS2, -sgnT * mag);   // ★ §2.285 符号实测翻转（墙回正）
          }
        }
      }
    }
    const otherAirborne = footModeOf(ctx, side === 'l' ? 'r' : 'l') === 'air';
    const bias = otherAirborne ? -40 : 0;
    // ★ §2.243 内收肌共收缩（用户：大腿内侧是否也默认多发力；文献：单腿站内收肌大量激活=同轴共收缩→刚度）
    //   做刚度（向承重锚角的弹簧）而非偏置——只加刚度、不搬平衡点
    const dh0b = ctx.body.dofByName(`hip_${side}`, 0);
    let coCon = 0;
    if (dh0b >= 0 && _hip0Lock[side] !== null) coCon = -300 * (ctx.body.dofs[dh0b]!.angle - _hip0Lock[side]!);
    r.pelvisDamp = Math.max(-330, Math.min(330, tau2 + bias + coCon - 0 * _pelvVf));   // ★ §2.272 台账：阻尼项逐帧吃掉 act 的30-80%且反相→系数0试（-300 留档）
    // ★ §2.263 漂移窗脊柱力共发（与髋同向）：服务器在漂移期已停位（§2.262），
    //   这时脊柱力不会被位置伺服吃掉；把总量从☋260 顶到☋450（实测扭转阈值）
    if (Math.abs(vZc) > 0.02 || Math.abs(dZ) > 0.03) {
      for (const sn of ['spine1', 'spine2', 'spine3']) {
        const diS = ctx.body.dofByName(sn, 0);
        const manS = ctx.bal.manual;
        if (diS >= 0 && (!manS || manS.torqueOf(diS) === 0)) {
          const cof = (globalThis as unknown as { __NOCOF?: boolean }).__NOCOF ? 0 : 0;   // ★ §2.267 判决：共发两符号均害（原号加速爬行/翻号逆向狂奔）→彻底禁用留档
          ctx.bal.drive.setTorque(diS, Math.max(-120, Math.min(120, -cof * tau2)));   // ★ §2.267 符号实测翻转（脊柱矩阵与 lean 符号相反）
        }
      }
    }
    // ★ §2.255 脊柱力矩空间实验失败已撤（与位置伺服对拉）——改在目标空间单模式（lateralStab）
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
