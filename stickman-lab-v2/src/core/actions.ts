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
import { propose, PRI } from './proposalBus';   // ★ 提案制收敛（2026-10-16）

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
      propose({ dof: ctx.body.dofByName(`knee_${sd}`, 2), kind: 'angle', pri: PRI.action, rad: kTgt, kp: 350, kd: 45, src: 'actions' });
      // ★ 深蹲几何：踝背屈 ≈ 膝/2（骨盆直落、脚掌平贴）——动作连踝一起接管
      //   （pin 踝 → 垫脚让位），否则踝被垫脚抢走，重心必后漂
      propose({ dof: ctx.body.dofByName(`foot_${sd}`, 2), kind: 'angle', pri: PRI.action, rad: kTgt * 0.5, kp: 200, kd: 25, src: 'actions' });
      propose({ dof: ctx.body.dofByName(`hip_${sd}`, 2), kind: 'angle', pri: PRI.action, rad: hipCmd, kp: 400, kd: 50, src: 'actions' });
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
/** ★ 2026-10-17 用户：**所有动作**加随机微扰——每轴目标 ±5%、时序 ±12%（速度变化） */
const JV = (v: number, amt = 0.5): number => v * (1 + (Math.random() * 2 - 1) * amt);   // ★ 用户：+50% 扰动
const JT = (t: number, amt = 0.5): number => t * (1 + (Math.random() * 2 - 1) * amt);

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
  const dur = JT(R2(1.6, 3.0)), tIn = JT(R2(0.4, 0.8)), tOut = JT(R2(0.4, 0.8));
  const doNod = Math.random() < 0.75, doTurn = Math.random() < 0.65, doTilt = Math.random() < 0.3;
  const aNod = JV(R2(0.15, 0.35)), aTurn = JV(R2(0.25, 0.70)), aTilt = JV(R2(0.08, 0.20));
  const sN = SGN(), sT = SGN(), sL = SGN();
  return {
    dur,
    update(ctx, t) {
      // ★ §2.442 用户：微动=静止专用；有命令就暂停（身体在动/单腿/任何动作激活）
      {
        const vs = Math.abs(ctx.sensors.comVel[2] ?? 0) + Math.abs(ctx.sensors.comVel[0] ?? 0);
        if (vs > 0.25 || ctx.bal.drive.legReflex.side !== null) return;
      }
      const e = envOf(t, tIn, tOut, dur);
      if (doNod) propose({ dof: ctx.body.dofByName('neck', 2), kind: 'angle', pri: PRI.action, rad: sN * aNod * e, kp: 120, kd: 15, src: 'actions' });
      if (doTurn) propose({ dof: ctx.body.dofByName('neck', 1), kind: 'angle', pri: PRI.action, rad: sT * aTurn * e, kp: 100, kd: 12, src: 'actions' });
      if (doTilt) propose({ dof: ctx.body.dofByName('neck', 0), kind: 'angle', pri: PRI.action, rad: sL * aTilt * e, kp: 100, kd: 12, src: 'actions' });
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
  const dur = JT(R2(1.5, 3.0)), tIn = JT(R2(0.4, 0.8)), tOut = JT(R2(0.4, 0.8));
  // ★ 2026-10-17 标定口（用户：'晃臂加参数消伺服'）：W1=摆幅 WB=屈肘 WA=内收
  const envW = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const W1 = Number(envW.W1 ?? NaN), WB = Number(envW.WB ?? NaN), WA = Number(envW.WA ?? NaN);
  const doSwing = Number.isFinite(W1) || Math.random() < 0.6, doBend = Number.isFinite(WB) || Math.random() < 0.5, doAd = Number.isFinite(WA) || Math.random() < 0.4;
  const aSwing = Number.isFinite(W1) ? W1 : JV(R2(0.30, 0.60)), aBend = Number.isFinite(WB) ? WB : JV(R2(0.40, 0.90)), aAd = Number.isFinite(WA) ? WA : JV(R2(0.10, 0.20));   // ★ 用户：'明显点'（原0.10-0.30/0.20-0.55/0.04-0.10）
  const sS = SGN(), sA = SGN();
  return {
    dur,
    update(ctx, t) {
      // ★ §2.442 用户：微动=静止专用；有命令就暂停（身体在动/单腿/任何动作激活）
      {
        const vs = Math.abs(ctx.sensors.comVel[2] ?? 0) + Math.abs(ctx.sensors.comVel[0] ?? 0);
        if (vs > 0.25 || ctx.bal.drive.legReflex.side !== null) return;
      }
      const e = envOf(t, tIn, tOut, dur);
      // ★ 2026-10-16 用户："手臂动作只要力矩正确、不影响平衡，就直接屏蔽预测层"
      (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
      // ★ 标记接管（消伺服：supportClean.arm / 张力层 见 hasAngle 让位）
      if (doSwing) { propose({ dof: ctx.body.dofByName(`shoulder_${side}`, 2), kind: 'angle', pri: PRI.action, rad: sS * aSwing * e, kp: armKp(ctx, `shoulder_${side}`, 2), kd: 40, src: 'actions' }); ctx.bal.manual.setAngle(`shoulder_${side}`, 2, sS * aSwing * e); }
      if (doBend) { propose({ dof: ctx.body.dofByName(`elbow_${side}`, 2), kind: 'angle', pri: PRI.action, rad: aBend * e, kp: armKp(ctx, `elbow_${side}`, 2), kd: 10, src: 'actions' }); ctx.bal.manual.setAngle(`elbow_${side}`, 2, aBend * e); }   // ★ 屈肘=正（限位修正后）
      if (doAd) {
        // 手动角度会盖掉姿势基线的内收偏置（armInward）→ 并进目标
        const base = -ctx.bal.opt.armInward;
        propose({ dof: ctx.body.dofByName(`shoulder_${side}`, 0), kind: 'angle', pri: PRI.action, rad: base + sA * -aAd * e, kp: armKp(ctx, `shoulder_${side}`, 0), kd: 12, src: 'actions' });
        ctx.bal.manual.setAngle(`shoulder_${side}`, 0, base + sA * -aAd * e);
      }
    },
    end(ctx) {
      (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = false;
      ctx.bal.manual.clearAngle(`shoulder_${side}`, 2);
      ctx.bal.manual.clearAngle(`elbow_${side}`, 2);
      ctx.bal.manual.clearAngle(`shoulder_${side}`, 0);
    },
  };
}

/** 躯干：转腰（脊柱轴1）/侧屈（轴0），分配到 spine1..3 */
function torsoMotion(): PartMotion {
  const dur = JT(R2(1.6, 3.0)), tIn = JT(R2(0.5, 0.9)), tOut = JT(R2(0.5, 0.9));
  // ★ 标定口（用户：'体转加参数消伺服'）：TT=转腰 TS=侧屈
  const envT = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const TT = Number(envT.TT ?? NaN), TS = Number(envT.TS ?? NaN);
  const doTwist = Number.isFinite(TT) || Math.random() < 0.6, doSide = Number.isFinite(TS) || Math.random() < 0.4;
  const aTwist = Number.isFinite(TT) ? TT : JV(R2(0.15, 0.35)) * SGN(), aSide = Number.isFinite(TS) ? TS : JV(R2(0.10, 0.25)) * SGN();   // ★ 用户：'明显点'（原0.05-0.14/0.04-0.10）
  const segs = ['spine1', 'spine2', 'spine3'] as const;
  return {
    dur,
    update(ctx, t) {
      // ★ §2.442 用户：微动=静止专用；有命令就暂停（身体在动/单腿/任何动作激活）
      {
        const vs = Math.abs(ctx.sensors.comVel[2] ?? 0) + Math.abs(ctx.sensors.comVel[0] ?? 0);
        if (vs > 0.25 || ctx.bal.drive.legReflex.side !== null) return;
      }
      const e = envOf(t, tIn, tOut, dur);
      for (const sg of segs) {
        if (doTwist) { propose({ dof: ctx.body.dofByName(sg, 1), kind: 'angle', pri: PRI.action, rad: aTwist * e, kp: 100, kd: 12, src: 'actions' }); ctx.bal.manual.setAngle(sg, 1, aTwist * e); }
        if (doSide) { propose({ dof: ctx.body.dofByName(sg, 0), kind: 'angle', pri: PRI.action, rad: aSide * e, kp: 100, kd: 12, src: 'actions' }); ctx.bal.manual.setAngle(sg, 0, aSide * e); }
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
  const dur = JT(R2(1.6, 3.0)), tIn = JT(R2(0.5, 0.9)), tOut = JT(R2(0.5, 0.9));
  const a = JV(R2(0.15, 0.30)) * SGN();          // 骨盆转角（髋轴1 限位 ±0.70）
  const f = R2(0.5, 0.8);                    // 上身跟随比例（同向 → 腰和上身一起转）
  const segs = ['spine1', 'spine2', 'spine3'] as const;
  return {
    dur,
    update(ctx, t) {
      // ★ §2.442 用户：微动=静止专用；有命令就暂停（身体在动/单腿/任何动作激活）
      {
        const vs = Math.abs(ctx.sensors.comVel[2] ?? 0) + Math.abs(ctx.sensors.comVel[0] ?? 0);
        if (vs > 0.25 || ctx.bal.drive.legReflex.side !== null) return;
      }
      const e = envOf(t, tIn, tOut, dur);
      for (const sd of ['l', 'r'] as const) propose({ dof: ctx.body.dofByName(`hip_${sd}`, 1), kind: 'angle', pri: PRI.action, rad: a * e, kp: 120, kd: 15, src: 'actions' });
      for (const sg of segs) propose({ dof: ctx.body.dofByName(sg, 1), kind: 'angle', pri: PRI.action, rad: a * f * e, kp: 100, kd: 12, src: 'actions' });
    },
    end(ctx) {
      for (const sd of ['l', 'r'] as const) ctx.bal.manual.clearAngle(`hip_${sd}`, 1);
      for (const sg of segs) ctx.bal.manual.clearAngle(sg, 1);
    },
  };
}

/** 脚踝转动：单/双脚小幅内外翻（轴0）或俯仰（轴2）——像换脚压 */
function ankleMotion(): PartMotion {
  const dur = JT(R2(1.5, 3.0)), tIn = JT(R2(0.5, 0.9)), tOut = JT(R2(0.5, 0.9));
  const both = Math.random() < 0.5;
  const useInv = Math.random() < 0.6;                       // 内外翻 or 俯仰
  const a = JV(R2(0.06, 0.15)) * SGN();
  const feet = both ? (['l', 'r'] as const) : [Math.random() < 0.5 ? 'l' : 'r'] as const;
  return {
    dur,
    update(ctx, t) {
      // ★ §2.442 用户：微动=静止专用；有命令就暂停（身体在动/单腿/任何动作激活）
      {
        const vs = Math.abs(ctx.sensors.comVel[2] ?? 0) + Math.abs(ctx.sensors.comVel[0] ?? 0);
        if (vs > 0.25 || ctx.bal.drive.legReflex.side !== null) return;
      }
      const e = envOf(t, tIn, tOut, dur);
      for (const fd of feet) propose({ dof: ctx.body.dofByName(`foot_${fd}`, useInv ? 0 : 2), kind: 'angle', pri: PRI.action, rad: a * e, kp: 120, kd: 15, src: 'actions' });
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
  const dur = JT(R2(1.4, 2.6)), tIn = JT(R2(0.5, 0.9)), tOut = JT(R2(0.5, 0.9));
  const a = JV(R2(0.10, 0.28));                                 // 屈 = 负
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
      // ★ §2.442 用户：微动=静止专用；有命令就暂停（身体在动/单腿/任何动作激活）
      {
        const vs = Math.abs(ctx.sensors.comVel[2] ?? 0) + Math.abs(ctx.sensors.comVel[0] ?? 0);
        if (vs > 0.25 || ctx.bal.drive.legReflex.side !== null) return;
      }
      const e = envOf(t, tIn, tOut, dur);
      for (const kn of knees) {
        // ★ §2.441 用户：细查膝盖/大腿的侧向写入——元凶=本微动（Math.random 的膝侧摆/扭转/髋外展）！
        //   单腿期间严禁微动触碰摆腿/承重腿（抬腿时被随机数扫来扫去=扫堂腿）。
        if (ctx.bal.drive.legReflex.side !== null) continue;
        propose({ dof: ctx.body.dofByName(`knee_${kn}`, 2), kind: 'angle', pri: PRI.action, rad: -a * e, kp: 150, kd: 20, src: 'actions' });
        // ★ 屈膝补偿：骨盆会后旋 → 髋屈同步前倾（上身保持竖直）
        propose({ dof: ctx.body.dofByName(`hip_${kn}`, 2), kind: 'angle', pri: PRI.action, rad: HIP_FRAC * a * e, kp: 400, kd: 50, src: 'actions' });
        if (doSide) propose({ dof: ctx.body.dofByName(`knee_${kn}`, 0), kind: 'angle', pri: PRI.action, rad: aS * e, kp: 90, kd: 12, src: 'actions' });
        if (doTwist) propose({ dof: ctx.body.dofByName(`knee_${kn}`, 1), kind: 'angle', pri: PRI.action, rad: aT * e, kp: 80, kd: 10, src: 'actions' });
        if (doHipAb) propose({ dof: ctx.body.dofByName(`hip_${kn}`, 0), kind: 'angle', pri: PRI.action, rad: aH * e, kp: 120, kd: 15, src: 'actions' });
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
/** ★ 2026-10-16 手臂动作 kp 修复：kp=τmax/lim（满量程偏差刚好出 τmax，不顶格不乱甩） */
function armKp(ctx: PhaseCtx, n: string, ax: number): number {
  const di = ctx.body.dofByName(n, ax);
  if (di < 0) return 50;
  const d = ctx.body.dofs[di]!;
  // ★ 2026-10-17 用户：手臂乱甩——kp=300 对轻质手臂轴过刚（能量泵入→肘甩出限位）；
  //   ARM_KP_OVR 扫稳定值（0=用默认）
  const ovr = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).ARM_KP_OVR ?? 0);
  if (ovr > 0) return ovr;
  return Math.max(d.tauMax / Math.max(Math.abs(d.min), Math.abs(d.max), 0.3), 300);
}

function gestureMotion(pose: PoseEntry[], torso: { twist?: number; lean?: number; hipTw?: number }, tm?: { dur: number; tIn: number; tOut: number }): PartMotion {
  // ★ 2026-10-17 用户：所有动作加随机微扰（每轴±5% + 时序±12%）
  const jp: PoseEntry[] = pose.map(([n2, ax2, v2]) => [n2, ax2, JV(v2, 0.10)]);   // ★ 用户：摸头/摸脸别爆炸——目标值只±10%（时序仍±50%）
  const jTorso = {
    twist: torso.twist !== undefined ? JV(torso.twist) : undefined,
    lean: torso.lean !== undefined ? JV(torso.lean) : undefined,
    hipTw: torso.hipTw !== undefined ? JV(torso.hipTw) : undefined,
  };
  const dur = JT(tm?.dur ?? R2(2.2, 3.6)), tIn = JT(tm?.tIn ?? R2(0.7, 1.1)), tOut = JT(tm?.tOut ?? R2(0.7, 1.1));
  const segs = ['spine1', 'spine2', 'spine3'] as const;
  return {
    dur,
    update(ctx, t) {
      // ★ §2.442 用户：微动=静止专用；有命令就暂停（身体在动/单腿/任何动作激活）
      {
        const vs = Math.abs(ctx.sensors.comVel[2] ?? 0) + Math.abs(ctx.sensors.comVel[0] ?? 0);
        if (vs > 0.25 || ctx.bal.drive.legReflex.side !== null) return;
      }
      const e = envOf(t, tIn, tOut, dur);
      (globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;   // 手臂手势期间屏蔽预测层
      const kdG = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).ARM_KD_OVR ?? 40);
      for (const [n, ax, a] of jp) { propose({ dof: ctx.body.dofByName(n, ax), kind: 'angle', pri: PRI.action, rad: a * e, kp: armKp(ctx, n, ax), kd: kdG, src: 'actions' }); ctx.bal.manual.setAngle(n, ax, a * e); }   // ★ 声明接管（伺服让位）
      // ★ 手臂与腰同步发力：腰/胯的配套扭转与侧倾（同一包络）
      if (jTorso.twist) for (const sg of segs) propose({ dof: ctx.body.dofByName(sg, 1), kind: 'angle', pri: PRI.action, rad: jTorso.twist * e, kp: armKp(ctx, sg, 1), kd: 12, src: 'actions' });
      if (jTorso.lean) for (const sg of segs) propose({ dof: ctx.body.dofByName(sg, 0), kind: 'angle', pri: PRI.action, rad: jTorso.lean * e, kp: armKp(ctx, sg, 0), kd: 12, src: 'actions' });
      if (jTorso.hipTw) for (const sd of ['l', 'r'] as const) propose({ dof: ctx.body.dofByName(`hip_${sd}`, 1), kind: 'angle', pri: PRI.action, rad: jTorso.hipTw * e, kp: 120, kd: 15, src: 'actions' });
    },
    end(ctx) {
      for (const [n, ax] of jp) ctx.bal.manual.clearAngle(n, ax);
      for (const sg of segs) { ctx.bal.manual.clearAngle(sg, 1); ctx.bal.manual.clearAngle(sg, 0); }
      for (const sd of ['l', 'r'] as const) ctx.bal.manual.clearAngle(`hip_${sd}`, 1);
    },
  };
}

/** 随机挑一个大动作手势（数值是初调档，可据画面微调；无 IK 用姿势组合近似）；传名可指定 */
function gesturePart(force?: string): PartMotion {
  const pick = force ?? (Math.random() < 0.30 ? '叉腰' : Math.random() < 0.60 ? '抱胸' : Math.random() < 0.80 ? '摸头' : '摸脸');
  // ★ 2026-10-17 标定口（用户：姿势全不对——用真实通道逐个标定）
  const env2 = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const G0 = Number(env2.G0 ?? NaN), G2 = Number(env2.G2 ?? NaN), GE = Number(env2.GE ?? NaN);
  const P = (d: number, i: number): number => i === 0 && Number.isFinite(G0) ? G0 : i === 1 && Number.isFinite(G2) ? G2 : i === 2 && Number.isFinite(GE) ? GE : d;
  if (pick === '叉腰') {
    // 叉腰：双臂外展微后 + 深屈肘（手到腰侧），腰胯轻微侧移配合
    // ★ 2026-10-17 反解叉腰（用户标注）：目标=大臂外展46°下垂+肘铰链朝"下-内"
    //   解出肩三轴 rotvec = [0.481, -1.237, -0.621] + 肘 1.211 → 手到腰侧(4,107,-28)✓
    const GLx = Number(env2.GLx ?? -0.481), GLy = Number(env2.GLy ?? 1.237), GLz = Number(env2.GLz ?? -0.621);
    const poseX: Array<[string, number, number]> = [
      ['shoulder_l', 0, GLx], ['shoulder_l', 1, GLy], ['shoulder_l', 2, GLz], ['elbow_l', 2, 1.211],
      ['shoulder_r', 0, P(0.481, 0)], ['shoulder_r', 2, P(-0.621, 1)], ['elbow_r', 2, P(1.211, 2)],
    ];
    { const G1 = Number(env2.G1 ?? -1.237); if (Number.isFinite(G1)) poseX.push(['shoulder_r', 1, G1]); }
    return gestureMotion(poseX, { lean: 0.05 * SGN(), hipTw: 0.06 * SGN() });
  }
  if (pick === '抱胸') {
    // 双手交叉抱胸：双肩内收前摆 + 深屈肘，左右微错开使前臂交叠；上身略转
    // ★ 2026-10-17 反解抱胸（用户：'肘部折的不够'）：目标=肘在体侧前(6,118,-14)+手横过胸前(3,106,7)
    //   → 肩三轴 rotvec=[-0.133,-1.937,0.215] + 肘 2.269rad(130°深折)
    const B1 = Number(env2.B1 ?? -1.4);   // ★ 标定：-1.4 手前移到 (11,114,6)（用户：'矢状面往前一些'）
    return gestureMotion([
      ['shoulder_l', 0, 0.133], ['shoulder_l', 1, -B1], ['shoulder_l', 2, 0.215], ['elbow_l', 2, Number(env2.BE ?? 1.2)],
      ['shoulder_r', 0, -0.133], ['shoulder_r', 1, B1], ['shoulder_r', 2, 0.215], ['elbow_r', 2, Number(env2.BE ?? 1.2)],
    ], { twist: 0.08 * SGN() });
  }
  if (pick === '摸头') {
    // 摸头：右臂上抬内收 + 深屈肘，头向手侧微倾
    // ★ 稳定版回退（分段版实测：扭转相甩到前方+结尾摔倒）
    const T0 = Number(env2.T0 ?? 2.0), T1 = Number(env2.T1 ?? 0.8), T2 = Number(env2.T2 ?? 0.5), TE = Number(env2.TE ?? 2.2);   // ★ 向前版（用户：'别向后了'）：手(9,156,-28)   // ★ 手到脑后 (-5,163,-27)——自旋1.6(92°=人体自然肱骨内旋，少拧)
    const N2 = Number(env2.N2 ?? -0.3);
    // ★ 2026-10-17 用户：随机左右手 + 小概率双手（镜像=(-x,+y,-z)）
    // ★ 回退右手专用（用户：'左手摸头乱转/摸脸成摸背'——左臂大抬肩控制不稳，需单独修；SIDE=l 可强制测试）
    const sideH = String(env2.SIDE ?? '') === 'l' ? 'l' : String(env2.SIDE ?? '') === 'r' ? 'r' : (Math.random() < 0.5 ? 'r' : 'l');
    const bothH = Math.random() < 0.15;   // ★ 双手 15%（用户：左手别关）
    const p0 = P(T0, 0), p1 = T1, p2 = P(T2, 1), pe = P(TE, 2);
    const L1 = Number(env2.L1 ?? -0.8), L2 = Number(env2.L2 ?? 0.5), L0 = Number(env2.L0 ?? -2.0);   // ★ 左臂向前版
    const poseH: Array<[string, number, number]> = sideH === 'r'
      ? [['shoulder_r', 0, p0], ['shoulder_r', 1, p1], ['shoulder_r', 2, p2], ['elbow_r', 2, pe]]
      : [['shoulder_l', 0, L0], ['shoulder_l', 1, L1], ['shoulder_l', 2, L2], ['elbow_l', 2, Number(env2.LE ?? 1.2)]];
    if (bothH) poseH.push(['shoulder_r', 0, p0], ['shoulder_r', 1, p1], ['shoulder_r', 2, p2], ['elbow_r', 2, pe], ['shoulder_l', 0, -p0], ['shoulder_l', 1, -p1], ['shoulder_l', 2, -p2], ['elbow_l', 2, pe]);
    poseH.push(['neck', 0, -0.12 * (sideH === 'r' ? 1 : -1)], ['neck', 2, N2]);
    return gestureMotion(poseH, { lean: 0.07 }, { dur: 5.2, tIn: 2.0, tOut: 1.6 });
  }
  // 摸下巴/脸：右臂前上抬 + 屈肘（手近下巴），头微低
  const T0 = Number(env2.T0 ?? 1.0), T1 = Number(env2.T1 ?? 0.3), T2 = Number(env2.T2 ?? 1.8), TE = Number(env2.TE ?? 2.4);   // ★ 标定：手到(9,157,-16) 脸侧
  // ★ 用户：随机左右手 + 小概率双手（镜像=(-x,+y,-z)）
  const sideF = String(env2.SIDE ?? '') === 'l' ? 'l' : String(env2.SIDE ?? '') === 'r' ? 'r' : (Math.random() < 0.5 ? 'r' : 'l');
  const bothF = Math.random() < 0.15;   // ★ 双手 15%
  const q0 = P(T0, 0), q1 = T1, q2 = P(T2, 1), qe = P(TE, 2);
  const F1 = Number(env2.F1 ?? -1.3), F2 = Number(env2.F2 ?? 0.9), F0 = Number(env2.F0 ?? -2.0);   // ★ 左臂最终：手L到(0,158,27) 脸高（z=27 为左臂可达极限——轴不对称）
  const poseF: Array<[string, number, number]> = sideF === 'r'
    ? [['shoulder_r', 0, q0], ['shoulder_r', 1, q1], ['shoulder_r', 2, q2], ['elbow_r', 2, qe]]
    : [['shoulder_l', 0, F0], ['shoulder_l', 1, F1], ['shoulder_l', 2, F2], ['elbow_l', 2, Number(env2.FE ?? 1.761)]];
  if (bothF) poseF.push(['shoulder_r', 0, q0], ['shoulder_r', 1, q1], ['shoulder_r', 2, q2], ['elbow_r', 2, qe], ['shoulder_l', 0, -q0], ['shoulder_l', 1, -q1], ['shoulder_l', 2, -q2], ['elbow_l', 2, qe]);
  poseF.push(['neck', 2, 0.10]);
  return gestureMotion(poseF, { twist: -0.05 * SGN() }, { dur: 4.8, tIn: 1.8, tOut: 1.5 });   // ★ 慢速
}

/** ★ 用户：举手（肩大幅前屈测试——验证肩球铰大角度读数是否翻转） */
function raiseMotion(): PartMotion {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const rad = Number(env.ARM_RAD ?? 1.4);
  const sideR = String(env.SIDE ?? 'r') === 'l' ? 'l' : 'r';   // ★ SIDE=l 左手抬手
  const sgnR = sideR === 'r' ? 1 : -1;
  const dur = JT(5.0), tIn = JT(1.5), tOut = JT(1.0);
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      const d0 = ctx.body.dofByName(`shoulder_${sideR}`, 0);
      const d2 = ctx.body.dofByName(`shoulder_${sideR}`, 2);
      if (d0 >= 0) { propose({ dof: d0, kind: 'angle', pri: PRI.action, rad: sgnR * rad * e, kp: armKp(ctx, `shoulder_${sideR}`, 0), kd: 40, src: 'actions' }); ctx.bal.manual.setAngle(`shoulder_${sideR}`, 0, sgnR * rad * e); }
      if (d2 >= 0) { propose({ dof: d2, kind: 'angle', pri: PRI.action, rad: sgnR * 0.3 * e, kp: armKp(ctx, `shoulder_${sideR}`, 2), kd: 40, src: 'actions' }); ctx.bal.manual.setAngle(`shoulder_${sideR}`, 2, sgnR * 0.3 * e); }
    },
    end(ctx) { ctx.bal.manual.clearAngle(`shoulder_${sideR}`, 0); ctx.bal.manual.clearAngle(`shoulder_${sideR}`, 2); },
  };
}

/** ★ 2026-10-17 用户（'鞠躬和蹬地没写进新动作层——以前遗留的'）：重写为 PartMotion */
function bowMotion(): PartMotion {
  const dur = JT(4.0), tIn = JT(1.8), tOut = JT(1.2);
  const j = (v: number): number => JV(v, 0.5);
  const poseB: Array<[string, number, number]> = [
    ['hip_l', 2, j(0.20)], ['hip_r', 2, j(0.20)],
    ['spine1', 2, j(-0.08)], ['spine2', 2, j(-0.08)], ['spine3', 2, j(-0.07)],
    ['neck', 2, j(-0.08)],
  ];
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      for (const [n, ax, v] of poseB) {
        const di = ctx.body.dofByName(n, ax); if (di < 0) continue;
        propose({ dof: di, kind: 'angle', pri: PRI.action, rad: v * e, kp: 150, kd: 18, src: 'actions' });
        ctx.bal.manual.setAngle(n, ax, v * e);
      }
    },
    end(ctx) {
      for (const [n, ax] of poseB) ctx.bal.manual.clearAngle(n, ax);
    },
  };
}

/** ★ 蹬地挺腰（用户定：'只需要膝盖弯一下'）——简单膝弯 + 伺服让位 */
function pushMotion(): PartMotion {
  const dur = JT(2.6), tIn = JT(0.7), tOut = JT(0.8);
  const envP = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const bend = JV(Number(envP.PB ?? -0.18), 0.5);   // 膝盖弯一下（负=屈）
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      for (const sd of ['l', 'r'] as const) {
        const n = `knee_${sd}`;
        const di = ctx.body.dofByName(n, 2); if (di < 0) continue;
        propose({ dof: di, kind: 'angle', pri: PRI.action, rad: bend * e, kp: 1200, kd: 60, src: 'actions' });   // ★ 刚度压过体重（kp220 弯不动）
        ctx.bal.manual.setAngle(n, 2, bend * e);   // 接管标记（伺服让位——用户：'削弱伺服'）
      }
    },
    end(ctx) {
      for (const sd of ['l', 'r'] as const) ctx.bal.manual.clearAngle(`knee_${sd}`, 2);
    },
  };
}

/** ★ 2026-10-17 用户（'鞠躬和蹬地挺腰补上'）：关键帧脚本加随机微扰——
 *  姿势/力矩 ±10%（不破坏动作结构）、整体速度 ±50%（每个 t 同比例缩放，不重排） */
export function jitterScript(script: ActionScript): ActionScript {
  const k = 1 + (Math.random() * 2 - 1) * 0.5;
  const jr = (r: Record<string, number> | undefined): Record<string, number> | undefined =>
    r === undefined ? undefined : Object.fromEntries(Object.entries(r).map(([key, v]) => [key, JV(v, 0.5)]));   // ★ ±50%（用户：±10% 对鞠躬小角度不可见）
  return {
    name: script.name,
    frames: script.frames.map((f) => ({ t: f.t * k, pose: jr(f.pose), torque: jr(f.torque) })),
  };
}

/** ★ 用户：防御姿势（双手护头前方——由摸脸矢状解改）：手在脸前抬起护住 */
function guardMotion(): PartMotion {
  const dur = JT(4.0), tIn = JT(1.2), tOut = JT(1.2);
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      const pr = (n: string, ax: number, v: number): void => {
        const di = ctx.body.dofByName(n, ax); if (di < 0) return;
        propose({ dof: di, kind: 'angle', pri: PRI.action, rad: v * e, kp: armKp(ctx, n, ax), kd: 40, src: 'actions' });
        ctx.bal.manual.setAngle(n, ax, v * e);
      };
      // 右臂矢状（摸脸解）：手护在脸前
      pr('shoulder_r', 0, 0.056); pr('shoulder_r', 1, -0.185); pr('shoulder_r', 2, 1.3); pr('elbow_r', 2, 2.421);
      // 左臂矢状
      pr('shoulder_l', 0, -0.029); pr('shoulder_l', 1, 0.152); pr('shoulder_l', 2, 1.068); pr('elbow_l', 2, 2.422);
    },
    end(ctx) {
      for (const [n, ax] of [['shoulder_r', 0], ['shoulder_r', 1], ['shoulder_r', 2], ['elbow_r', 2], ['shoulder_l', 0], ['shoulder_l', 1], ['shoulder_l', 2], ['elbow_l', 2]] as Array<[string, number]>) ctx.bal.manual.clearAngle(n, ax);
    },
  };
}

