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
    { t: 0.5, torque: { 'knee_l/2': -40, 'knee_r/2': -40 } },
    { t: 0.9, torque: {
      'knee_l/2': +40, 'knee_r/2': +40,
      'hip_l/2': -28, 'hip_r/2': -28,
      'foot_l/2': +18, 'foot_r/2': +18,
    } },
    { t: 1.4, torque: {
      'knee_l/2': +40, 'knee_r/2': +40,
      'hip_l/2': -28, 'hip_r/2': -28,
      'foot_l/2': +18, 'foot_r/2': +18,
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
  let shiftT = 0;
  let inited = false;
  let relL = 0, relR = 0;                    // 回中时两髋外展角的当前值（平滑释放用）
  let relL2 = 0, relK = 0, relF = 0;         // 抬腿侧屈伸角现状（平滑释放，防"蹬直撑杆"）
  let leanSaved = 0.35;                      // 动作期间暂存 leanGain
  const supHip = `hip_${support}`;
  /** ★ 重心转移是否**真的**成功——失败则整个动作不抬腿（安全语义） */
  let shiftOk = false;
  return [
    {
      name: '重心转移',
      timeout: 4.0,
      enter: (ctx) => {
        shiftOk = false;
        shiftT = 0;
        inited = false;
        // ★ 有意搬移 = 动作权限：动作期间把侧移环路增益抬到 1.0（平时 0.35 防共振），
        //   动作结束（回中 timeout）恢复。动作是监督下的运动，不参与自激。
        leanSaved = ctx.bal.opt.leanGain;
        ctx.bal.opt.leanGain = 1.0;
      },
      update: (ctx, dt) => {
        // ★ enter 在 play() 当帧执行，那时传感器还是零初始化——几何量延迟到首个 update 帧捕获
        if (!inited) {
          supportZ0 = si(ctx).z;
          groundY = fi(ctx).y;               // 静姿态脚高 = 地面基准
          inited = true;
        }
        // ★ **渐入**：目标从当前 CoM 位置斜坡搬向支撑脚上方（0.08 m/s），
        //   而不是阶跃——阶跃会让侧移环（髋策略）振荡/搬不动（实测）。
        shiftT += dt;
        const dir = Math.sign(supportZ0) || 1;
        const mag = Math.min(Math.abs(supportZ0), 0.06 * shiftT);
        ctx.bal.setComTarget(0, dir * mag);
      },
      done: (ctx) => {
        // ★ 必须**真的**完成重心转移：支撑脚承重、抬脚卸载、CoM 到位——三者同时成立
        const sup = si(ctx), lf = fi(ctx);
        shiftOk = sup.fz > 0.7 * W(ctx)
          && lf.fz < 0.15 * W(ctx)
          && Math.abs(ctx.sensors.com[2]! - supportZ0) < 0.04;
        return shiftOk;
      },
    },
    {
      name: '抬腿',
      timeout: 1.5,
      enter: (ctx) => {
        if (!shiftOk) return;                // 重心没转成 → 不抬（下面 done 直接放行）
        // ★ 恢复平时增益：保持相是调节任务（高增益=非最小相位泵，实测会慢慢摇大）
        ctx.bal.opt.leanGain = leanSaved;
        // ★ 抬腿侧髋外展**钉住**并外摆 −0.45：防止抬腿时脚越中线（跨到 −0.14 后
        //   支撑多边形全在右侧，CoM 再也回不来——实测回中必倒）
        ctx.bal.manual.pin(hip, 0);
        ctx.bal.manual.setAngle(hip, 0, -0.45, 400, 50);
        // ★ 抬腿/保持期间摆动腿屈伸轴也钉住：这是动作有意抬腿，不是落地，
        //   落地消力反射不许抢（实测它会把膝盖目标从 −0.75 抢成 −0.2，腿被拉直）
        ctx.bal.manual.pin(hip, 2);
        ctx.bal.manual.pin(knee, 2);
        ctx.bal.manual.pin(foot, 2);
        ctx.bal.manual.setAngle(hip, 2, 0.45);
        ctx.bal.manual.setAngle(knee, 2, -0.75);
        ctx.bal.manual.setAngle(foot, 2, 0.08);
      },
      update: (ctx) => {
        if (shiftOk) ctx.bal.setComTarget(0, supportZ0);   // 保持侧移目标（lean 持续守着）
      },
      done: (ctx) => !shiftOk || fi(ctx).y > groundY + 0.06,
    },
    {
      name: '保持',
      timeout: holdSeconds,
      enter: (ctx) => {
        // ★ 保持 = 静态姿势：把两髋外展钉在当前角（开环静态支撑，不进伺服环路——
        //   侧移环在单支撑下会自激/慢塌，实测）。落腿时解钉交还给消力/反射。
        const g = (name: string) => {
          const i = ctx.body.dofByName(name, 0);
          return i >= 0 ? ctx.body.dofs[i]!.angle : 0;
        };
        ctx.bal.manual.pin(supHip, 0);
        ctx.bal.manual.pin(hip, 0);
        ctx.bal.manual.setAngle(supHip, 0, g(supHip), 400, 50);
        if (shiftOk) ctx.bal.manual.setAngle(hip, 0, g(hip), 400, 50);
      },
      update: (ctx) => {
        if (shiftOk) ctx.bal.setComTarget(0, supportZ0);   // 保持期间也守着侧移目标
      },
      done: () => false,                     // 由 timeout 结束（= 保持时长）
    },
    {
      name: '落腿（触地事件）',
      timeout: 2.0,
      enter: (ctx) => {
        // ★ 落腿即解钉摆动腿屈伸轴：脚落地交给消力反射吸收（§3.12）
        ctx.bal.manual.pin(hip, 2, false);
        ctx.bal.manual.pin(knee, 2, false);
        ctx.bal.manual.pin(foot, 2, false);
        // 缓降目标；**不依赖时间结束**——等真的触地
        ctx.bal.manual.setAngle(hip, 2, 0.12);
        ctx.bal.manual.setAngle(knee, 2, -0.20);
        ctx.bal.manual.setAngle(foot, 2, 0);
      },
      done: (ctx) => !shiftOk || fi(ctx).fz >= 0.25 * W(ctx),
      onTimeout: (ctx) => {
        // 还没触地：继续压低（安全出口——绝不悬在半空）
        ctx.bal.manual.setAngle(hip, 2, 0);
        ctx.bal.manual.setAngle(knee, 2, 0);
        ctx.bal.manual.setAngle(foot, 2, 0);
      },
    },
    {
      name: '回中',
      timeout: 2.0,
      enter: (ctx) => {
        // ★ 保持抬起侧髋的钉住（脚留在外侧，给回中留 +z 支撑）；捕获屈伸角平滑释放
        const g = (name: string, ax: number) => {
          const i = ctx.body.dofByName(name, ax);
          return i >= 0 ? ctx.body.dofs[i]!.angle : 0;
        };
        relL2 = g(hip, 2); relK = g(knee, 2); relF = g(foot, 2);
        shiftT = 0;
      },
      update: (ctx, dt) => {
        // 屈伸角平滑释放（防"蹬直撑杆"）；侧向 lean 全程开启（单支撑预倾辅助在守着）
        shiftT += dt;
        const k = Math.max(0, 1 - shiftT / 1.4);
        ctx.bal.manual.setAngle(hip, 2, relL2 * k);
        ctx.bal.manual.setAngle(knee, 2, relK * k);
        ctx.bal.manual.setAngle(foot, 2, relF * k);
      },
      done: () => false,                     // 由 timeout 结束（释放完成）
      onTimeout: (ctx) => {
        ctx.bal.manual.pin(hip, 0, false);   // ★ 解钉抬起侧髋（动作结束，反射接管）
        ctx.bal.setComTarget(0, supportZ0);
        ctx.bal.opt.leanGain = leanSaved;    // ★ 恢复平时增益（防站立自激）
      },
    },
  ];
}
