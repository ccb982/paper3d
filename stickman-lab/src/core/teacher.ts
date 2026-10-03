/**
 * 手写"捕获点行走控制器"——**单一真源**。
 *
 * 为什么它在一个模块里而不是散在探针里：
 * 1. `tools/probe-capture.ts` 用它搜参数；
 * 2. `tools/probe-clone.ts` 用它**采数据做行为克隆**（把它的策略蒸馏进神经网络基因组）。
 *    克隆要求 teacher 是观测的纯函数，所以这里提供 `clockDriven` 模式：
 *    换脚由**时钟**触发（周期 T/2），而不是由捕获点越界触发。
 *    时钟相位在观测里是 `sin/cos(2π·phase)`（`gaitHz = 1/T` 时一一对应），
 *    于是"摆到第几步、抬多高"全部可观测 ⇒ 克隆出来的网络不需要任何内部记忆。
 *
 * 观测侧需要的量它全都在读：com/om/ξ、躯干俯仰与角速度、脚底世界 x（当支撑脚时
 * 落脚点就等于脚的当前位置）、每脚载荷份额（判别哪条腿是支撑腿）。缺的只有绝对时间 t，
 * 而时钟补上了。
 */

import type { Sim } from './sim';
import { readCom, newCom, omegaAt, footGrounded } from './posture';
import { wholeBodyAngularMomentum } from './balance';
import { ADJUST_MIN } from './gaitPhase';
import { JOINT_ORDER, jointIndexByName, spineJointNames, type Skeleton } from './skeleton';
/** ★ 摆动相前 25% 用于**重心转移**（用户 2026-10-02："迈腿之前需要把重心转移到静止的腿上"） */
export const SHIFT_FRAC = 0.25;
/** ★ 四步循环的第③段起点：**迈出的腿发力、把自己撑成支撑腿**（用户 2026-10-02） */
export const PUSH_FRAC = 0.75;
/** ★ 换脚前必须连续"站稳"的时长（s）—— 用户 2026-10-02："迈一条腿后保持稳定" */
export const STABLE_HOLD = 0.45;
/** ★ 横向误差限幅（m）：kLat·误差 不得换算成 >~8° 的髋外展（见 latCorr 注释） */
const LAT_MAX_ERR = 0.04;
import { cell } from './normGait';
import { copTargetZ, WT, THR, BalanceGate, type WtStage } from './gaitEvents';
import { balanceHold, holdParamsFrom, type BalanceHoldParams } from './balanceHold';
import type { GaitPhase } from './gaitPhase';
import { stepSystem, stepParamsFrom } from './stepSystem';

// ── 腿长/髋偏置：全部从纹理像素换算（px2m = 0.00068，画布 y=2899 是地面）──
const PX2M = 0.00068;
const Y = (py: number): number => (2899 - py) * PX2M;
export const LEN_A = 0.407;      // ★ 实测髋→膝 0.407（锚点 wx/wy/wz 实算，不用像素换算）
export const LEN_B = 0.379;      // ★ 实测膝→踝 0.379
export const HIP_Z = 0.05;     // ★ 髋横向半间距（两腿分开的关键）
export const STANCE_Z = 0.07;   // ★ 脚的目标横向位置（站距 140mm，Stasiu 文献）
/** ★ 支撑面在**前后方向**的半宽（m）：脚掌长度的一半，MoS 的分母
 *  （Hof: MoS = BoS边缘 − XCoM；单脚支撑时只剩一只脚的掌长） */
export const STANCE_X_HALF = 0.09;
                                  //   （横向支撑面≈0，"迈出的腿无法支撑"）。改后需重标 kLat/kLatV。
/**
 * ★★ CoM 到**真实髋**的垂直落差（m）。
 *   腿长（髋→踝）实测 0.828 m、真实髋高 0.901 m、CoM 高约 1.208 m ⇒ 落差 ≈0.307 m。
 *   **旧值 0.10 是错的**：它把 IK 的虚拟髋点抬到 CoM 下方仅 10 cm，于是 IK 要解
 *   "|髋−脚| = 腿长" 时垂直落差 = 1.208−0.10−0.012 = **1.096 m > 0.828 m**
 *   ⇒ 任何前伸都**解不出来**。这就是"抬腿的时候脚都不往前伸"的根因
 *   （实测前伸 3 mm；`reach`、踝指令全救不了，因为不是能力问题而是无解）。
 *   改成 0.307 后最大水平步长 ≈ √(0.828² − 0.889²) 无解…… 见下方 sanity：
 */
export const HIP_DY = 0.22;    // ★ LEN 改为实测(0.407/0.379)后重标：存活 1.90s / 3 换脚
/** ★ 落地吸能上限（rad）= 20°。Oberg 初始接触膝屈 ~15°、负重反应峰 ~20°。
 *  超过它落地就会把支撑腿压塌（实测 57° ⇒ 脚撑不住）。 */
export const ABSORB_MAX = 0.35;

/**
 * ★★ CoP 行程半长（m）：踝关节到**跖骨头 / 足跟**的距离。
 *   文献依据：Michaels & Ting, *Sci Rep* 2025, 15:97637 ——
 *     "The biomechanical constraint was defined as the **center of pressure (CoP)
 *      range limitation to the metatarsal joint**"
 *   即 CoP 只能在**脚掌内**前后移动；一旦越界，踝力矩**饱和**（保住 flat-foot 约束），
 *   平衡策略随之从"踝策略/CoP 策略"转向"髋策略/CoM 策略"。
 *   值按本骨架脚掌实测（约 0.15 m 鞋底）取半长 0.075 m。
 */
export const COP_HALF_LEN = 0.075;
/** 真实髋高（m），由 limbAxes.json 锚点 Y(1574.5) 换算 */
export const HIP_Y = Y(1574.5);

export interface CaptureParams {
  /** 步态周期（s）：一左一右两个支撑相 */
  T: number;
  /** 目标速度（m/s） */
  vDes: number;
  /** 摆动脚抬多高（m） */
  lift: number;
  /** Raibert 速度误差增益：x* = ξ + kv·(vDes − vx)·T/2 */
  kv: number;
  kPitch: number;
  kRate: number;
  kLat: number;
  kLatV: number;
  kLatSwing: number;
  /**
   * ★★ 矢状面承重转移增益（rad/m）—— CoM 位置+速度反馈 → 踝力矩 → 移 CoP → 加速 CoM。
   *   文献：Becker/Banks/Whittle, PLOS Comput Biol 2021, 17(6):e1008369（中支撑相增益最高）；
   *   Neptune/Perry, Front Neurol 2019, 10:999（跖屈是 CoM 推进主引擎）。
   *   实现见 teacher.ts 中 xi / comShiftErr / copTau / copGainPhase。
   */
  kCop?: number;
  /**
   * ★★ B 方案：矢状面重心转移增益（rad/m）。CoM 相对支撑脚的纵向位置 + 速度反馈 → 支撑髋俯仰。
   *   文献：Neptune/Perry Front Neurol 2019（髋可维持 CoM 增量，效率为跖屈肌的 1/4 ⇒ 增益需大）；
   *         Becker/PLOS Comp Biol 2021（CoM 位置+速度延迟线性反馈即可解释关节矩反应）。
   *   实现见 teacher.ts 的 comShiftB / corrCom。
   */
  kWtX?: number;
  /** ★ B 方案的 CoM 速度阻尼项（s）。 */
  kWtVx?: number;
  /**
   * ★★ Raibert 落脚点规则的无量纲增益 Γ：脚落在捕获点 ξ 前方 `Γ·vDes`。
   *   文献：Raibert 1985；Perry《Gait Analysis: Biomechanics and Gait Analysis》步态控制章。
   *   `Γ·vDes` = 支撑腿把 CoM 推过去的**余量**；Γ=0 则脚正好落在 ξ（CoM 立刻停住）。
   *   取代了原先硬编码的 `reach`（相对支撑脚的固定偏移，与速度无关 ⇒ 前后腿之分消失）。
   */
  kGamma?: number;
  /** ★ Raibert 规则的速度误差时间常数 K（s）：跑慢了把脚落得更靠前。 */
  kVerr?: number;
  /**
   * ★★ VIP 反馈增益（Morasso et al., Front Comput Neurosci 2022, 15:956932）。
   *   kVipP：VIP 倾角的比例增益；kVipD：VIP 角速度的微分增益。
   *   原文用**延迟**反馈（离散间歇控制），此处用当前帧 + 速度项近似。
   */
  kVipP?: number;
  /** ★ VIP 角速度微分增益（见 kVipP）。 */
  kVipD?: number;
  /**
   * ★★ 踝的被动刚度比例（× K_crit = mgh）。<1 = **欠临界**（靠主动反馈补），
   *   这是"踝策略 / CoP 策略"的定义形态（Morasso 2019/2022）。
   */
  kAnkleStiff?: number;
  /**
   * ★★ 髋的被动刚度比例（× K_crit,hip = m·g·h_hip）。>1 = **超临界** ⇒ 被动即稳定。
   *   原文关键点：h_hip ≈ 踝铰全身 h 的一半 ⇒ K_crit 也只有一半 ⇒ 极小共同收缩即可。
   */
  kHipStiff?: number;
  /** ★ 踝 CoP 饱和后，髋接管（CoM 策略）的份额。 */
  kHipShare?: number;
  /**
   * ★★ 额状面 VMP（Virtual Medial Pendulum）反馈增益 —— 矢状面 kVipP 的额状面对偶。
   *   用户 2026-10-02："我怀疑是因为无法单脚站稳导致的" ⇒ 实测单腿站立 CoM 侧移
   *   **0.377 m**（与前后 0.343 m 同量级），而此前**额状面没有任何控制器**
   *   （旧 `shiftErr` 被限幅到 ±40mm / ±8°，连 1/9 的误差都看不见）。
   *   文献：Morasso Front Comput Neurosci 2022（踝策略=CoP策略 / 髋策略=CoM策略，
   *   额状面是同一套分工）；Nashner & McCollum 1985（支撑面变小 ⇒ 策略由踝转向髋）。
   */
  kVmpP?: number;
  /** ★ VMP 角速度微分增益。 */
  kVmpD?: number;
  /**
   * ★★ 踝**内翻/外翻**（额状面）反馈增益 —— Liu et al., *J Biomech* 2012 的力学链：
   *   "…a lateral bending (hip abduction/adduction) moment that is equilibrated
   *   没有这一项，髋外展造出的额状面力矩无人平衡 ⇒ CoM 反而被推得更偏
   *   （实测 kVmpP 0→80 侧移 0.275~0.337 m 纹丝不动）。
   */
  kVmpAnkle?: number;
  /**
   * ★★ **骨盆执行器**增益（1/rad）：`spine1` 轴 2（屈伸）的力线对齐。
   *   这是让角色挺起来、消除鞠躬的执行器（用户 2026-10-02 指出）。
   *   骨架里没有独立骨盆刚体：`torso` 占 49.70% 质量兼作根，
   *   `spine1` 轴 2（限位 ±25°、力矩 120 N·m）= 骨盆↔上半身。
   *   ⚠ 此前被误关（错把"躯干该安静"推广成"骨盆也该安静"），已恢复。
   */
  kPelvis?: number;
  /** 骨盆前倾偏置（deg）：>0 让骨盆略前倾迎向 GRF 力线。 */
  pelvisLeanDeg?: number;
  /** ★ 支撑腿发力前送（rad）：支撑相后半段线性增大的髋伸驱动。
   *   文献：支撑腿要持续把身体推过支撑脚（跖屈+髋伸），不是被动站立。
   *   之前完全没有这一项 ⇒ 净位移 0、越走越慢。 */
  stancePush?: number;
  /** 捕获点走出支撑脚的换脚阈值（m），仅 clockDriven=false 时用 */
  thresh: number;
  /** 落地吸能强度（rad） */
  absorb: number;
  /** 吸能时间常数（s） */
  absorbTau: number;
  /**
   * ★★ CMP / Moment Balance Strategy 增益（用户 2026-10-02："迈出脚后为啥不能自主调整平衡"）。
   *   文献：Popovic, Hofmann & Herr (2004) —— 把 CoP 稳在支撑中心**并不能**保证平衡
   *   （那等于一个静态不稳定、无执行器的倒立摆）；**唯一出路是产生关于质心的非零力矩**，
   *   即 CMP ≠ ZMP（"Moment Balance Strategy"）。恢复力由"质心地面投影与 CMP 的间距"调制。
   *   人在走路时 **CMP 全程被约束在支撑面内**（Herr 2008：CMP 与实测 CoP 距离仅足长 14±2%）。
   *   我们的执行器：支撑腿的**髋外展**（把骨盆挪向支撑脚）+ **脊柱侧屈**（上身反向配重）。
   *   这是落地后那一层"自主调整"，此前 teacher 里**完全没有**。
   */
  cmBalance: number;
  /** 角动量变化率（dL/dt）的阻尼增益 */
  cmBalanceD: number;
  /**
   * ★★ 脊椎/骨盆**反相旋转**增益（用户 2026-10-02："身体调整需要脊椎同步发力对吧"——对）。
   *
   * 文献：Takemura et al. 2007（*Dynamic Walk of Humanoids: Momentum Compensation
   * Based on the Optimal Pelvic Rotation*）—— 正常走路里摆动腿产生的角动量是靠
   * **胸廓/肩的反相旋转**抵消的（van Emmerik & Wagenaar 1996；Lamoth 2002；
   * LaFiandra 2003）；而"trunk-twistless walk"更直接：**骨盆与摆动腿反相**，
   * 骨盆旋转本身就抵消腿的动量。HRP-2 实测：垂直轴**峰值动量降 13%、积分降 18%**；
   * 动捕数据上最优骨盆旋转降 **42%**。最优旋转由**最小化垂直轴动量**求得。
   *
   * 实测依据（probe-gaitcycle ③）：未做这一项时单支撑 |WBAM| 中位 **5.36**
   * = 平衡基线 0.16 的 **33.5×** ⇒ 完全没有角动量抵消。
   */
  spineSync: number;
  /** ★ 支撑腿在「迈步相」锁定到文献姿态的权重（0=不锁，1=全锁）。依据 npm run roles：
   *   step 相支撑腿 髋 ROM 38.5°/膝 ROM 30.7°，而 Oberg slow midstance 要求 15°/15.7°。 */
  stanceLock?: number;
  /** 覆盖 IK 虚拟髋点落差 HIP_DY（标定用，见 tools/probe-arch 的 HIP_DY 扫描） */
  hipDy?: number;
  /** ★ 摆动脚**显式前伸**量（m）。用户 2026-10-02："抬腿的时候脚都不往前伸"。
   *   实测旧行为只前伸 **3mm**（标准慢速步长 ≈500mm）⇒ 等于没迈步。
   *   0 = 退回旧行为（只跟捕获点 xi）。 */
  reach?: number;
  /** ★★ 踝：摆动期背屈峰值（°）—— 勾脚把腿往前送 */
  ankleSwing?: number;
  /** ★★ 踝：支撑期起立跖屈（°）—— 顶髋把身体前送 */
  anklePush?: number;
  /** ★★ 踝：支撑中期中立角（°） */
  ankleStance?: number;
}

