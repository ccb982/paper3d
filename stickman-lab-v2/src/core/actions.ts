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
    // ★ 2026-10 重标：原键（蹲 −40 / 蹬 +40/髋−28/踝+34）在当前膝盖刚度下
    //   蹲深 0.2 rad、蹬伸把身体**发射离地**（Fz 0/0 弹跳）→ 重心前漂到倒。
    //   定档：蹲 −40（深蹲给行程）、蹬 +24/髋−16/踝+6（轻蹬不离地）。
    { t: 0.5, torque: { 'knee_l/2': -40, 'knee_r/2': -40 } },
    { t: 0.9, torque: {
      'knee_l/2': +24, 'knee_r/2': +24,
      'hip_l/2': -16, 'hip_r/2': -16,
      'foot_l/2': +6, 'foot_r/2': +6,
    } },
    { t: 1.4, torque: {
      'knee_l/2': +24, 'knee_r/2': +24,
      'hip_l/2': -16, 'hip_r/2': -16,
      'foot_l/2': +6, 'foot_r/2': +6,
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
// 蹲起（动作层；与"蹬地挺腰"同通道但**深蹲缓起**）：下蹲 → 蹲底保持 → 站起
//   · 力矩键取"不再发射离地"的标定档（见 PUSH_RISE 注释）；
//   · 只写动作层（actions.ts/ActionSystem），不动伺服层。
// ════════════════════════════════════════════════════════════════
/**
 * 蹲起（闭环相位版）—— ★ **动作层主动、连续地保持竖直**（用户定调）：
 *   · 膝按轨线下蹲到"对折"档（位置伺服，动作自己管）；
 *   · **每帧竖直环**：读躯干倾角/角速度 → 连续调髋（`hipTgt = −(kp·pitch + kd·pitchRate)`）
 *     把上身纠回竖直——动作自己的姿势回路，不依赖伺服；
 *   · 重心目标蹲时略前偏（支撑交给垫脚/伺服）；站起=膝轨线回零，收尾交还关节。
 */
export function squatPhases(depth = -0.9, descentT = 1.2, holdT = 0.6, riseT = 1.0): Phase[] {
  // ★ 竖直环增益：实测 1.6 会抖（硬位置伺服 + 一帧延迟 → 极限环）——降到 0.7/0.12 并加限速
  const SAG_KP = 0.7, SAG_KD = 0.12;
  let t = 0;
  let hipCmd = 0;                                    // 限速后的髋目标（slew limit）
  const cl = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const writeLeg = (ctx: PhaseCtx, kTgt: number, dt: number): void => {
    const pitch = ctx.sensors.torsoTilt[0]!;         // 正 = 前倾
    const rate = ctx.sensors.torsoAngVel[2]!;        // 躯干俯仰角速度（世界系）
    const raw = cl(SAG_KP * pitch + SAG_KD * rate, -0.9, 0.3);
    const step = 1.2 * dt;                           // 限速 1.2 rad/s
    hipCmd += cl(raw - hipCmd, -step, step);
    for (const sd of ['l', 'r'] as const) {
      ctx.bal.manual.setAngle(`knee_${sd}`, 2, kTgt, 350, 45);
      // ★ 深蹲几何：踝背屈 ≈ 膝/2（骨盆直落、脚掌平贴）——动作连踝一起接管
      //   （pin 踝 → 垫脚让位），否则踝被垫脚抢走，重心必后漂
      ctx.bal.manual.setAngle(`foot_${sd}`, 2, kTgt * 0.5, 200, 25);
      ctx.bal.manual.setAngle(`hip_${sd}`, 2, hipCmd, 400, 50);
    }
  };
  return [
    {
      name: '下蹲',
      timeout: descentT + 1.5,
      enter: (ctx) => {
        t = 0;
        hipCmd = 0;
        for (const sd of ['l', 'r'] as const) {
          ctx.bal.manual.pin(`knee_${sd}`, 2);
          ctx.bal.manual.pin(`hip_${sd}`, 2);
          ctx.bal.manual.pin(`foot_${sd}`, 2);
        }
      },
      update: (ctx, dt) => {
        t += dt;
        const u = Math.min(1, t / descentT);
        writeLeg(ctx, depth * smooth(u), dt);
        ctx.bal.setComTarget(ctx.bal.opt.standX + 0.03, 0);
      },
      done: () => t >= descentT,
    },
    {
      name: '蹲底保持',
      timeout: holdT,
      update: (ctx, dt) => {
        t += dt;
        writeLeg(ctx, depth, dt);
        ctx.bal.setComTarget(ctx.bal.opt.standX + 0.03, 0);
      },
      done: () => false,
    },
    {
      name: '站起',
      timeout: riseT + 1.5,
      enter: () => { t = 0; },
      update: (ctx, dt) => {
        t += dt;
        const u = Math.min(1, t / riseT);
        writeLeg(ctx, depth * (1 - smooth(u)), dt);
        ctx.bal.setComTarget(ctx.bal.opt.standX, 0);
      },
      done: () => t >= riseT,
    },
    {
      name: '收尾',
      timeout: 0.8,
      enter: (ctx) => {
        for (const sd of ['l', 'r'] as const) {
          ctx.bal.manual.clearAngle(`knee_${sd}`, 2);
          ctx.bal.manual.clearAngle(`hip_${sd}`, 2);
          ctx.bal.manual.clearAngle(`foot_${sd}`, 2);
          ctx.bal.manual.pin(`knee_${sd}`, 2, false);
          ctx.bal.manual.pin(`hip_${sd}`, 2, false);
          ctx.bal.manual.pin(`foot_${sd}`, 2, false);
        }
        ctx.bal.setComTarget(ctx.bal.opt.standX, 0);
      },
      done: () => false,
    },
  ];
}

// ════════════════════════════════════════════════════════════════
// ★ 空闲行为（动作层；文献：Duarte & Zatsiorsky 1999 —— 长时间站立时人自发地
//   重心迁移/换脚/调整；Collins & De Luca 1993 —— 静立摆动=开环+闭环随机游走）
//
// 结构（用户定调 2026-10）：**按部位归类**，每个部位**独立掷概率**，
// 一次空闲事件里选中哪些部位就同时做哪些（点头/摆头/侧头可叠加）：
//   head   头颈：点头(轴2)/摆头(轴1)/侧头(轴0) 三个子动作各自独立掷
//   arm_l  左臂：摆臂(肩轴2)/屈肘(肘轴2)/收展(肩轴0)
//   arm_r  右臂：同上（与左臂独立）
//   torso  躯干：转腰(脊柱轴1)/侧屈(脊柱轴0)（分配到 spine1..3）
//   weight 重心：横向转移（comTrack z，5–10cm，移→保持→回中）
// 每个部位自带随机幅度/时长与平滑包络；事件时长 = 选中部位的最长时长；
// 全部走动作层（相位程序），伺服在下层照常工作。
// ════════════════════════════════════════════════════════════════
const R2 = (a: number, b: number): number => a + Math.random() * (b - a);
const SGN = (): number => (Math.random() < 0.5 ? -1 : 1);

/** 平滑包络：tIn 渐入、tOut 渐出、dur 总时长 */
function envOf(t: number, tIn: number, tOut: number, dur: number): number {
  const a = Math.min(1, t / tIn);
  const b = t > dur - tOut ? Math.max(0, (dur - t) / tOut) : 1;
  return smooth(a) * smooth(b);
}

interface PartMotion {
  dur: number;
  update(ctx: PhaseCtx, t: number): void;
  end(ctx: PhaseCtx): void;
}

/** 头颈：点头/摆头/侧头（三个子动作独立掷概率，可叠加） */
function headMotion(): PartMotion {
  const dur = R2(1.6, 3.0), tIn = R2(0.4, 0.8), tOut = R2(0.4, 0.8);
  const doNod = Math.random() < 0.75, doTurn = Math.random() < 0.65, doTilt = Math.random() < 0.3;
  const aNod = R2(0.15, 0.35), aTurn = R2(0.25, 0.70), aTilt = R2(0.08, 0.20);
  const sN = SGN(), sT = SGN(), sL = SGN();
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      if (doNod) ctx.bal.manual.setAngle('neck', 2, sN * aNod * e, 120, 15);
      if (doTurn) ctx.bal.manual.setAngle('neck', 1, sT * aTurn * e, 100, 12);
      if (doTilt) ctx.bal.manual.setAngle('neck', 0, sL * aTilt * e, 100, 12);
    },
    end(ctx) {
      ctx.bal.manual.clearAngle('neck', 2);
      ctx.bal.manual.clearAngle('neck', 1);
      ctx.bal.manual.clearAngle('neck', 0);
    },
  };
}

