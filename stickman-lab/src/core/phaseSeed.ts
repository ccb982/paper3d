// phaseSeed —— 把"手工相位步态"变成可以直接当种子的基因组。
//
// ★ 为什么需要它：ES 的"迈步奖"要有一个**真的会迈步的祖代**才有梯度可爬。
//   从 48 份随机权重出发，几十代内最好的个体都只是原地抖腿（实测）——
//   因为"先迈出第一步"这一步本身没有梯度可循（要同时满足：换脚、有前进、CoM 稳）。
//   探针 `tools/probe-gait.ts` 用少量权重（clock.sin/cos → 髋膝正弦）就能走出
//   1.21 m / 1.82 s，于是把它固化成种子，让 ES 从"已经会走"开始优化"走得久、走得稳"。
//
// 权重只写 w2/b2（第二层）与 w1 的 clock 两行，其余为 0 ⇒ 行为完全可预测、可复现。

import { brainLayout, brainParamCount, shapeForJoints, type BrainShape } from './brain';
import { JOINT_ORDER } from './skeleton';

export interface PhaseSpec {
  hip: number;      // 髋屈伸幅度
  knee: number;     // 膝屈伸幅度
  duty: number;     // 占空比偏置（越大 = 停得越久）
  legPhase: number; // 左右相位：1 = 反相（四分相），-1 = 同相
  arm: number;      // 手臂反相摆动幅度
  waist: number;    // 腰部摆动幅度
  scale: number;    // 输出整体缩放（探针实测：×0.15 走得最远、活得最久）
}

/** 探针里实测最好的那组（×0.15，x=1.21 m / 1.82 s） */
export const BEST_PHASE: PhaseSpec =
  { hip: 0.6, knee: 0.5, duty: 0.8, legPhase: 1, arm: 0.3, waist: 0.2, scale: 0.15 };

/** 构造一份相位步态基因组（scale=1 即原始幅度） */
export function phaseGenome(shape: BrainShape, s: PhaseSpec): Float32Array {
  const p = new Float32Array(brainParamCount(shape));
  const L = brainLayout(shape);
  p[L.w1 + 0 * shape.inputs + 0] = 5;   // h0 ← clock.sin
  p[L.w1 + 1 * shape.inputs + 1] = 5;   // h1 ← clock.cos
  const out = (joint: string, axis: number, aSin: number, aCos: number, bias: number) => {
    const o = JOINT_ORDER.indexOf(joint) * 3 + axis;
    if (o < 0) return;
    p[L.w2 + o * shape.hidden + 0] = aSin * s.scale;
    p[L.w2 + o * shape.hidden + 1] = aCos * s.scale;
    p[L.b2 + o] = bias * s.scale;
  };
  for (const [j, sgn] of [['hip_l', 1], ['hip_r', s.legPhase]] as [string, number][]) {
    out(j, 2, s.hip * sgn, 0, s.duty * sgn * 0.5);
    out(j.replace('hip', 'knee'), 2, -s.knee * sgn, s.knee * 0.35 * sgn, s.duty * sgn * 0.4);
  }
  for (const [j, sgn] of [['shoulder_l', -1], ['shoulder_r', 1]] as [string, number][]) {
    out(j, 2, s.arm * sgn, 0, 0);
  }
  for (let i = 1; i <= 3; i++) out(`spine${i}`, 0, s.waist * 0.5, 0, 0);
  return p;
}

/** 便捷入口：按关节数推 shape 再构造 */
export function phaseGenomeFor(jointCount: number, s: PhaseSpec = BEST_PHASE): Float32Array {
  return phaseGenome(shapeForJoints(jointCount), s);
}

