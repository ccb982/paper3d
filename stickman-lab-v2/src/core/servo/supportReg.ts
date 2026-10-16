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
import { rescueOffsets } from './rescue';   // ★ §2.647 救援统一模块（唯一实现）
import { propose, PRI } from '../proposalBus';   // ★ 2026-10-15 提案制收编（用户："所有的写手都是提案制"）

/** ★ 当拍支撑命令发布（§2.34 治抖：pad 同源化用**当拍命令**而非上一拍台账——消相位滞后） */
/** ★ 单腿刚度（用户定调 2026-10："支撑腿受力不稳→左右共振→摇摆放大"）：进相姿态冻结+弹簧 */
const _pose: Record<string, { knee: number; hip: number; foot: number } | null> = { l: null, r: null };
let _prevPx: number | null = null;   // 跨x 速度估计（§2.103 预测项）
let _prevPv: number | null = null;   // ★ §2.194 上一帧 pv（两帧平均）
let _comYRef = 0;
let _dyF = 0;
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
  // ★ §2.159 按论文标定（Zelik 2025 摆动透明度：腿几乎不发力——峰值 2.3N·m）
  // ★ 2026-10-15 用户："腿都抬不起来"——air 档 10/2/2 抱不住折腿姿态（脚一卸载腿就耷拉）→ 上调到能持腿重：
  air:    { hipKp: 45,  hipKd: 3, kneeKp: 45, kneeKd: 3, ankKp: 8, ankKd: 1, dampBoost: 1.0 },
  /** ★ §2.178 该有力有力该轻就轻：折叠运动期强 kp（误差门控），抱到位即转透明 */
  // ★ §2.213 用户：抬腿“快而轻”——分关节轻刹车（旧 200/20 全轴一锅=重；现“动则力、停则透”）
  move:   { hipKp: 50, hipKd: 5, kneeKp: 35, kneeKd: 3.5, ankKp: 12, ankKd: 1.5, threshold: 0.20 },   // ★ 轻伺服实验（25=腿乱甩失控）→ 中间档 50/35/12：降 kp + 升主动力（FF25/外展20）配对
} as const;

/** 足态解析：本脚 fz < 5%W → 腾空；对侧也载 → 站立；否则单腿支撑 */
export function footModeOf(ctx: ServoRefs, side: 'l' | 'r'): FootMode {
  const W = ctx.body.sk.massTotal * 9.81;
  const ft = ctx.sensors.feet[side === 'l' ? 0 : 1]!;
  // ★ 2026-10-15 用户："腿也有基础力"——被托住的抬腿 fz 读腿内力(400+)会骗过判定（踝部/单腿机制全不激活）
  //   → 加脚高判据（>6cm 判 air；站立脚在 6cm 以下）
  const airY = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).FOOT_AIR_Y ?? 0);   // 默认关（0）：主机 3.83→2.40 回归→默认不启用；静态探针用 FOOT_AIR_Y=0.06
  if (ft.fz < 0.05 * W || (airY > 0 && ft.y > airY)) return 'air';
  const ot = ctx.sensors.feet[side === 'l' ? 1 : 0]!;
  return ot.fz < 0.05 * W || (airY > 0 && ot.y > airY) ? 'single' : 'stand';
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
// ★（历史：2026-10-11 从动作层迁入的"脚部侧向对抗"footLateral/FOOT_LAT——§7j 死码清理：
//   无任何调用点，删除；其文献笔记移交 §2.606 踝电机的 PCDC/前馈设计档）
let _copFwdF = 0;   // ★ §2.138 CoP/速度低通（踝 tf 与膝 brake 抗抖）
// ★ 2026-10-15 盆骨拉平（自救援迁入支撑柱；用户："把救援的力在其他写手补上，而且要更稳定"）
let _pbDyPrev: number | null = null;
let _pbDyLp = 0;
let _pbDydLp = 0;
let _pbLam = 0;
let _piLp = 0;
let _dynB0H = 0;   // delta 过滤器（动态=默认力±小偏差）
let _dynB0S = 0;
let _dynB0K0 = 0;
let _dynB0K2 = 0;
/** ★ 2026-10-15 动态默认力（用户："抬腿过程有力但力是变化的→动态决定"）：
 *  当前配置下"上身+摆动腿+骨盆"绕该轴的静矩（父侧载荷约定；正号=与经验 B0 同号）。 */
