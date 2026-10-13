import { computeMomentum } from './momentum';
import { observe as observeUnified, modeOf as uModeOf, unifiedActive, resetUnifiedRefs } from './unified';   // ★ §2.361-365/420
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
let _torsoW0: number | null = null;   // ★ §2.541 足世界角锁基准
let _legRoll0: { l: number | null; r: number | null } = { l: null, r: null };   // ★ §2.545 腿柱世界roll锁基准(小腿)
let _goldenL = 0, _goldenR = 0;   // ★ §2.227 黄金窗口计时（承重上升沿起算，0.25s 内 D×3）
/** ★ §2.243 内收/外展共收缩锚（承重升沿捕获髋额状角） */
const _hip0Lock: { l: number | null; r: number | null } = { l: null, r: null };
let _prevVzRawB = 0, _azF = 0;   // ★ §2.228 加速度前瞻（原始速度差分×低通 τ0.03）
/** ★ §2.265 修正段（用户：有力且慢、彻底改变腿的走势）：检漂→锁方向→慢起→持续强推→反转后释放 */
let _fixT = 0, _fixDir = 0, _fixRamp = 0, _fixCool = 0;
let _tau2F = 0;   // ★ §2.274 τ低通（漂移档高增益把120Hz噪声放大成自振荡）
let _pelvVf = 0;   // ★ §2.220 骨盆滚速低通（原始噪声×300=cap200逐帧砸）
export function resetFootLateral(): void { _footLatTau = 0; _footLatVPrev = 0; _ank0Lock.l = null; _ank0Lock.r = null; _torsoW0 = null; _legRoll0 = { l: null, r: null }; }
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
  // ★ §2.428 一轴一律：不再 setTorque（_footLatTau 作为脚 pair λ 的偏置被读取）
  void support;
}

/** ★ §2.337（用户：继续）：抬腿完成旗标——由动作层 B→C 相位事件直接设（不猜脚状态） */
let _liftDoneFlag = false;
/** ★ §2.498 用户：腰部矢状需知道初始弯曲程度并维持在它附近——单腿入场捕获的初始弯曲。 */
export const sagInit: { s1: number; s2: number; s3: number; hip2: number; pitchW: number } = { s1: 0, s2: 0, s3: 0, hip2: 0, pitchW: 0 };
export function setLiftDone(v: boolean): void {
  // ★ §2.420 用户：刚进入指挥层的瞬间的躯干角度就是基准值！——入场即重捕全部基准
  if (v && !_liftDoneFlag) {
    resetUnifiedRefs();
    _ank0Lock.l = _ank0Lock.r = null;
    _knee0Lock.l = _knee0Lock.r = null;
    _hip0Lock.l = _hip0Lock.r = null;
    _comZBase.l = _comZBase.r = null;
    _corrHipF = 0;
  }
  _liftDoneFlag = v;
}
export function isLiftDone(): boolean { return _liftDoneFlag; }   // ★ §2.364 HUD 用

let _revInt = 0;   // ★ §2.351 目的性外环积分（不达目的不罢休）

const C_LEG_BASE = 0.5;   // ★ §2.324 腿柱基档
/** ★ §2.334（用户：三道防线像阻尼/横过来太快）：腿柱锁随风险升（Wissmann 全躯僶直） */
function cLegRisk(ctx: ServoRefs): number {
  const tilt = Math.abs(ctx.sensors.torsoTilt[1] ?? 0);
  // ★ §2.335 前馈预锁（用户选 2：Welch&Ting 初始爆发）：风险=max(角度, 预测速度)
  const vz = ctx.sensors.comVel[2] ?? 0;
  const pred = Math.max(0, Math.abs(vz) - 0.02) / 0.08;
  const risk = Math.min(1, Math.max(tilt / 0.1745, pred));
  // ★ §2.480 用户：抬腿后完全软了——全腿基础张力下限提到 0.6（绷着是底色，修正是添加）
  return Math.max(0.75, C_LEG_BASE + 0.45 * risk * risk);   // ★ §2.481 单腿指挥层专属张力0.75(与站立基线分开)
}
let stiffEnv = 0;   // ★ §2.291 僵直包络（渐起，防一帧冲量锤）
let _knee0Lock: { l: number | null; r: number | null } = { l: null, r: null };
const _comZBase: { l: number | null; r: number | null } = { l: null, r: null };   // ★ §2.333 天平基准   // ★ §2.296 支撑柱膝捕获
let _footCap = 60;  // ★ §2.294 足接触容量封顶（天平：fz×CoP余量）
let _corrHipF = 0;
let _sagCaptured = false;   // ★ §2.498 矢状初始弯曲捕获旗  // ★ §2.406b 盆骨扶正偏移低通滤波（力链 dZ 是噪声信号，直喂 λ 会逐帧抽鞭撞 τmax）