// ══════════════════════════════════════════════════════════════════════
// 镇定器（2026-10-01）：手写反馈控制器，**让骨架站得住**
//
// ★ 为什么需要它（实测，之前一直没搞清楚）：
//   零输出（纯阻尼）只能站 4.72 s：躯干高度全程不变，但**缓慢前倾**
//   （3 s 内 0.2°→4.7°，髋/膝各漂 1~2°），CoM 缓慢前移，最后顶翻。
//   而"常数偏置"治不了（髋 −1°/−2°/−3° 全部倒得更快、往后倒 0.83 m）——
//   它是**边缘稳定**，必须靠反馈兜住。
//   坐标下降搜出的 6 个系数能做到：**站满 8 s、平均倾角 0.77°**。
//
// 观测下标（见 sim.ts 的 observe）：
//   2 = 躯干四元数 x（俯仰）、9 = 躯干角速度 x、14 = CoM 相对支撑域 x、16 = CoM 速度 x
export interface BalancerSpec {
  /** 俯仰角 → 髋屈伸 */
  kPitch: number;
  /** 俯仰角速度 → 髋屈伸 */
  kRate: number;
  /** CoM 横向偏移 → 髋屈伸（钉住位置用；追速度时置 0） */
  kComX: number;
  /** 髋静态偏置 */
  bias: number;
  /** 膝静态偏置 */
  knee: number;
  /** ★ 同时叠加的步态振荡幅度（0 = 纯镇定器；>0 = 边平衡边摆腿） */
  osc: number;
  /** ★★ 踝：躯干俯仰 → 踝 pitch（矢状面踝策略，14 关节才有） */
  kAnkPitch: number;
  /** 踝：俯仰角速度 → 踝 pitch */
  kAnkRate: number;
  /** 踝：CoM 横向偏移 → 踝 roll（把 CoP 推向 CoM 底下） */
  kAnkRoll: number;
}

/** 搜出来的镇定器（坐标下降，目标 = 站满 8 s + 倾角小），**12 关节**几何 */
export const BEST_BALANCER: BalancerSpec =
  { kPitch: 0.028, kRate: -0.028, kComX: -3.102, bias: 0, knee: 0.028, osc: 0, kAnkPitch: 0, kAnkRate: 0, kAnkRoll: 0 };

/**
 * 构造"镇定器 (+ 可选振荡器)"基因组。
 * 隐层 0..3 接躯干状态（反馈），隐层 4..5 接时钟（振荡）——**两组互不干扰**。
 */
export function balancerGenome(shape: BrainShape, s: BalancerSpec = BEST_BALANCER): Float32Array {
  const p = new Float32Array(brainParamCount(shape));
  const L = brainLayout(shape);
  const QX = 2, WX = 9, CMX = 14, CVX = 16;     // 观测下标
  p[L.w1 + 0 * shape.inputs + QX] = 1;
  p[L.w1 + 1 * shape.inputs + WX] = 1;
  p[L.w1 + 2 * shape.inputs + CMX] = 1;
  p[L.w1 + 3 * shape.inputs + CVX] = 1;
  p[L.w1 + 4 * shape.inputs + 0] = 5;           // h4 ← clock.sin
  p[L.w1 + 5 * shape.inputs + 1] = 5;           // h5 ← clock.cos
  // ★ 用 `+=` 叠加：直接赋值会把镇定器的权重清零（写错过一次，
  //   害得"合成"基因组里其实只有振荡器，于是全在往后倒）。
  const row = (joint: string, w: number[], b: number): void => {
    const o = JOINT_ORDER.indexOf(joint) * 3 + 2;
    if (o < 0) return;
    for (let i = 0; i < w.length; i++) p[L.w2 + o * shape.hidden + i] += w[i];
    p[L.b2 + o] += b;
  };
  for (const [j, sgn] of [['hip_l', 1], ['hip_r', 1]] as [string, number][]) {
    row(j, [sgn * s.kPitch, sgn * s.kRate, sgn * s.kComX, 0, sgn * s.osc * 0.09, 0], s.bias);
  }
  row('knee_l', [0, 0, 0, 0, -s.osc * 0.075, s.osc * 0.027], s.knee + s.osc * 0.048);
  row('knee_r', [0, 0, 0, 0, s.osc * 0.075, s.osc * 0.027], s.knee + s.osc * 0.048);
  row('shoulder_l', [0, 0, 0, 0, -s.osc * 0.045, 0], 0);
  row('shoulder_r', [0, 0, 0, 0, s.osc * 0.045, 0], 0);
  // ★★ 踝自身的反馈（14 关节才有；此前踝输出恒为 0 = 纯被动关节，对平衡零贡献）。
  //   矢状面：躯干俯仰 → 踝 pitch（即 sagittal 方向的"踝策略"：用踝力矩把 CoP 前后移）
  //   额状面：CoM 横向偏移 → 踝 roll（把 CoP 往 CoM 底下推）
  //   ⚠ 必须判 `shape.outputs`：踝关闭时 `JOINT_ORDER.indexOf('foot_l')` = 12，
  //     而输出只有 36 项 ⇒ 直接写会越界串到别的关节上。
  if (shape.outputs >= 3 * 13) {
    // ⚠ 俯仰项**取负**：与髋同理（探针实测"kPitch=−1 才接得住前扑"），
    //   第一次写成 +kAnkPitch 时三个踝增益全部撞到**负向边界**且存活更差（4.96 → 2.69 s），
    //   典型的"符号反了、搜索一路顶到栏杆"。
    row('foot_l', [-s.kAnkPitch, -s.kAnkRate, s.kAnkRoll, 0, 0, 0], 0);
    row('foot_r', [-s.kAnkPitch, -s.kAnkRate, s.kAnkRoll, 0, 0, 0], 0);
  }
  return p;
}

