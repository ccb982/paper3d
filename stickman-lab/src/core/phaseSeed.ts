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