/** ★ 用户：手臂对折（肘折叠到肩）——最小测试动作；只要这个正常，其他动作就能行 */
function foldMotion(): PartMotion {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const kp = Number(env.ARM_KP_OVR ?? 40), kd = Number(env.ARM_KD_OVR ?? 12);
  const rad = Number(env.ARM_RAD ?? 2.4);
  const side = String(env.SIDE ?? 'r') === 'l' ? 'l' : 'r';   // ★ SIDE=l 左手对折
  const dur = JT(5.0), tIn = JT(1.5), tOut = JT(1.0);
  return {
    dur,
    update(ctx, t) {
      const e = envOf(t, tIn, tOut, dur);
      const di = ctx.body.dofByName(`elbow_${side}`, 2);
      if (di < 0) return;
      propose({ dof: di, kind: 'angle', pri: PRI.action, rad: rad * e, kp, kd, src: 'actions' });
      ctx.bal.manual.setAngle(`elbow_${side}`, 2, rad * e);
    },
    end(ctx) { ctx.bal.manual.clearAngle(`elbow_${side}`, 2); },
  };
}

/** ★ 手动空闲动作（用户）：按名播放单个部位动作（网页按钮用） */
export function partPhases(name: string): Phase[] {
  let m: PartMotion;
  switch (name) {
    case '防御': m = guardMotion(); break;
    case '鞠躬': m = bowMotion(); break;
    case '蹬地': m = pushMotion(); break;
    case '对折': m = foldMotion(); break;
    case '举手': m = raiseMotion(); break;
    case '叉腰': case '抱胸': case '摸头': case '摸脸': m = gesturePart(name); break;
    case '甩头': m = headMotion(); break;
    case '晃臂': m = armMotion(Math.random() < 0.5 ? 'l' : 'r'); break;
    case '转体': m = torsoMotion(); break;
    case '晃腰': m = waistMotion(); break;
    case '跺脚': m = ankleMotion(); break;
    case '抖膝': m = kneeMotion(); break;
    case '小动': m = secondaryMotion(); break;
    case '重心移': m = weightMotion(); break;
    default: m = gesturePart();
  }
  const dur = m.dur;
  let t = 0;
  return [{
    name: `手动·${name}`,
    timeout: dur + 0.6,
    enter: () => { t = 0; },
    update: (ctx, dt) => { t += dt; m.update(ctx, t); void dt; },
    done: () => t >= dur,
    onTimeout: (ctx) => { m.end(ctx); },
  }];
}