/** 二连杆 IK：髋 (hipX,hipY) → 脚 (fx,fy)，返回 [髋屈伸, 膝屈伸]（膝屈为负） */
export function ik(hipX: number, hipY: number, fx: number, fy: number, planeScale = 1): [number, number] {
  // ★ `planeScale` = **矢状面内可用腿长 / 全腿长**。
  //   当脚要往横向偏 dz 时，全腿长被分成"平面分量 + 横向分量"：
  //       dz = L·sin(abduct)，  d_plane = L·cos(abduct)
  //   平面内解算必须用 d_plane，否则求出的姿态会让腿总长超出 ⇒ 软限位接管 ⇒ 脚回中线。
  const la = LEN_A * planeScale, lb = LEN_B * planeScale;
  const dx = fx - hipX, dy = fy - hipY;
  let d = Math.hypot(dx, dy);
  d = Math.min(d, (la + lb) * 0.995);
  d = Math.max(d, Math.abs(la - lb) + 0.02);
  const base = Math.atan2(dx, -dy);
  const cosK = Math.max(-1, Math.min(1,
    (la * la + lb * lb - d * d) / (2 * la * lb)));
  const interior = Math.acos(cosK);
  const hipRel = base + Math.atan2(lb * Math.sin(interior), la + lb * Math.cos(interior));
  return [hipRel, -(Math.PI - interior)];
}

/** 全腿长（用于横向反解） */
export const LEG = LEN_A + LEN_B;

export interface TeacherResult {
  x: number;
  alive: boolean;
  steps: number;
  t: number;
  /** 采样到的样本数（record=true 时） */
  n: number;
  /** ★ 换脚诊断轨迹：每条含 s / 摆动腿 / landed / ready / 离地高度 */
  swapTrace?: { t: number; s: number; swing: 'L' | 'R'; landed: boolean; ready: boolean; sole: number }[];
  /** ★ 支撑腿序列（'L'/'R' 拼接），用来一眼看出有没有左右交替 */
  stanceSeq?: string;
}

/**
 * ★★ teacher 的**可分帧会话**（2026-10-03）。
 *
 * 为什么要这个：网页（`src/main.ts`）此前**只能渲染 ES 神经网络的输出**，
 * 而 `balanceHold` / `stepSystem` 这套平衡维持系统只被 `tools/*.ts` 引用
 * ⇒ **你在网页上调平衡维持系统时，网页上根本没有那个系统**。
 * 于是网页显示的和探针测的是两个不同的东西，对不上。
 *
 * 解法：把主循环的闭包状态封进 `TeacherSession`，让网页用 rAF 一帧一帧地
 * `session.step(n)` 推进。这样网页与 `tools/probe-*.ts` 跑的是**同一份代码**。
 */
/**
 * 三套系统的归属标签 —— 网页「模块归属」面板按它上色。
 *   `hold`  = 平衡维持系统（balanceHold.ts）
 *   `step`  = 迈步系统（stepSystem.ts）
 *   `servo` = 伺服/条件化修正
 */
export type HoldSystem = 'hold' | 'step' | 'servo';

/** ★ 网页每帧读的诊断快照（用户 2026-10-03 要求 UI 明确区分两套系统 + 前后腿） */
export interface TeacherDiag {
  /** 关节/轴 → 系统归属（形如 `hip_l/2`） */
  sys: Map<string, HoldSystem>;
  /** 关节/轴 → 机制标签（形如 `balance(ik+corr)`） */
  owner: Map<string, string>;
  /** 关节/轴 → 本拍原始角度（rad） */
  ang: Record<string, number>;
  /** 前腿 / 后腿（按脚的 x 位置实测，**不是硬编码左右**） */
  frontLeg: 'l' | 'r';
  backLeg: 'l' | 'r';
  /** 承重腿（loadFrac + 迟滞判出来的） */
  stanceLeg: 'l' | 'r';
  /** 摆动腿 */
  swingLeg: 'l' | 'r';
  /** 两脚是否接地 */
  groundL: boolean;
  groundR: boolean;
  /** 步态相 */
  phase: GaitPhase;
  /** 此刻真正下出去的轴数（0 = 某个角色压根没被控制） */
  nAxes: number;
  /** 平衡门判定（'' = 放行） */
  balOk: boolean;
  balWhy: string;
  /** 支撑域内的 MoS（m，负 = 已越界） */
  mosX: number;
}

export interface TeacherSession {
  /** 推进 n 个物理步（每步 = sim.advance(1) + 算指令 + setMotorTargets） */
  step(n: number): void;
  /** ★ 每拍刷新的诊断快照（UI 读这个，不要自己去猜归属） */
  readonly diag: TeacherDiag;
  /** 已推进的仿真时间（s） */
  readonly t: number;
  /** 已完成的控制拍数 */
  readonly steps: number;
  /** 结算（等价于旧的返回值） */
  result(): TeacherResult;
}

export interface TeacherOpts {
  dur?: number; clockDriven?: boolean; record?: boolean;
  data?: { X: number[][]; A: number[][] };
  /** 每控制拍的回调（探针用它取角度/接触状态做逐帧统计） */
  onFrame?: (t: number, stanceL: boolean, s: number, ownerLog?: Map<string, string>, curOwner?: string, angLog?: Record<string, number>, dbgLog?: Record<string, number | string>) => void;
  /**
   * ★★ **单腿站立模式**（用户 2026-10-02："我怀疑是因为无法单脚站稳导致的，
   *   我需要学怎么保证单脚站稳，先维持抬腿后的重心稳定，再考虑迈腿"）。
   *   置为 `'l' | 'r'` 时：
   *     · 强制该腿为唯一支撑腿，**不换脚**（关掉时序与落地判定）
   *     · 另一条腿的 IK 目标抬到 `liftHold`（默认 0.25 m）并**保持**
   *   ⇒ 这样可以把"能不能单腿站稳"从"能不能迈腿"里**解耦**出来单独验证。
   *   null = 正常迈腿（默认）。
   */
  singleLeg?: 'l' | 'r' | null;
  /** 单腿模式下摆动腿的保持高度（m） */
  liftHold?: number;
}

/**
 * 建一个 teacher 会话（**不自动跑**）。网页用它做分帧驱动。
 */
