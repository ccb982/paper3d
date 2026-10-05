/**
 * ══════════════════════════════════════════════════════════════
 *  keyframe.ts —— **行走关键帧姿态参考**（两套系统的共同收敛目标）
 * ══════════════════════════════════════════════════════════════
 *
 * ★ 这份文件回答一个用户问题：
 *   「伺服保护系统 和 迈步系统 的重心偏移，到不了一个平衡态」
 *   答案：**平衡态是客观存在的、可写下来的姿态**，不是两套系统 PK 出来的结果。
 *   Perry & Burnfield 把一个步态周期拆成 8 个功能相，每相有明确的
 *   **关节角目标 + 主动肌**。两个系统应当**分别向同一批关键帧收敛**，
 *   而不是互相抢同一根轴。
 *
 * ── 文献 ────────────────────────────────────────────────────
 * · **Perry & Burnfield 2010**（Gait Analysis, 2nd ed.）8 相划分与
 *   各相关节角区间；步宽均值 **女 7cm / 男 8cm**。
 * · **Oberg 2002**（JRRD）233 名 10-79 岁健康受试者的髋/膝角规范值：
 *   中支撑膝角 男 15~24°/女 12~20°；膝摆动峰值 65~68°；
 *   髋屈伸总程 男 43~53°/女 42~51°。**随步速显著变化** ⇒ 必须按相位取。
 * · **Winter 1998**（J Neurophysiology 80:1211）额状刚度在**髋外展/内收肌**。
 * · **Horak & Nashner 1986** 负荷依赖的腿部僵化。
 *
 * ── ⚠⚠ 本 rig 与规范值的**量级差**（这是重心转移做不到的根因）────
 *   步宽（两脚间距）：规范 70~80mm，本 rig **327mm**（footZ ±163mm）⇒ **4 倍**。
 *   重心所需横移：规范 ≈40mm，本 rig **142mm**。
 *   而 `handoverTolZ = 50mm` 是**人类尺度**的门限。
 *   ⇒ 现在是在要求一个**超人类 3.5 倍**的重心横移。**不调站距，这个问题无解。**
 *
 * ── 两套系统的分工（关键：不再抢同一根轴）───────────────────────
 *   · **伺服保护系统（balance）** = 负责**支撑腿**的关键帧
 *     `MSt / TSt`：膝 5°、踝 5°背屈、髋 0°、髋外展托住 —— 文献说这组
 *     姿态下身体**接近静止站立**（Perry：「Only in the mid point of the stance
 *     period does body alignment approximate that of a stable quiet-standing
 *     posture」）。它是**保护**，不制造位移。
 *   · **迈步系统（step）** = 负责**摆动腿**的关键帧
 *     `PSw / ISw / MSw / TSw`：膝 40→60→30→0°、髋 0→20→30→25°、踝 20°跖屈→0。
 *     它是**唯一允许制造大位移**的通道。
 *   ⇒ 额状的重心搬运由**髋外展**（Winter 1998 指定）承担，脊柱只做
 *     ±5~10° 的**代偿**（Mann 1975），不再当主执行器。
 */

import type { Side } from './rigState';

/** 步态相（Perry 8 相）。与 `Phase` 的映射在 `PHASE_TO_GAIT` 里显式给出。 */
export type GaitKey =
  | 'IC'    // 0-2%   initial contact
  | 'LR'    // 2-12%  loading response
  | 'MSt'   // 12-31% midstance  ← 重心压在支撑脚上的那一帧
  | 'TSt'   // 31-50% terminal stance
  | 'PSw'   // 50-62% pre-swing
  | 'ISw'   // 62-75% initial swing
  | 'MSw'   // 75-87% mid swing
  | 'TSw';  // 87-100% terminal swing

/** 相位起止（步态周期百分比）。用于诊断显示。 */
export const GAIT_KEY_RANGE: Readonly<Record<GaitKey, [number, number]>> = Object.freeze({
  IC: [0, 2], LR: [2, 12], MSt: [12, 31], TSt: [31, 50],
  PSw: [50, 62], ISw: [62, 75], MSw: [75, 87], TSw: [87, 100],
});

/**
 * 单腿在一个关键帧上的姿态目标（**deg**，符号约定见各字段注释）。
 * 只列本 rig 真有的自由度；骨盆是刚体输出，不设目标。
 */