/** 单臂：摆臂（肩轴2）/屈肘（肘轴2，屈=负）/收展（肩轴0；负=往身体收） */
function armMotion(side: 'l' | 'r'): PartMotion {
  const dur = R2(1.5, 3.0), tIn = R2(0.4, 0.8), tOut = R2(0.4, 0.8);
  const doSwing = Math.random() < 0.6, doBend = Math.random() < 0.5, doAd = Math.random() < 0.4;
  const aSwing = R2(0.10, 0.30), aBend = R2(0.20, 0.55), aAd = R2(0.04, 0.10);
  const sS = SGN(), sA = SGN();
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      if (doSwing) ctx.bal.manual.setAngle(`shoulder_${side}`, 2, sS * aSwing * e, 120, 15);
      if (doBend) ctx.bal.manual.setAngle(`elbow_${side}`, 2, -aBend * e, 100, 12);   // 屈肘=负
      if (doAd) {
        // 手动角度会盖掉姿势基线的内收偏置（armInward）→ 并进目标
        const base = -ctx.bal.opt.armInward;
        ctx.bal.manual.setAngle(`shoulder_${side}`, 0, base + sA * -aAd * e, 100, 12);
      }
    },
    end(ctx) {
      ctx.bal.manual.clearAngle(`shoulder_${side}`, 2);
      ctx.bal.manual.clearAngle(`elbow_${side}`, 2);
      ctx.bal.manual.clearAngle(`shoulder_${side}`, 0);
    },
  };
}