/** ★ §2.285 危险墙 */
export function supportColumn(ctx: ServoRefs, side: 'l' | 'r', dt = 1 / 240): void {
  // ★ §2.361 stage-2：统一观测器（三源+谓词）——一切判断从这份状态出
  // ★ §2.498 捕获脊柱矢状初始弯曲（单腿入场首帧）
  // ★ §2.525 CoM速度限速环（用户：跌落每秒只有3cm）：单向——只限"远离支撑"方向的跌速
  {
    const comVz = ctx.sensors.comVel[2] ?? 0;
    const fallingAway = Math.sign(comVz) !== Math.sign(_comZBase[side] ?? -1e-9) && Math.abs(comVz) > 0.03;
    void fallingAway;
    const supZ = ctx.sensors.feet[side === 'l' ? 0 : 1]!.z;
    const away = Math.abs(comVz) > 0.03 && Math.sign(comVz) === -Math.sign(supZ);
    const mgV = Math.max(0, Math.min(1, (Math.abs(comVz) - 0.03) / 0.05));
    ctx.bal.drive.pairDampGlobal = away ? 1 + 3 * mgV : 0.4;   // 跌向:重阻尼(至×4); 回向/静止:轻
  }
  if (_liftDoneFlag && !_sagCaptured) {
    _sagCaptured = true;
    for (const [sn, k] of [['spine1', 's1'], ['spine2', 's2'], ['spine3', 's3']] as Array<[string, 's1' | 's2' | 's3']>) {
      const di = ctx.body.dofByName(sn, 2);
      sagInit[k] = di >= 0 ? ctx.body.dofs[di]!.angle : 0;
    }
    // ★ §2.503 用户：力要以初始角度为基准——同时捕获髇矢状初始角
    const dh2c = ctx.body.dofByName(`hip_${side}`, 2);
    sagInit.hip2 = dh2c >= 0 ? ctx.body.dofs[dh2c]!.angle : 0;
    // ★ §2.526 世界姿态初始值（胸/腰的世界 pitch）
    const ixT = ctx.body.indexByKey.get('spine3');
    if (ixT !== undefined) { const q = ctx.body.bodies[ixT]!.rotation(); const ux = 2*(q.x*q.y-q.w*q.z), uy = 1-2*(q.x*q.x+q.z*q.z); sagInit.pitchW = Math.atan2(-ux, uy); }
  }
  if (!_liftDoneFlag) _sagCaptured = false;
  // ★ §2.530 跨节肌肉装配（用户：脊柱间肌肉控制拉伸）：跨2节×2 + 跨3节×1，侧向+矢状各一套
  {
    const list: Array<{ dofs: number[]; c: number; ref: number }> = [];
    const axDofs = (ax: number): number[] => ['spine1', 'spine2', 'spine3'].map((sn) => ctx.body.dofByName(sn, ax));
    const cSp = Math.max(0.8, cLegRisk(ctx));
    for (const ax of [0, 2] as const) {
      const ds = axDofs(ax);
      if (ds.some((d) => d < 0)) continue;
      if (ax === 2) {
        const ref = sagInit.s1 + sagInit.s2 + sagInit.s3;
        list.push({ dofs: [ds[0]!, ds[1]!], c: cSp, ref: ((sagInit.s1 + sagInit.s2 - ref) * 0 + (ref - sagInit.s3)) * 0 + (sagInit.s1 + sagInit.s2) });
        list.push({ dofs: [ds[1]!, ds[2]!], c: cSp, ref: sagInit.s2 + sagInit.s3 });
        list.push({ dofs: [ds[0]!, ds[1]!, ds[2]!], c: cSp, ref });
      } else {
        list.push({ dofs: [ds[0]!, ds[1]!], c: cSp, ref: 0 });
        list.push({ dofs: [ds[1]!, ds[2]!], c: cSp, ref: 0 });
        list.push({ dofs: [ds[0]!, ds[1]!, ds[2]!], c: cSp, ref: 0 });
      }
    }
    ctx.bal.drive.commandSpanMuscles(list);
  }
  // ★ §2.544 腹斜肌=斜向链（文献：Colonna 螺旋链跑对角线）：λ=小量对角偏移(∝脊柱残差)
  {
    const diagYaw = Math.max(-0.05, Math.min(0.05, (ctx.bal.drive.legReflex.latResidS / 60) * 0.05));
    for (const sn of ['spine1', 'spine2', 'spine3']) {
      const dyy = ctx.body.dofByName(sn, 1);
      if (dyy >= 0) ctx.bal.drive.commandMusclePair(dyy, Math.max(0.7, cLegRisk(ctx)), diagYaw);
    }
  }
  const U = observeUnified(ctx, side);
  const U_MODE = uModeOf(U, _liftDoneFlag);   // ★ §2.362 统一模式
  const U_ACTIVE = unifiedActive(U, _liftDoneFlag);   // ★ §2.365 单腿才成立
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
    // ★ §2.296 支撑柱（用户：支撑腿必须稳定+大力矩全传地下）：髇/膝改**捕获位置持**（同踝锁）——
    //   旧“拉世界竖直”会与 M2 对拉；捕获柱保持入相姿态（A结尾已验证 CoM4.2cm/tilt−0.4°）。
    // ★ §2.432 申请制：自下而上的力预算（接触→踝→膝→髋→脊柱，多层审批，min逐级收窄）
    //   文献：Orin&Oh 1981 力分配 / Caron 2015 接触扳手锥（最底层预算）/ Sentis 层级约束裁剪。
    {
      const kAT = 6;   // ★ §2.485 临床标定前的提档实验(初估 3 偏保守→6，整链放大四倍)
      const capAnkle = _footCap;                              // 接触层批准：fz×CoP余量（已有）
      const capKnee = Math.min(300, capAnkle * kAT);         // 踝批的×传导，受膝τmax
      const capHip = Math.min(228, capKnee * kAT);           // 膝批的×传导，受髋τmax
      const capSpine = Math.min(470, capHip * 2);            // ★ §2.494 用户：腰不到论文水平！156拍脑封顶→按脊柱τmax重算(3节×142≈426,取470)
      const df0c = ctx.body.dofByName(`foot_${side}`, 0);
      const dk0c = ctx.body.dofByName(`knee_${side}`, 0);
      const dh0c = ctx.body.dofByName(`hip_${side}`, 0);
      // ★ §2.549 预算补全（回读：偏航对无pairCap=Infinity——申请制漏洞）：全轴上预算
      for (const [jn, cap] of [['foot', capAnkle], ['knee', capKnee], ['hip', capHip]] as Array<[string, number]>) {
        for (const ax of [0, 1, 2]) {
          const dc = ctx.body.dofByName(`${jn}_${side}`, ax);
          if (dc >= 0) ctx.bal.drive.pairCap[dc] = cap;
        }
      }
      for (const snc of ['spine1', 'spine2', 'spine3']) {
        for (const ax of [0, 1, 2]) {
          const dsc = ctx.body.dofByName(snc, ax);
          if (dsc >= 0) ctx.bal.drive.pairCap[dsc] = capSpine;
        }
      }
    }
    if (_hip0Lock[side] !== null) {
      const dh1 = ctx.body.dofByName(`hip_${side}`, 0);
      r.hipErr = dh1 >= 0 ? _hip0Lock[side]! - ctx.body.dofs[dh1]!.angle : 0;
      // ★ §2.404 用户：盆骨也要有±10°的修正（以水平为基准，不只是捕获旧姿态）：
      //   回读：hip_r/0 唯一写手=肌肉对但 λ=捕获旧姿态(−15°)→只会拉回旧位、不会扶正；倒时 act 跑到 −79。
      //   修=λ = 捕获姿态 + 依世界倾斜的扶正偏移（±10°钳位）——盆骨的"挺腰"。
      // ★ §2.405 用户：盆骨发力要基于力链（不是盲目弹簧→太猛飞出去）：
      //   力链 dZ = 重力线到髇的垂距 → 需求矩 = 体重×dZ（物理真值，N·m）
      //   λ偏移 = 需求矩/(K×C)（刚好抵消、不多不少）—— 不抢不欠。
      const Wtot2 = ctx.body.sk.massTotal * 9.81;
      const hc = U.chain.find((c: { name: string }) => /thigh/.test(c.name));
      const effK = Math.max(60, ctx.bal.drive.opt.musclePairK * cLegRisk(ctx));
      // ★ §2.467 删旧建新：旧M2=T链 bang-bang+打架;新=盆骨力=λ世界修正直接拉满一轴
      // ★ §2.486 回读：λ 跟随误追认(实际−46→λ−45,偏差≈0,永不出力)——反向：λ 参照竖直，偏离越大回正越强（与实际相反的方向）。
      // ★ §2.544 侧向链分工（文献：Borghi2023 螺旋链[踝TA+臀中肌相关0.89]/Nature2025 踝饱和→髋接力/PMC5056157 GRF斜向合力）
      //   需求=W×CoM侧偏(相对支撑脚)；足→髋→腰自下而上接力，各级只吃上级吃剩的残差
      const _latNeed = Wtot2 * (ctx.sensors.com[2]! - ctx.sensors.feet[side === 'l' ? 0 : 1]!.z);
      ctx.bal.drive.legReflex.latNeed = _latNeed;
      ctx.bal.drive.legReflex.latResidS = _latNeed;   // ★ 链门控信号=物理需求(需求超出下层常规容量→腰上岗)
      const corrRaw = Math.max(-0.35, Math.min(0.35, (U.tiltRelDeg / 57.3) * 5.0 - (Wtot2 * (hc ? hc.dZ : 0)) / effK));   // ★ §2.552 大腿发力实验:3→5
      const aHipC = 1 - Math.exp(-dt / 0.2);   // ★ §2.406b τ=0.2s 低通：力矩=f(平滑后的偏移角)
      _corrHipF += (corrRaw - _corrHipF) * aHipC;
      const corrHip = _corrHipF;
      // ★ §2.415 移植：posHip（平衡对髋的提案=leanReflex 态环）并入 pair 的 λ；leanReflex 单腿髋随之下岗
      const posHipNow = (ctx.bal as { lean?: { postureHipNow?: number } }).lean?.postureHipNow ?? 0;
      // ★ §2.427 用户：写手干净——臀中肌 tonic（25 N·m）并入 λ 偏置（"绷着"的常值分量）。
      const sgnTonic = side === 'r' ? 1 : -1;
      const effKT = Math.max(60, ctx.bal.drive.opt.musclePairK * 0.45);
      // ★ §2.467 天平余量小→C 自动加档（新盆骨力的强度维度）
      const bsNew = balanceScale(ctx, side);
      const mgNew = Math.min(bsNew.marginLat, bsNew.marginMed);
      const edgeBoost = Number.isFinite(mgNew) ? 1 + Math.max(0, Math.min(1, (0.025 - mgNew) / 0.02)) * 0.6 : 1;
      // ★ §2.473 回读：髇被撑到−46°(自然位−15°)——tonic 项(+25/effK=+6°正向)在推外展+被拖。删 tonic，λ 回自然基座。
      // ★ §2.487 用户：髇部需要很大的张力当阻尼——C 拉满(≥。=0.95)
      if (dh1 >= 0) ctx.bal.drive.commandMusclePair(dh1, Math.max(0.95, Math.min(1, cLegRisk(ctx) * edgeBoost)), _hip0Lock[side]! * 0.85 + corrHip + posHipNow);
      // ★ §2.502 髇矢状（hip/2）也上肌肉对：λ=捕获初始屈度+竖直倾向修正
      {
        const dh2 = ctx.body.dofByName(`hip_${side}`, 2);
        if (dh2 >= 0) {
          const comXoff = ctx.sensors.com[0]!;
          const fzH = ctx.sensors.feet[side === 'l' ? 0 : 1]!.fz;
          const corrH2 = Math.max(-0.3, Math.min(0.3, (fzH * comXoff) / Math.max(60, ctx.bal.drive.opt.musclePairK)));
          // ★ §2.526 世界姿态闭环：腰以上的世界 pitch 偏移→髇λ 修正（不经相对角链，直接守世界姿态）
          let corrW = 0;
          {
            const ixT = ctx.body.indexByKey.get('spine3');
            if (ixT !== undefined) {
              const q = ctx.body.bodies[ixT]!.rotation();
              const ux = 2*(q.x*q.y-q.w*q.z), uy = 1-2*(q.x*q.x+q.z*q.z);
              const pitchW = Math.atan2(-ux, uy);
              corrW = Math.max(-0.5, Math.min(0.5, (pitchW - sagInit.pitchW) * 2.0));
            }
          }
          ctx.bal.drive.commandMusclePair(dh2, Math.max(0.9, cLegRisk(ctx)), sagInit.hip2 + corrH2 + corrW);   // ★ §2.503/526 λ=初始屈度+世界姿态修正
        }
      }
    } else {
      r.hipErr = -sgn * rollOf(`thigh_${side}`);
    }
    if (_knee0Lock[side] !== null) {
      const dk1 = ctx.body.dofByName(`knee_${side}`, 0);
      r.kneeErr = dk1 >= 0 ? _knee0Lock[side]! - ctx.body.dofs[dk1]!.angle : 0;
      // ★ §2.472 用户：继续修膝——回读：膝持续负向出力(−35~−50)反着打。
      //   照搬踝/髇的力链驱动：膝 pair λ偏移 = fz×(CoM‑膝杆杆)/effK（矢状面）。
      {
        const fzK = ctx.sensors.feet[side === 'l' ? 0 : 1]!.fz;
        const kneeX = side === 'l' ? 0 : 0;   // 膝关节 x 近似（支撑姿态下近 0）
        void kneeX;
        const dXk = ctx.sensors.com[0]!;      // CoM 前后偏移（近似膝杆杆）
        const needKnee = fzK * dXk;
        const effKK = Math.max(60, ctx.bal.drive.opt.musclePairK * 0.45);
        const corrKnee = Math.max(-0.35, Math.min(0.35, needKnee / effKK));
        if (dk1 >= 0) ctx.bal.drive.commandMusclePair(dk1, cLegRisk(ctx), _knee0Lock[side]! + corrKnee);   // ★ §2.324/334/472
      }
    } else {
      r.kneeErr = -sgn * rollOf(`shin_${side}`);
    }
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
            const ixT0 = ctx.body.indexByKey.get('torso');
            if (ixT0 !== undefined) { const q0 = ctx.body.bodies[ixT0]!.rotation(); const ux0 = 2*(q0.x*q0.y-q0.w*q0.z), uy0 = 1-2*(q0.x*q0.x+q0.z*q0.z); _torsoW0 = Math.atan2(-ux0, uy0); }
            const ixS0 = ctx.body.indexByKey.get(`shin_${side}`);
            if (ixS0 !== undefined) { const qs0 = ctx.body.bodies[ixS0]!.rotation(); _legRoll0[side] = Math.atan2(2*(qs0.w*qs0.z+qs0.x*qs0.y), 1-2*(qs0.z*qs0.z+qs0.y*qs0.y)); }
            if (side === 'l') _goldenL = 0; else _goldenR = 0;
            const dh0 = ctx.body.dofByName(`hip_${side}`, 0);
            _hip0Lock[side] = dh0 >= 0 ? ctx.body.dofs[dh0]!.angle : null;
            _comZBase[side] = ctx.sensors.com[2]! - (side === 'l' ? ctx.sensors.feet[0]!.z : ctx.sensors.feet[1]!.z);   // ★ §2.333 天平基准=初始姿势的 CoM 偏移
            const dk0 = ctx.body.dofByName(`knee_${side}`, 0);
            _knee0Lock[side] = dk0 >= 0 ? ctx.body.dofs[dk0]!.angle : null;   // ★ §2.296 支撑柱：膝同步捕获
          }
          r.footErr = _ank0Lock[side]! - ctx.body.dofs[df0]!.angle;   // 保留读数（探针）
          // ★ §2.428 踝侧向抓地并入 λ（一轴一律）
          const effKF = Math.max(60, ctx.bal.drive.opt.musclePairK * 0.45);
          // ★ §2.471 用户：先修踝——回读：足底CoP需求(−45)踝只做+9且反号。
          //   照搬髇的力链驱动：λ 偏移 = 脚底物理需求矩/(K×C)（从 CoM-踝杆杆算）。
          const comZNow = ctx.sensors.com[2]!;
          const ankLever = comZNow - (ctx.sensors.feet[side === 'l' ? 0 : 1]!.z * 0);
          const ankLeverRel = comZNow - (ctx.sensors.feet[side === 'l' ? 0 : 1]!.z);
          void ankLever;
          const fzNow = ctx.sensors.feet[side === 'l' ? 0 : 1]!.fz;
          const needAnk = fzNow * ankLeverRel;   // ★ §2.471b 符号翻正（§2.349 CoP 同族）
          // ★ §2.508 用户：踝侧向几乎不出力(±7)——底层先出力原则：增益×3且扩权
          // ★ §2.532 CoP边缘墙（用户：只差抓地）：CoP偏离>70%半宽时踝矩递增（抓地最后一道闸）
          const fSelf = ctx.sensors.feet[side === 'l' ? 0 : 1]!;
          const copOffP = Math.abs(fSelf.copZ - fSelf.z) / 0.045;
          const edgeWall = copOffP > 0.7 ? 1 + 3 * Math.min(1, (copOffP - 0.7) / 0.3) : 1;
          const corrAnk = Math.max(-0.7, Math.min(0.7, (needAnk * 3 * edgeWall) / effKF));
          // ★ §2.509 用户：加侧向力的同时加向下的力（摩擦锥: N↑→侧向抓地↑）
          {
            const df2p = ctx.body.dofByName(`foot_${side}`, 2);
            if (df2p >= 0) {
              // ★ §2.510 回读：蹬地 45/170=26%太弱！——下压量→⅔型满档，C顶格
              // ★ §2.538 回退§2.535-537（用户：矢状面的力被砍/解决不了就回退）：蹬地恢复静态press
              const press = Math.max(0.06, Math.min(0.45, Math.abs(corrAnk) * 1.2 + 0.06));
              const cur2 = ctx.body.dofs[df2p]!.angle;
              let wCorr = 0;
              if (_torsoW0 !== null) {
                const ixTw = ctx.body.indexByKey.get('torso');
                if (ixTw !== undefined) { const qw = ctx.body.bodies[ixTw]!.rotation(); const uxw = 2*(qw.x*qw.y-qw.w*qw.z), uyw = 1-2*(qw.x*qw.x+qw.z*qw.z); wCorr = Math.max(-0.45, Math.min(0.45, (Math.atan2(-uxw, uyw) - _torsoW0) * 3.0)); }
              }
              // ★ §2.540 回退§2.539（实测相对偏置更糟1.41s/CoM漂移加速至5.7cm）：蹬地方向独立存疑
              ctx.bal.drive.commandMusclePair(df2p, Math.max(0.9, cLegRisk(ctx)), press + wCorr);   // ★ §2.541 足世界角锁
            }
          }
          // ★ §2.545 腿柱世界roll锁（用户：大腿站不稳/看看大腿怎么调控上身）：小腿(柱)世界roll偏离初始→踝λ修正（柱底铰链锁柱）
          let latW = 0;
          if (_legRoll0[side] !== null) {
            const ixS = ctx.body.indexByKey.get(`shin_${side}`);
            if (ixS !== undefined) { const qs = ctx.body.bodies[ixS]!.rotation(); const roll = Math.atan2(2*(qs.w*qs.z+qs.x*qs.y), 1-2*(qs.z*qs.z+qs.y*qs.y)); latW = Math.max(-0.4, Math.min(0.4, (roll - _legRoll0[side]!) * -3.0)); }
          }
          ctx.bal.drive.commandMusclePair(df0, cLegRisk(ctx), _ank0Lock[side]! + _footLatTau / effKF + corrAnk + latW);   // ★ §2.324/§2.471/§2.545
        } else {
          _ank0Lock[side] = null;
          _torsoW0 = null;
          _legRoll0[side] = null;
          _hip0Lock[side] = null;
          _knee0Lock[side] = null;
          _comZBase[side] = null;
          _corrHipF = 0;
          r.footErr = 0;
        }
      }
      if (side === 'l') _goldenL += dt; else _goldenR += dt;
    }
    // ★ §2.294 接触容量封顶（用户：脚还在踢飞）：足转矩物理上限 = fz × CoP余量（天平）——
    //   此前命令 ±40~60（以及锁 110+）超出物理上限（约±34）→ 脚被自己的命令翻过去（实测 ωz±270°/s、载 22%↔250% 碾压）。
    {
      const bsF = balanceScale(ctx, side);
      const fzN = ctx.sensors.feet[side === 'l' ? 0 : 1]!.fz;
      // ★ §2.475 用户：姿态没问题/站不住只能是发力不够！——预算用“脚的几何能力”(半宽4.5cm×fz)，
      //   而不是“CoP到边缘的剩余距离”(≈0→批准≈4N·m=全身饥荒的源头)。
      const hwF = FOOT_HALF_W * 2;   // 全脚宽 9cm 的 CoP 可搬运量
      _footCap = Math.max(20, fzN * hwF * 0.8);   // ★ §2.511 回退(cap放开无助，真因=λ追认)
      void bsF;
      ctx.bal.drive.legReflex.footTauCap = _footCap;
    }
    // ★ §2.217 足贴地守卫——★ §2.429 审计：与下方 §2.227 完全同公式(−120×sgn×rollOf)、被其覆盖=纯死写，删除。
    {
      const diF = ctx.body.dofByName(`foot_${side}`, 0);
      void diF;
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
    // ★ §2.302 回读（用户：腿还在飞）：aAcc × M2 漂移档(×100) 在抬腿瞬间燃 ±200 十几Hz 两脚互砸。
    const aAcc = Math.max(-0.6, Math.min(0.6, 1.2 * _azF));
    const aDes = m2On ? -(120 * dZ + 20 * vZc + aAcc) : 0;   // ★ §2.248 判决：CoP不是内环误差信号（它是内环的输出）——回运动学 dZ；eCop两符号均发散留档
    // ★ §2.227 黄金窗口远端先发（Horak：踝最先 73-110ms；回读：窗口内踝额状 −2~−7=静默）：
    //   承重后 0.25s 内踝额状 = CoM 速度刹车（与贴地守卫合并写入）
    {
      const diF = ctx.body.dofByName(`foot_${side}`, 0);
      if (diF >= 0) {
        const t = -120 * sgn * rollOf(`foot_${side}`);
        // ★ §2.323 删除黄金窗（判决表：临时 hack，扩展版曾泵飞 vZ−115；其职责归任务层踝分量）
        void golden;
        ctx.bal.drive.setTorque(diF, Math.max(-_footCap, Math.min(_footCap, t)));
      }
    }
    // ★ §2.255 侧向 M-mode（Krishnamoorthy&Latash 03：固定权重表×单标量，全同号——治对拉）
    //   权重：髋 .45 / 脊柱1-3 各 .15 / 踝 .10；总需求 T=33·aDes（髋份量保持☆记录档量级）
    // ★ §2.261 实测标定+增益调度：静止=×15（☆记录档）；漂移≥2.5cm/s 渐变到 ×100（实测-300才按得住）
    const drift = Math.max(Math.abs(vZc) - 0.005, 0);
    const wDrift = Math.min(1, drift / 0.02);
    let tau2 = (15 + 85 * wDrift) * aDes;   // ★ §2.279fix az解耦实测无净益→回可用档   // ★ §2.264 试×150(腿重配)=外冲跑飞(0.0616)→回纪录档×100
    // ★ §2.274 τ低通30ms（漂移档高增益下，az噪声×100=±200N·m@120Hz自振荡的根治）
    _tau2F += (tau2 - _tau2F) * (1 - Math.exp(-dt / 0.10));   // ★ §2.320 用户：肌肉有缓冲——τ 30ms→100ms（渐起建力）
    tau2 = _tau2F;
    // ★ §2.265 修正段：有力且慢——持续强推才能彻底改腿走势
    if (_fixT > 0) {
      _fixT -= dt;
      // ★ §2.299 回读（用户：腿还在飞必须完全无变化）：260级强推在承重腿上施加=0.15s 台阶→柱传不及；拉缓 350ms
      _fixRamp = Math.min(1, _fixRamp + dt / 0.35);
      const rev = Math.sign(vZc) === -_fixDir && Math.abs(vZc) > 0.01;   // 速度已反转
      // 就高不就低：保持方向，幅值 max(260×ramp, 同向 PD)
      const agree = _fixDir * tau2 > 0;
      const mag = Math.max(260 * _fixRamp, agree ? Math.abs(tau2) : 0);
      tau2 = _fixDir * mag;
      if (_fixT <= 0 || rev) { _fixT = 0; _fixCool = 0.25; }
    } else {
      _fixCool = Math.max(0, _fixCool - dt);
      const goldT = side === 'l' ? _goldenL : _goldenR;
      if (_fixCool <= 0 && goldT > 0.9 && Math.abs(vZc) > 0.06) {   // ★ §2.301 调试：B进场正常漂移(−4.4cm/s)被误当跌反推→阈值 0.018→0.06、门控 0.6→0.9
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
    // ★ §2.314 P1.1：危险墙被 MusclePair 的 C 状态机吸收（写手 5→2）——墙已拆除。
    const otherAirborne = footModeOf(ctx, side === 'l' ? 'r' : 'l') === 'air';
    const bias = otherAirborne ? -40 : 0;
    // ★ §2.243 内收肌共收缩（用户：大腿内侧是否也默认多发力；文献：单腿站内收肌大量激活=同轴共收缩→刚度）
    //   做刚度（向承重锚角的弹簧）而非偏置——只加刚度、不搬平衡点
    const dh0b = ctx.body.dofByName(`hip_${side}`, 0);
    let coCon = 0;
    if (dh0b >= 0 && _hip0Lock[side] !== null) coCon = -300 * (ctx.body.dofs[dh0b]!.angle - _hip0Lock[side]!);
    // ★ §2.326 第四刀：M2→TaskForce（用户：发力的时候脚还蹬一下）——
    //   把侧向修正力从“单点砸髇”改为 F_des 经 J^ᵀ 分配到 [髇+脊柱链]：
    //   每节只拿“传送该力所需的份额”（静态一致，与重力补偿同构）。
    {
      const mTot = ctx.body.sk.massTotal;
      const Fdes = mTot * aDes;   // 侧向期望力（N，沿 +z）
      const comP = [ctx.sensors.com[0]!, ctx.sensors.com[1]!, ctx.sensors.com[2]!];
      const Fvec = [0, 0, Fdes];
      // 髇份额（写 r.pelvisDamp）+ 脊柱份额（ff，最后写者优先级下于 manual）
      let hipShare = 0;
      for (const [nm, ax] of [['hip_', 0], ['spine1', 0], ['spine2', 0], ['spine3', 0]] as Array<[string, number]>) {
        const full = nm === 'hip_' ? `hip_${side}` : nm;
        const di = ctx.body.dofByName(full, ax);
        if (di < 0) continue;
        const d = ctx.body.dofs[di]!;
        const axw = [d.axisWorld[0]!, d.axisWorld[1]!, d.axisWorld[2]!];
        const an = [d.anchorWorld[0]!, d.anchorWorld[1]!, d.anchorWorld[2]!];
        const rx = an[0]! - comP[0]!, ry = an[1]! - comP[1]!, rz = an[2]! - comP[2]!;
        const cx = ry * Fvec[2]! - rz * Fvec[1]!;
        const cy = rz * Fvec[0]! - rx * Fvec[2]!;
        const cz = rx * Fvec[1]! - ry * Fvec[0]!;
        const tj = axw[0]! * cx + axw[1]! * cy + axw[2]! * cz;
        if (nm === 'hip_') hipShare += tj;
        else void tj;   // ★ §2.425 用户：写手干净——Fdes 投影的脊柱份额(±65)删除，spine/0 唯一写手=lateralStab 的 pair
      }
      void hipShare;
    }
    // ★ §2.327 用户：发力的时候脚还蹬一下——B 进场正常漂移被当跌，M2 冲满 220 砸脚；
    //   黄金窗（承重<0.3s）= 踝的时间，M2 限 100。
    const goldTNow = side === 'l' ? _goldenL : _goldenR;
    // ★ §2.335b 用户：发力纠正需要抬腿后再正式开始——摆动脚离地>10cm 前，M2 静默（不打抬腿瞬态）
    // ★ §2.337 用户：继续——门控=动作层的 B→C 相位事件（不再猜脚的状态）
    const liftDone = _liftDoneFlag;
    // ★ §2.328 用户：脚还有一个很大的侧向力；上身该给向下的力，侧向力只在脚快歪时才有。
    //   → M2 侧向力按天平余量门控：余量>2.5cm=60（止偷）；余量趋0才到 220（余量保护）。
    const bsM = balanceScale(ctx, side);
    const marginNow = Math.min(bsM.marginLat, bsM.marginMed);
    const edgeRisk = Number.isFinite(marginNow) ? Math.max(0, Math.min(1, (0.025 - marginNow) / 0.015)) : 0;
    // ★ §2.329 回读：脚关节本体全程<15N·m——“向内侧向力”=hip/0上的M2经腿链传到地面的摩擦；稳态再收 60→35
    // ★ §2.330 回读铁证：M2 一发力(−80,80ms)→脚内滑 1.16cm 再回；黄金窗特批 80=内滑发生器。
    //   黄金窗不再扩权：与稳态同控（边缘保护照旧）。
    // ★ §2.331 回读：余量门控→正反馈（M2发力→脚内滑→CoP近缘→余量变小→M2更大）。全平 35。
    void edgeRisk; void bsM;
    // ★ §2.332 用户：大腿发力主要向下，侧向只为保证在平衡内，力气大且作用距离小。
    //   → M2 改形：平衡域(±2cm)内侧向≈0（不扰脚）；域外=硬弹簧（大力、短程：刚度大、只在越界部分作用）。
    // ★ §2.333 用户：初始姿势的角度就是天平基准；±10°内活动——基准相对误差（初始 4.2cm 偏移不是错）
    const eZ = dZ - (_comZBase[side] ?? 0);
    const band = 0.03;   // ★ §2.332b 带宽=脚几何半宽内缩（支撑域~±3cm）
    const over = Math.abs(eZ) > band ? (Math.abs(eZ) - band) * Math.sign(eZ) : 0;
    // ★ §2.342 MoS 闭环（用户：做；文献 Xu2026：MoS~髇+躯干力矩关联）：
    //   天平 MoS<2cm → 全路开火（增益随 MoS 掉落递增，最高 5×）。
    const bsMoS = balanceScale(ctx, side);
    const mosMin = Math.min(
      Number.isFinite(bsMoS.mosMed) ? bsMoS.mosMed : 1,
      Number.isFinite(bsMoS.mosLat) ? bsMoS.mosLat : 1,
      Number.isFinite(bsMoS.mosPredMed) ? bsMoS.mosPredMed : 1,
      Number.isFinite(bsMoS.mosPredLat) ? bsMoS.mosPredLat : 1);
    const fire = mosMin < 0.02 ? 1 + 4 * Math.min(1, (0.02 - mosMin) / 0.02) : 1;
    const m2Cap = liftDone ? 150 * Math.min(1.5, fire) : 15;   // ★ §2.342 全路开火时传输上限也放（≤225）   // ★ §2.342 全路开火时传输上限也放（≤225）
    // ★ §2.336 用户：力自主根据偏移角度和速度去计算（PD）；Kd 25→300（速度项真算上）
    // ★ §2.339 三道共发（用户：三道方向共同发力；文献：Latash reciprocal+coactivation / M-mode 单标量×固定权重）：
    //   T=PD(eZ,vZc) 单标量 → 踝0.35(直接 CoP=唯一有效通道) / 髇0.65（近端传输）
    // ★ §2.369 可变阻尼：actF=0.4+2.2×risk（risk=倾角/10°,即 C 的驱动量）——活化强→阻尼大（SRS）
    const riskA = Math.min(1, Math.abs(U.tiltDeg) / 10);
    const actF = 1.0 + 2.0 * riskA;   // ★ §2.393 回读：1.0+5.0 的阻尼反打回正(同轴抢力)→ 1.0+2.0
    // ★ §2.394b 实测判决：单向阻尼=0.48s崩(回程无阻尼→过冲放大)；肌肉对的净效=双向——恢复双向(幅度由 actF 1+2 限)
    // ★ §2.408 试验记录：T0 去速度项（纯角度式）→ 变 bang-bang 死区振荡（8° 外 225 狂锤→翻号→弃疗）。
    //   判决：M2 是古董级 bang-bang，调不动；它的替代=肌肉对 λ 世界化（§2.404 方向），M2 暂留但降权待拆。
    const T0 = liftDone ? (-3000 * over - 300 * actF * vZc) : (-25 * vZc);
    // ★ §2.351 目的性外环：腰还在往倒的方向转→积分加码；反转/止住则衰减。
    {
      const tiltRate = U.tiltRateDeg;
      let stillFalling = Math.abs(tiltRate) > 3 && Math.sign(tiltRate) === -Math.sign(T0);
      if (Math.abs(vZc) < 0.02) stillFalling = false;
      _revInt = Math.max(0, Math.min(2, _revInt + (stillFalling ? 0.8 : -1.6) * dt));
    }
    // ★ §2.361 谓词接决策：脚真着地不满足 → 修正暂停（没抓地=修了也白修）
    // ★ §2.362 模式化：grip=0.2 / lift=0(仅阻尼) / single=1 / edge=1+fire
    const modeGain = !U_ACTIVE ? 0 : (U_MODE === 'grip' ? 0.2 : U_MODE === 'lift' ? 0.5 : 1);   // ★ §2.365 未成立→不出力
    // ★ §2.368 预处理（用户：侧向倾多少各部分自动出多大力；人肌肉时刻紧绷；不下调主动）：
    //   预分配 = 倾角→力的固定自动回应（常态紧绷，预标定）；主动（fire/revInt）叠加在上。
    const tiltRad = U.tiltRelDeg / 57.3;   // ★ §2.421 入场即基准：pre 全部改用相对倾角（原来用绝对 tiltDeg，入场 15° 全被算越界）
    // ★ §2.369 用户：不直接设阻尼！阻尼=自动肌肉发力生成（人肌肉可变→阻尼可变）。
    //   预处理：仅刚度（=co-contraction 的弹性分量）；阻尼份全走活化度调制的速度项（下方 actF）。
    // ★ §2.370 用户：可变阻尼=肌肉根据不同位置发力——位置项入预处理（力的锚=位置）
    const dZover = (ctx.sensors.com[2]! - (side === 'l' ? ctx.sensors.feet[0]!.z : ctx.sensors.feet[1]!.z)) - (_comZBase[side] ?? 0);
    // ★ §2.372 用户：大力矩回正还没有——三档形态：±8°内软(450)，越界后硬(2500×越界份)。
    const tiltDegAbs = Math.abs(U.tiltRelDeg);   // ★ §2.421 同上：相对
    const overTilt = tiltDegAbs > 8 ? (tiltDegAbs - 8) / 57.3 * Math.sign(U.tiltRelDeg) : 0;
    const pre = -(450 * tiltRad) - 1100 * dZover - 2500 * overTilt;   // ★ §2.381b 世界慢爬锁：600→1100
    const T = modeGain * (T0 + pre) * (1 + _revInt) + (U_MODE === 'edge' ? 2 * T0 * fire : 0);
    const fdA = ctx.body.dofByName(`foot_${side}`, 0);
    if (fdA >= 0 && liftDone) {
      // ★ §2.349/2.350 历史：踝份额符号曾反（越修越倒）→ 后改为小份额。
      // ★ §2.429 用户：写手干净——shareA(踝份额直写)删除（§2.409 删过被回退带回）。
      //   foot/0 唯一侧向写手=踝 pair（λ 已含 _footLatTau 抓地分量）。
      void fdA; void T;
      // ★ §2.346 第三路=躯干肌群（用户：上身还在急速侧倒没力修正/架构文档的肌群呢）：
      //   Hof 机制②快弯折——直接给脊柱三节发 T 的份额（上身自己的肌肉）
      // ★ §2.423 用户：我就要写手干净——shareS(±155)幽灵再删（§2.409 删过被回退带回，
      //   审计实锤 spine/0 三写手）。spine/0 唯一写手=lateralStab 的 pair。
      void T;
    }
    const tauHard = U.shareHip * T;   // ★ §2.363 随力链弯度自适应
    const inBand = Math.abs(eZ) <= band;
    const m2New = inBand ? tauHard : tauHard;   // 全域均用硬弹簧形（带内 over=0→仅小阻尼）
    void tau2;
    // ★ §2.407 删 M2 实测=瞬间崩（可救0.00s）——真相：肌肉对是"关节空间弹簧"，随捕获姿态跟踪，
    //   全身倾倒时（髋角与骨盆同倒、相对角不变）完全看不见；M2 是唯一"看得见世界"（绝对倾角/速度）的写手。
    //   判决：M2 不删，降为角度式（去掉速度暴力项）；肌肉对的 λ 必须世界化（下一步）。
    // ★ §2.417 实测：M2 撤退→又崩(0.00s)——pair(纯位置弹簧)替代不了 M2 的速度/强度维度。
    //   正确顺序：先把 pair 升级到"绷着=阻尼+修正"(用户定调)再撤。
    // ★ §2.418b 实测第四次：M2=0仍崩（可救 0.00s）；damp提到 M2 同级 300 也不行（0.33s）。
    //   结论：M2 的作用不只是刚度+阻尼（机制待解）——四次撤退实验均崩。M2 作为承重核心保留，待真正理解后再动。
    // ★ §2.469 用户定调：我肌肉发力就是全部预算化，这样发力才真实，不要浮空的力了。
    //   M2（不受预算链约束的紧急通道）=浮空的力 —— 删除。
    //   全部肌肉力走申请制预算：地面能兑现多少、肌肉才能发多少。腿支撑不住=真实的损失。
    void m2New; void bias; void coCon; void m2Cap;
    r.pelvisDamp = 0;
    // ★ §2.263 漂移窗脊柱共发——★ §2.416b 实测：删除→崩塌(可救0.04s)！cof 虽恒 0，
    //   但 setTorque(0) 本身在对这些轴"立柱占位"（清除它=让位给未知写手互殴）。恢复。
    if (Math.abs(vZc) > 0.02 || Math.abs(dZ) > 0.03) {
      for (const sn of ['spine1', 'spine2', 'spine3']) {
        const diS = ctx.body.dofByName(sn, 0);
        const manS = ctx.bal.manual;
        if (diS >= 0 && (!manS || manS.torqueOf(diS) === 0)) {
          const cof = (globalThis as unknown as { __NOCOF?: boolean }).__NOCOF ? 0 : 0;
          ctx.bal.drive.setTorque(diS, Math.max(-120, Math.min(120, -cof * tau2)));
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
      posTq = Math.max(-20, Math.min(20, -err * 60 - pv * 6));   // ★ §2.476 审计：±55与 th 链混合产生−40伪作动，降为微调量
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
  // ★ §2.383 用户：默认就需要很大的持续力挺腰（重力前馈+强俯仰锚）
  // ★ §2.489 用户：前后侧腰没挺起来（回读：pitchRel 21°前倾而公式只管后倾）→双向触发
  const pitchHold = 40 + 500 * Math.max(0, Math.abs(U.pitchRelDeg) / 57.3);
  // ★ §2.542 收官实验（用户：找到一直写向前分量的写手/解决了就彻底结束）：支撑柱化石直写归零测试（保留 put=占位）
  const tf = 0, tk = 0, th = pitchHold;   // ★ §2.542b 中间态：恢复髋的 pitchHold 支撑（侧向支持待验）   // ★ §2.193 tk 90→18（论文值~16；原90=单腿 B相蹬飞躯体的弹射器！）   // ★ 位置伺服 + 踝削力 PD
  supportCmd[side].foot = tf; supportCmd[side].knee = tk; supportCmd[side].hip = th;
  // ★ 支撑腿绷直（§2.104：用户“腿不绷直”；实测支撑膝 15-19° 全程弯）：
  //   膝关节加角度目标闭环（目标 0°）——腿做承重柱而非软弹簧。
  // （§2.191 并链：膝位置伺服撤除——支撑柱=纯力矩单写手）
  put(`foot_${side}`, 2, tf);
  put(`knee_${side}`, 2, tk);
  put(`hip_${side}`, 2, th);
  // ★ §2.323 删除抗塔 PD（用户：删不必要的力；判决表：重力补偿+垂直阻尼已覆盖，消融零差）
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