// ══════════════════════════════════════════════════════════════════════
// 捕获点行走控制器（2026-10-01，tools/probe-capture.ts 搜出来的）
//
// ★ 这是**第一个真的能走几步**的控制器：摆动脚落到 ξ（捕获点 = CoM + v/ω），
//   而不是按正弦盲摆。逐拍 trace 里能看到载荷 0.00/1.00（全部体重压在一只脚上）。
//   三个关键点（每一个都是踩坑换来的）：
//   ① **落地吸能**：支撑脚刚落地的一小段时间额外屈膝（膝能屈 −145°，权限足够）。
//      没有它 ⇒ 迈步后躯干俯仰发散（−1.2°→−13°），2.9 s 就前扑倒下。
//   ② **俯仰反馈的符号**与髋的符号约定相反（kPitch = **−1** 才接得住前扑）。
//   ③ **Raibert 落脚点** x* = ξ + kv·(v_des − v_x)·T_s/2（慢了把脚放更靠前；
//      写成 (v_x − v_des) 方向整个反过来，会一路往后走）。
//   侧向（髋外展）调节实测**无权**：CoM.z 只偏离中线 0.01 m，加了没用。
export const CAPTURE_GAIT = {
  /** 摆动周期（秒） */
  T: 2.20,   // ★ 用户 2026-10-02："迈腿间隔要在 1s 之上" ⇒ 每条腿 T/2 = 1.10s
  /** 目标速度（m/s） */
  vDes: 0.39,
  /** 摆动脚抬升高度（m） */
  lift: 0.32,
  /** 落脚点速度修正增益 */
  kv: 0.3283,
  /**
   * ★ 脊椎-骨盆反相旋转幅度（rad）。**这个参数此前根本没定义** ⇒ `p.spineSync > 0`
   *   永远为 false ⇒ 腰（spine1..3）一次指令都没收到过（实测脊柱关节角恒为 0.0°）。
   *   用户 2026-10-02："腰咋动的" ⇒ 先补上这个参数，腰才有可能被驱动。
   *   文献：Takemura 2007 / Sci Rep 2019 —— 胸廓与骨盆反相旋转，抵消摆动腿角动量。
   */
  spineSync: 0.25,
  /** ★ 矢状面承重转移（CoM 反馈 → 踝力矩移 CoP）。PLOS CB 2021 中支撑相增益最高。 */
  kCop: 3.0,
  /**
   * ★★ B 方案：矢状面重心转移 —— CoM 相对支撑脚的纵向位置/速度反馈 → 支撑髋俯仰。
   *   注意：与 BalancerSpec.kComX（镇定器用的**矢状反馈**）是**不同的东西**，
   *   故命名 kWtX 以免混淆。probe-arch 二维扫描最优 (kWtX×kWtVx = 4×0.3)。
   *   扫描依据：kWtX=4,kWtVx=0.3 ⇒ 位移 0.643m/2.72s（=0.236 m/s，目标 0.39）、
   *   峰值倾角 21.8°（全表最低）、离地峰 52mm；kWtX=0 时位移仅 0.048m（原地不动）。
   */
  kWtX: 0.6,   // ★ 重扫定值（原 4.0 饱和式猛冲到 2.0m/s，致 MoS 深度为负、门永闭）
  /** ★ B 方案的 CoM 速度阻尼项（s）。 */
  kWtVx: 0.6,
  /** 躯干俯仰 → 髋（★ 负号才接得住） */
  kPitch: 0.4,   // ★ 重标（见 probe-arch 存活寻优）
  /** 俯仰角速度 → 髋 */
  kRate: 0.0,   // ★ 重标：俯仰反馈在这里帮倒忙
  /** 捕获点走出当前支撑脚多远才换脚（m） */
  thresh: 0.0673,
  /** 落地吸能：支撑膝额外屈多少（rad） */
  absorb: 0.4,
  /** 吸能衰减时间常数（s） */
  absorbTau: 0.25,
  /** 实测：4 次真实换脚、0.625 m、存活 4.32 s（零输出基线 1.83 s） */
  measured: { steps: 4, x: 0.625, t: 4.32 },
} as const;