export function makeTeacherSession(
  sk: Skeleton,
  sim: Sim,
  p: CaptureParams,
  opts: TeacherOpts = {},
): TeacherSession {
  const dur = opts.dur ?? 8;
  const clockDriven = opts.clockDriven ?? false;
  const singleLeg = opts.singleLeg ?? null;
  const liftHold = opts.liftHold ?? 0.25;
  const out = new Float32Array(sim.doll.jointCount * 3);
  // ★ 两个模块的参数视图（用户 2026-10-02 的两模块设计）：
  //   ① `holdP` → 承重腿 + 腰的平衡维持（balanceHold.ts，纯函数、无状态）
  //   ② `stepP` → 迈步（stepSystem.ts，纯函数、无状态）
  //   teacher 只负责把两者**接到关节上**，不自己算平衡/迈步的数学。
  const holdP: BalanceHoldParams = holdParamsFrom(p as unknown as Record<string, unknown>);
  const stepP = stepParamsFrom(p as unknown as Record<string, unknown>, (p.T ?? 2.2) / 2);
  // 全身质量：从 Rapier 各刚体实测求和（K_crit = mgh 需要它；不手填体重常数）
  let totalMass = 0; for (const b of sim.doll.bodies) totalMass += b.mass();
  totalMass = Math.max(1, totalMass);
  const com = newCom();
  const dt = 1 / sim.cfg.controlHz;
  const iL = sk.bodies.findIndex((b) => b.key === 'shin_l');
  const iR = sk.bodies.findIndex((b) => b.key === 'shin_r');
  let plantL = sim.doll.bodies[iL].translation().x;
  let plantR = sim.doll.bodies[iR].translation().x;
  let plantLz = HIP_Z, plantRz = -HIP_Z;   // ★ 落脚点横向锁在髋投影上（防踝内收）

  // ══════════════════════════════════════════════════════════════════════
  // ★★★ 初始的**前后腿之分 + 后退腿承重锁定**（用户 2026-10-02：
  //   "一开始的重心就错了，腰和腿一起向前凸了，导致无法正常迈步，
  //    优化迈步前的平衡保持，先把后退锁定为承重腿"）
  //
  //   实测的病根：初始姿态 `hip/knee/foot` 三个锚点的 **x 全是 0.000** ——
  //   两条腿在矢状面**完全重合**，于是
  //     · 根本没有"前脚/后脚"之分 → 没有承重腿 → `stanceL` 只能靠时钟瞎猜
  //     · 载荷天生 0.50/0.50 → 承重转移判据（差值）恒在 0 附近 → 平衡门永远差一点
  //   ⇒ 必须先人为造出前后之分，并把**后退腿**锁成承重腿。
  //
  //   做法（步态启动的标准次序，Lugade 2011 / Neptune 2008）：
  //     ① 后退腿 = 右腿（R），它落在**后方** BASE_X_BEHIND，提供支撑基座
  //     ② 前腿 = 左腿（L）落在**前方** BASE_X_FRONT，准备启动
  //     ③ 把 CoM 初始目标点设在**后退腿上方略偏前**，即重心先压到后退腿
  const BASE_X_BEHIND = -0.09;   // 后退腿落点（m，相对初始 Hip x=0）★ 扫描确定
  const BASE_X_FRONT = +0.09;   // 前腿落点
  plantR = BASE_X_BEHIND;            // ★ 右腿 = 后退腿 = 承重腿
  plantL = BASE_X_FRONT;             // 左腿 = 前腿 = 待迈腿
  plantRz = HIP_Z; plantLz = HIP_Z;
  // CoM 初始目标：压在**后退腿上方**（这是"先把后退锁定为承重腿"的落点）
  const comTarget0X = BASE_X_BEHIND + 0.03;

  let t = 0, steps = 0, prevStance = 2, lastSwitch = 0;   // ★ prevStance=2 ⇒ 起始 stanceL=false ⇒ 右腿承重
  /**
   * ★ CoM 的**纵向目标**（B 方案 `comShiftB` 的参考点）= **始终等于当前承重腿的落点**。
   //   之前初值取硬编码的 `comTarget0X`、且只在 `steps > 0` 后才跟随 —— 而 `steps`
   //   长期为 0 ⇒ 目标永远钉死在 −0.06 ⇒ kWtX 把身体往那拉、拉过头到 −0.4m
   //   （实测末 CoM −0.23~−0.42，身体倒着走）。⇒ 现在**从头就跟随承重腿**，
   //   消掉这一处硬编码与退化。
   */
  let comTargetX = BASE_X_BEHIND + 0.03;
  const syncComTarget = (): void => { comTargetX = (stanceLNow ? plantL : plantR) + 0.03; };

  // ══════════════════════════════════════════════════════════════════════
  // ★★★ 三个角色的**程序化判定**（用户 2026-10-02：
  //   "程序化决定前后腿，锁定腿，承重腿了吗" —— 之前三个都不是，全是硬编码/死条件）
  //
  //   设计原则：**角色由物理量判定，不由常数设定、也不由时钟瞎猜。**
  //     · 前腿 / 后腿  = 由**实测脚位 x** 排序（x 大的=前）⇒ 自动跟随实际落点
  //     · 承重腿       = 由**实测载荷**判定（承重大的一方）⇒ 载荷失衡会自动换角色
  //     · 锁定腿       = 承重腿被闩锁，在另一条腿完成承重之前**不许改变**
  //   ⇒ 这样"角色"是状态的**因**，不是预设的**果**；发令器只决定"该换谁了"。
  let roleLatched: 'l' | 'r' | null = null;   // ★ 被闩锁的角色（= 当前承重腿）
  /** 按实测 x 判定：返回 [前腿, 后腿] */
  const rolesFromFootX = (xL: number, xR: number): ['l' | 'r', 'l' | 'r'] =>
    (xL >= xR ? ['l', 'r'] : ['r', 'l']);
  // CMP/Moment-balance 的角动量状态（关于质心，额状/矢状）
  const lbuf = new Float64Array(3);
  const footBufL = new Float64Array(2), footBufR = new Float64Array(2);
  let prevLz = 0, prevLy = 0, hasL = false;

  const jHip = sk.joints.find((j) => j.name === 'hip_l')!;
  const jKnee = sk.joints.find((j) => j.name === "knee_l")!;
  // ★★ 踝（foot_l/foot_r）—— 之前**从不下指令**，脚掌是自由体。
  //   这就是"抬腿的时候脚都不往前伸"的直接原因：脚掌朝向恒定（只跟小腿走），
  //   膝控制的只是小腿，**脚要往前伸必须靠踝**（人走路：摆动期背屈→蹬离跖屈）。
  // ★★ `ankleEnabled=false` ⇒ 骨架里**没有 foot_l/foot_r 关节**（脚掌是小腿的第二个
  //   collider）。这里查不到就是查不到，**不要**用 `jointIndexByName` 的旧回退
  //   （它会返回 9 = spine1 ⇒ 指令下到腰上，见 skeleton.jointIndexByName 的注释）。
  //   `setAxis` 的 `!j` 分支会让踝指令静默丢弃 —— 这是**已知且正确**的行为：
  //   前提是调用方知道"没有踝"，所以 UI 会把它显示成"未驱动"而不是假装在控制。
  const jFoot = sk.joints.find((j) => j.name === 'foot_l');
  // ★ 腰（脊柱）关节的实际名字与描述：spineSegments>1 时才存在
  const spineNames = spineJointNames(sk);
  const nSpine = spineNames.length;
  // ★ 肩必须用**肩自己的**限位归一化：之前错用 jHip ⇒ 指令幅度被髋的限位缩放了
const setAxis = (joint: string, ang: number, j: typeof jHip | undefined, ax = 2): void => {
      // ★★★ 查索引必须走 `jointIndexByName`（查**实际关节实例**），
      //   不能用 `JOINT_ORDER.indexOf` —— 后者是硬编码常量，**不含运行时追加的脊柱关节**：
      //     spine1/spine2/spine3（腰）在 `spineSegments > 1` 时才被 joints.push 进去，
      //     indexOf 永远 −1 ⇒ setAxis 静默 return ⇒ **腰从来没被下过指令**。
      const ji = jointIndexByName(sk, joint);
      const o = ji * 3 + ax;
      // ★ 静默失效点（曾让我们误判"某个模块在起作用"）：
      //   12 关节配置里**没有 ankle**，此时 `j` 为 undefined（踝只存在于 14 关节）
      if (o < 0 || !j) return;
      ownerLog.set(joint + '/' + ax, curOwner);   // ★ 谁写了这一轴（probe-arch 读它）
      sysLog.set(joint + '/' + ax, curSys);      // ★ 这一轴属于**哪个系统**（网页「模块归属」面板读它）
      angLog[joint + "/" + ax] = +ang.toFixed(4);   // ★ 原始角度值
      // ★★ 归一化必须用该轴的**最大行程**，不能用"这一侧的小限位"。
      //   旧写法 `ang>=0 ? ang/(0.9*maxRad) : ang/(0.9*-minRad)` 在**不对称限位**上
      //   会把正向指令掐死：膝限位 [-145°, +2°] ⇒ 正指令除以 0.9*2° = 1.8°，
      //   一个 0.5 的指令只产生 **0.9°** 目标 ⇒ 实测膝只动 1.6°/5.1°、肘 4.4°。
      //   （hip [-80°,+60°] 较对称，所以髋看起来正常 —— 这就是"只有髋像有关节"的错觉。）
      //   改成按 `max(|min|,|max|)` 双向一致归一化。
      const span = Math.max(Math.abs(j.minRad[ax]), Math.abs(j.maxRad[ax]));
      if (span <= 1e-6) return;
      out[o] = ang / (0.9 * span);
      nAxes++;
    };
  /** 本拍真正下出去的轴数（调试用：0 说明某个角色压根没被控制） */
  /** ★ **本拍**真正下出去的轴数（每拍开头清零 —— 它原来是累计值，
   *   面板会显示成"这一整局一共下了多少轴"。诊断口径必须是每拍。 */
  let nAxes = 0;
  /** ★ 当前写入者标签（probe-arch 用它看"哪个机制在抢哪个关节"） */
  let curOwner = '?';
  /**
   * ★★★ **这一轴属于哪套系统** —— 网页「模块归属」面板的核心字段。
   *
   *   用户 2026-10-03："我需要一个 UI 明确表示哪部分属于平衡维持，
   *   哪部分属于迈步系统，从而让我区分前后腿。"
   *
   *   三类：
   *     · `hold`  —— **平衡维持系统**（`balanceHold.ts` 纯函数）
   *     · `step`  —— **迈步系统**（`stepSystem.ts` 纯函数）
   *     · `servo` —— 伺服/条件化修正（落点、摆动腿自由度…）
   *   `ownerLog` 记的是"哪个机制"（如 `balance(ik+corr+lock+push)`），
   *   `sysLog` 记的是"哪套系统"，两者正交：前者用于查机制打架，后者用于看归属。
   */
  let curSys: HoldSystem = 'servo';
  /** ★ joint/axis → 系统归属 的本拍记录（'hold' | 'step' | 'servo'） */
  const sysLog = new Map<string, HoldSystem>();
  /** ★ joint/axis → owner 的本拍记录 */
  const ownerLog = new Map<string, string>();
  const hipW = new Float64Array(3);   // ★ 真实髋锚点世界坐标
  const angLog: Record<string, number> = {};   // ★ 每次 setAxis 的原始角度（排查"指令为何全 0"）
  /** ★ UI 读的那一份（每拍整体替换，避免前端拿到半更新的数据） */
  const sys = new Map<string, HoldSystem>();
  const diag: TeacherDiag = {
    sys, owner: ownerLog, ang: angLog,
    frontLeg: 'l', backLeg: 'r', stanceLeg: 'l', swingLeg: 'r',
    groundL: true, groundR: true, phase: 'both', nAxes: 0,
    balOk: true, balWhy: '', mosX: 0,
  };

  const dbgLog: Record<string, number | string> = {};   // ★ 摆动腿指令追踪
  const hipDy = p.hipDy ?? HIP_DY;   // ★ 可标定的 IK 虚拟髋点落差
  /**
   * ★★★ IK 虚拟髋高必须锚在**固定参考**上，不能用瞬时 `com.y`。
   *   旧式 `hipY = com.y − HIP_DY` 是一个**正反馈**：
   *     身体沉一点 → com.y 降 → 虚拟髋跟着降 → 目标距离变短 → 腿折得更多 → 沉更多 …
   *   实测就是它把躯干从 1.429 m 一路拽到 1.214 m（正好撞上 `height` 摔倒阈值），
   *   而且**所有参数消融都无效**（改什么都不影响这个下沉）。
   *   修法：第一次采到 CoM 时锁存 `hipYRef = com.y − HIP_DY`，之后一直用它。
   */
  let hipYRef = -1;
  /** ★ 换脚诊断轨迹（probe-arch 打印）：每 0.08 s 一条 */
  interface SwapDiag { t: number; s: number; swing: 'L' | 'R'; landed: boolean; ready: boolean; sole: number }
  const swapTrace: SwapDiag[] = [];
  let stanceSeq = "";
  // ══════════════════════════════════════════════════════════════════════
  // ★ 重心转移阶段机（文献锚定，用户 2026-10-02："显式写出重心转移的各个变化"）
  //   ① APA-back    CoP 后退 —— 产生向前的力矩            Hansen 2016 / Breniere 1986
  //   ② APA-toSwing CoP 移向**摆动腿**（APA 预备）        Hansen 2016
  //   ③ toStance    CoP 反向移向**支撑腿**（真转移）      Frontiers 2022（134~207ms）
  //   ④ done        新支撑腿承重 ≥50%                     Perry: Loading Response 结束
  //
  //   实测依据：只有 ③ 时，支撑 L 始终触发不了 `load`（承重≥50%），
  //   而支撑 R 有完整 `IC→load→FF` ⇒ 体重转不过去，髋虽打满力矩也没用。
  // ══════════════════════════════════════════════════════════════════════
  let wtStage: WtStage = 'idle';
  let wtT = 0;                       // 本阶段已持续时间
  let wtDone = false;                // 本次落地是否已完成转移（防止重复触发）
  let stableT = 0;                // 连续站稳计时（换脚门控)
  // ══════════════════════════════════════════════════════════════════════
  // ⚠ 初值必须是 **false**（2026-10-02 修正）。原来写 `true` ⇒ 第 1 帧就满足
    //   `lastSwitchWasFlip || latchedStance === null`，于是**开局把一条腿假锁死**，
    //   之后因为摆动腿从未真正离地、`landed` 每帧都真，永远不会重新判定 ⇒
    //   锁定腿从头到尾不变，"着地即锁"名存实亡。
    let lastSwitchWasFlip = false;   // 是否发生过真正的换脚（用于闩锁判据）
  const balGate = new BalanceGate();   // ★ 迈腿前平衡判定门
  let balBlocked = '';
  /** ★ GRF 横/竖比（切向/法向）—— 由 `footGrip` 估出，供"力线对齐"用（治鞠躬）。 */
  let grfRatioNow = 0;
  let dbgLoad = 0;
  // ★★★ 支撑**闩锁**（用户 2026-10-02）：
  //   "前腿落地后启动一个支撑相关的模块，别再让前腿再离地了"
  //   "落地就得锁定，要是接受50%以上体重再触发，说不定就触发不了了"
  //
  //   ⇒ 触发条件是**着地（接触）**，不是承重 ≥50%。
  //     理由（本 rig 的实测）：两条腿的承重常在 0.5 上下摆动（0.48~0.89），
  //     指望某个"承重过半"的瞬间来上闩，实测经常不出现 ⇒ 闩锁永远不上 ⇒ 前腿反复离地。
  //     文献上"接触"本身就是一个明确事件（IC 初次接触，Lambrecht 2017 / JAB 2003），
  //     之后才是载荷转移（Frontiers 2022：134~207ms）。
  //
  //   语义：某条腿**一旦着地**，它就被闩锁为支撑腿；在另一条腿着地之前，
  //        它**绝不允许再离地**。
  //
  //   换腿重量转移的文献：
  //   · Sci Rep 2021 (Amma et al.)：双支撑期"卸载 ULR / 加载 LR"**成对且几乎同时**发生，
  //     二者线性相关 ⇒ 后腿不能在体重还没转完时抬。
  //   · Frontiers 2022：转移**结束判据** = 摆动腿 vGRF < 10 N，全程 134~207 ms。
  //   · Perry：Pre-swing(50~62%GC) = 对侧初次接触 → 本侧离趾（顺序不可逆）。
  // ══════════════════════════════════════════════════════════════════════
  let latchedStance: 'l' | 'r' | null = null;   // 被闩锁的支撑腿（着地即锁）
  /** ★ 下一次抬腿的**许可锁存**（2026-10-02）。见 balGate.judge 处注释：
   *   判定点落在摆动下降段，必须锁存到落脚为止，放行才有意义。 */
  let stepPermit = false;
  let wtModule = 0;                 // ★ 支撑模块启动计数（探针回读用）
  /** 本次落地的目标承重（Frontiers 2022：结束判据 = 该腿 vGRF < 10N）
   *  ⚠ `stanceL` 在下面主循环里才赋值，这里用可变闭包变量延后读取。 */
  let wtLoadOf = (): number => {
    const [fl, fr] = sim.doll.footLoadFrac(dt);
    return stanceLNow ? fl : fr;
  };
  let stanceLNow = true;
  let lastDiagT = -1;

  // ★★★ 分帧驱动：`step(n)` 推进 n 个物理步。网页用 rAF 一帧一帧调它，
  //   探针仍然可以用下面的 `runCaptureTeacher` 一次跑完 —— 两条路径同一份代码。
  const step = (n: number): void => {
    for (let k = 0; k < n; k++) {
    if (sim.finished || t >= dur) return;
    // ★ 每拍清空"本拍记录"，否则 UI 看到的是**至今所有拍**的并集
    //   （看着像"到处都在控制"，实际那些轴早就没人管了）。
    nAxes = 0; ownerLog.clear(); sysLog.clear();
    for (const k of Object.keys(angLog)) delete angLog[k];
    curOwner = '—';
    sim.advance(1);
    const torso = sim.doll.torso();
    const rot = torso.rotation();
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (rot.w * rot.x + rot.y * rot.z))));
    const av = torso.angvel();
    readCom(sim.doll, com);
    const om = omegaAt(com.y);
    const xi = com.x + com.vx / om;                    // ★ 捕获点

    let stanceL = singleLeg ? (singleLeg !== "r") : prevStance === 1;   // ★ 单腿模式：指定腿为支撑
    // ★★★ 架构重做（2026-10-02）：换脚触发改成「**摆动腿已落地**」，而不是时钟边界。
    stanceLNow = stanceL;   // ★ 让 wtLoadOf 读到当前支撑腿
    //
    //  旧写法（时钟边界 + 接触校验）**必然死锁**：
    //    校验要求"旧支撑脚已离地"，但旧支撑腿在换脚之前一直被命令为 stance ⇒ 它不会离地
    //    ⇒ 校验永远不过 ⇒ `stanceL` 8 秒不翻转 ⇒ 实测"指令支撑腿 = 左 21 / 右 0"
    //    ⇒ 整条左腿都被标成 balance、右腿被标成 step（一瘸一拐的机器级原因）。
    //
    //  正确的三步（用户 2026-10-02 原话）：
    //    ① 迈腿   → swingLeg 摆出去
    //    ② 变支撑 → 摆动腿**落地**后与旧支撑腿交换角色
    //    ③ 调重心 → 支撑腿 + 腰 做平衡调整（adjust 相）
    //  所以交换的触发条件是「**当前摆动腿已落地** 且过了防抖时间」。
    const swingIsL = singleLeg ? (singleLeg !== "l") : !stanceL;   // 摆动腿 = 非支撑腿（单腿模式下固定）
    if (clockDriven) {
      const half = p.T * 0.5;
      // 防抖：迈步相本身就要占掉一半周期，落地后再等一小会儿才换角色
      const readyT = lastSwitch + half * 0.55;
      const landed = swingIsL ? footGrounded(sim.doll, 'l') : footGrounded(sim.doll, 'r');
      // ★★ **着地即闩锁**（用户 2026-10-02 明确："落地就得锁定"）。
      //   一旦摆动腿触地（IC 事件），立刻把它闩为支撑腿并启动支撑模块：
      //   在另一条腿着地之前，**它不允许再离地**。
      if (landed && latchedStance !== (swingIsL ? 'l' : 'r')) {
        // ⚠ 只有当"另一条腿已被换下去"时才算这次落地，否则是同一条腿反复触地。
        // ★ 修 bug（2026-10-02）：原来判据是 `lastSwitchWasFlip || latchedStance === null`，
        //   而 `lastSwitchWasFlip` 一旦为 true **再也不会被清回 false** ⇒ 换脚之后
        //   条件恒真；又因为摆动腿从不离地、`landed` 每帧为真 ⇒ 锁定腿每帧来回翻，
        //   "着地即锁"名存实亡（实测锁定腿全程不变，交接数却是 72 次）。
        //   ⇒ 改成**必须真的发生过一次换脚**（`steps > 0`）才认这次落地。
        if (steps > 0 && latchedStance === null) {
          latchedStance = swingIsL ? 'l' : 'r';
          wtModule++;
        }
      }
      // ══════════════════════════════════════════════════════════════════
      // ★★★ 换脚必须以「站稳」为前提（用户 2026-10-02："身体没调整过去，先不急迈另一条腿，
      //   现在需要迈一条腿后保持稳定，而且要求抬高后退后依旧稳定"）
      //   旧逻辑：只等 `landed && t >= lastSwitch + half·0.55` —— **纯定时器**，
      //   刚落地就换另一条 ⇒ 重心永远转不完。
      //   新增门槛（缺一不可）：
      //     ① 重心转移已完成（wtStage==='done'，即该腿承重 ≥50%，Perry Loading Response）
      //     ② MoS 有正余量（站得住，不是勉强撑着）
      //     ③ 上面两条连续满足 STABLE_HOLD 秒
      // ══════════════════════════════════════════════════════════════════
      const mosNow = xi - (com.x + com.vx / om);     // 正 = CoM 在支撑边内
      const stableNow = wtStage === 'done' && mosNow > 0;
      if (stableNow) stableT += dt; else stableT = 0;
      const stableEnough = stableT >= STABLE_HOLD;
      // ★ 诊断：换脚卡在哪一条（架构重做的打点，probe-arch 打印）
      //   `s` 在后面才算，这里内联算一份；`sole` = 摆动脚离地高度（判断它到底落没落）
      const sNow = Math.max(0, Math.min(1, (t - lastSwitch) / Math.max(0.2, p.T * 0.5)));
      sim.doll.soleXZ('l', footBufL); sim.doll.soleXZ('r', footBufR);
      if (t - lastDiagT > 0.08) {
        lastDiagT = t;
        swapTrace.push({
          t: +t.toFixed(2), s: +sNow.toFixed(2), swing: swingIsL ? 'L' : 'R',
          landed, ready: t >= readyT, sole: +(swingIsL ? footBufL[1]! : footBufR[1]!).toFixed(3),
        });
        if (swapTrace.length > 400) swapTrace.shift();
      }
      if (!singleLeg && landed && t >= readyT && stableEnough) {   // ★ 单腿模式禁用换脚
        steps++;
        stanceL = swingIsL;                    // 摆动腿落地 ⇒ 它变成新的支撑腿
        stanceL = swingIsL;                    // 摆动腿落地 ⇒ 它变成新的支撑腿
        prevStance = stanceL ? 1 : 2;
        stanceSeq += stanceL ? "L" : "R";
        // 落脚点记**实测落点**（不是捕获点 xi，否则支撑腿 IK 每帧往错误位置拉）
        sim.doll.soleXZ('l', footBufL); sim.doll.soleXZ('r', footBufR);
        const landedX = stanceL ? footBufL[0]! : footBufR[0]!;
        // ★ 落脚点的**横向 (z)** 不采纳实测值，锁在髋的投影上（STANCE_Z）。
        //   否则每一步都记录"脚碰巧落在哪"，会**随机往内游走**：
        //   实测骨架锚点踝间距 421mm，仿真里两只脚却都跑到 z≈0（踝间距≈10mm）
        //   ⇒ 腿长期内八、横向支撑面消失、CoM 单调漂移 0.19m（用户："脚踝向内收"）。
        const landedZ = stanceL ? HIP_Z : -HIP_Z;
        plantLz = stanceL ? landedZ : plantLz;
        if (stanceL) { plantL = landedX; } else { plantR = landedX; }
        if (stanceL) plantL = landedX; else plantR = landedX;
      }
    } else {
      // 状态触发：ξ 走出当前支撑脚的落点，且过了半个周期（防抖）才换脚
      const plantNow = stanceL ? plantL : plantR;
      if (Math.abs(xi - plantNow) > p.thresh && t - lastSwitch > p.T * 0.5) {
        stanceL = !stanceL;
        steps++;
        lastSwitch = t;
        if (stanceL) plantL = xi; else plantR = xi;
        prevStance = stanceL ? 1 : 2;
        syncComTarget();   // ★ 换脚后 CoM 目标跟到新支撑脚
      }
    }
    const s = Math.max(0, Math.min(1, (t - lastSwitch) / Math.max(0.2, p.T * 0.5)));
    // ══════════════════════════════════════════════════════════════════════
    // ★★★★★ 四步循环（用户 2026-10-02 原话）：
    //   "需要迈出的腿发力，让自己支撑起来，转移重心，然后再迈出下一条腿"
    //
    //   ① SHIFT  [0, 0.25)      重心转移到**旧支撑腿**（把待迈的腿卸掉）
    //   ② STEP   [0.25, 0.75)   迈出：抬腿 + 前伸 + 落地
    //   ③ PUSH   [0.75, 1.0)    **新腿发力**：踝跖屈 + 髋伸，把身体推过去、撑住
    //   ④ 下一周期：重心已在新腿上 ⇒ 又可以迈另一条
    //
    //   关键：③ 是"迈出的腿变成支撑腿"的力学过程，缺了它新腿落地就是死重。
    // ══════════════════════════════════════════════════════════════════════
    const sPush = Math.max(0, (s - PUSH_FRAC) / (1 - PUSH_FRAC));   // ③ 的进度 0→1
    const inPush = s >= PUSH_FRAC;
    // ③ 新支撑腿发力：踝跖屈（顶髋）+ 髋伸（前送）
    const pushTorque = inPush ? (p.anklePush ?? 0) * 2.2 * sPush : 0;
    // ══════════════════════════════════════════════════════════════════════
    // ★★★ 迈腿前的**平衡判定门**（用户 2026-10-02："后腿起来得经过一个平衡判定的东西，
    //   甚至第一步走出之前我也觉得应该有这么个玩意"）
    //   三条判据全部成立才允许**任何脚离地** —— 前进时的后腿、后退时的后腿、以及第一步，
    //   全都走这一个门。
    //
    // ★★ 2026-10-02 改为**真实支撑边**（此前用常数 STANCE_X_HALF 估算，必然是假的）：
    //   MoS = 真实支撑面前沿 − 捕获点ξ。`readSupport()` 由 sim 每控制周期算好并存进
    //   `sim.sup`，直接取它，不再在 teacher 里另立一套几何。
    //   （真实支撑面是**两只接地脚足迹的凸包**，双支撑时前沿在两脚之间，
    //    比单脚时的 STANCE_X_HALF 大得多 ⇒ 之前那些 −200mm 的假 MoS 不复存在。）
    const supB = sim.sup;
    const supEdgeReal = supB.cx + supB.halfX;
    const xiNow = com.x + com.vx / om;
    const mosHere = supEdgeReal - xiNow;
    //   没通过就把摆动高度压到 0（等于不迈），而不是硬抬。
    // ══════════════════════════════════════════════════════════════════════
    const [flNow, frNow] = sim.doll.footLoadFrac(dt);
    const stanceLoadNow = stanceL ? flNow : frNow;
    // ★★★ **承重腿由实测载荷决定**（不是硬编码、也不是时钟）。
    //   起始时右腿是后退腿，但真正把它定为承重腿的依据是**它的载荷确实更大**。
    //   `roleLatched` 一旦锁定就固定，只有在另一条腿承重超过 `ROLE_HANDOFF` 时才交接。
    const ROLE_HANDOFF = 0.08;   // 交接滞环：防止两条腿载荷接近时角色来回抖
    if (roleLatched === null) {
      // 开局：谁承重明显更大谁当承重腿；若还分不出，退回"后退腿"（x 更小的一方）
      if (Math.abs(flNow - frNow) > ROLE_HANDOFF) roleLatched = flNow > frNow ? 'l' : 'r';
      else roleLatched = footBufL[0]! <= footBufR[0]! ? 'l' : 'r';   // 更靠后 = 承重
      dbgLog.roleSet = 1;
    } else {
      // 交接：锁定腿的载荷被**另一条腿明显超过**才交出去
      const lockedLoad = roleLatched === 'l' ? flNow : frNow;
      const otherLoad = roleLatched === 'l' ? frNow : flNow;
      if (otherLoad > lockedLoad + ROLE_HANDOFF) { roleLatched = roleLatched === 'l' ? 'r' : 'l'; dbgLog.roleSet = 2; }
    }
    // ★ 承重判据改用**差值**（两脚都在地上时绝对占比天然 = 0.50，用绝对值会死锁）
    const loadDiffNow = flNow - frNow;
    // ★ 判定时刻：只在双支撑末段（s ≥ decisionAt）判一次，不再要求连续保持 0.45s
    //   （连续保持 + 承重绝对值 0.5 会互相锁死，见 BalanceGate 注释）
    const verdictRaw = balGate.judge(mosHere, loadDiffNow, true);
    // ★★ **判定结果锁存**（这一步是让整条链能通的关键）：
    //   判定时刻 `s ≥ 0.75` 落在摆动的**下降段**（脚已经在往回落），
    //   此时就算放行也没有意义 —— 抬腿峰值在 s≈0.3~0.5，早过了。
    //   ⇒ 在判定点把结果**存起来**，一直用到这次落脚完成（换脚）为止。
    //   这也正是用户最初要求的语义："前腿落地后把支撑模块锁住，在另一条腿完成前不许再离地"，
    //   只是方向反过来 —— 这里锁的是"下一次抬腿的许可"。
    // ⚠⚠ 已回退（2026-10-02）：曾改成「按周期 OR 累积许可 + 只在换脚时清零」，
    //   实测**更糟**：许可在 t=0.033s 就取得（此时前脚承重才 0.55、体重还在两脚之间），
    //   而清零条件「换脚」从不发生 ⇒ 许可**永不掉落**，门放行帧占比 98.9%、
    //   最长连续许可 2.90s（硬约束周期 1.10s 的 2.6 倍）⇒ **门形同虚设**，
    //   与用户要求的「锁住、未完成不许再离地」正好相反。
    //
    // ★ 现在的诚实语义：**每周期独立判定，不跨帧累积**。
    //   许可只对**当前这一帧**有效 —— 抬腿必须当帧达标。
    //   相位错位问题（承重 s≈0.9 才上去、抬腿峰在 s≈0.3）不再用锁存掩盖，
    //   而是靠让承重转移本身在摆动**之前**完成来解决（那是 APA 的职责，见 copTargetZ）。
    const verdict = balGate.judge(mosHere, loadDiffNow, true);

    // ══════════════════════════════════════════════════════════════════════
    // ★★★ **迈步之前先稳定重心**（用户 2026-10-02 原话）
    //
    //   之前门只看**位置**（MoS 在支撑边内）与**承重差**，不看**速度**。
    //   实测：门放行的瞬间 CoM 速度高达 0.8~2.0 m/s（前面B 控制器饱和时更甚），
    //   身体还在快速移动就被允许抬腿 ⇒ 落脚点必然错、承重必然接不住 ⇒ 又倒。
    //   真实步态的双支撑末期本来就是**停下来**的一小段（Perry：Loading Response 短制动），
    //   "站稳了才迈下一条" —— 所以必须把**重心速度**纳入判据。
    //
    //   判据：`|vx|` 与 `|vz|` 同时低于 `vHold`（默认 0.06 m/s，比文献慢速步速 0.39 的 15% 更严）。
    //   并且在**未达标时主动阻尼**（下面 corrCom 已含 kWtVx 项，这里再补一个专门的
    //   稳定项），把"迈步前"这段真正用来**减速**而不是用来倒计时。
    const vHold = THR.vHold;
    const comSpeed = Math.hypot(com.vx, com.vz);
    const okHoldV = comSpeed < vHold;
    // 主动稳定力矩：CoM 越快，髋俯仰阻尼越大（只加减速，不改目标位置）
    const holdDamp = -Math.min(0.5, comSpeed * 2.2) * Math.sign(com.vx || 1);
    dbgLog.vHold = +comSpeed.toFixed(3);
    const verdictV: typeof verdict = {
      ...verdict,
      ok: verdict.ok && okHoldV,
      why: verdict.ok && !okHoldV
        ? `重心未稳定（速度 ${comSpeed.toFixed(3)} m/s ≥ ${vHold}，先减速再迈）`
        : verdict.why,
    };
    if (!verdictV.ok) balBlocked = verdictV.why; else balBlocked = '';
    // ★ 重心转移期内**前伸也要压住**：先把体重挪过去，再把腿送出去。
    //   否则腿在体重还没卸掉时就往前甩 ⇒ 既抬不高也甩不远。
    const sSw = Math.max(0, (Math.min(1, s) - SHIFT_FRAC) / (1 - SHIFT_FRAC));
    // 原式 `xi + kv·(vDes−vx)·T/2`：xi 是捕获点，跟随身体前进。身体还没动起来时
    //   `xi ≈ com.x` ⇒ 每只脚都被种在**原来的位置** ⇒ 净位移≈0（实测前伸仅 3mm）。
    // ─────────────────────────────────────────────────────────────────────
    // ★★★ 落脚点 = **Raibert 捕获点规则**（程序化，不再有硬编码的固定偏移）
    //
    //   Raibert (1985) / Perry 脊椎与步态控制的标准形式：
    //       x_foot = ξ + Γ·v_des + K·(v_des − v_actual)
    //   其中 ξ = 捕获点 = com.x + com.vx/ω（放 ξ 处 ⇒ CoM 恰好停住）。
    //   · Γ（无量纲）把脚放在 ξ **前方** Γ·v_des ⇒ 支撑脚有余量把 CoM 推过去
    //   · K（时间，s）按速度误差修正：跑慢了把脚落得更靠前
    //
    //   为什么必须用它（用户 2026-10-02："程序化决定前后腿了吗"）：
    //   旧写法 `xi + kv·(vDes−vx)·T/2` 之后又被 `reach` 覆盖成
    //   `stanceX + reach`（reach=0.5 硬编码常数）⇒
    //     · 前后间距**与速度无关**，恒为 0.5m 附近的死数
    //     · 开局两脚 `BASE_X_*=±0.09` 完全重合 ⇒ 根本没有前后之分 ⇒ 无承重腿
    //   ⇒ 现在前后间距、承重分工、落点全部由 ξ 与速度决定，是**程序化的**。
    const swingX0 = xi + (p.kGamma ?? 0.35) * p.vDes + (p.kVerr ?? 0.25) * (p.vDes - com.vx);
    let swingX = swingX0;
    // ⚠ `reach`（相对支撑脚的固定偏移）已停用：它是硬编码常数，会把落脚点
    //   重新钉死到与速度无关的固定间距上，正是前后腿之分消失的根源。
    //   如需临时扫参请用 `kGamma` / `kVerr`。

    // ★★★★ 摆动曲线改成「**先转移重心，再迈出**」（用户 2026-10-02 提醒：