/** 躯干：转腰（脊柱轴1）/侧屈（轴0），分配到 spine1..3 */
function torsoMotion(): PartMotion {
  const dur = R2(1.6, 3.0), tIn = R2(0.5, 0.9), tOut = R2(0.5, 0.9);
  const doTwist = Math.random() < 0.6, doSide = Math.random() < 0.4;
  const aTwist = R2(0.05, 0.14) * SGN(), aSide = R2(0.04, 0.10) * SGN();
  const segs = ['spine1', 'spine2', 'spine3'] as const;
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      for (const sg of segs) {
        if (doTwist) ctx.bal.manual.setAngle(sg, 1, aTwist * e, 100, 12);
        if (doSide) ctx.bal.manual.setAngle(sg, 0, aSide * e, 100, 12);
      }
    },
    end(ctx) {
      for (const sg of segs) {
        ctx.bal.manual.clearAngle(sg, 1);
        ctx.bal.manual.clearAngle(sg, 0);
      }
    },
  };
}

/** 腰部转动：髋扭转（轴1，双腿长轴吸能、脚不动）+ 脊柱腰段（spine1 轴1）跟随 */
function waistMotion(): PartMotion {
  const dur = R2(1.6, 3.0), tIn = R2(0.5, 0.9), tOut = R2(0.5, 0.9);
  const a = R2(0.15, 0.30) * SGN();          // 骨盆转角（髋轴1 限位 ±0.70）
  const f = R2(0.5, 0.8);                    // 上身跟随比例（同向 → 腰和上身一起转）
  const segs = ['spine1', 'spine2', 'spine3'] as const;
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      for (const sd of ['l', 'r'] as const) ctx.bal.manual.setAngle(`hip_${sd}`, 1, a * e, 120, 15);
      for (const sg of segs) ctx.bal.manual.setAngle(sg, 1, a * f * e, 100, 12);
    },
    end(ctx) {
      for (const sd of ['l', 'r'] as const) ctx.bal.manual.clearAngle(`hip_${sd}`, 1);
      for (const sg of segs) ctx.bal.manual.clearAngle(sg, 1);
    },
  };
}

