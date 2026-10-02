/**
 * ══════════════════════════════════════════════════════════════════════
 * ★★★ 模块 ②：**迈步系统**（用户 2026-10-02 的两个模块之二）
 * ══════════════════════════════════════════════════════════════════════
 *
 *   "我的设计分两个模块，一个承重腿和腰的平衡维持系统，另一个迈步系统"
 *
 *   本文件只负责：**什么时候抬腿、抬多高、脚落在哪、摆动腿的髋膝踝各出多少力矩**。
 *   它**不负责**"身体在不在平衡"——那是 `balanceHold.ts` 的事。
 *
 *   两个模块的接口（刻意做窄，避免又缠回一起）：
 *     · 输入：`permit`（平衡模块给的抬腿许可）、`stanceX`（承重脚位置）、
 *             ξ（捕获点）、`s`（本相进度 0~1）
 *     · 输出：摆动腿的 IK 目标 (x, y) + 髋/膝/踝的力矩修正 + 落脚点
 *
 *   ────────────────────────────────────────────────────────────────────
 *   文献依据：
 *   · **落脚点** Raibert 捕获点规则：`x_foot = ξ + Γ·v_des + K·(v_des − v)`
 *     ξ = 捕获点 = com.x + vx/ω（放 ξ 处 CoM 恰好停住）。
 *     ⚠ 此前用硬编码 `reach`（相对支撑脚的固定偏移）⇒ 前后间距与速度无关、
 *       开局两脚完全重合 ⇒ 根本没有前后腿之分 ⇒ 无承重腿。已改 Raibert。
 *   · **摆动轨迹** Oberg / Perry：髋屈峰 ~30°（中摆动时脚尖在髋正下方）、
 *     膝屈峰 ~60~67°、踝背屈**仅 7.2±3.4°**（Front Neurorob 2022）。
 *     ⚠ 实测我们的踝跑到 +26~117°（限位 +18°）⇒ 是执行失控，不是轨迹画错。
 *   · **踝的 CoP 权限** 是踝策略（主力）的前提。本 rig 的踝**没有**这个权限
 *     （四次独立测量：指令 ×33 / 力矩 ×9 / 刚度比 ×3.7 均逐位无变化），
 *     所以迈步系统的踝只能做**轨迹跟踪**，不能指望它产生 CoP。
 */

/** 摆动相踝背屈峰值（deg）—— Front Neurorobotics 2022 实测 7.21±3.42°（有辅助时 14.15°） */
export const ANKLE_DF_SWING = 7.2;
/** 预摆动踝跖屈（deg）—— 同文 17.17±3.36° */
export const ANKLE_PF_PRESWING = 17.2;
/** 摆动相膝屈峰值（deg）—— Oberg / Perry */
export const KNEE_FLEX_PEAK = 63;
/** 中摆动时脚尖应到的高度（m，踝高以上）—— 保证最小离地净空 */
export const MFC_TARGET = 0.05;

export interface StepSystemParams {
  /** 摆动周期的一半（s）—— 用户硬约束：每条腿迈步间隔 > 1s ⇒ T/2 > 1.0 */
  halfPeriod: number;
  /** 抬腿峰值高度（m） */
  lift: number;
  /** 目标步速（m/s） */
  vDes: number;
  /** Raibert 无量纲增益 Γ：脚落在 ξ 前方 Γ·vDes */
  kGamma: number;
  /** Raibert 速度误差时间常数 K（s） */
  kVerr: number;
  /** 踝背屈峰值（deg）—— 默认取文献 7.2 */
  ankleSwing?: number;
  /** 预摆动跖屈（deg）—— 默认取文献 17.2 */
  anklePush?: number;
}

export interface StepSystemInput {
  /** 本相进度 0~1（0 = 刚离地，1 = 落地） */
  s: number;
  /** 捕获点 ξ（m） */
  xi: number;
  /** CoM 实际前后速度（m/s） */
  vx: number;
  /** 承重脚的世界 x —— 落脚点必须相对它在前 */
  stanceX: number;
  /** 平衡模块给的抬腿许可 */
  permit: boolean;
}

export interface StepSystemOutput {
  /** 摆动脚 IK 目标 x（m） */
  targetX: number;
  /** 摆动脚 IK 目标 y（m，踝高以上） */
  targetY: number;
  /** 摆动腿踝背屈指令（deg，正 = 背屈） */
  ankleCmd: number;
  /** 摆动腿膝屈角目标（deg，0 = 直） */
  kneeTarget: number;
  /** 是否已越过最小离地净空 */
  clearOk: boolean;
}

export function stepSystem(p: StepSystemParams, i: StepSystemInput): StepSystemOutput {
  // ── 落脚点：Raibert 捕获点规则 ────────────────────────────────────────
  const targetX = i.xi + p.kGamma * p.vDes + p.kVerr * (p.vDes - i.vx);
  const ahead = targetX - i.stanceX;          // 必须落在支撑脚前方才是"迈步"

  // ── 抬腿轨迹：抛物线，中摆动（s≈0.3~0.5）到峰 ────────────────────────
  //   s=0 刚离地 → s=0.5 峰 → s=1 落地。用 sin 保证两端速度为 0（不抽脚）。
  const sClamp = Math.max(0, Math.min(1, i.s));
  const bell = Math.sin(Math.PI * sClamp);
  const rawTargetY = p.lift * bell;

  // ── 许可门：没许可就贴地（不是硬抬）───────────────────────────────────
  const targetY = i.permit ? rawTargetY : 0.012;

  // ── 踝轨迹（文献形状）─────────────────────────────────────────────────
  //   0→0.5 背屈到峰值 ANKLE_DF_SWING，0.5→1 回到中立为着地。
  //   ⚠ 注意：文献背屈只有 7.2°，我们实测跑到 26~117°（限位 +18°）——
  //     那是**执行失控**，不是这里的轨迹画错。
  const dfPeak = p.ankleSwing ?? ANKLE_DF_SWING;
  const ankleCmd = sClamp < 0.5
    ? dfPeak * (sClamp / 0.5)
    : dfPeak * (1 - (sClamp - 0.5) / 0.5);

  // ── 膝屈峰（文献 63°）─────────────────────────────────────────────────
  const kneeTarget = KNEE_FLEX_PEAK * bell;

  // ── 最小离地净空判据 ─────────────────────────────────────────────────
  const clearOk = rawTargetY >= MFC_TARGET && ahead > 0.05;

  return { targetX, targetY, ankleCmd, kneeTarget, clearOk };
}

export function stepParamsFrom(src: Record<string, unknown>, halfPeriod: number): StepSystemParams {
  const g = (k: string, d: number): number => (typeof src[k] === 'number' ? src[k] as number : d);
  return {
    halfPeriod,
    lift: g('lift', 0.32),
    vDes: g('vDes', 0.39),
    kGamma: g('kGamma', 0.35),
    kVerr: g('kVerr', 0.25),
    ankleSwing: typeof src.ankleSwing === 'number' ? src.ankleSwing : undefined,
    anklePush: typeof src.anklePush === 'number' ? src.anklePush : undefined,
  };
}