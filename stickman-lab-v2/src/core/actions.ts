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
import type { Phase, PhaseCtx } from './program';

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
/**
 * ⚠ 已弃用（保留对照）：开环关键帧版单腿站立——**不保证落腿触地**。
 * 正式版见 `singleLegPhases`（事件驱动相位）。
 */
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

// ════════════════════════════════════════════════════════════════
// 单腿站立（闭环相位版）—— 正式版
//   · 相位结束由**事件**决定：重心到位 / 抬脚离地 / 保持到时 / **落腿触地** / 回中
//   · 超时有安全出口；落腿相位绝不允许"悬在半空"结束
// ════════════════════════════════════════════════════════════════
export function singleLegPhases(support: 'l' | 'r', holdSeconds = 1.0): Phase[] {
  const lift = support === 'l' ? 'r' : 'l';
  const fi = (ctx: PhaseCtx) => ctx.sensors.feet[lift === 'l' ? 0 : 1]!;
  const si = (ctx: PhaseCtx) => ctx.sensors.feet[support === 'l' ? 0 : 1]!;
  const W = (ctx: PhaseCtx) => ctx.body.sk.massTotal * 9.81;
  const hip = `hip_${lift}`, knee = `knee_${lift}`, foot = `foot_${lift}`;
  let groundY = 0;
  let supportZ0 = 0;
  /** ★ 重心转移是否**真的**成功——失败则整个动作不抬腿（安全语义） */
  let shiftOk = false;
  return [
    {
      name: '重心转移',
      timeout: 3.0,
      enter: (ctx) => {
        supportZ0 = si(ctx).z;
        groundY = fi(ctx).y;                 // 静姿态脚高 = 地面基准
        shiftOk = false;
        ctx.bal.setComTarget(0, supportZ0);
      },
      done: (ctx) => {
        // ★ 必须**真的**完成重心转移：支撑脚承重、抬脚卸载、CoM 到位——三者同时成立
        const sup = si(ctx), lf = fi(ctx);
        shiftOk = sup.fz > 0.55 * W(ctx)
          && lf.fz < 0.15 * W(ctx)
          && Math.abs(ctx.sensors.com[2]! - supportZ0) < 0.045;
        return shiftOk;
      },
    },
    {
      name: '抬腿',
      timeout: 1.5,
      enter: (ctx) => {
        if (!shiftOk) return;                // 重心没转成 → 不抬（下面 done 直接放行）
        ctx.bal.manual.setAngle(hip, 2, 0.65);
        ctx.bal.manual.setAngle(knee, 2, -1.05);
        ctx.bal.manual.setAngle(foot, 2, 0.10);
      },
      done: (ctx) => !shiftOk || fi(ctx).y > groundY + 0.06,
    },
    {
      name: '保持',
      timeout: holdSeconds,
      done: () => false,                     // 由 timeout 结束（= 保持时长）
    },
    {
      name: '落腿（触地事件）',
      timeout: 2.0,
      enter: (ctx) => {
        // 缓降目标；**不依赖时间结束**——等真的触地
        ctx.bal.manual.setAngle(hip, 2, 0.12);
        ctx.bal.manual.setAngle(knee, 2, -0.20);
        ctx.bal.manual.setAngle(foot, 2, 0);
      },
      done: (ctx) => !shiftOk || fi(ctx).fz >= 40 || fi(ctx).y <= groundY + 0.015,
      onTimeout: (ctx) => {
        // 还没触地：继续压低（安全出口——绝不悬在半空）
        ctx.bal.manual.setAngle(hip, 2, 0);
        ctx.bal.manual.setAngle(knee, 2, 0);
        ctx.bal.manual.setAngle(foot, 2, 0);
      },
    },
    {
      name: '回中',
      timeout: 1.5,
      enter: (ctx) => {
        ctx.bal.manual.setAngle(hip, 2, 0);
        ctx.bal.manual.setAngle(knee, 2, 0);
        ctx.bal.manual.setAngle(foot, 2, 0);
      },
      done: (ctx) => Math.abs(ctx.sensors.com[2]!) < 0.03,
      onTimeout: (ctx) => ctx.bal.setComTarget(0, 0),
    },
  ];
}