/** 脚踝转动：单/双脚小幅内外翻（轴0）或俯仰（轴2）——像换脚压 */
function ankleMotion(): PartMotion {
  const dur = R2(1.5, 3.0), tIn = R2(0.5, 0.9), tOut = R2(0.5, 0.9);
  const both = Math.random() < 0.5;
  const useInv = Math.random() < 0.6;                       // 内外翻 or 俯仰
  const a = R2(0.06, 0.15) * SGN();
  const feet = both ? (['l', 'r'] as const) : [Math.random() < 0.5 ? 'l' : 'r'] as const;
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      for (const fd of feet) ctx.bal.manual.setAngle(`foot_${fd}`, useInv ? 0 : 2, a * e, 120, 15);
    },
    end(ctx) {
      for (const fd of ['l', 'r'] as const) {
        ctx.bal.manual.clearAngle(`foot_${fd}`, 0);
        ctx.bal.manual.clearAngle(`foot_${fd}`, 2);
      }
    },
  };
}

/** 膝盖弯曲：双腿微屈回弹（小幅弹一下）/或单膝屈（换重心） */
function kneeMotion(): PartMotion {
  const dur = R2(1.4, 2.6), tIn = R2(0.5, 0.9), tOut = R2(0.5, 0.9);
  const a = R2(0.10, 0.28);                                 // 屈 = 负
  const both = Math.random() < 0.6;
  const knees = both ? (['l', 'r'] as const) : [Math.random() < 0.5 ? 'l' : 'r'] as const;
  // ★ 其他方向的自由度活动：膝侧摆(轴0)/膝扭转(轴1)/髋外展(轴0) 各自独立微动
  // ★ HIP_FRAC：屈膝的上身竖直补偿（髋屈 = FRAC×膝屈；标定于 _probe-idle 的倾角统计）
  const HIP_FRAC = 0.8;
  const doSide = Math.random() < 0.4, doTwist = Math.random() < 0.4, doHipAb = Math.random() < 0.35;
  const aS = R2(0.03, 0.08) * SGN(), aT = R2(0.04, 0.10) * SGN(), aH = R2(0.03, 0.08) * SGN();
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      for (const kn of knees) {
        ctx.bal.manual.setAngle(`knee_${kn}`, 2, -a * e, 150, 20);
        // ★ 屈膝补偿：骨盆会后旋 → 髋屈同步前倾（上身保持竖直）
        ctx.bal.manual.setAngle(`hip_${kn}`, 2, HIP_FRAC * a * e, 400, 50);
        if (doSide) ctx.bal.manual.setAngle(`knee_${kn}`, 0, aS * e, 90, 12);
        if (doTwist) ctx.bal.manual.setAngle(`knee_${kn}`, 1, aT * e, 80, 10);
        if (doHipAb) ctx.bal.manual.setAngle(`hip_${kn}`, 0, aH * e, 120, 15);
      }
    },
    end(ctx) {
      for (const kn of ['l', 'r'] as const) {
        ctx.bal.manual.clearAngle(`knee_${kn}`, 2);
        ctx.bal.manual.clearAngle(`knee_${kn}`, 0);
        ctx.bal.manual.clearAngle(`knee_${kn}`, 1);
        ctx.bal.manual.clearAngle(`hip_${kn}`, 0);
        ctx.bal.manual.clearAngle(`hip_${kn}`, 2);
      }
    },
  };
}

