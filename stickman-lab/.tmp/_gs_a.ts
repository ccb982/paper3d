/**
 * ══════════════════════════════════════════════════════════════════
 *  gaitState.ts —— **固定环形状态机（5 态）+ 逐项验收**
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06 的四条定调，全部落在这个文件里：
 *   ① 「平衡和迈步系统设计为**协作**」—— 角色分区由本文件每拍指派（见 §角色）。
 *   ② 「**状态机不需要每拍给目标**」—— 本文件**不发任何关节指令**
 *      （门禁 `probe-pure-sm` 静态断言：`gaitState.ts` 里不得出现任何
 *      `requestAngle/requestTorque/addTorque/requestHold/requestSwingLeg*`）。
 *   ③ 「**显式标明这几个状态**，验收过了进下一个状态就行了」——
 *      环：`DOUBLE → LOAD → PUSH → LIFT → SWING → DOUBLE`，
 *      迁移**只**由 `VERIFY[state]` 逐项验收驱动，**没有计时器推进相位**。
 *   ④ 「**迈步前需要先让重量转移到后脚**」—— `LOAD` 是环里独立的一步，
 *      是抬腿的**资格前提**（承接腿载荷达标才允许进入 `PUSH`/`LIFT`）。
 *
 * ── 判据的文献依据（详见 `架构_v2_三模块协作.md` §3.4）──────────────
 *   SCONE `GaitStateController`（5 态）：迁移判据 = **相对腿长的矢状足位置**
 *     阈值 + 足载阈值；**没有一处用重心位置**。
 *   EPFL 神经肌肉假体（每腿 5 态）：**对侧足事件**（对侧趾离 = 单支撑起点、
 *     对侧触地 = 双支撑起点）+ 同侧触地/趾离；落地准备用**屈伸角速度**阈值。
 *   opensourceleg（4 态）：足载阈值（0.25 / 0.15 / 0.40 BW）+ **膝角阈值
 *     与膝角速度阈值**；**最短驻留 0.20s**（防抖，不是推进条件）。
 *   Vughuma & Verlinden 2022（EECSS）：每个正常态派生**安全态** + `Tmax`。
 *
 * ── 相对旧实现改了什么（审计见文档 §3.5）──────────────────────────
 *   删：`comOverFootX/Z`（自己推着自己走、实测永不收敛）、`SINGLE→PUSH` 的
 *       纯计时推进、`PUSH→STEP` 里混入的行为条件、"锁承重腿"、重心当判据。
 *   加：`LOAD`（重量交接）、`LIFT`（离地单独成态）、摆动腿姿态验收、
 *       **手性不变式**、安全态、逐项 `violations[]`（差多少都能读）。
 */

import {
  RigState, makeCriteria, NEXT_STATE,
  type GaitState, type Side, type StateViolation,
} from './rigState';
import {
  STATE_TO_GAIT, KEY_POSES, STATE_DOMAINS, stateDomains,
  stanceWidthRatio, supportEntry, type StateDomain,
} from './keyframe';

/** deg ← rad */
const DEG = 180 / Math.PI;

export interface GaitConfig {
  // ── 载荷阈值（体重归一，SCONE / OSL 口径）─────────────────────
  /**
   * **承接腿**承重达标线（`loadFrac`）。`LOAD` 的验收项之一。
   * OSL 用 0.40 BW 判"已承重"，SCONE 用 `stance_load_threshold`（体重归一）。
   */
  loadAcceptFrac: number;
  /**
   * 卸载达标线（`loadFrac`）。两条腿都必须满足才算"这一侧真的空了"：
   * `DOUBLE` 用它确认仍是真双支撑，`LIFT` 用它确认摆动腿已卸掉。
   * OSL 的 `loadESwing = 0.15 BW` 就是这一档。
   */
  loadReleaseFrac: number;
  /** 承重腿判定的载荷迟滞（防抖，与 `loadAcceptFrac` 分工：前者选腿，后者验收） */
  bearerLoadHyst: number;

  // ── 矢状位置阈值（相对腿长，SCONE `sagittal_pos` 口径）─────────
  /**
   * `LOAD` 验收：承接脚**不在重心前方太远**。
   * SCONE 的 `EarlyStance→LateStance` 用 `sagittal_pos < late_stance_threshold`。
   */
  sagLoadThr: number;
  /**
   * `PUSH` 验收：后脚已明显后移到可离地位置。
   * SCONE 的 `LateStance→LiftOff` 用 `sagittal_pos < liftoff_threshold`（默认 −1）。
   */
  sagLiftOffThr: number;
  /**
   * `SWING` 验收：落地脚已到重心前方。
   * SCONE 的 `Swing→Landing` 用 `sagittal_pos > landing_threshold`（默认 0）。
   */
  sagLandingThr: number;

  // ── 摆动腿姿态（OSL `knee_theta` / EPFL `LP` 角速度）───────────
  /** `LIFT` 验收：摆动膝至少屈到这个角度（deg），否则是"拖着走" */
  swingKneeMinDeg: number;
  /** `SWING` 验收：膝角速度 ≤ 此值（deg/s）才算"伸展已收住、准备落地"（EPFL `LP`） */
  swingKneeVelMax: number;
  /** 离地净空下限（m）。Saunders 1953：最小离地净空 MFC = 5cm */
  minClearance: number;

  // ── 节奏与防抖（OSL `min_time_in_state`；**不参与推进**）────────
  /** 两次抬腿起点的最小间隔（s）。用户 2026-10-03：「每次迈步间隔 1s 左右」 */
  stepIntervalSec: number;
  /** 最短驻留（s）：防抖。OSL `min_time_in_state = 0.20` */
  minDwellSec: number;
  /** `Tmax`（s）：任一状态超过它就回 `DOUBLE`（Vughuma 的时间上限，防卡死） */
  tmaxSec: number;
  /** 硬项连续越界多久进安全态（s） */
  graceSec: number;