function demLiveOf(ctx: ServoRefs, di: number, side: 'l' | 'r'): number {
  if (di < 0) return 0;
  const d0 = ctx.body.dofs[di]!;
  const u = d0.axisWorld, a0 = d0.anchorWorld;
  const sfx2 = side === 'l' ? '_l' : '_r';
  const jn = d0.name.split('_')[0]!;
  const dsets: Record<string, string[]> = {
    hip: ['thigh', 'shin', 'foot', 'arch', 'mfoot'],
    knee: ['shin', 'foot', 'arch', 'mfoot'],
    foot: ['foot', 'arch', 'mfoot'],
  };
  const excl = new Set((dsets[jn] ?? dsets.hip!).map((p2) => `${p2}${sfx2}`));
  let tau = 0;
  for (const [kk, bi] of ctx.body.indexByKey.entries()) {
    if (excl.has(kk)) continue;
    const rb = ctx.body.bodies[bi]!;
    const c = rb.worldCom();
    const Fy = rb.mass() * (-9.81);
    tau += u[0]! * (-(c.z - a0[2]!) * Fy) + u[2]! * ((c.x - a0[0]!) * Fy);
  }
  return -tau;
}
let _piRateLp = 0;
let _piLam = 0;
let _piPrev: number | null = null;
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
let _comZ0Lift: number | null = null;   // ★ §2.561 抬腿入口CoM侧向基准(世界位置锁)
let _goldenL = 0, _goldenR = 0;   // ★ §2.227 黄金窗口计时（承重上升沿起算，0.25s 内 D×3）
/** ★ §2.243 内收/外展共收缩锚（承重升沿捕获髋额状角） */
const _hip0Lock: { l: number | null; r: number | null } = { l: null, r: null };
let _prevVzRawB = 0, _azF = 0;   // ★ §2.228 加速度前瞻（原始速度差分×低通 τ0.03）
/** ★ §2.265 修正段（用户：有力且慢、彻底改变腿的走势）：检漂→锁方向→慢起→持续强推→反转后释放 */
let _fixT = 0, _fixDir = 0, _fixRamp = 0, _fixCool = 0;
let _tau2F = 0;   // ★ §2.274 τ低通（漂移档高增益把120Hz噪声放大成自振荡）
let _pelvVf = 0;   // ★ §2.220 骨盆滚速低通（原始噪声×300=cap200逐帧砸）
export function resetFootLateral(): void { _ank0Lock.l = null; _ank0Lock.r = null; _torsoW0 = null; _legRoll0 = { l: null, r: null }; _ankMotorTgt.l = null; _ankMotorTgt.r = null; _ank2Lock.l = null; _ank2Lock.r = null; _ank2Tgt.l = null; _ank2Tgt.r = null; }

/** ★ §2.337（用户：继续）：抬腿完成旗标——由动作层 B→C 相位事件直接设（不猜脚状态） */
let _liftDoneFlag = false;
/** ★ §2.498 用户：腰部矢状需知道初始弯曲程度并维持在它附近——单腿入场捕获的初始弯曲。 */
export const sagInit: { s1: number; s2: number; s3: number; hip2: number; pitchW: number; l1: number; l2: number; l3: number } = { s1: 0, s2: 0, s3: 0, hip2: 0, pitchW: 0, l1: 0, l2: 0, l3: 0 };   // ★ §2.558 侧向初态l1-3
export function setLiftDone(v: boolean): void {
  // ★ §2.420 用户：刚进入指挥层的瞬间的躯干角度就是基准值！——入场即重捕全部基准
  if (v && !_liftDoneFlag) {
    resetUnifiedRefs();
    _ank0Lock.l = _ank0Lock.r = null;
    _knee0Lock.l = _knee0Lock.r = null;
    _knee2Lock.l = _knee2Lock.r = null;   // ★ §2.645
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
let _knee2Lock: { l: number | null; r: number | null } = { l: null, r: null };   // ★ §2.645 膝俯仰锁
const _comZBase: { l: number | null; r: number | null } = { l: null, r: null };   // ★ §2.333 天平基准   // ★ §2.296 支撑柱膝捕获
let _footCap = 60;  // ★ §2.294 足接触容量封顶（天平：fz×CoP余量）
let _corrHipF = 0;
let _reactLeadF2 = 0, _reactLeadF0 = 0;   // ★ §2.599 反作用补偿一阶缓起状态（τ0.25s）
let _preBraceF = 0;   // ★ §2.601 预支撑一阶缓起状态（τ0.12s）
// ★ §2.606 刀1 踝内外翻引擎电机状态（目标偏移 rad；承重升沿置 0，解除置 null）
const _ankMotorTgt: { l: number | null; r: number | null } = { l: null, r: null };
// ★ §2.610 刀2 踝屈伸电机状态（捕获锚 + 目标偏移）
const _ank2Lock: { l: number | null; r: number | null } = { l: null, r: null };
const _ank2Tgt: { l: number | null; r: number | null } = { l: null, r: null };
let _sagCaptured = false;   // ★ §2.498 矢状初始弯曲捕获旗  // ★ §2.406b 盆骨扶正偏移低通滤波（力链 dZ 是噪声信号，直喂 λ 会逐帧抽鞭撞 τmax）

/** ★ §2.285 危险墙 */
/** ★ 2026-10-15 用户："旧的乱七八糟的可以扔了"——SUPPORT_CLEAN=1 → 支撑柱/摆腿柱全部转发到骨架版 supportClean */
export function cleanModeOn(): boolean {
  if ((globalThis as { __SUPPORT_CLEAN?: boolean }).__SUPPORT_CLEAN === true) return true;
  // ★ 2026-10-15 用户："旧的可以扔了"——默认=骨架版；SUPPORT_CLEAN=0 临时回旧做对照
  return String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).SUPPORT_CLEAN ?? '1') !== '0';
}
import { supportClean } from './supportClean';