//   "迈腿之前需要把重心转移到静止的腿上，我给忘了"）
//
//   旧式 `swingY = 0.012 + lift·sin(πs)` 从 s=0 就开始抬腿 —— 但此刻**体重还在摆动腿上**，
//   脚抬不动（实测离地只有 0~5mm），身体却已经在失衡 ⇒ 迈完第一步就倒（实测 0.48s）。
//
//   Perry 分期对应的正确顺序（每条腿一个周期）：
//     ① 前 25%  **重心转移**：双脚着地，CoM 横向挪到支撑腿，摆动腿**先不离地**
//     ② 25~100% **迈出**：摆动腿离地 → 前伸 → 落地
// 转移期内摆动腿只抬起一点点（跟着身体被"卸掉"），离地主体在转移之后
const sSwing = Math.max(0, (Math.min(1, s) - SHIFT_FRAC) / (1 - SHIFT_FRAC));
// ★★ 平衡判定门没通过 ⇒ **不允许离地**（把抬升压到 0，等门通过再迈）
      const swingYRaw = s < SHIFT_FRAC
      ? 0.012 + p.lift * 0.12 * (s / SHIFT_FRAC)          // 转移期：几乎不离地
      : 0.012 + p.lift * Math.sin(Math.PI * sSwing);       // 迈出期：完整抬升曲线
    // ★★ 单腿站立模式：摆动腿抬到固定高度并**保持**（绕过平衡门与换脚判定）
    //   目的：把"单腿能不能站稳"从"能不能迈腿"里解耦出来单独验证。
    const swingY = singleLeg
      ? (swingIsL === (singleLeg === 'l') ? 0.012 : liftHold)
      : (verdictV.ok ? swingYRaw : 0.012);             // ★ 没过门就贴地
    const dtSw = t - lastSwitch;
    // ★★ 落地吸能**必须限幅**（用户 2026-10-02："脚落地后甚至无法实现支撑"）。
    //   旧式：`absorb = p.absorb · exp(−dtSw/τ)`，触地那一帧 dtSw=0 ⇒ **满量** p.absorb。
    //   而寻优把 p.absorb 推到 1.0 rad = **57°**（因为目标函数只测摆动膝峰值、
    //   不测支撑膝，它一路涨没有代价）⇒ 落地瞬间支撑膝被命令屈 57° ⇒ **腿直接塌**，
    //   脚当然撑不住。
    //   文献：Oberg 初始接触膝屈 ~15°、负重反应峰 ~20°（midstance 15.7°）。
    //   ⇒ 上限取 20° = 0.35 rad。
    const absorb = Math.min(ABSORB_MAX, p.absorb)
      * Math.exp(-dtSw / Math.max(0.05, p.absorbTau));
    const corr = p.kPitch * pitch + p.kRate * av.x;
    // ══════════════════════════════════════════════════════════════════════
    // ★★★ B 方案：矢状面重心转移（用户 2026-10-02："前脚承重都没做"）
    //   动机：整套 APA 转移此前**只写在横向 (z) 上**（`copZ - com.z`），
    //   而"前脚承重"要的是**矢状面前移** ⇒ 矢状面完全没有承重转移控制器。
    //   另：`loadAccept = 0.5` 在两脚平分时就已满足，状态机一进 toStance 就宣布
    //   "转移完成" ⇒ 转移从未启动却被当成完成。
    //
    //   文献依据 ——
    //   · Neptune/Perry, Front Neurol 2019, 10:999：髋肌也能维持 CoM 增量，
    //     但"the work produced by these muscles has been **four times more efficient**"
    //     （指跖屈肌 vs 髋肌）⇒ 髋效率低、需要的增益大。
    //   · Becker/Banks/Whittle, PLOS Comput Biol 2021, 17(6):e1008369：
    //     CoM 位置+速度的延迟线性反馈即可解释踝反射 ⇒ 同样口径用在髋俯仰上成立。
    //
    //   控制器（阻尼倒立摆形式）：
    //     e  = com.x − 支撑脚x        （CoM 相对支撑脚的纵向位置）
    //     ė  = com.vx                 （CoM 前移速度）
    //     τ  = −kComX·e − kComVx·ė     （把 CoM 拉回/停在支撑脚上方）
    //   ⇒ 符号：CoM 在脚**前方**(e>0) 且前移 ⇒ 给**屈髋**把躯干压回去、拉 CoM 后移。
    // ══════════════════════════════════════════════════════════════════════
    // ★★★★★ **VIP + 双刚度平衡态**（按文献重做，2026-10-02）
    //
    //   文献依据 —— Morasso et al., *Front Comput Neurosci* 2022, 15:956932
    //   "Integrating ankle and hip strategies for the stabilization of upright
    //    standing: an intermittent control model"；以及 Morasso et al. 2019
    //   （DIP/VIP 模型，*J NeuroEngineering Rehabil* / PMC6428281）：
    //
    //   ① **VIP（Virtual Inverted Pendulum）** = 从**踝**连到**全身 CoM** 的虚拟摆。
    //      它的摆角**就是 CoP 在支撑面上的位置** —— 因为 CoP 是人体唯一能直接
    //      "感知"这个虚拟摆的通道（足底触觉+本体感觉）。⇒
    //          q_vip = atan2(coM_x − ankle_x , coM_y − ankle_y)
    //
    //   ② **两个关节用不同机制**（这是全文的关键，原文照搬）：
    //          踝：被动刚度 `K_a`（**欠临界**）+ 对 VIP 延迟误差的**间歇反馈**
    //               ⇒ 直接控制 **CoP**（"踝策略" = "CoP 策略"）
    //          髋：被动刚度 `K_h`（**超临界**），**不需要主动控制**
    //               ⇒ 靠上方身体的局部 CoM 间接控制全身 CoM（"髋策略" = "CoM 策略"）
    //
    //   ③ **为什么髋只需一点点共同收缩**（原文的推导，我们直接用）：
    //          倾倒力矩  τ_g = mgh·sin(q) ≈ mgh·q  ⇒  **K_crit = mgh**
    //      · 绕**踝**的全身：h ≈ 0.9 m  ⇒ K_crit ≈ m·g·0.9   （大）
    //      · 绕**髋**的上身：h ≈ 0.5 m  ⇒ K_crit ≈ m·g·0.5   （**只有一半**）
    //      ⇒ 髋只要 `K_h > K_crit` 就**被动稳定**，代价极小。
    //
    //   ④ **踝的 CoP 行程被限制在脚掌内**（Michaels & Ting, *Sci Rep* 2025：
    //      "the biomechanical constraint was defined as the **CoP range limitation
    //      to the metatarsal joint**"）。一旦 CoP 走到足底边缘，**踝力矩饱和**
    //      （保住 flat-foot 约束），策略随之转向髋。这正是"踝是主力、髋是备选"。
    //
    //   ★ 与旧写法的根本差别（旧写法是**方向性错误**，已废）：
    //      旧：把**髋**当 CoP 策略的主力（`kWtX` 直接推 CoM）。
    //          但实测踝力矩 ×9 扫描对动力学**零效力** ⇒ 被迫让髋代偿，
    //          而髋做 CoM 策略效率只有跖屈肌的 **1/4**（Neptune/Perry 2019）
    //          ⇒ 必然饱和（实测 CoM 冲到 0.4~2.0 m/s）⇒ 平衡门拦下 ⇒ 死锁。
    //      新：踝=CoP 策略（主力，直接）、髋=CoM 策略（备选，被动超临界刚度）。
    // ══════════════════════════════════════════════════════════════════════
    // ★★★ 调用**模块 ①：承重腿 + 腰的平衡维持系统**（balanceHold.ts）
    //
    //   用户 2026-10-02："我的设计分两个模块，一个承重腿和腰的平衡维持系统，
    //   另一个迈步系统"。本文件原先把两套逻辑**缠在同一个循环里**，
    //   导致"关掉迈步相关的东西就把平衡也关了"（kWtX 全局归零那次）。
    { const [fnn, ftt] = sim.doll.footGrip(stanceL ? 0 : 1, dt); grfRatioNow = fnn > 1 ? ftt / fnn : 0; }
    //   ⇒ 现在平衡全部由 balanceHold() 一个**纯函数**算出，本模块不持有任何状态。
    //
    //   平面分工与全部文献依据见 balanceHold.ts 文件头。
    const hold = balanceHold(holdP, {
      comX: com.x, comY: com.y, comZ: com.z,
      comVx: com.vx, comVy: com.vy, comVz: com.vz,
      stanceX: stanceL ? footBufL[0]! : footBufR[0]!,
      stanceZ: stanceL ? HIP_Z : -HIP_Z,
      ankleY: com.y - hipDy,
      bodyMass: totalMass,
      hipHeight: hipDy,
      hipFlex: sim.doll.jointAngle(jointIndexByName(sk, stanceL ? "hip_l" : "hip_r")),
      kneeFlex: sim.doll.jointAngle(jointIndexByName(sk, stanceL ? "knee_l" : "knee_r")),
      grfX: grfRatioNow,   // ★ GRF 横/竖比（切向力 / 法向力）
      grfY: 1,
      singleLeg: singleLeg !== null,
    });
    const qVip = hold.qVip, qVipDot = hold.qVipDot;
    const qVmp = hold.qVmp;
    // 以下全部已搬到 `balanceHold()` 里算（见上方调用点），此处只做诊断转发。
    const vipDegDbg = hold.ankleSag * 57.3;   // ★ VIP 踝角指令（°）
    // ★★ 把 VIP 的踝角指令翻译成**虚拟支撑点的位置**（这才是让踝有 CoP 权限的关键）。
    //   `qVip` 是"CoM 在踝前方多少"（弧度），把它的**正弦**当作 CoP 前移量：
    //     CoP 前移 ⇒ GRF 对踝产生**后向**力矩 ⇒ 减速前移的 CoM（踝策略的本意）。
    //   行程用 Sci Rep 2025 的 metatarsal CoP range：±COP_HALF_LEN(0.075 m)。
    {
      const side: 0 | 1 = stanceL ? 0 : 1;
      dbgLog.grfRatio = +grfRatioNow.toFixed(3);
      const cop = Math.sin(qVip) * COP_HALF_LEN;
      sim.doll.setCoP(side, (side === 0) === stanceLNow ? cop : 0, COP_HALF_LEN);
      dbgLog.copOff = +cop.toFixed(4);
    }
    const hipStiffRatio = (p.kHipStiff ?? 1.6) - 1;      // >0 ⇒ 超临界，多出来的就是稳定裕度
    const kCritAnkle = hold.kCritAnkle, kCritHip = hold.kCritHip;
    const copOut = hold.copOut;
    const bodyMass = totalMass;
    dbgLog.qVip = +qVip.toFixed(4); dbgLog.vipDot = +qVipDot.toFixed(4);
    dbgLog.kCritA = +kCritAnkle.toFixed(1); dbgLog.kCritH = +kCritHip.toFixed(1);
    dbgLog.copOut = +copOut.toFixed(4);
    syncComTarget();   // ★ 每周期同步 CoM 目标到承重腿落点（否则单腿站立下目标钉在初值）
    const corrCom = Math.max(-0.45, Math.min(0.45, hold.hipSag + holdDamp));
    dbgLog.ankleCorr = +vipDegDbg.toFixed(2); dbgLog.hipStiff = +hipStiffRatio.toFixed(4);   // 报**实际下发的踝角度偏移(°)**
    // ★★ 状态机增益调度（iCub 框架 arXiv 1707.08359 的做法：**姿态是低优先级任务**，
    //   用状态机在"迈步相/调整相"之间调度增益）。
    //   实测依据（probe-gaitcycle ④）：脊椎反相**全程开**会把双支撑占比从 83% 顶到 94%
    //   —— 它让角色更想站住而不是迈步，正是"姿态压过推进"的典型症状。
    //   ⇒ 调整相（落地后的前 ADJUST_MIN 秒）全力做姿态；迈步相只留一点点。
    const inAdjust = (t - lastSwitch) < ADJUST_MIN;
    const postGain = inAdjust ? 1 : 0.15;
    // ★★ CMP / Moment Balance Strategy：主动产生**关于质心的力矩**，把全身角动量调回 0。
    //   为什么必须主动做（Popovic, Hofmann & Herr 2004）：仅靠 CoP 位置控制不够 ——
    //   把 ZMP 放在支撑中心等于一个"静态不稳定、无执行器的倒立摆"。
    //   为什么用角动量当被控量（Herr 2008 / Sci Rep 2023）：正常走路 WBAM≈0，
    //   段间抵消 70~95%；偏离它就说明身体在"整体转"，必须靠髋/脊柱配重来抵消。
    //   实测（probe-gaitcycle）：未启用时单支撑 |WBAM| 中位 5.36 = 平衡基线 0.16 的 **33.5×**。
    let cmRoll = 0;
    // ★ 脊椎归属的模块走统一开关（否则 `mod.enable('cmBalance', false)` 是假的：
    //   实测关掉脊椎两行数字完全一样 ⇒ 老师根本不看模块表）。
    const cmOn = p.cmBalance > 0 && sim.mod.active('cmBalance', sim.gp.now, 2, null);
    if (cmOn) {
      wholeBodyAngularMomentum(sim.doll, com, lbuf);
      const lz = lbuf[2]!;                       // 额状面：绕竖直轴（左右转）
      const ly = lbuf[1]!;                       // 矢状面：绕侧向轴（前扑后仰的转动）
      const dlz = hasL ? (lz - prevLz) / dt : 0;
      const dly = hasL ? (ly - prevLy) / dt : 0;
      prevLz = lz; prevLy = ly; hasL = true;
      // PD：力矩 ∝ −k·L − kd·dL/dt
      cmRoll = -(p.cmBalance * lz + p.cmBalanceD * dlz) * 0.02
        - (p.cmBalance * ly + p.cmBalanceD * dly) * 0.02;
    }
    for (const side of ['l', 'r'] as const) {
      const isStance0 = (side === 'l') === stanceL;
      // ★★ 闩锁的强制：闩锁腿**永远是支撑腿**，绝不被派成摆动腿
      //   （"前腿落地后别再让它离地"）。若因时钟错位被派成摆动，这里直接改回支撑。
      // ★★ 承重角色改由 `roleLatched`（实测载荷判定的承重腿）决定 —— 不再靠时钟猜。
      // ★ 承重角色：`roleLatched`（实测载荷判定）与 `stanceL`（时钟）**取或**，
      //   两者任一认为该腿是支撑腿就按支撑腿处理 —— 这样即使时钟与载荷判定
      //   短暂不一致，也不会把正在承重的那条腿误判成摆动腿去抬。
      const isStance = roleLatched === side || isStance0;
      // ★ 虚拟髋（com.y − HIP_DY）。实测对比：
      //   用**真实髋刚体**(0.849m) ⇒ IK 必须把腿折到 92% 才够得着地 ⇒ 存活反而降到 0.77s
      //   用**虚拟髋**(0.744m)      ⇒ 站立构型接近自然 ⇒ 存活 1.90s / 3 次换脚
      //   ⇒ 根因是**骨骼比例**：腿/髋 = 0.785/0.849 = 0.92，低于人体常态 ~0.95~1.0。
      //   正确修法是改骨架（降髋锚点 / 伸长腿），不是改 IK 的参考点。见 probe-arch 骨骼体检。
      const hipX = com.x + (side === 'l' ? HIP_Z : -HIP_Z);
      if (hipYRef < 0) hipYRef = com.y - hipDy;   // 锁存，避免 com.y 正反馈把身体拽沉
      const hipY = hipYRef;
      void hipW; void com;
      // ★★★ 横向自由度（用户 2026-10-02："脚踝向内收而不是向外迈"、"迈出的腿真能承重吗"）
      //   现象：髋外展指令给到 14°、增益放大 3.4 倍，双脚间距纹丝不动（0~10mm），
      //   而 CoM 只跟着漂移 ⇒ **矢状面 IK 把脚拽回竖直平面**，外展这条通道对本 rig 无效。
      //   修法（给它真正的一个自由度）：
      //     ① 由目标横向偏移 dz 反解髋外展角：sin(abduct) = dz / L
      //     ② 矢状面 IK 改用**剩余平面腿长** L·cos(abduct) 去解
      //   这样外展是**前馈**（有明确目标），不再靠 kLat 反馈瞎推。
      const hipZ = side === 'l' ? HIP_Z : -HIP_Z;
      const footZTarget = side === 'l' ? STANCE_Z : -STANCE_Z;
      const dzWant = footZTarget - hipZ;
      const sinAb = Math.max(-0.7, Math.min(0.7, dzWant / LEG));     // 限幅：≤±45° 外展
      const abductFF = Math.asin(sinAb);                                // ① 前馈外展
      const planeScale = Math.sqrt(Math.max(0.05, 1 - sinAb * sinAb)); // ② 剩余平面腿长
      const [h, k] = isStance
        ? ik(hipX, hipY, side === 'l' ? plantL : plantR, 0.012, planeScale)
        : ik(hipX, hipY, swingX, swingY, planeScale);
      // ⚠ 2026-10-02 记录：这里**曾经**试过"平衡修正只给支撑腿"（摆动腿不加 corr），
      //   **实测更差**（存活 3.85→2.43s、双支撑 35%→71%）。保留原样。
      //
      // ★★★★★ 阶段 × 角色 姿态指令表（normGait.PHASE_ROLE）
      //   目标值全部来自文献（Oberg 膝 15.7°/63°、髋 ROM 46.9°；Sci Rep 2019 腰 −20°），
      //   用**跟踪误差**把实际姿态拉向该阶段该角色的标准姿态。
      const phNow = sim.gp.now;
      const cSwing = cell(phNow, 'swingLeg'), cStance = cell(phNow, 'stanceLeg');
      const roleCell = isStance ? cStance : cSwing;
      const stanceLock = p.stanceLock ?? 0;
      // ⚠ 2026-10-02：把膝**直接**按指令表替换（不做 IK 混合）会更差（存活 3.85→1.37s），
      //   因为落点必须靠 IK。所以按表的正确用法是：**摆动腿用 IK，支撑腿在迈步相锁定**。
      let kneeCmd = k + (isStance ? -Math.abs(absorb) : 0);
      // ★★★ 用户 2026-10-02："先迈出去，再启动支撑的过程啊，迈出去的过程被覆盖了吗"
      //   —— 是的，被覆盖了。旧写法 `hipCmd = h + corr` 把**平衡修正加在两条腿上**，
      //      kPitch=2.544 时躯干一个俯仰就能往摆动腿的髋上叠几十度，把 IK 的迈步冲掉。
      //   正确分工：**摆动腿只吃 IK**（纯迈步），`corr` 只给支撑腿。
      //   （注：早期试过"corr 只给支撑腿"更差，但那是**归一化还坏着**的时候测的
      //     ——膝只能动 1.6°，结论不可信；现在重测。）
      let hipCmd = isStance ? h + corr + corrCom : h;
      // ★★★ 支撑腿在「迈步相」锁定（用户："脚往前迈的时候，身体别动"）
      //   回读依据（npm run roles）：step 相支撑腿 **髋 ROM 38.5° / 膝 ROM 30.7°**，
      //   而指令表要求 髋 15° / 膝 15.7°（Oberg slow midstance）⇒ 实际是要求的 2 倍。
      if (isStance && roleCell && stanceLock > 0 && phNow === "step") {
        // ★ 只对支撑腿生效（架构约束）
        const w = stanceLock;
        if (roleCell.hipDeg != null) hipCmd = hipCmd * (1 - w) + roleCell.hipDeg * Math.PI / 180 * w;
        if (roleCell.kneeDeg != null) kneeCmd = kneeCmd * (1 - w) + roleCell.kneeDeg * Math.PI / 180 * w;
      }
      // ★★ 支撑腿蹬离（**必须在写马达之前**加！旧代码加在 setAxis 之后 ⇒ 完全无效）
      //   支撑相后半段线性增大的髋伸驱动，把身体推过支撑脚。
      if (isStance) hipCmd += (p.stancePush ?? 0) * Math.max(0, (s - PUSH_FRAC) / (1 - PUSH_FRAC));   // ★③ 支撑腿蹬离发力
      curSys = isStance ? 'hold' : 'servo';
      curOwner = isStance
        ? `balance(ik+corr${stanceLock > 0 ? '+lock' : ''}${s > 0.5 ? '+push' : ''})`
        : 'step(ik)';
      // ★★ 架构硬约束（2026-10-02，probe-arch 体检得出）：**摆动腿的髋只接受 IK**。
      //   corr / lock / push 都是**支撑腿的平衡机制**，它们进来就等于把迈步冲掉
      //   （实测：加了 lock+push 后"迈腿都做不到了"）。
      //   这里用 `Math.abs` 显式区分：摆动侧 hipCmd 本来就等于 h（见上方 `isStance ? h+corr : h`），
      //   但 lock/push 仍会无条件叠加 —— 必须把它们也限定在支撑腿。
      if (!isStance) hipCmd = h;
      curSys = 'hold';
      setAxis(`hip_${side}`, hipCmd, jHip);
      // ★★★ **支撑膝锁腿**（模块 ① 的 `hold.kneeUpright`）。
      //   实测（2026-10-02，"不停鞠躬"）：支撑膝自由折到 **−79°**，把骨盆压下去 **752 mm**。
      //   文献：Li & Levine 2010 —— "humans **keep their knee angle nearly constant**"；
      //   PMC8710023 —— 靠股四头肌（VM/VL/RF）协同提供腿部刚性。
      //   ⇒ 承重腿的膝在**单腿站立**时叠加直立刚度，把膝锁在轻微屈曲（默认 15°）。
      if (singleLeg && isStance) kneeCmd += hold.kneeUpright;
      curSys = 'hold';
      setAxis(`knee_${side}`, kneeCmd, jKnee);
      curSys = 'hold';
      setAxis(`shoulder_${side}`, -h * 0.4, jHip);
      // ★★★ 踝指令
      //   文献量级：摆动期背屈 ~10°（脚尖上勾，利于前伸）→ 蹬离跖屈 ~15~20°（脚尖下压推髋前送）
      //   相位 s：0=刚离地  0.5=摆动中  1=落地
      const aStance = p.ankleStance ?? 0, aPush = p.anklePush ?? 0, aSwing = p.ankleSwing ?? 0;
      // ★★ 符号约定（用户 2026-10-02："踝关节是不是方向反了" —— 是的，反了，已修）：
      //   partsMeta: `limitDeg = [低头(plantarflex), 勾脚(dorsiflex)]` = [−10°, +18°]
      //   ⇒ **负 = 跖屈（脚尖下压）**，**正 = 背屈（脚尖上勾）**。
      //   我第一版写成「摆动前半 −aSwing = 背屈、支撑起立 +aPush = 跖屈」——**两者都反了**。
      //
      // ══════════════════════════════════════════════════════════════════════
      // ★★★ 新增：**矢状面承重转移**（用户 2026-10-02："前脚承重都没做"）
      //   文献依据 —— Becker/Banks/Whittle, *PLOS Comput Biol* 2021, 17(6):e1008369：
      //     "delayed linear feedback of **center of mass position and velocity** ... can
      //      explain reactive ankle muscle activity and joint moments in response to
      //      perturbations of walking"
      //     "the ankle strategy is mainly used during **mid stance** ... since the CoP is
      //      approximately in the middle of the foot and **can move forward and backward**"
      //     "the **proportional feedback of COM kinematics** is modulated to exploit this
      //      change in potential to adjust the CoP position within the foot"
      //     增益按相调度：**中支撑相最高**，早期/晚期低（R²: 中支撑 0.7 / 早晚 0.3）
      //   同源依据 —— Neptune/Perry, *Frontiers Neurology* 2019, 10:999：
      //     跖屈肌是 CoM 推进的**主引擎**，"the work produced by these muscles has been
      //     **four times more efficient** than the work produced by the hip muscles to
      //     sustain the CoM increment during the single-stance period"
      //
      //   ⇒ 控制器（阻尼倒立摆 / CoP→CoM 标准形式）：
      //        捕获点  ξ = com.x + com.vx/ω          （放 ξ 处 ⇒ CoM 恰好停住）
      //        CoM 误差 e = ξ − 脚中心 x            （脚比 ξ 靠后 ⇒ 需要把 CoM 推过去）
      //        踝力矩   τ = −kcop·e                  （移 CoP：跖屈把 CoP 前推→减速前移；
      //                                               背屈把 CoP 后拉→加速前移）
      //   ⇒ 符号推导：CoP 在 CoM **后**方 ⇒ GRF 对 CoM 产生**前向**力矩 ⇒ CoM 前移。
      //     跖屈（脚尖下压）把 CoP 推向**前**；故想让 CoM **减速**（前移过快）要跖屈。
      //     ⇒ τ_ankle = +kcop · (ξ − 脚x)   当 ξ > 脚x（CoM 冲过脚前方）→ 跖屈减速。
      const xi = com.x + com.vx / om;                    // 捕获点（与上方 MoS 同一定义）
      const footCX = stanceL ? footBufL[0]! : footBufR[0]!;
      const comShiftErr = xi - footCX;                   // >0 ⇒ CoM 冲在脚前方，需要减速
      // 相位调度：中支撑相（s∈[0.25,0.75]）增益最高，早/晚期低 —— PLOS CB 2021 的实测形状
      const copGainPhase = (Math.abs(s - 0.5) < 0.25 ? 1 : 0.45);
      const copTau = (p.kCop ?? 0) * copGainPhase * comShiftErr;   // rad，负 = 跖屈（减速）
      dbgLog.xi = +xi.toFixed(3); dbgLog.footCX = +footCX.toFixed(3);
      dbgLog.copTau = +copTau.toFixed(4);
      const ankleDeg = isStance
        // 支撑相：起立时**跖屈**（脚尖下压，顶髋把身体前送）→ 中后期回中立
        ? aStance - aPush * Math.max(0, 1 - 2 * s)
        // 摆动相：前半**背屈**（勾脚往前送）→ 后半跖屈（脚尖先着地）
        : (s < 0.5 ? aSwing * (s / 0.5) : -aSwing * (1 - (s - 0.5) / 0.5));
      // ★★ 平衡判定门**也必须管住踝**（用户 2026-10-02："前脚刚落地，没调整平衡，
      //   后脚就抬起来了，平衡校验没用吗"）。
      //   之前只把 `swingY` 压到 0.012（IK 层面不让离地），但**踝的跖屈/背屈指令
      //   照样在动** —— 脚掌自身一抬，后脚就离开了地面，门形同虚设。
      //   ⇒ 门没放行时，摆动腿的踝强制归零（平贴地面），一步都不许动。
      // ★★ 踝 = **CoP 策略主力**（VIP + 双刚度，见上方文献注释）：
      //   `ankleCorr` 是 VIP 反馈产生的踝力矩（欠临界刚度 + VIP 延迟反馈），
      //   它通过"把 CoP 前后移动"来**直接**控制 CoM —— 这是文献里的主力通道，
      //   效率远高于髋（Neptune/Perry 2019：跖屈肌效率是髋的 4 倍）。
      //   旧写法把这份活全压在髋上（`kWtX` 直推 CoM），是**方向性错误**，已废。
      // ★★★ **承重腿在单腿站立时不走摆动相的踝轨迹**（2026-10-02，两个叠加 bug 之一）。
      //   实测链路（单腿站立）：`ankleDeg = aStance − aPush·(1−2s) = 0 − 15 = −15°`
      //   与 VIP 的 `+14.9°` **正好抵消** ⇒ `ankleCmd ≈ 0` ⇒ 踝收不到任何平衡指令，
      //   而马达却饱和在 120 N·m 往 0° 拉（实际踝角一路涨到 71°）。
      //   根因：`ankleDeg` 是**摆动相**的踝轨迹（背屈→跖屈），套到**承重腿**上
      //   就等于给平衡控制施加了一个 −15° 的偏置，把 VIP 顶掉。
      //   ⇒ 单腿站立时承重腿只听 VIP 的；摆动腿才走 ankleDeg。
      const stanceAnkleBase = singleLeg ? 0 : (ankleDeg + pushTorque);
      const vipDeg = isStance ? vipDegDbg : 0;
      // ★★★ **平衡门绝不能关掉承重腿的平衡指令**（方向性错误）。
      //   门的职责是"否决一次不安全的**抬腿**"，不是"否决平衡控制"。
      //   承重腿的踝**永远**带 vipDeg；门只作用于摆动腿。
      const ankleCmd = isStance
        ? (stanceAnkleBase + vipDeg)
        : (verdictV.ok ? ankleDeg : 0);                 // 摆动腿：门没过 ⇒ 踝锁 0
      dbgLog.ankleCmdDeg = +ankleCmd.toFixed(2); dbgLog.isStanceDbg = isStance ? 1 : 0;
      curSys = 'hold';
        setAxis(`foot_${side}`, ankleCmd * Math.PI / 180, jFoot);
      // ★★ 脊椎同步发力（Takemura 2007）：摆动相里让**胸廓（脊椎）绕竖直轴反相旋转**，
      //   抵消摆动腿产生的垂直轴角动量。本 rig 的"胸廓"= spine1..3，
      //   "骨盆"= 根刚体（由两髋的轴 1 扭转反向叠加得到）。
      //   摆动腿是左 ⇒ 胸廓往 +yaw 走（右转），反之亦然；幅度随摆动进度 sin(πs) 起伏。
      if (p.spineSync > 0 && sim.mod.active('spineSync', sim.gp.now, 2, null) && !singleLeg) {
        const sw = Math.sin(Math.PI * Math.min(1, s));
        const dir = isStance ? -1 : 1;      // 与摆动腿反相（isStance=false 即该腿在摆）
        const yaw = dir * p.spineSync * sw;
        dbgLog.sWaist = +(yaw * 57.3).toFixed(2);
        // 胸廓：**用实际的脊柱关节名**（spineSegments>1 时才有，可能是 spine1..3 或更长）
        //   旧写法硬编码 ['spine1','spine2','spine3'] + JOINT_ORDER.indexOf ⇒ 永远 −1 ⇒ 腰从未被驱动。
        //   每段用**它自己的**关节描述做归一化（错用 jHip 会让限位算错）。
        for (const sj of spineNames) {
          const sjDesc = sk.joints[jointIndexByName(sk, sj)];
          // ★★ 轴修正：旧代码把**偏航(yaw)**值写到**轴 2**。
          //   而脊柱关节的限位是 `minRad/maxRad = [-xy, -xy, SPINE_FLEX]`，
          //   即轴 0/1 = 侧倾/扭转、**轴 2 = 前后屈伸** ⇒
          //   偏航写进屈伸轴 ⇒ 脊柱只会前后弯、不会左右转，实测关节角恒为 0.0°。
          //   ⇒ 改写到**轴 0**（侧倾/扭转）。
          if (sjDesc) curSys = 'servo';
        setAxis(sj, yaw * 0.6, sjDesc, 0);
        }
        // 骨盆：两髋绕自身长轴反向扭转（axis 1）⇒ 骨盆相对脚反向转
        curSys = 'step';
        setAxis('hip_l', -dir * p.spineSync * 0.5 * sw, jHip, 1);
        setAxis('hip_r', dir * p.spineSync * 0.5 * sw, jHip, 1);
      }
      // ══════════════════════════════════════════════════════════════════════
      // ★★★★ **骨盆执行器**（用户 2026-10-02："盆骨不能施力让角色挺起来"）
      //
      //   骨架事实：**没有独立骨盆刚体** —— `torso` 一个刚体占 49.70% 质量、
      //   兼作根，上接 `spine1..3`、下接两髋。脊柱关节限位
      //   `[-xy, -xy, SPINE_FLEX]` ⇒ **轴 2 = 屈伸**，力矩上限 120 N·m。
      //   ⇒ **`spine1` 轴 2 就是"骨盆 ↔ 上半身"的屈伸执行器**，
      //     是唯一能让角色**挺起来**、对抗鞠躬的关节。
      //
      //   ⚠ 之前我把它关了，理由是错的。Riemann 2003 说"trunk 是最不重要的
      //     纠正来源"，指的是**躯干**惯大、来不及参与快速扰动响应；同一篇的下一句
      //     才是关键："significantly **more corrective action occurred between the
      //     pelvis and thigh** than between the pelvis and trunk"
      //     ⇒ **骨盆恰恰是应该发力的那个**，我把"躯干该安静"错推成了"骨盆也该安静"。
      //
      //   作用：把骨盆顶向 **GRF 力线**（`hold.pelvisUpright`），与髋**力矩方向一致**
      //   ⇒ 力矩分配到骨盆+髋两个关节，而不是全压在髋上把躯干折向前。
      {
        const sp0 = spineNames[0];
        const jSp0 = sp0 !== undefined ? sk.joints[jointIndexByName(sk, sp0)] : undefined;
        if (jSp0 && (p.kPelvis ?? 0) > 0) {
          curSys = 'hold';
          setAxis(sp0, hold.pelvisUpright, jSp0, 2);
          dbgLog.pelvisCmd = +(hold.pelvisUpright * 57.3).toFixed(2);
        }
      }
      // ══════════════════════════════════════════════════════════════════════
      // ★★★ 两个用户点名要调、但参数一直是 0（等于没接）的机制：
      //
      // ① **重心转移**（用户："这个重心转移…都得调"）
      //    迈步前必须先把体重**横向挪到支撑脚上**，才能把摆动腿卸掉抬起来。
      //    现在 `kLat/kLatV` 全是 0 ⇒ 从来没有主动转移 ⇒ 摆动腿抬不起来（离地峰值
      //    长期只有 0~6mm）。文献：成人单支撑期 CoM 横向偏移 ≈ 步宽的一半（~7cm）。
      //    `latCorr` = kLat·(com.z − 目标) + kLatV·com.vz：把 CoM 拉向**支撑脚**。
      //
      // ② **支撑腿保持发力 / 蹬离**（用户："迈出的腿保持发力"）
      //    支撑腿不是"站住"，而是要**持续把身体推过支撑脚**（跖屈 + 髋伸）。
      //    现在支撑腿的指令 = IK(落脚点) + corr，没有任何前送项 ⇒ 纯被动站立，
      //    所以净位移为 0、越走越慢。
      //    `pushDrive` = 支撑相后段线性增大的髋伸驱动，配合踝跖屈（anklePush）。
      // ══════════════════════════════════════════════════════════════════════
      // ★★ 重心转移（用户 2026-10-02："缺乏迈出的脚着地并转移重心的过程"）
      //   落地后把 CoM 横向挪到**新支撑脚**上。
      //   ⚠ 必须限幅：kLat·误差 在误差 0.17m、kLat=3.5 时会产生 **33° 髋外展**，
      //     控制器自己成了漂移源。限到 ±LAT_MAX（≈8°）。
      const stanceZ = stanceL ? HIP_Z : -HIP_Z;
      const shiftErrRaw = stanceZ - com.z;
      // ★ 重心转移阶段推进（在给横向指令之前先更新）
      //   触发：进入新的支撑相（落地换脚）⇒ 从 APA 开始
      if (wtDone && s < 0.05) { wtStage = 'APA-back'; wtT = 0; wtDone = false; }
      else if (wtStage === 'idle') { wtStage = 'APA-back'; wtT = 0; }
      if (wtStage !== 'done') {
        wtT += dt;
        const load = wtLoadOf();
        if (wtStage === 'APA-back' && wtT >= WT.min * WT.apaShare) { wtStage = 'APA-toSwing'; wtT = 0; }
        else if (wtStage === 'APA-toSwing' && wtT >= WT.min * (1 - WT.apaShare)) { wtStage = 'toStance'; wtT = 0; }
        else if (wtStage === 'toStance' && load >= THR.loadAccept) {
          wtStage = 'done'; wtDone = true;
          wtModule++;
        }
        else if (wtStage === 'toStance' && wtT > WT.max) { wtStage = 'done'; wtDone = true; }   // 超时也放行，避免卡死
      }
      // ★ 按阶段给出 CoP 横向目标（APA 先反向预备、再正向转移）
      const copZ = copTargetZ(wtStage, stanceZ, -stanceZ);
      const shiftErrRaw2 = copZ - com.z;
      const shiftErr = Math.max(-LAT_MAX_ERR, Math.min(LAT_MAX_ERR, shiftErrRaw2));
      // ★ 额状面指令全部由**模块 ①**（balanceHold.ts）算出，见上方 `hold` 调用点。
      //   VMP（髋外展）+ 踝内/外翻反向配对（Liu et al., J Biomech 2012 的力学链）。
      dbgLog.qVmp = +qVmp.toFixed(4);
      dbgLog.copLatOut = +hold.copLatOut.toFixed(4);
      dbgLog.ankleEv = +hold.ankleLat.toFixed(3);
      const latCorr = hold.hipAbd + (isStance ? cmRoll : -cmRoll * 0.3);
      // ② 支撑腿发力前送：支撑相后半段线性增大（s∈[0.5,1]），把身体推过支撑脚

      // ★ 摆动腿要**向外（外展）**让开支撑腿，原来写的是 `-p.kLatSwing`（向内）⇒ 踝内收
      const swingAbduct = isStance ? abductFF + latCorr : abductFF + (p.kLatSwing ?? 0);   // ★ 前馈外展 + 反馈修正
      // ★ `curOwner` 必须**跟着** `curSys` 一起改：它是上一分支（承重腿 IK）留下的值，
      //   于是 UI 上会出现「底色=迈步、机制=balance(...)」的自相矛盾格子（已实测到）。
      curSys = 'step';
      curOwner = isStance ? 'balance(abductFF+latCorr)' : 'step(abductFF+swing)';
    setAxis(`hip_${side}`, swingAbduct, jHip, 0);
      // ★★ 踝的**内翻/外翻**（轴 0，绕足长轴）—— 额状面力学链的执行端（Liu 2012）。
      //   限位已按文献放宽到 ±14°/±10°；指令由模块 ① 的 `hold.ankleLat` 给出。
      //   ⚠ 本 rig `ankleEnabled=false` ⇒ 没有 foot_* 关节 ⇒ 这段**永不生效**
      //     （`jFoot` 为 undefined，`setAxis` 静默 return）。额状面因此只剩髋外展，
      //     而它的权限实测≈0（见 tools/probe-auth2.ts）—— 这是单腿站不住的物理原因。
      if (hold.ankleLat !== 0 && isStance) {
        const aCmd = Math.max(-14, Math.min(14, hold.ankleLat * 57.3));
        curSys = 'hold';
        curOwner = 'balance(ankleLat)';
      setAxis(`foot_${side}`, aCmd * Math.PI / 180, jFoot, 0);
      }
    }
    // owner 已在各写入点打标
    dbgLog.s = +s.toFixed(3); dbgLog.swingY = +swingY.toFixed(4); dbgLog.swingX = +swingX.toFixed(3); dbgLog.stanceX = +(stanceL ? footBufL[0]! : footBufR[0]!).toFixed(3); dbgLog.wtMod = wtModule; dbgLog.latch = latchedStance ? (latchedStance === "l" ? 1 : 2) : 0;
    // ★ 三个角色的程序化判定结果（供 probe 回读）
    dbgLog.roleWB = roleLatched === 'l' ? 1 : roleLatched === 'r' ? 2 : 0;   // 承重腿
    {
      const [frontLeg, backLeg] = rolesFromFootX(footBufL[0]!, footBufR[0]!);
      dbgLog.roleFront = frontLeg === 'l' ? 1 : 2;
      dbgLog.roleBack = backLeg === 'l' ? 1 : 2;
      dbgLog.footXL = +footBufL[0]!.toFixed(3);
      dbgLog.footXR = +footBufR[0]!.toFixed(3);
    }
    dbgLog.balOk = verdictV.ok ? 1 : 0; dbgLog.balStage = verdictV.why; dbgLog.mosX = +mosHere.toFixed(4); dbgLoad = stanceLoadNow; dbgLog.comY = +com.y.toFixed(3); dbgLog.hipY = +(com.y - hipDy).toFixed(3);
    // ────────────────────────────────────────────────────────────────
    // ★ 刷新 UI 诊断快照：系统归属 + 前后腿 + 承重腿 + 平衡门
    //   （用户 2026-10-03："UI 明确表示哪部分属于平衡维持，哪部分属于迈步，
    //     从而让我区分前后腿"）
    // ────────────────────────────────────────────────────────────────
    {
      const [fL, bL] = rolesFromFootX(footBufL[0] ?? 0, footBufR[0] ?? 0);
      const swingSide: 'l' | 'r' = stanceL ? 'r' : 'l';
      diag.frontLeg = fL; diag.backLeg = bL;
      diag.stanceLeg = stanceL ? 'l' : 'r';
      diag.swingLeg = swingSide;
      diag.groundL = sim.doll.footGrounded(0);
      diag.groundR = sim.doll.footGrounded(1);
      diag.phase = sim.gp.now;
      diag.nAxes = nAxes;
      diag.balOk = verdictV.ok;
      diag.balWhy = verdictV.why;
      diag.mosX = mosHere;
      sys.clear();
      for (const [k, v] of sysLog) sys.set(k, v);
      // 逐拍把 sysLog 整份替换成 sys（避免每帧 42 个 Map.set 的开销）
    }
    opts.onFrame?.(t, stanceL, s, ownerLog, curOwner, angLog, dbgLog);
    sim.doll.setMotorTargets(out);
    // ★★ 采样：观测是 advance 之后取的（与训练时的时序一致：控制目标由上一帧状态算出，
    //    下一帧的观测才能反映它的效果 ⇒ 这里必须记录**这一帧的观测**而不是上一帧）。
    if (opts.record && opts.data) {
      opts.data.X.push(Array.from(sim.observation()));
      opts.data.A.push(Array.from(out));
    }
    t += dt;
    }
  };

  const result = (): TeacherResult =>
    ({ x: sim.distance, alive: !sim.fallen, steps, t, n: opts.data?.X.length ?? 0, swapTrace, stanceSeq });

  return {
    step,
    diag,
    get t() { return t; },
    get steps() { return steps; },
    result,
  };
}

