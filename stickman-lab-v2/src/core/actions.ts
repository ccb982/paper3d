/**
 * actions.ts —— 动作库（手动控制系统的"节目单"）
 *
 * 每个 action = 关键帧序列（关节角/力矩）+ 可选质心目标轨道。
 * 外部只需：`balance.manual.play(a.frames)` + 每步 `balance.setComTarget(a.com(t))`。
 *
 * 符号约定（`tools/_calib.ts` 实测标定，改动前先重跑它）：
 *   · 髋 axis2 **正 = 腿相对骨盆向前**（屈髋读数）；双脚踩地时 = 躯干前倾（鞠躬）
 *   · 膝 axis2 **负 = 屈膝**（限位 −145°…+2°）
 *   · 脊柱 axis2 **负 = 上身向前弯**（轴测：头 Δx 为正）
 *   · 颈 axis2 **负 = 低头**
 *   · 踝 axis2 正 = 跖屈（踮脚）、负 = 背屈
 */

import type { Keyframe } from './manual';

export interface ComPoint { t: number; x: number; z: number }

export interface ActionScript {
  name: string;
  frames: Keyframe[];
  /** 质心水平目标轨道（smoothstep 插值；省略 = 一直 (0,0)） */
  comTrack?: ComPoint[];
  /** 验收摘要（探针直接打印） */
  expect?: string;
}

function smooth(u: number): number {
  return u * u * (3 - 2 * u);
}

/** 求质心目标轨道在 t 时刻的值 */
export function evalComTrack(track: ComPoint[] | undefined, t: number): { x: number; z: number } {
  if (!track || track.length === 0) return { x: 0, z: 0 };
  if (t <= track[0]!.t) return { x: track[0]!.x, z: track[0]!.z };
  const last = track[track.length - 1]!;
  if (t >= last.t) return { x: last.x, z: last.z };
  let k = 0;
  while (k < track.length - 1 && track[k + 1]!.t < t) k++;
  const a = track[k]!, b = track[k + 1]!;
  const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  const s = smooth(u);
  return { x: a.x + (b.x - a.x) * s, z: a.z + (b.z - a.z) * s };
}

// ════════════════════════════════════════════════════════════════
// 鞠躬：前三节脊柱前弯 + 双髋屈 + 低头，停 1s，再直起来
// ════════════════════════════════════════════════════════════════
export const BOW: ActionScript = {
  name: '鞠躬',
  frames: [
    { t: 0.0, pose: {} },
    {
      t: 1.8,
      pose: {
        'hip_l/2': 0.20, 'hip_r/2': 0.20,
        'spine1/2': -0.08, 'spine2/2': -0.08, 'spine3/2': -0.07,
        'neck/2': -0.08,
      },
    },
    {
      t: 2.8,
      pose: {
        'hip_l/2': 0.20, 'hip_r/2': 0.20,
        'spine1/2': -0.08, 'spine2/2': -0.08, 'spine3/2': -0.07,
        'neck/2': -0.08,
      },
    },
    { t: 4.0, pose: {} },
  ],
  comTrack: [
    { t: 0.0, x: 0.0, z: 0.0 },
    { t: 4.0, x: 0.0, z: 0.0 },
  ],
  expect: '安静起立→前弯（头/胸向前 >0.15m）→停 1s→直回原位；全程双脚不离地、不摔倒',
};

// ════════════════════════════════════════════════════════════════
// 蹬地挺腰（实验）：纯力矩——先屈膝下蹲，再膝/髋/踝同步蹬伸
// ════════════════════════════════════════════════════════════════
export const PUSH_RISE: ActionScript = {
  name: '蹬地挺腰',
  frames: [
    { t: 0.0, torque: {} },
    { t: 0.5, torque: { 'knee_l/2': -30, 'knee_r/2': -30 } },
    { t: 0.9, torque: {
      'knee_l/2': +28, 'knee_r/2': +28,
      'hip_l/2': -22, 'hip_r/2': -22,
      'foot_l/2': +14, 'foot_r/2': +14,
    } },
    { t: 1.4, torque: {
      'knee_l/2': +28, 'knee_r/2': +28,
      'hip_l/2': -22, 'hip_r/2': -22,
      'foot_l/2': +14, 'foot_r/2': +14,
    } },
    { t: 1.8, torque: {} },
  ],
  comTrack: [
    { t: 0.0, x: 0.0, z: 0.0 },
    { t: 1.8, x: 0.0, z: 0.0 },
  ],
  expect: '蹲→蹬：地面反力 >100% 体重、胸腔先降后升；纯力矩通道',
};

// ════════════════════════════════════════════════════════════════
// 单腿站立（站在 support 侧，抬起另一条腿）
//   · 第一阶段：CoM 横移到支撑脚上方
//   · 第二阶段：抬腿（髋屈 + 膝屈），保持 1.4s
//   · 第三阶段：放腿、CoM 回中
// ════════════════════════════════════════════════════════════════
export function buildSingleLeg(support: 'l' | 'r', supportFootZ: number): ActionScript {
  const lift = support === 'l' ? 'r' : 'l';
  const h = (k: string) => `${k}`;
  return {
    name: `单腿站立（站 ${support.toUpperCase()} 脚）`,
    frames: [
      { t: 0.0, pose: {} },
      { t: 0.9, pose: {} },                                       // 只横移重心
      {
        t: 1.7,
        pose: {
          [h(`hip_${lift}/2`)]: 0.65,
          [h(`knee_${lift}/2`)]: -1.05,
          [`foot_${lift}/2`]: 0.10,
        },
      },
      {
        t: 3.1,
        pose: {
          [h(`hip_${lift}/2`)]: 0.65,
          [h(`knee_${lift}/2`)]: -1.05,
          [`foot_${lift}/2`]: 0.10,
        },
      },
      { t: 4.0, pose: {} },
      { t: 4.6, pose: {} },
    ],
    comTrack: [
      { t: 0.0, x: 0.0, z: 0.0 },
      { t: 0.9, x: 0.0, z: supportFootZ },
      { t: 3.1, x: 0.0, z: supportFootZ },
      { t: 4.6, x: 0.0, z: 0.0 },
    ],
    expect: `重心横移到 ${support.toUpperCase()} 脚上方 → 抬起 ${lift.toUpperCase()} 腿（离地 >8cm）保持 1.4s → 放回；支撑脚承重 >70% 体重、不摔倒`,
  };
}