/** 大动作手势：给定完整姿势轨线（[关节,轴,目标角]）+ 同步的腰/胯配合（twist/lean） */
type PoseEntry = [string, number, number];
function gestureMotion(pose: PoseEntry[], torso: { twist?: number; lean?: number; hipTw?: number }): PartMotion {
  const dur = R2(2.2, 3.6), tIn = R2(0.7, 1.1), tOut = R2(0.7, 1.1);
  const segs = ['spine1', 'spine2', 'spine3'] as const;
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      for (const [n, ax, a] of pose) ctx.bal.manual.setAngle(n, ax, a * e, 120, 15);
      // ★ 手臂与腰同步发力：腰/胯的配套扭转与侧倾（同一包络）
      if (torso.twist) for (const sg of segs) ctx.bal.manual.setAngle(sg, 1, torso.twist * e, 100, 12);
      if (torso.lean) for (const sg of segs) ctx.bal.manual.setAngle(sg, 0, torso.lean * e, 100, 12);
      if (torso.hipTw) for (const sd of ['l', 'r'] as const) ctx.bal.manual.setAngle(`hip_${sd}`, 1, torso.hipTw * e, 120, 15);
    },
    end(ctx) {
      for (const [n, ax] of pose) ctx.bal.manual.clearAngle(n, ax);
      for (const sg of segs) { ctx.bal.manual.clearAngle(sg, 1); ctx.bal.manual.clearAngle(sg, 0); }
      for (const sd of ['l', 'r'] as const) ctx.bal.manual.clearAngle(`hip_${sd}`, 1);
    },
  };
}

/** 随机挑一个大动作手势（数值是初调档，可据画面微调；无 IK 用姿势组合近似） */
function gesturePart(): PartMotion {
  const pick = Math.random();
  if (pick < 0.30) {
    // 叉腰：双臂外展微后 + 深屈肘（手到腰侧），腰胯轻微侧移配合
    return gestureMotion([
      ['shoulder_l', 0, 0.45], ['shoulder_l', 2, -0.25], ['shoulder_l', 1, 0.30], ['elbow_l', 2, -1.55],
      ['shoulder_r', 0, 0.45], ['shoulder_r', 2, -0.25], ['shoulder_r', 1, -0.30], ['elbow_r', 2, -1.55],
    ], { lean: 0.05 * SGN(), hipTw: 0.06 * SGN() });
  }
  if (pick < 0.60) {
    // 双手交叉抱胸：双肩内收前摆 + 深屈肘，左右微错开使前臂交叠；上身略转
    return gestureMotion([
      ['shoulder_l', 0, -0.15], ['shoulder_l', 2, 0.45], ['shoulder_l', 1, 0.50], ['elbow_l', 2, -1.70],
      ['shoulder_r', 0, -0.15], ['shoulder_r', 2, 0.60], ['shoulder_r', 1, -0.40], ['elbow_r', 2, -1.85],
    ], { twist: 0.08 * SGN() });
  }
  if (pick < 0.80) {
    // 摸头：右臂上抬内收 + 深屈肘，头向手侧微倾
    return gestureMotion([
      ['shoulder_r', 0, 0.65], ['shoulder_r', 2, 0.40], ['shoulder_r', 1, -0.60], ['elbow_r', 2, -1.95],
      ['neck', 0, -0.12 * SGN()],
    ], { lean: 0.07 });   // ★ 配重：右臂抬起把 CoM 带向 −z，躯干向 +z 侧倾补偿
  }
  // 摸下巴/脸：右臂前上抬 + 屈肘（手近下巴），头微低
  return gestureMotion([
    ['shoulder_r', 0, 0.35], ['shoulder_r', 2, 0.55], ['shoulder_r', 1, -0.30], ['elbow_r', 2, -1.95],
    ['neck', 2, 0.10],
  ], { twist: -0.05 * SGN() });
}

