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
}

/** 搜出来的镇定器（坐标下降，目标 = 站满 8 s + 倾角小） */
export const BEST_BALANCER: BalancerSpec =
  { kPitch: 0.028, kRate: -0.028, kComX: -3.102, bias: 0, knee: 0.028, osc: 0 };

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
  T: 1.89,
  /** 目标速度（m/s） */
  vDes: 0.39,
  /** 摆动脚抬升高度（m） */
  lift: 0.15,
  /** 落脚点速度修正增益 */
  kv: 0.3283,
  /** 躯干俯仰 → 髋（★ 负号才接得住） */
  kPitch: 2.544,
  /** 俯仰角速度 → 髋 */
  kRate: 0.542,
  /** 捕获点走出当前支撑脚多远才换脚（m） */
  thresh: 0.0673,
  /** 落地吸能：支撑膝额外屈多少（rad） */
  absorb: 0.4,
  /** 吸能衰减时间常数（s） */
  absorbTau: 0.25,
  /** 实测：4 次真实换脚、0.625 m、存活 4.32 s（零输出基线 1.83 s） */
  measured: { steps: 4, x: 0.625, t: 4.32 },
} as const;