export interface KeyPose {
  /** 支撑腿髋屈伸（rad）。正 = 屈曲。Oberg：中支撑 0°、末期支撑 0~20°伸 */
  supHipFlex: number;
  /** 摆动腿髋屈伸（rad）。正 = 屈曲。Perry：PSw 0°→ISw 20°→MSw 30°→TSw 25° */
  swHipFlex: number;
  /** 支撑腿膝屈曲（rad）。**正 = 屈曲**。Perry：LR 15~20°、MSt 5°、TSt 0~5° */
  supKneeFlex: number;
  /** 摆动腿膝屈曲（rad）。正 = 屈曲。Perry：PSw 40°、ISw 60°(峰)、MSw 30°、TSw 0~5° */
  swKneeFlex: number;
  /** 支撑腿踝（rad）。**正 = 跖屈**。Perry：LR 10~15°跖屈、MSt 5°背屈、TSt 10°背屈 */
  supAnkle: number;
  /** 摆动腿踝（rad）。正 = 跖屈。Perry：PSw 20°跖屈、ISw 10°背屈、MSw 0° */
  swAnkle: number;
  /** 躯干矢状倾（rad，正 = 前倾）。Perry：IC 前倾 4°、MSt 0°、摆动相后倾 */
  trunkPitch: number;
  /** 躯干额状倾（rad，正 = 倒向 +Z）。**代偿量，Mann 1975 只有 5~10°** */
  trunkLat: number;
  /**
   * 该相的**主动肌**（诊断显示用，也是"这个关节该由谁负责"的判据）。
   * ⚠ `MSt` 明确是 **臀中肌 / 阔筋膜张肌 = 髋外展**（Winter 1998 同结论）。
   */
  primeMover: string;
}

const D = Math.PI / 180;

/**
 * ★ 关键帧表 —— **唯一真源**。数值全部来自 Perry & Burnfield 的相区间中值
 * 与 Oberg 的规范角，改这里就等于改"平衡态的定义"。
 */
export const KEY_POSES: Readonly<Record<GaitKey, KeyPose>> = Object.freeze({
  IC: {
    supHipFlex: 25 * D, swHipFlex: 25 * D,
    supKneeFlex: 2 * D, swKneeFlex: 2 * D,
    supAnkle: 0, swAnkle: -2 * D,
    trunkPitch: 4 * D, trunkLat: 0,
    primeMover: '踝跖屈肌（制动）',
  },
  LR: {
    // 「Shock absorption」：膝屈到 15~20°，踝**受控**跖屈 10~15°
    supHipFlex: 25 * D, swHipFlex: 24 * D,
    supKneeFlex: 17.5 * D, swKneeFlex: 18 * D,
    supAnkle: 12.5 * D, swAnkle: -5 * D,
    trunkPitch: 2 * D, trunkLat: 0,
    primeMover: '股四头肌（离心）+ 腓肠肌-比目鱼肌（离心）',
  },
  MSt: {
    // ★★★ 重心转移的目标帧。Perry 原文：「Body weight passes over supporting foot」
    //   骨盆 0°、髋 0°、膝 5°屈、踝 5°背屈。
    //   主肌 = **臀中肌 / 阔筋膜张肌**（髋外展）⇒ 额状刚度在这里（Winter 1998）。
    supHipFlex: 0, swHipFlex: 15 * D,
    supKneeFlex: 5 * D, swKneeFlex: 40 * D,
    supAnkle: -5 * D, swAnkle: -10 * D,
    trunkPitch: 0, trunkLat: 0,
    primeMover: '臀中肌 + 阔筋膜张肌（髋外展）',
  },
  TSt: {
    // 「Body weight moves ahead of the forefoot」：髋伸 0~20°、膝近伸、踝背屈最大 10°
    supHipFlex: -10 * D, swHipFlex: 5 * D,
    supKneeFlex: 2 * D, swKneeFlex: 45 * D,
    supAnkle: -10 * D, swAnkle: -18 * D,
    trunkPitch: -2 * D, trunkLat: 0,
    primeMover: '腓肠肌-比目鱼肌（蹬离）+ 臀大肌',
  },
  PSw: {
    // 第二段双支撑：膝快速屈到 40°、踝被动作跖屈到 20°、髋回中立
    supHipFlex: 0, swHipFlex: 2 * D,
    supKneeFlex: 40 * D, swKneeFlex: 20 * D,
    supAnkle: 20 * D, swAnkle: -20 * D,
    trunkPitch: 0, trunkLat: 0,
    primeMover: '腘绳肌 + 内收肌（卸载后腿）',
  },
  ISw: {
    supHipFlex: -5 * D, swHipFlex: 20 * D,
    supKneeFlex: 5 * D, swKneeFlex: 60 * D,   // 膝屈峰 = 足净空
    supAnkle: -5 * D, swAnkle: -10 * D,
    trunkPitch: -3 * D, trunkLat: 0,
    primeMover: '髂腰肌 + 股直肌（加速摆动腿）',
  },
  MSw: {
    supHipFlex: 0, swHipFlex: 30 * D,
    supKneeFlex: 3 * D, swKneeFlex: 30 * D,   // 「tibia vertical」髋膝屈曲相等
    supAnkle: 0, swAnkle: 0,
    trunkPitch: -2 * D, trunkLat: 0,
    primeMover: '（被动钟摆）',
  },
  TSw: {
    // 「Prepare for stance」：膝伸到 0~5°、踝中立、髋保持 25°屈
    supHipFlex: 0, swHipFlex: 25 * D,
    supKneeFlex: 3 * D, swKneeFlex: 3 * D,
    supAnkle: -2 * D, swAnkle: -3 * D,
    trunkPitch: 3 * D, trunkLat: 0,
    primeMover: '腓肠肌-比目鱼肌（末端制动）',
  },
});

