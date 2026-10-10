/**
 * 保护动作（fall protection）——`架构.md` §3.8 目标态：保护动作归**动作层**。
 *
 * 自 fallGuard.ts 相位化迁移（用户定调：架构要干净 / 保护只提案不直写）：
 *   绷直（落地冲击保护）→ 移重心 → 跪撑（受控下放）→ 起身（占位）
 *
 * · 触发：控制层紧急裁定（Future 管道 level=2 / giveup 判定）——本文件不含检测；
 * · 写入：只走 manual 角度/刚度 + comTarget（与其它动作同渠道，不直写 Executor）；
 * · 纪律：每相都有超时安全出口；写进去的（manual 角/CoM 目标）都能交还。
 * 依据：Maki & McIlroy 1997（change-in-support）；绷直 = 非踝共收缩（踝留给垫脚，
 *       锁死踝 = 刚性倒立摆，实测 0.25 m/s 推即倒）。
 */
import type { Phase, PhaseCtx } from '../program';

export interface FallProtectOptions {
  /** 绷直刚度倍数（× 姿态基础刚度） */
  braceKpScale: number;
  /** 绷直相超时（s，安全出口；事件条件=落地竖直速度已静） */
  braceTime: number;
  /** 竖直速度静判据（m/s）与连续时长（s） */
  settleV: number;
  settleTime: number;
  /** 移重心相超时（s；事件条件=CoM 已到支撑脚上方） */
  shiftTime: number;
  /** 从站姿降到跪姿的时长（s） */
  kneelTime: number;
  kneelHip: number;
  kneelKnee: number;
  kneelAnkle: number;
}

export const DEFAULT_FALL_PROTECT: FallProtectOptions = {
  braceKpScale: 3,
  braceTime: 1.5,
  settleV: 0.15,
  settleTime: 0.15,
  shiftTime: 0.5,
  kneelTime: 0.7,
  kneelHip: 1.1,
  kneelKnee: -2.0,
  kneelAnkle: 0.35,
};

/** 绷直身子：**非踝**关节锁在当前角 + 高刚度（共收缩），每拍刷新（姿态在变） */
function brace(ctx: PhaseCtx, kpScale: number): void {
  for (const d of ctx.body.dofs) {
    if (d.engineMotor) continue;
    if (/^foot_/.test(d.name)) continue;      // 踝留给垫脚
    const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
    const kp = kpScale * 0.5 * d.tauMax / lim;
    ctx.bal.manual.setAngle(d.name, d.axis, d.angle, kp);
  }
}

export function fallProtectPhases(opt: Partial<FallProtectOptions> = {}): Phase[] {
  const o = { ...DEFAULT_FALL_PROTECT, ...opt };
  let settleT = 0;
  let shiftTargetZ = 0;
  let kneelT = 0;
  return [
    {
      name: '绷直',
      timeout: o.braceTime,
      update: (ctx, dt) => {
        brace(ctx, o.braceKpScale);
        // 落地冲击已过：竖直速度连续小（事件条件）
        settleT = Math.abs(ctx.sensors.comVel[1]!) < o.settleV ? settleT + dt : 0;
      },
      done: () => settleT >= o.settleTime,
      onTimeout: () => { settleT = 0; },
    },
    {
      name: '移重心',
      timeout: o.shiftTime,
      enter: (ctx) => {
        // 目标 = 当前承重更大的那只脚上方（配合垫脚，把倒的方向让给安全侧）
        const fl = ctx.sensors.feet[0]!, fr = ctx.sensors.feet[1]!;
        shiftTargetZ = fr.fz >= fl.fz ? fr.z : fl.z;
      },
      update: (ctx) => { ctx.bal.setComTarget(0, shiftTargetZ); },
      done: (ctx) => Math.abs(ctx.sensors.com[2]! - shiftTargetZ) < 0.02,
      onTimeout: () => {},
    },
    {
      name: '跪撑',
      timeout: o.kneelTime * 1.5,
      enter: () => { kneelT = 0; },
      update: (ctx, dt) => {
        kneelT += dt;
        const u = Math.min(1, kneelT / o.kneelTime);
        const s = u * u * (3 - 2 * u);
        for (const side of ['l', 'r'] as const) {
          ctx.bal.manual.setAngle(`hip_${side}`, 2, o.kneelHip * s);
          ctx.bal.manual.setAngle(`knee_${side}`, 2, o.kneelKnee * s);
          ctx.bal.manual.setAngle(`foot_${side}`, 2, o.kneelAnkle * s);
        }
        ctx.bal.setComTarget(-0.03, 0);
      },
      done: () => kneelT >= o.kneelTime,
      onTimeout: () => {},
    },
    {
      name: '起身(占位)',
      timeout: Infinity,
      done: () => false,        // 保护保持；释放 = 控制层裁定（release 语义）
    },
  ];
}