/** ★ 2026-10-15 用户："抬腿后只注入基础力"（网页可切、探针可用）——回正/阻尼全关，只留常值基础力 */
export function onlyBaseOn(): boolean {
  if ((globalThis as { __SUP_ONLY_BASE?: boolean }).__SUP_ONLY_BASE === true) return true;
  return String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).SUP_ONLY_BASE ?? '') === '1';
}
/** ★ 2026-10-15 用户："抬腿结束后立刻注入基础力；抬腿后的腿也是有基础力的"——
 *  摆动腿基础力写手：λ = 捕获姿势θ₀ + B0_sw/(C·K·kStage)（同统一式；无回正、无伺服）。
 *  姿势捕获=首次调用帧（=抬腿结束那刻，生产端在 liftoff 调 swingColumnReset 再持续调用）。 */
const _swLock = new Map<string, number>();
export function swingColumnReset(): void {
  _swLock.clear();
}
export function swingColumn(ctx: ServoRefs, side: 'l' | 'r', _dt = 1 / 240): void {
  if (cleanModeOn()) { supportClean(ctx, side); return; }   // ★ 骨架版转发
}

// ★ 2026-10-15 用户："旧的乱七八糟的赶紧删了"——旧 supportColumn 实现体（~860 行 M2/天平/locks/modes 全链）已删除。
//   支撑柱 → supportClean（骨架版，默认）；本文件仅保留仍被引用的导出（ServoRefs/FOOT_SERVO/footModeOf/balanceScale/…）。
export function supportColumn(ctx: ServoRefs, side: 'l' | 'r', dt = 1 / 240): void {
  if (cleanModeOn()) { supportClean(ctx, side); return; }   // ★ 骨架版转发
}

// ── 以下为仍在被引用的工具导出（reactionComp/pelvisForward/trunkSupport） ──
export function reactionComp(ctx: ServoRefs, side: 'l' | 'r', scale: number): void {
  const other = side === 'l' ? 'r' : 'l';
  const diS = ctx.body.dofByName(`hip_${side}`, 0);
  const diL = ctx.body.dofByName(`hip_${other}`, 0);
  if (diS < 0 || diL < 0) return;
  const cmd = ctx.bal.drive.lastBreakdown[diL]?.servo ?? 0;
  propose({ dof: diS, kind: 'torque', pri: PRI.action, tau: -scale * cmd, src: 'reactionComp' });
}

/** ── L1-Future 骨盆前移预激活（§2.18；用户定调"脊柱弯了屁股还在后面被拽倒"）──
 *  随弯腰（|bend|）联动的支撑髋**伸展前馈**——把骨盆同步前移（文献 CVCF 2019：
 *  后向扰动=脊柱+髋伸展前移骨盆）。与动作层 (a) 的直接写构成**双保险**。 */
export function pelvisForward(ctx: ServoRefs, side: 'l' | 'r', bend: number): void {
  const di = ctx.body.dofByName(`hip_${side}`, 2);
  if (di < 0) return;
  propose({ dof: di, kind: 'torque', pri: PRI.action, tau: -90 * Math.abs(bend), src: 'pelvisForward' });   // 伸展（负）；随弯深联动
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
    propose({ dof: di, kind: 'torque', pri: PRI.action, tau: POSTURE.trunkTonic - 0.4 * swingFlex, src: 'trunkSupport' });
  }
}