  // ── 本 rig 特有的加强项（四篇实现测不到这两个量）──────────────
  /** 躯干倾角上限（deg） */
  tiltMaxDeg: number;
  /** 稳定裕度 MoS 下限（m） */
  mosMin: number;

  // ── α(t) 权限预算 ───────────────────────────────────────────
  /** α 斜坡时长（s） */
  authorityRamp: number;
  /** α 的软化宽度（相进度占比） */
  alphaSigma: number;

  /** 起始承重腿（只影响 t=0，不是模式开关） */
  startBearer: Side;
}

/** 迈步间隔下限（用户 2026-10-03：「每次迈步间隔 1s 左右」） */
const DEFAULT_STEP_INTERVAL = 1.0;

/**
 * ★★ **步态周期的唯一真源**（收敛点：控制路径与 ES 路径共用）。
 *   `1.6` s 是 ES 路径实测能走的值；`1.0` s 是用户给的控制下限。
 *   两者角色不同：**下限是安全约束，目标节拍是性能**，不许强行改成一样。
 */
export const STEP_CYCLE_SEC = 1.6;

export const DEFAULT_GAIT_CONFIG: GaitConfig = {
  loadAcceptFrac: 0.60,      // OSL 0.40 BW 量级；取 0.60 因为本 rig 双支撑各约 0.5
  loadReleaseFrac: 0.15,     // OSL `loadESwing = 0.15 BW`
  bearerLoadHyst: 0.08,      // 载荷量级迟滞（与旧实现同值，双支撑各约 0.5）
  sagLoadThr: 0.10,          // 承接脚不超前重心 0.10 腿长
  sagLiftOffThr: -0.35,      // 后脚后移到 −0.35 腿长（SCONE liftoff 默认 −1，按腿长归一后放宽）
  sagLandingThr: -0.05,      // 落地脚到重心稍前即可
  swingKneeMinDeg: 20,       // 离地后膝至少屈 20°
  swingKneeVelMax: 40,       // 40 deg/s：EPFL 的 −1 deg/s 远保守，按本 rig 尺度放宽
  minClearance: 0.05,        // MFC = 5cm（Saunders 1953）
  stepIntervalSec: DEFAULT_STEP_INTERVAL,
  minDwellSec: 0.20,         // OSL `min_time_in_state`
  tmaxSec: 2.0,              // Vughuma `Tmax`
  graceSec: 0.5,
  tiltMaxDeg: 20,
  mosMin: 0.0,
  authorityRamp: 0.4,
  alphaSigma: 0.08,
  startBearer: 'l',
};

/** ★ 状态的固定环顺序（**唯一真源**）。环走完一圈 = 一个完整迈步周期。 */
export const STATE_ORDER: readonly GaitState[] = Object.freeze(
  ['DOUBLE', 'LOAD', 'PUSH', 'LIFT', 'SWING'] as GaitState[]);

/**
 * 状态 → 计分相位（与 `gaitPhase.GaitPhaseMachine` 的词汇收敛点）。
 *
 * 用户 2026-10-04：「控制和计分的状态机可以分开，但是还得做到收敛。」
 *   · 计分 `step`   = **单支撑**（`nGround === 1`）
 *   · 计分 `adjust` = **双脚支撑**（`nGround === 2`）
 *   · 控制侧：`LIFT`/`SWING` 是单支撑；`DOUBLE`/`LOAD`/`PUSH` 是双脚
 *     （`PUSH` 是双脚支撑期内的蹬离，脚还没离地 —— 见文档 §3.5 的审计）
 */
export const STATE_TO_SCORING: Readonly<Record<GaitState, 'both' | 'step' | 'adjust'>> = Object.freeze({
  DOUBLE: 'adjust',
  LOAD: 'adjust',
  PUSH: 'adjust',
  LIFT: 'step',
  SWING: 'step',
});

/** 反向：计分相位 ⇒ 哪一类支撑 */
export const SCORING_TO_STANCE: Readonly<Record<'both' | 'step' | 'adjust', 'single' | 'double'>> =
  Object.freeze({ both: 'double', step: 'single', adjust: 'double' });

/** 某个控制状态是单支撑还是双脚支撑（门禁断言它与映射表一致） */
export function stateStance(s: GaitState): 'single' | 'double' {
  return SCORING_TO_STANCE[STATE_TO_SCORING[s]];
}

/** 状态标签（导出给 `ui/hud.ts` 与 `tools/probe-uipanel.ts`，真源唯一） */
export const STATE_LABEL: Record<GaitState, string> = {
  DOUBLE: '双脚支撑', LOAD: '重量交接', PUSH: '蹬离', LIFT: '抬腿离地', SWING: '摆动落地',
};

/** 兼容别名（旧名，2026-10-06 改名；保留给旧日志/旧探针读） */
export const PHASE_LABEL = STATE_LABEL;

/** 正常正态 CDF（把硬阈值软化成连续权限用） */
function cdf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

/**
 * ★ 平滑的权限预算 α(t)。
 *   ⚠ **不是**状态迁移判据（用户 2026-10-06：推进只看验收）。
 *   摆动相内从 0 升到 1，用 3/2 斜坡在前 ⅓ 完成，再经 CDF 软化边界。
 */
export function smoothAuthority(state: GaitState, stateT: number, ramp: number, sigma: number): number {
  if (state !== 'SWING') return 0;
  const p = Math.max(0, Math.min(1, stateT / Math.max(1e-6, ramp)));
  const ramped = Math.min(1, 1.5 * p);
  return 0.5 * (1 + cdf((ramped - 0.5) / Math.max(1e-6, sigma)));
}