/** 次级轴活动：肩扭转(轴1)/髋外展(轴0)/踝扭转(轴1) 各自独立掷，随机微动 */
function secondaryMotion(): PartMotion {
  const dur = R2(1.5, 2.8), tIn = R2(0.5, 0.9), tOut = R2(0.5, 0.9);
  const entries: Array<[string, number, number]> = [];
  if (Math.random() < 0.4) entries.push(['shoulder_l', 1, R2(0.06, 0.14) * SGN()]);
  if (Math.random() < 0.4) entries.push(['shoulder_r', 1, R2(0.06, 0.14) * SGN()]);
  if (Math.random() < 0.35) entries.push(['hip_l', 0, R2(0.03, 0.08) * SGN()]);
  if (Math.random() < 0.35) entries.push(['hip_r', 0, R2(0.03, 0.08) * SGN()]);
  if (Math.random() < 0.3) entries.push(['foot_l', 1, R2(0.04, 0.10) * SGN()]);
  if (Math.random() < 0.3) entries.push(['foot_r', 1, R2(0.04, 0.10) * SGN()]);
  if (entries.length === 0) entries.push(['hip_l', 0, R2(0.03, 0.06) * SGN()]);
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      for (const [n, ax, amp] of entries) ctx.bal.manual.setAngle(n, ax, amp * e, 100, 12);
    },
    end(ctx) {
      for (const [n, ax] of entries) ctx.bal.manual.clearAngle(n, ax);
    },
  };
}

/** 重心：横向转移 5–10cm（移→保持→回中） */
function weightMotion(): PartMotion {
  const dir = SGN(), a = R2(0.05, 0.10);
  const tIn = R2(1.0, 1.6), tHold = R2(0.5, 1.2), tOut = R2(1.0, 1.6);
  const dur = tIn + tHold + tOut;
  return {
    dur,
    update(ctx, t) {
      let z = 0;
      if (t < tIn) z = dir * a * smooth(t / tIn);
      else if (t < tIn + tHold) z = dir * a;
      else z = dir * a * (1 - smooth(Math.min(1, (t - tIn - tHold) / tOut)));
      ctx.bal.setComTarget(ctx.bal.opt.standX, z);
    },
    end(ctx) {
      ctx.bal.setComTarget(ctx.bal.opt.standX, 0);
    },
  };
}

/** ★ 一次空闲事件 = 各部位独立掷骰后并发做（用户定调：每部位概率独立） */
export function idlePhases(): Phase[] {
  const parts: PartMotion[] = [];
  if (Math.random() < 0.55) parts.push(headMotion());
  if (Math.random() < 0.45) parts.push(armMotion('l'));
  if (Math.random() < 0.45) parts.push(armMotion('r'));
  if (Math.random() < 0.30) parts.push(torsoMotion());
  if (Math.random() < 0.35) parts.push(waistMotion());
  if (Math.random() < 0.25) parts.push(ankleMotion());
  if (Math.random() < 0.30) parts.push(kneeMotion());
  if (Math.random() < 0.25) parts.push(secondaryMotion());
  if (Math.random() < 0.22) parts.push(gesturePart());
  if (Math.random() < 0.40) parts.push(weightMotion());
  if (parts.length === 0) parts.push(headMotion());          // 保底：至少动一下
  const dur = Math.max(...parts.map((m) => m.dur));
  let t = 0;
  return [
    {
      name: '空闲(部位复合)',
      timeout: dur + 0.6,
      enter: () => { t = 0; },
      update: (ctx, dt) => {
        t += dt;
        for (const m of parts) m.update(ctx, t);
        void dt;
      },
      done: () => t >= dur,
      onTimeout: (ctx) => { for (const m of parts) m.end(ctx); },
    },
  ];
}