// ══════════════════════════════════════════════════════════════════════
// 捕获点控制器的**基因组版**（2026-10-01）
//
// ★ 为什么需要这个：捕获点控制器本身是"状态机 + 二连杆 IK"，**没法直接塞进
//   4228 个权重**（IK 对目标位置是非线性的）。但在这条腿的**工作范围内**
//   （脚在地面附近、腿接近伸直），IK 几乎是线性的 ⇒ 可以用
//   "**线性反馈 + 相位锁定振荡**"逼近：
//     hip = a·俯仰 + b·俯仰角速度 + c·(CoM 偏移≈捕获点误差) + d·CoM 速度 ± A·sin(φ)
//   换支撑脚那一下不连续，用**反相的 sin**（左右腿差一个符号）来近似 ——
//   这就是经典的"相位锁定步态"，本身是线性的。
//   于是：手写控制器能走的姿态，可以作为**基因组建模**给 ES 当种子。

export interface CaptureGenomeSpec {
  /** 躯干俯仰 → 髋 */
  kPitch: number;
  /** 俯仰角速度 → 髋 */
  kRate: number;
  /** CoM 相对支撑域偏移 → 髋（近似捕获点误差） */
  kCom: number;
  /** CoM 速度 → 髋 */
  kComV: number;
  /** 髋的摆动幅度（rad） */
  amp: number;
  /** 摆动相位（0 = 与时钟同相） */
  phase: number;
  /** 膝的摆动幅度 */
  kneeAmp: number;
  /** 膝静态偏置（落地吸能） */
  kneeBias: number;
  /** 髋静态偏置 */
  hipBias: number;
  /** ★ 载荷差 → 髋：载荷大的那条伸（支撑）、小的屈（摆动）——"哪条腿摆"由载荷决定 */
  kLoad: number;
  /** 膝的载荷差增益（落地吸能/收腿） */
  kLoadKnee: number;
  /** ★ Raibert 落脚增益：把脚往捕获点 ξ 推（线性写法 hip += kRaib·(HALF·ξ̂ − 脚相对x)） */
  kRaib: number;
}



/** 从手写控制器反推的初值（capture 探针里最好的那组） */
export const CAPTURE_GENOME_0: CaptureGenomeSpec = {
  kPitch: 2.544, kRate: 0.542, kCom: -3.1, kComV: 0.0,
  amp: 0.12, phase: 0, kneeAmp: 0.09, kneeBias: -0.03, hipBias: 0, kLoad: 0.25, kLoadKnee: 0.4, kRaib: 1.2,
};