/** 本 rig 的 `Phase` → Perry 关键帧。**唯一映射表**，不许散落字面量。 */
export const PHASE_TO_GAIT: Readonly<Record<string, GaitKey>> = Object.freeze({
  // DOUBLE/SHIFT = 双支撑的前后两段 + 交接
  DOUBLE: 'MSt',
  SHIFT: 'LR',
  SINGLE: 'MSt',
  PUSH: 'PSw',
  STEP: 'ISw',
});

/** 取某相的关键帧姿态（带侧别无关的默认值）。 */
export function keyPose(key: GaitKey): KeyPose { return KEY_POSES[key]; }

/**
 * ★ 两个关键帧姿态之间线性插值（按相内进度 `s∈[0,1]`）。
 * 用途：摆动相不该"跳"到目标，而该**沿规范曲线走过去**（Perry 的角-时间曲线）。
 * `side` 决定哪条腿是支撑、哪条是摆动（插值结果里已按支撑/摆动分好字段）。
 */
export function lerpKeyPose(from: GaitKey, to: GaitKey, s: number): KeyPose {
  const a = KEY_POSES[from], b = KEY_POSES[to];
  const u = s < 0 ? 0 : s > 1 ? 1 : s;
  const L = (x: number, y: number): number => x + (y - x) * u;
  return {
    supHipFlex: L(a.supHipFlex, b.supHipFlex),
    swHipFlex: L(a.swHipFlex, b.swHipFlex),
    supKneeFlex: L(a.supKneeFlex, b.supKneeFlex),
    swKneeFlex: L(a.swKneeFlex, b.swKneeFlex),
    supAnkle: L(a.supAnkle, b.supAnkle),
    swAnkle: L(a.swAnkle, b.swAnkle),
    trunkPitch: L(a.trunkPitch, b.trunkPitch),
    trunkLat: L(a.trunkLat, b.trunkLat),
    primeMover: u < 0.5 ? a.primeMover : b.primeMover,
  };
}

// ══════════════════════════════════════════════════════════════
// ★ 站距的**正确**文献基准（2026-10-05 更正）
// ══════════════════════════════════════════════════════════════
//
// ⚠⚠ 曾经的量纲错误：把本 rig 的**踝间距**去比 Perry 的 **step width
//   0.075 m**，得出"4.4× 人类"。**两者不是同一个量**：
//     · step width = **相邻两步落点**的横向间距（Perry & Burnfield）
//     · 站距 = **站立时双脚**的间距
//
// ★ 站距的正确基准是 **hip-to-hip 的百分比** —— **Winter 1998**
//   （J Neurophysiology 80:1211）实测了 **50% / 100% / 150%** 三档：
//   "Sway amplitude **decreased** as stance width increased, and **Ke
//   increased with stance width**"（sway ∝ Ke^−0.55）
//   ⇒ **宽站距更稳**，不是更不稳。
//
// ★ 身高 1.80 m 的等比换算：
//   · step width 0.075 m = **4.2% 身高**
//   · biiliac（髋间距）≈ 0.28 m = **15.6% 身高**
//   · 站立踝间距 ≈ 0.10~0.15 m = 髋间距的 **35~55%**
//   本 rig 髋间距 0.25 m（≈人类 ✓）⇒ 对应 `stance ≈ 0.25~0.40`
//
// ★★ 站距影响**重心转移**的真实机制是**支撑面位置**，不是"稳不稳"：
//   重心不必到脚心，只需进入脚掌横向范围（足宽≈100mm，半 50mm）。
//   `handoverTolZ = 50mm` 要求重心到脚心 50mm 内 ⇒ 支撑面离中线越近越可达。
export const NORMATIVE_STEP_WIDTH = 0.075;      // Perry：相邻落点横向间距
export const NORMATIVE_BIILIAC = 0.28;          // 身高 1.80m 的髋间距
/** 人类站立踝间距区间（m）＝ 髋间距的 35~55% */
export const NORMATIVE_ANKLE_SPAN = { min: 0.10, max: 0.15 };

/** 站立站距（m）＝ 两脚 `soleZ` 之差。 */
export function stanceSpan(soleZl: number, soleZr: number): number {
  return Math.abs(soleZl - soleZr);
}

/** 站距 / 髋间距（Winter 1998 的口径，0.5~1.5 为其实测区间）。 */
export function stanceWidthRatio(soleZl: number, soleZr: number, biiliac = 0.25): number {
  return stanceSpan(soleZl, soleZr) / Math.max(1e-3, biiliac);
}

/**
 * 重心进入支撑面所需的最小横移（m）：脚心 − 足半宽。
 * 这才是 `handoverTolZ` 难度的真正度量，比站距本身直接。
 */
export function supportEntry(soleZl: number, footHalfWidth = 0.05): number {
  return Math.abs(soleZl) - footHalfWidth;
}

/** 侧别工具：给定支撑腿，返回摆动腿。 */
export function otherSide(s: Side): Side { return s === 'l' ? 'r' : 'l'; }