/**
 * 跑一整段 teacher（**一次性跑完**）。
 * ★ 网页请改用 `makeTeacherSession` + `session.step(n)`（分帧驱动），
 *   否则网页跑的是 ES 大脑、探针跑的是 teacher，两边对不上。
 */
export function runCaptureTeacher(
  sk: Skeleton,
  sim: Sim,
  p: CaptureParams,
  opts: TeacherOpts = {},
): TeacherResult {
  const session = makeTeacherSession(sk, sim, p, opts);
  while (!sim.finished && session.t < (opts.dur ?? 8)) session.step(1);
  return session.result();
}

/**
 * ══════════════════════════════════════════════════════════════════
 * ★★★ **平衡维持系统的唯一一份参数**（2026-10-03）
 * ══════════════════════════════════════════════════════════════════
 *
 * 此前每个探针各自内联一份 `FB`，实测三者**互不相同**：
 *   probe-arch     kLat=3.5 kLatV=1.2 kWtX=0   kVipP=60   （最完整）
 *   probe-capture  kLat=0                      （侧向控制为零 ⇒ 它测的不是同一个控制器）
 *   probe-ankle    kLat=0
 *   probe-balance  kLat=0
 * ⇒ 「探针之间」就已经不同步，网页更是只跑 ES 大脑。
 *
 * ★ 这里取 **probe-arch 那一份**（它是当前唯一在调的、字段最全的）。
 *   网页（`driver='teacher'`）与所有探针都必须 import 这个对象，
 *   要改平衡维持系统就改这里一处 —— 改完网页立刻能看到。
 *
 * ⚠ 调参时用 `tools/tune-teacher.ts`，它输出可直接粘回下面。
 */
import { CAPTURE_GAIT } from './phaseSeed';

export const CAPTURE_DEFAULT: CaptureParams = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  spineSync: CAPTURE_GAIT.spineSync, kCop: CAPTURE_GAIT.kCop,
  // ★ 髋不再是 CoP 主力 ⇒ 直推 CoM 的增益归零（VIP 结构接管）
  kWtX: 0, kWtVx: 0,
  kVipP: 60, kVipD: 5,
  kVmpP: 14, kVmpD: 3, cmBalance: 0, cmBalanceD: 0,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau,
  // ★★ 侧向**不能是 0**：`probe-capture` 用 kLat=0 时 1.45s 就倒，
  //   `probe-arch` 用 3.5 时能跑 3.1s。之前两者被当成同一个 teacher 比过。
  kLat: 3.5, kLatV: 1.2, kLatSwing: 0.10,
  stancePush: 0.18, stanceLock: 0.6, reach: 0.5,
  ankleSwing: 12, anklePush: 15, ankleStance: 0,
};