export function captureGenome(shape: BrainShape, s: CaptureGenomeSpec = CAPTURE_GENOME_0): Float32Array {
  const p = new Float32Array(brainParamCount(shape));
  const L = brainLayout(shape);
  const QX = 2, WX = 9, CMX = 14, CVX = 16;
  p[L.w1 + 0 * shape.inputs + QX] = 1;     // h0 = 俯仰
  p[L.w1 + 1 * shape.inputs + WX] = 1;     // h1 = 俯仰角速度
  p[L.w1 + 2 * shape.inputs + CMX] = 1;    // h2 = CoM 偏移
  p[L.w1 + 3 * shape.inputs + CVX] = 1;    // h3 = CoM 速度
  p[L.w1 + 4 * shape.inputs + 0] = 5;      // h4 = sin(φ)
  p[L.w1 + 5 * shape.inputs + 1] = 5;      // h5 = cos(φ)
  const FOOT_H = 20 + 2;                   // 观测里两脚高度/载荷的起始下标（见 sim.observe）
  p[L.w1 + 6 * shape.inputs + FOOT_H + 2] = 1;   // h6 = 左脚载荷份额
  p[L.w1 + 7 * shape.inputs + FOOT_H + 3] = 1;   // h7 = 右脚载荷份额
  p[L.w1 + 8 * shape.inputs + FOOT_H + 4] = 1;   // h8 = 左腿摆动窗口 ★
  p[L.w1 + 9 * shape.inputs + FOOT_H + 5] = 1;   // h9 = 右腿摆动窗口 ★
  p[L.w1 + 10 * shape.inputs + FOOT_H + 6] = 1;  // h10 = 左脚相对支撑中心的 x
  p[L.w1 + 11 * shape.inputs + FOOT_H + 7] = 1;  // h11 = 右脚相对 CoM 的 x
  p[L.w1 + 12 * shape.inputs + 16] = 1;           // h12 = CoM 速度（×2）⇒ 目标落脚位置 ẋ/ω
  const cs = Math.cos(s.phase), sn = Math.sin(s.phase);
  // 振荡项 = amp·sin(φ+phase) = amp·(sn·h4 + cs·h5)
  const oscS = s.amp * sn, oscC = s.amp * cs;
  const row = (joint: string, w: number[], b: number): void => {
    const o = JOINT_ORDER.indexOf(joint) * 3 + 2;
    if (o < 0) return;
    // ⚠ w 的下标是**隐层单元**下标（0..hidden-1），不是观测下标。
    //   我踩过这个坑：把观测下标（~98）当隐层下标用，整条 Raibert 项写到行外被丢掉，
    //   表现就是"加了落脚增益但结果一模一样"。要用的观测必须先经 w1 搬进隐层（h10/h11/h12）。
    for (let i = 0; i < w.length; i++) p[L.w2 + o * shape.hidden + i] += w[i];
    p[L.b2 + o] += b;
  };
  // 左腿 sin 为正、右腿反相（换支撑脚）
  // 载荷差项：hip_l 用 (载荷左 − 载荷右)，hip_r 取反 ⇒ **哪条腿被压住就伸直、另一条屈膝摆动**
  // ★★ 摆腿改成**直接读摆动窗口**（h8/h9），不再靠反相正弦：
  //   窗口在支撑相是 0 ⇒ 那条腿真的站住；窗口内 sin 抬起来 ⇒ 真的离地。
  //   这就是"一次抬一条"的**线性写法**。
  // ★★ Raibert 落脚（线性）：脚相对 x 应该等于捕获点位置（归一化 ξ̂ 换算成米）。
  //   支撑相时这个误差本来就接近 0（脚正踩在该踩的地方），摆动相时误差很大 ⇒ 脚被推向捕获点。
  //   目标位置 = ẋ/ω：h12 是 CoM 速度×2（还原要除 2），再乘 1/ω≈0.55 s 换算成米。
  //   误差 = (脚相对 CoM 的 x) − ẋ/ω ⇒ 写进输出行是 h10/h12 的线性组合（都在 0..12 内 ✔）。
  // ⚠ 抬腿项是 **+amp·摆动窗口**（不是负）：实测 amp>0 配负号会把脚按在地上
  //   （脚最高仅 0.019 m、身体被甩出 0.42 m 后扑倒），符号翻过来才真抬得起来（0.074 m）。
  row('hip_l', [s.kPitch, s.kRate, s.kCom, s.kComV, 0, 0, s.kLoad, -s.kLoad, s.amp, 0,
    -s.kRaib, 0, s.kRaib * 0.5 * 0.55], s.hipBias);
  row('hip_r', [s.kPitch, s.kRate, s.kCom, s.kComV, 0, 0, -s.kLoad, s.kLoad, 0, s.amp,
    -s.kRaib, 0, s.kRaib * 0.5 * 0.55], s.hipBias);
  row('knee_l', [0, 0, 0, 0, 0, 0, -s.kLoadKnee, s.kLoadKnee, -s.kneeAmp, 0], s.kneeBias);
  row('knee_r', [0, 0, 0, 0, 0, 0, s.kLoadKnee, -s.kLoadKnee, 0, -s.kneeAmp], s.kneeBias);
  row('shoulder_l', [0, 0, 0, 0, 0, 0, 0, 0, -s.amp * 0.4, 0], 0);
  row('shoulder_r', [0, 0, 0, 0, 0, 0, 0, 0, 0, -s.amp * 0.4], 0);
  return p;
}