/** 次级轴活动：肩扭转(轴1)/髋外展(轴0)/踝扭转(轴1) 各自独立掷，随机微动 */
function secondaryMotion(): PartMotion {
  const dur = JT(R2(1.5, 2.8)), tIn = JT(R2(0.5, 0.9)), tOut = JT(R2(0.5, 0.9));
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
      // ★ §2.442 用户：微动=静止专用；有命令就暂停（身体在动/单腿/任何动作激活）
      {
        const vs = Math.abs(ctx.sensors.comVel[2] ?? 0) + Math.abs(ctx.sensors.comVel[0] ?? 0);
        if (vs > 0.25 || ctx.bal.drive.legReflex.side !== null) return;
      }
      const e = envOf(t, tIn, tOut, dur);
      for (const [n, ax, amp] of entries) propose({ dof: ctx.body.dofByName(n, ax), kind: 'angle', pri: PRI.action, rad: amp * e, kp: 100, kd: 12, src: 'actions' });
    },
    end(ctx) {
      for (const [n, ax] of entries) ctx.bal.manual.clearAngle(n, ax);
    },
  };
}

/** 重心：横向转移 5–10cm（移→保持→回中） */
function weightMotion(): PartMotion {
  // ★ 标定口（用户：'重心移加参数'）：WC=幅度(m) WD=方向(+1左/-1右)
  const envWt = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const WC = Number(envWt.WC ?? NaN), WD = Number(envWt.WD ?? NaN);
  const dir = Number.isFinite(WD) ? Math.sign(WD) : SGN(), a = Number.isFinite(WC) ? Math.abs(WC) : JV(R2(0.08, 0.15));   // ★ 用户：'明显点'（原0.05-0.10）
  const tIn = JT(R2(1.0, 1.6)), tHold = JT(R2(0.5, 1.2)), tOut = JT(R2(1.0, 1.6));
  const dur = tIn + tHold + tOut;
  return {
    dur,
    update(ctx, t) {
      // ★ §2.442 用户：微动=静止专用；有命令就暂停（身体在动/单腿/任何动作激活）
      {
        const vs = Math.abs(ctx.sensors.comVel[2] ?? 0) + Math.abs(ctx.sensors.comVel[0] ?? 0);
        if (vs > 0.25 || ctx.bal.drive.legReflex.side !== null) return;
      }
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
