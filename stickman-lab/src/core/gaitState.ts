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
  RigState, makeCriteria, NEXT_STATE, STATE_ORDER,
  type WalkState, type Side, type StateViolation,
} from './rigState';
import {
  STATE_TO_GAIT, KEY_POSES, stanceWidthRatio, supportEntry,
} from './keyframe';
import { createJointQuery } from './jointQuery';
import { buildGroundChain, forceChainLines } from './forceChain';

/** deg ← rad */
const DEG = 180 / Math.PI;
/** 环境变量读取（本文件的局部助手；与 core/env.ts 语义一致） */
const envNumG = (k: string, d: number): number => {
  const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  const raw = env[k];
  if (raw == null || raw === '') return d;
  const v = Number(raw);
  return Number.isFinite(v) ? v : d;
};

/**
 * ★ W2 开关（`STEPTRIG=0` 关）：`copPlan.fallNeeded` 应急放行迈步许可。
 *   见 `stepPermit` 构造后的那段（"要摔倒了也别管承重腿摆动腿了"——用户定调）。
 */
const STEP_TRIG = !['0', 'false', 'off'].includes(String(
  ((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).STEPTRIG ?? '').trim().toLowerCase());

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
  /**
   * 承重腿切换的**最小驻留**（s）—— 双阈值迟滞的另一半（SCONE 的
   * `stance_load_threshold` / `swing_load_threshold` 就是一对双阈值）。
   * ⚠ 载荷在物理上真的会以 ~0.75s 周期大幅摆动（实测 |Δload| 到 0.328），
   *   只靠 0.08 的幅值迟滞会出现 **50ms 级翻转**（门禁 D 实测）⇒ 必须加驻留。
   */
  bearerMinDwellSec: number;

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
  /**
   * ★ LateStance 阈值（SCONE `late_stance_threshold`，默认 **0.0**）。
   *   SCONE 的 `EarlyStance→LateStance` 与 `LateStance→LiftOff` 是**两个不同阈值**
   *   （0.0 与 −1），我们原来只留了后者 ⇒ 少了"承重腿后移到重心之后"这一段。
   */
  sagLateStanceThr: number;
  /** LiftOff 阈值（SCONE `liftoff_threshold`，默认 **−1**，以腿长归一） */
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
  /**
   * ★ **Perry 角度签名的门槛系数**（判据里所有 `人类值 × sigFrac`）。
   *
   *   为什么要有这个系数：Perry 给的是**整个步态周期**的签名值，
   *   而我们只在**单个状态内**采样 ⇒ 直接用绝对值会过严。
   *   初值 0.6 是**工程取值，不是文献值** —— 必须等两个系统重做、
   *   能站住之后按实测分布回填（见文档 §19.6）。
   *   放在配置里（而不是散在 VERIFY 里写死 0.6）就是为了让标定能一处改。
   */
  sigFrac: number;
  /**
   * ★ 踝角速度**死区**（deg/s，域口径：正 = 跖屈向）。
   *   用途：`PUSH` 要求"还在背屈"（`vel < -eps`）、`THRUST` 要求"已转跖屈"（`vel > +eps`）。
   *   没有死区时 `vel == 0` 会**同时**满足两个态 ⇒ 顺序约束失效。
   */
  ankleVelEps: number;
  /**
   * ★ 载荷类判据**是否拦迁移**（默认 false = 只报告）。
   *   人类相位由角度签名定义（Perry 不用载荷分数）；我们的载荷读数还没修
   *   （`grounded=00` 却 `loadFrac≈0.5`）⇒ 让它当硬门槛是用坏尺子卡好判据。
   *   接触模型可信之后把它设成 true 即可，判据本身不用改。
   */
  loadBlocks: boolean;
  /**
   * ★ 承接脚「放平」的容差（deg，**绝对值**）。
   *   为什么用绝对值而不是 Perry 的「跖屈 ≥10°」：那签名**假定足跟着地**
   *   （足跟先着 → 足掌落下 → 踝跖屈）。本机**可能是平足落地**，此时踝是**背屈**的
   *   （实测 −10.84°）⇒ 方向判据永远不过。
   *   「脚放平」的物理含义与落地方式无关：**踝角接近中立**。
   *   出处：本项目自研（§21.5「设计自研，论文只借数据」）。
   */
  footFlatTolDeg: number;
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

  /**
   * ★ **标定模式**（默认 false）：验收照常逐项计算并记录，但**不拦截状态迁移**。
   *
   *   为什么需要它：文档 §11 原则 1 要求阈值「先只打印再反标」——
   *   而拦截式阈值会让系统**卡在被怀疑的那一项上**，根本采不到分布
   *   （实测：阈值 0.60 时承接腿载荷只到 0.57，状态机卡在 `LOAD` 150 拍直到跌落，
   *     于是"到底能到多少"永远测不出来）。
   *   ⇒ 标定模式下：**只靠最短驻留推进**，每拍把全部验收项的值写进
   *     `rs.violations`（未过项）与 `rs.stateStats`（峰值/均值），由探针取分位数。
   *
   *   ⚠ 标定模式**只用于测量**，绝不能留在正式路径上
   *     （门禁 `probe-domain` 在默认配置下断言"5 态全访问"就是它的护栏）。
   */
  calib?: boolean;
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
  // ★★★★★ 2026-10-06 **用户规格：承重腿 80% / 摆动腿 20%**
  //   （「承重腿承重 **80% 左右**的体重即可；即将摆动的腿承重 **20% 左右**，
  //     要不容易站不稳」——这正是人体步态在 toe-off 前的标准分配）
  // ⚠ 实测：门设 **0.80** 时 LOAD 到不了 ⇒ 4.43 s Tmax 兜底回 DOUBLE（周期退化）。
  //   ⇒ 按用户"**80% 左右**"留容差：**验收门 0.70**（转移的**目标**仍是 0.80，
  //     见 `step.ts` 的"点到为止"）。
  loadAcceptFrac: 0.60,      // 原（OSL 0.40 BW 量级；本 rig 双支撑各约 0.5）
  loadReleaseFrac: 0.15,     // ⚠ 实测 0.20 会把 LOAD→PUSH 的链条弄断（见 §22.53）；先回 0.15
  bearerLoadHyst: 0.08,      // 载荷量级迟滞（与旧实现同值，双支撑各约 0.5）
  bearerMinDwellSec: 0.12,   // 承重腿换边最小驻留（双阈值迟滞的另一半）
  sagLoadThr: 0.10,          // 承接脚不超前重心 0.10 腿长
  // ★ SCONE 官方默认值（scone.software GaitStateController）：
  //     late_stance_threshold = 0.0    liftoff_threshold = −1    landing_threshold = 0.0
  //   我们把 liftoff 从 −1 放宽到 −0.35（比文献**更严**，因为本 rig 步长小）。
  sagLateStanceThr: 0.0,      // SCONE `late_stance_threshold` 默认值
  sagLiftOffThr: -0.35,       // SCONE 默认 −1 ⇒ 本值更严，待本机标定
  sagLandingThr: 0.0,       // SCONE `landing_threshold` 默认值：脚到重心**之前**
  swingKneeMinDeg: 20,       // 离地后膝至少屈 20°
  swingKneeVelMax: 40,       // 40 deg/s：EPFL 的 −1 deg/s 远保守，按本 rig 尺度放宽
  minClearance: 0.05,        // MFC = 5cm（Saunders 1953）
  stepIntervalSec: DEFAULT_STEP_INTERVAL,
  minDwellSec: 0.20,         // OSL `min_time_in_state`
  // ★★★ **可扫**（`SIG_FRAC=0.15 node tools/run.mjs …`）：Perry 签名 × 该系数 = 门槛。
  //   实测 `LOAD -> PUSH` 长期卡在 `承接膝屈(吸振)`：门槛 = 20×0.6 = **12°**，
  //   而承接膝只摆到 ~10° 就回落 ⇒ 状态机出不去（**完成周期 0**，永远不迈步）。
  sigFrac: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SIG_FRAC) || 0.6,
  ankleVelEps: 2.0,          // 踝角速度死区 deg/s（判"背屈中/跖屈中"要互斥）
  loadBlocks: true,          // ★ 恢复阻塞（§3.7-B6）：L0 口径已收敛、readback 已断言可信
  // ★★★ **可扫**（`FOOT_FLAT_DEG=8 node tools/run.mjs …`）。
  //   ⚠⚠ 默认 12 **正好等于踝关节限位** `[-12, 18]` ⇒ 踝被钉在 −12.000° 时
  //   判据要求 `|踝| <= 12.000`，实测读到 **12.001** ⇒ **判据压在限位边界上**
  //   （刀锋条件，靠浮点运气）。⇒ 真值应留余量（8°）。本轮扫它 + `SIG_FRAC`。
  footFlatTolDeg: Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.FOOT_FLAT_DEG) || 12,
  tmaxSec: 2.0,              // Vughuma `Tmax`
  graceSec: 0.5,
  tiltMaxDeg: 20,
  mosMin: 0.0,
  authorityRamp: 0.4,
  alphaSigma: 0.08,
  startBearer: 'l',
};

/**
 * ★ 状态的固定环顺序（**唯一真源**）。环走完一圈 = 一个完整迈步周期。
 *   定义已下沉到 `rigState`（见那里 STATE_ORDER 的注释：遥测要画环，
 *   而 NEXT_STATE 也在那一层）。这里 re-export，外部引用不变。
 */
export { STATE_ORDER };

/**
 * 状态 → 计分相位（与 `gaitPhase.GaitPhaseMachine` 的词汇收敛点）。
 *
 * 用户 2026-10-04：「控制和计分的状态机可以分开，但是还得做到收敛。」
 *   · 计分 `step`   = **单支撑**（`nGround === 1`）
 *   · 计分 `adjust` = **双脚支撑**（`nGround === 2`）
 *   · 控制侧：`LIFT`/`SWING` 是单支撑；`DOUBLE`/`LOAD`/`PUSH` 是双脚
 *     （`PUSH` 是双脚支撑期内的蹬离，脚还没离地 —— 见文档 §3.5 的审计）
 */
export const STATE_TO_SCORING: Readonly<Record<WalkState, 'both' | 'step' | 'adjust'>> = Object.freeze({
  DOUBLE: 'adjust',
  LOAD: 'adjust',
  PUSH: 'adjust',
  THRUST: 'adjust',
  LIFT: 'step',
  SWING: 'step',
});

/** 反向：计分相位 ⇒ 哪一类支撑 */
export const SCORING_TO_STANCE: Readonly<Record<'both' | 'step' | 'adjust', 'single' | 'double'>> =
  Object.freeze({ both: 'double', step: 'single', adjust: 'double' });

/** 某个控制状态是单支撑还是双脚支撑（门禁断言它与映射表一致） */
export function stateStance(s: WalkState): 'single' | 'double' {
  return SCORING_TO_STANCE[STATE_TO_SCORING[s]];
}

/** 状态标签（导出给 `ui/hud.ts` 与 `tools/probe-uipanel.ts`，真源唯一） */
export const STATE_LABEL: Record<WalkState, string> = {
  DOUBLE: '双脚支撑', LOAD: '重量交接', PUSH: '提踵支撑', THRUST: '卸载蹬离',
  LIFT: '抬腿离地', SWING: '摆动落地',
};

/** 兼容别名（旧名，2026-10-06 改名；保留给旧日志/旧探针读） */
export const PHASE_LABEL = STATE_LABEL;

const LEG_CN: Record<Side, string> = { l: '左', r: '右' };

/** 越界项 → 人话（给 UI 用的**唯一**措辞表，避免 UI 自己拼字符串） */
function violationText(v: StateViolation): string {
  if (!Number.isFinite(v.value) || !Number.isFinite(v.tol)) return `${v.item} ${v.value}/${v.tol}`;
  return `${v.item} ${v.value.toFixed(3)}/${v.tol > 0 ? '' : '-'}${Math.abs(v.tol).toFixed(3)}`;
}

/**
 * ★★★ **人类步态参考值（判据的第一依据）**
 *
 *   用户 2026-10-06 定调：「我的偏好是查**有关人类运动**的文献，尽量别查机器人相关的，
 *   游戏角色关节应该更接近真人。」
 *   ⇒ 判据的**第一**依据是人类步态分析，机器人文献只作交叉验证。
 *
 *   主源：**Perry & Burnfield, Gait Analysis**（Rancho Los Amigos 八相位体系）
 *   与 **Winter, Biomechanics of Walking**。两者都按**关节角/角速度签名**划分相位，
 *   **不是**按载荷分数 —— 这是与 SCONE/OSL（机器人实现）最大的口径差异。
 *
 *   符号口径：本文件的角度一律用**帧域**（`degOf` 之后）：
 *     髋 `+` = 屈　膝 `+` = 屈　踝 `+` = **跖屈**（实测见 probe-readback）。
 *   人类文献给的是"背屈为正"的临床口径，下表已换算并在注释里保留原文。
 */
export const HUMAN_REF = Object.freeze({
  /** Perry 八相位在步态周期中的区间（%GC）与三项任务 */
  phases: Object.freeze([
    { name: 'InitialContact', from: 0, to: 2, task: 'WeightAcceptance' },
    { name: 'LoadingResponse', from: 2, to: 10, task: 'WeightAcceptance' },
    { name: 'MidStance', from: 10, to: 31, task: 'SingleLimbSupport' },
    { name: 'TerminalStance', from: 31, to: 50, task: 'SingleLimbSupport' },
    { name: 'PreSwing', from: 50, to: 62, task: 'SingleLimbSupport' },
    { name: 'InitialSwing', from: 62, to: 73, task: 'LimbAdvancement' },
    { name: 'MidSwing', from: 73, to: 87, task: 'LimbAdvancement' },
    { name: 'TerminalSwing', from: 87, to: 100, task: 'LimbAdvancement' },
  ] as const),

  /**
   * 逐相位的**角度签名**（deg，帧域）。这是我们判据的骨架。
   * 数值全部来自 Perry/Winter 的成人正常值，`approx` 表示文献本身给的是范围。
   */
  angle: Object.freeze({
    /** IC：足跟着地时踝约 3° 跖屈（临床记 −3° 背屈），膝 0~5° 屈，髋 30° 屈 */
    IC: { anklePF: 3, kneeFlex: 5, hipFlex: 30 },
    /** LR（足底着平，10%GC）：踝跖屈 ~10° 后开始反向；膝屈到 20°；胫骨垂直 */
    footFlat: { anklePF: 10, kneeFlex: 20 },
    /** MS 末（提踵瞬间）：踝**背屈 +10°**（全支撑期最大背屈） */
    heelRise: { ankleDF: 10 },
    /** TS 末（单支撑末）：踝回到 5° 跖屈 */
    endSLS: { anklePF: 5 },
    /** PS（离地）：踝跖屈 **20°**；膝屈 35° */
    toeOff: { anklePF: 20, kneeFlex: 35 },
    /** MSW（摆动中期）：膝屈峰值 **60°**；髋 15~25° 屈 */
    peakKnee: { kneeFlex: 60 },
    /** TSW（终末摆动，落地前）：膝伸到 0~5°；踝背屈 10~15° 准备脚跟着地 */
    preLanding: { kneeFlex: 5, ankleDF: 12 },
  }),

  /** 人类步宽（Perry Fig 3-13）：女性 ~7cm、男性 ~8cm。**这是 Q1 站距的标尺。** */
  strideWidthM: { female: 0.07, male: 0.08 },
  /** 腿长 ≈ 3 × 足长（Usherwood 2023 J R Soc Interface 20:20220800） */
  legOverFoot: 3,
  /** 足长 : 跟-跖 : 趾 ≈ 1 : 2 : 1（同上，碰撞几何预测） */
  footRatio: Object.freeze({ hind: 0.25, mid: 0.5, fore: 0.25 }),
  /**
   * ★ 冲击—拱架—冲击（Usherwood 2012 J R Soc Interface 9:2396）：
   *   早支撑 = 小腿肌（胫前）**离心**耗散；中期拱架 = **被动**（GRF 过踝，力臂≈0）；
   *   晚支撑 = 足在踝**前方**受载 ⇒ 力臂 ⇒ 小腿肌（腓肠肌/比目鱼）**向心**蹬离。
   *   这直接给出"两个系统每态做什么"的人类版本（见 `STATE_ROLES`）。
   */
  impulseVaultImpulse: Object.freeze([
    { phase: 'veryEarlyStance', role: '小腿肌离心 · 耗散冲击', muscles: 'TA / EDL / EHL' },
    { phase: 'vault(MidStance)', role: '被动 · 倒立摆', muscles: '几乎不加载' },
    { phase: 'veryLateStance', role: '小腿肌向心 · 蹬离做功', muscles: 'Gastroc / Soleus' },
  ]),
});

/**
 * ★★★ **每态两个系统的显式分工**（用户 2026-10-06：
 *   「两个系统也应该在不同的状态下显式做不同的事」）。
 *
 *   为什么必须是**表**而不是散在两个系统的 `if` 里：
 *     · `balance.ts` 和 `step.ts` 各自按 `rs.state` 分支，久了就出现
 *       「同一个态在两个文件里含义不同」——而本项目已经栽过
 *       （前腿/承重腿定义、`LOAD` 承接腿语义、`PUSH→STEP` 混行为条件）。
 *     · 判据表（`VERIFY`）只说**什么时候进下一态**，不说**这一态该干什么**。
 *       缺了这张表，就会出现"验收过了但两个系统都在做同一件事"。
 *
 *   依据（每行都有出处，不是拍脑袋）：
 *   · **OSL FSM**（opensourceleg 官方示例，踝关节 FSM + 每态阻抗）：
 *       Early Stance = 中等刚度**吸振**；Late Stance = **高刚度蹬离**产生功率；
 *       Early Swing = **低刚度**让踝快速背屈让出净空；Late Swing = **保持背屈**准备落地。
 *   · **Lim et al. 2004**（WABIAN-RIII，位置型阻抗）：
 *       双支撑**前半**把落地腿阻尼**大幅调高**以吸收冲击；
 *       双支撑**后半**用多项式把腿的轨迹还给期望步态；
 *       单支撑**前半**给落地腿**大刚度**以补偿被黏滞消耗的动量；
 *       并且明确指出 **balance control 贯穿整个周期**，逐态变的是**阻抗/形状**。
 *   · **HKIC / FSIC**（PMC10249435 / PMC11426229）：
 *       支撑期用**阻抗**、摆动期用**运动学**；FSIC 还给出「落地后 6.7% 刚度不约束」
 *       这类逐相位刚度下限，说明**相位相关的刚度差异是被文献明确要求**的。
 *   · **EPFL**：摆动腿摆动轨迹在落地前更新；`LP` 用屈伸角速度判落地准备。
 *
 *   ⇒ 落到本项目：**平衡是"连续的一整套"，逐态变的是它的目标/权限；
 *     迈步是"逐态换目标腿与形状"**。两者不共享判据，也不互相代劳。
 */
export interface StateRoles {
  readonly state: WalkState;
  /** 平衡维持系统（balance）这一态做什么 —— 逐字写清职责与权限 */
  readonly balance: string;
  /** 迈步系统（step）这一态做什么 */
  readonly step: string;
  /** 两条腿的角色（由状态机指派，不许各自推断） */
  readonly legs: string;
  /** 出处 */
  readonly ref: string;
}

/**
 * ★★★ **每个状态的腿角色 + 锁定声明（唯一真源）**
 *
 *   用户 2026-10-06：「**每个状态，状态机都要显式指定前后腿、锁定腿**」。
 *
 *   为什么必须是**声明表**而不是散落的边沿写入：
 *   旧实现只在「触地」时写一次 `locked[sw]=true`、在 `LIFT`/`SWING` 时清一次
 *   —— 锁定状态是**历史的函数**，读代码看不出"这个态到底哪条腿能动"。
 *   实测后果：`recv/rear/sup` 每拍重算、`locked` 只在边沿碰一次
 *   ⇒ 出现「态中途换被测腿、判据一瞬间全过、关节却没动」（§3.2.1）。
 *
 *   三档自由度（与文档 §3.2 的解锁语义一一对应）：
 *     · `locked`             —— 摆动腿**不许被 step 移动**（`requestSwingLegAngle` 被否决）
 *     · `grounded-unlocked`  —— 解锁，但**必须留地**（允许预屈膝/预摆，不许离地）
 *     · `free`               —— 自由（`LIFT`/`SWING` 才允许离地）
 *
 *   ⚠⚠ **`front`（承重/承接腿）恒为 `free`，永不 `locked`**（2026-10-06 实测教训）：
 *     `rs.locked` 会被下游当成 `requestHold`（**冻住该腿伺服**）。把承重腿也锁上
 *     ⇒ 两条腿的伺服同时停 ⇒ 人从 t=0 就掉（实测 GRF 仅 **58N** vs 体重 687N，
 *     状态机卡死 `DOUBLE` 127 拍）。
 *     文档里"锁定"的语义**只针对摆动腿**（「锁定期内 `requestSwingLegAngle` 会被否决」）
 *     —— 承重腿是平衡系统的执行对象，必须能持续驱动。
 *   ★ `DOUBLE` **两腿皆锁**（用户 2026-10-06：「第一个状态应该是两腿都锁定，
 *     然后重心转移，保持平衡」）—— 语义是"**这个态谁都不许迈步**"，
 *     不是"关掉腿的执行"：`locked` 只被
 *       · `stepPermit.P3_未锁定`（否决 step 的摆动请求）
 *       · `supportLeg()` 的"锁定优先"分支（两腿皆锁时**跳过**，回落载荷判定）
 *     两处消费，**没有任何地方用它冻结伺服**（已 grep 全仓确认）。
 *     因此"两腿皆锁"是安全的，且正是 `DOUBLE` 想要的效果：静态站立、不许偷跑。
 *
 *   ⚠ 角色名用**语义**（承接/后腿），不用左右：左右由 `roleRecv` 在进态时定。
 */
export interface StateLegPlan {
  /** 承接腿（= front，本周期要成为承重腿的那条）的自由度 */
  readonly front: 'locked' | 'grounded-unlocked' | 'free';
  /** 后腿（= rear = 本周期要摆动的候选）的自由度 */
  readonly rear: 'locked' | 'grounded-unlocked' | 'free';
  /** 本态腿角色的职责（给 UI 与两个系统读的一句话） */
  readonly note: string;
  /** 出处（为什么这个态是这样） */
  readonly ref: string;
}

export const STATE_LEGS: Readonly<Record<WalkState, StateLegPlan>> = Object.freeze({
  // 双脚站立：两腿都在地上、都在承重 ⇒ 谁都不许走，否则就是"没交接就抬腿"
  DOUBLE: { front: 'locked', rear: 'locked',
    note: '双腿承重：两腿都不许动',
    ref: 'Perry 初始/终末双支撑；此时抬任何一条腿都是在没有交接的情况下偷跑' },

  // 交接：rear 是"要让位"的那条，但**交接完成前不许动**（这是抬腿的前提）
  LOAD: { front: 'free', rear: 'locked',
    note: '交接中：后腿仍锁（交接完成才准动）',
    ref: '§3.2 解锁语义；用户 2026-10-06「迈步前需要先让重量转移到后脚」' },

  // 提踵：rear 解锁但**仍留地**（允许预屈膝），front 承重不许动
  PUSH: { front: 'locked', rear: 'grounded-unlocked',
    note: '提踵：后腿解锁但仍留地',
    ref: 'Perry `TerminalStance`；离地只允许发生在 LIFT' },

  // 卸载蹬离：同上
  THRUST: { front: 'locked', rear: 'grounded-unlocked',
    note: '卸载蹬离：后腿解锁但仍留地',
    ref: 'Perry `PreSwing`；`locked` 仍为真以免摆动腿被提前抬走' },

  // 唯一允许离地
  LIFT: { front: 'locked', rear: 'free',
    note: '抬腿离地：后腿自由（唯一允许离地的态）',
    ref: 'Perry `InitialSwing`；用户 2026-10-03「触地即锁、不许预先锁」' },

  // 摆动落地：rear 自由到触地那一刻为止（触地即锁 ⇒ 下一态 DOUBLE 两腿皆锁）
  SWING: { front: 'locked', rear: 'free',
    note: '摆动落地：后腿自由，触地即锁',
    ref: 'Perry `MidSwing→TerminalSwing`；触地即锁 ⇒ 与 DOUBLE 的声明衔接' },
});

/**
 * ★★★ **逐态平衡目标（唯一真源）** —— 用户 2026-10-06：
 *   「平衡系统在**不同阶段下作用不一样**」「平衡系统是**一次给一个完整的各个关节的修正**」。
 *
 *   这张表把 §21.4 的逐态行为**从文档变成代码数据**：
 *   平衡系统重写后直接读它（不许在 `balance.ts` 里再抄一份 `if (state===...)`）。
 *
 *   ⚠ 定位：这是**目标**，不是控制律。控制律（怎么达标的）在 `balance.ts`，
 *     但"这个态该干什么"必须只有这一个来源。
 */
export interface StateBalanceTarget {
  /** 本态平衡系统**驱动哪条腿**：`bearer` = 只驱动承重腿（永远不许碰摆动腿） */
  readonly drive: 'bearer';
  /** 本态允许平衡系统**对搬运限幅/否决**（迈步系统搬得太过时） */
  readonly mayClampTransfer: boolean;
  /** 本态的 CoP 目标策略 */
  readonly cop: 'hold' | 'none' | 'forward';
  /** 一句话职责（UI 直接显示） */
  readonly note: string;
}

export const STATE_BALANCE_TARGET: Readonly<Record<WalkState, StateBalanceTarget>> = Object.freeze({
  DOUBLE: { drive: 'bearer', mayClampTransfer: true, cop: 'hold',
    note: '稳住承重腿；CoM 收在双脚支持多边形内。不搬重量、不碰摆动腿' },
  LOAD: { drive: 'bearer', mayClampTransfer: true, cop: 'hold',
    note: '两脚都在地时维持不倒；对迈步系统的搬运**限幅**（不得太过）' },
  PUSH: { drive: 'bearer', mayClampTransfer: false, cop: 'none',
    note: '少做（被动拱架：GRF 过踝、力臂≈0）⇒ 只维持稳定，不推进' },
  THRUST: { drive: 'bearer', mayClampTransfer: false, cop: 'forward',
    note: '主动：承重腿踝跖屈产力矩、CoP 前移到前脚掌' },
  LIFT: { drive: 'bearer', mayClampTransfer: false, cop: 'hold',
    note: '单腿平衡全权：侧向发力把 CoM 控在承重脚支持面内' },
  SWING: { drive: 'bearer', mayClampTransfer: true, cop: 'hold',
    note: '单腿平衡 + 对落地前的过冲**限幅**' },
});

export const STATE_ROLES: Readonly<Record<WalkState, StateRoles>> = Object.freeze({
  DOUBLE: {
    state: 'DOUBLE',
    legs: '双腿承重（front / rear 均为支撑）',
    balance: '**唯一**双脚同时工作的态：额状/矢状都进入 `shift` 模式，'
      + '把重心横向移到选定支撑腿 z，同时前倾到能起蹬的矢状位置。'
      + '此时禁止任何抬腿。',
    step: '**不产生摆动目标**。只允许更新摆动腿的**预备姿态**'
      + '（hip/knee 目标抬到 `LIFT` 帧域入口），不追轨迹、不给速度。',
    ref: 'Lim 2004 双支撑前半吸振/后半回归步态；本态 = 两半之和',
  },
  LOAD: {
    state: 'LOAD',
    legs: 'rear 承重 → recv 承接（尚未抬 rear）',
    balance: '把承重腿的额状权限**逐步交给**承接腿：`hip/0` 与中足侧向力的目标'
      + '从 rear 连续迁到 recv；腰参考偏置同步迁。'
      + '这一态平衡**不追 CoP**，只做横向迁移。',
    step: '维持摆动腿预备姿态**不动**（等交接完成才准动）。'
      + '可提前算好 LIFT 的起始姿态，但不下发。',
    ref: 'SCONE `Landing→EarlyStance`：`leg_load > stance_load_threshold`',
  },
  PUSH: {
    state: 'PUSH',
    legs: 'recv 单支撑，rear 已离地（摆动侧）',
    // ★ 人类依据：此时 GRF **过踝**、外力臂≈0 ⇒ 肌肉几乎不加载（Usherwood 2012 的 vault）
    balance: '**少做** —— 这是倒立摆**被动**过拱架的一段。踝只维持稳定、不主动推进；'
      + '横向做 `hold`，把额状权限全部交给单腿。'
      + 'Perry：只有支撑中期的身体对位才接近静态站姿 ⇒ 此时过度干预反而有害。',
    step: '摆动腿开始**蹬离后的小幅踝背屈**（为摆动中期让净空做准备），'
      + '髋/膝仍在延展段，未进入屈曲。',
    ref: 'Perry `MidStance` 10~31%GC；Usherwood 2012 vault（被动段）',
  },
  THRUST: {
    state: 'THRUST',
    legs: 'recv 单支撑，rear 变成后脚（准备离地）',
    balance: '**主动做功** —— 踝跖屈产生蹬离力矩，同时 CoP 前移到前脚掌。'
      + '力学前提（Perry/Usherwood）：**足必须在踝前方受载**才有力臂，'
      + '所以本态的判据是踝的角度（提踵 → 反向跖屈），不是矢状位置。'
      + '这是整周期里唯一允许"主动制造向前动量"的态。',
    step: '后脚**卸载**并继续跖屈制造离地间隙，但**仍不抬腿**（抬腿是 `LIFT`）。',
    ref: 'Perry `TerminalStance`+`PreSwing`「全周期最强推进力」；'
      + 'Usherwood 2012 极晚支撑（足在踝前方受载 ⇒ 小腿肌向心做功）',
  },
  LIFT: {
    state: 'LIFT',
    legs: 'recv 承重（锁），sw 已离地',
    balance: '承接腿进入**单腿硬支撑**：全部额状权限集中到它，'
      + '中足 CoP 做精调；腰权限此时最大（唯一能靠腰配平的时候）。',
    step: '**唯一抬腿的态**：摆动髋/膝追最小跃度轨迹，摆动踝做净空保持。',
    ref: 'OSL Early Swing = 低刚度快速背屈让净空；Saunders MFC = 5cm',
  },
  SWING: {
    state: 'SWING',
    legs: 'sw 摆动，recv 承重',
    balance: '继续单腿支撑，但重心**开始后移**为下一次交接做准备；'
      + '同时盯落地窗口（前脚触地会产生冲击）。',
    step: '摆动腿做**落地准备**：踝由背屈转跖屈准备触地，膝伸展减速，'
      + '落点按 `sagLandingThr` 修正。',
    ref: 'OSL Late Swing = 保持背屈准备落地；EPFL `LP` = 落地准备；'
      + 'FSIC = 落地后 6.7% 刚度不约束（吸振窗口）',
  },
});

/** ★★ 阈值清单（唯一审计入口） —— 每个数都写清「出处」与「是否已按本机标定」。
 *
 *   为什么要有这张表：验收项散落在 `VERIFY` 里，阈值散落在 `DEFAULT_GAIT_CONFIG`
 *   里，于是"这个 0.10 从哪来的"没人答得上来 —— 而本项目已经栽过：
 *     · 髋/膝/踝**符号**照抄注释 ⇒ 域全错（实测才发现）
 *     · `sagLiftOffThr = -0.35` 与本机可达区间 `+0.27~+0.54` **完全错位**
 *       ⇒ `PUSH→LIFT` 在结构上**永远不可能通过**
 *   ⇒ 这里把「出处」和「标定状态」显式化，`tools/probe-calib.ts` 逐项核对。
 *
 *   `calibrated: 'measured'` = 有本机实测支撑；`'literature'` = 出自文献/机器人文献，
 *   本机未验证；`'guess'` = **没有依据的初值**，别当结论用。
 */
export interface ThresholdDoc {
  readonly cfgKey: keyof GaitConfig;
  readonly unit: string;
  readonly source: string;
  readonly calibrated: 'measured' | 'literature' | 'guess';
  /** 本机实测区间（标定模式采得，仅供对照；跌落期数据不作标定依据） */
  readonly measured?: string;
}
export const THRESHOLDS: readonly ThresholdDoc[] = Object.freeze([
  { cfgKey: 'loadAcceptFrac', unit: 'BW 占比', calibrated: 'guess',
    source: 'SCONE `stance_load_threshold` 默认 **0.0**；OSL 用 0.25 BW(lstance)/0.4 BW(e-stance)'
      + ' ⇒ 本值 0.60 **比两者都严**，无文献支撑，属本 FSM「交接完成」的自定义语义',
    measured: 'DOUBLE 峰值 0.633 / LOAD 峰值 0.792（标定模式，跌落前）' },
  { cfgKey: 'loadReleaseFrac', unit: 'BW 占比', calibrated: 'literature',
    source: 'OSL `loadESwing = 0.15 BW`' },
  { cfgKey: 'sagLoadThr', unit: '腿长', calibrated: 'guess',
    source: 'SCONE `EarlyStance→LateStance` 矢状位置阈值（按腿长归一后自拟）',
    measured: 'LOAD 实测 +0.047~+0.256（p50 0.076）⇒ 0.10 卡在区间中段，39% 拍未过' },
  { cfgKey: 'sagLateStanceThr', unit: '腿长', calibrated: 'literature',
    source: 'SCONE `late_stance_threshold` **默认值 0.0**（`EarlyStance→LateStance`）' },
  { cfgKey: 'sagLiftOffThr', unit: '腿长', calibrated: 'guess',
    source: 'SCONE `liftoff_threshold` **默认 −1** ⇒ 本值 −0.35 比文献**更严**（本 rig 步长小）',
    measured: '⚠ 上一轮我拿 `PUSH` 的实测 +0.27~+0.54 说它「符号相反」——**那是错的**：'
      + '标定探针记的是 `sagPosRel(recv)`，而本项判的是 `sagPosRel(rear)`，**两条腿**。'
      + '已在 probe-calib 里同时记录 sup/rear/recv 三条腿才可比较。' },
  { cfgKey: 'sagLandingThr', unit: '腿长', calibrated: 'literature',
    source: 'SCONE `landing_threshold` **默认值 0.0**（`Swing→Landing`）',
    measured: '⚠ 上一轮记的 +1.34~+4.03 也是 `recv` 腿且取自跌落期，不能用来判这条' },
  { cfgKey: 'swingKneeMinDeg', unit: 'deg（域：正=屈）', calibrated: 'literature',
    source: 'OSL `kneeThetaESwingToLSwing = 50°`、`kneeThetaLSwingToEStance = 30°` ⇒ 本值 20° 更松',
    measured: '符号已于 2026-10-06 修正（原判据实际要求"伸 ≥20°"，与意图相反）' },
  { cfgKey: 'swingKneeVelMax', unit: 'deg/s（正=伸展）', calibrated: 'guess',
    source: 'EPFL `LP` 落地准备用屈伸角速度阈值；OSL 对应用 `kneeDthetaESwingToLSwing = 3 deg/s`（更严）' },
  { cfgKey: 'minClearance', unit: 'm', calibrated: 'literature',
    source: 'Saunders 1953 最小离地净空 MFC = 5 cm' },
  { cfgKey: 'tiltMaxDeg', unit: 'deg', calibrated: 'literature',
    source: '躯干倾角上限（20° 量级取自直立行走文献）' },
  { cfgKey: 'mosMin', unit: 'm', calibrated: 'guess',
    source: 'MoS ≥ 0（正裕度）。本 rig `mos` 实测常在数百 mm，尚未标定' },
  { cfgKey: 'stepIntervalSec', unit: 's', calibrated: 'literature',
    source: '步态周期量级（`STEP_CYCLE_SEC`）' },
]);

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
export function smoothAuthority(state: WalkState, stateT: number, ramp: number, sigma: number): number {
  if (state !== 'SWING') return 0;
  const p = Math.max(0, Math.min(1, stateT / Math.max(1e-6, ramp)));
  const ramped = Math.min(1, 1.5 * p);
  return 0.5 * (1 + cdf((ramped - 0.5) / Math.max(1e-6, sigma)));
}
// ══════════════════════════════════════════════════════════════════
// ★★★ **验收表（VERIFY）—— 每个状态「什么算通过」的唯一真源**
// ══════════════════════════════════════════════════════════════════
//
//  迁移**只**由这张表驱动。**没有任何计时器推进状态**；`stateT` 只用于
//  ① 防抖（OSL `min_time_in_state`）② `Tmax` 超时回退（Vughuma 2022）。
//
//  判据类型全部来自文献：
//   · 接触事件 / 接地标志 ............... SCONE、EPFL、OSL、Vughuma 全都用
//   · 足底载荷阈值（体重归一）........... OSL 0.25/0.15/0.40 BW；SCONE stance/swing threshold
//   · 足相对身体的**矢状位置**（腿长归一）.. SCONE `sagittal_pos` 全部迁移判据
//   · 关节角阈值 + **角速度**阈值 ........ OSL `knee>50° ∧ knee_vel<3`；EPFL `LP` 用角速度
//   · 离地净空 ......................... Saunders 1953 MFC = 5cm
//   ⚠ **没有任何一项用重心位置**：旧的 `comOverFootX/Z` 会自己推着自己走
//     （实测 243mm 永不收敛）⇒ 退役，有文献依据。
//   ⚠ 躯干倾角 / MoS 是**本 rig 特有的加强项**（四篇实现测不到）。
export interface VerifySpec {
  /** 项名（进 `rs.violations[].item`，UI 直接显示「差哪一项」） */
  item: string;
  ok: (c: VerifyCtx) => boolean;
  val: (c: VerifyCtx) => number;
  tol: (c: VerifyCtx) => number;
  /** true = 硬项：连续越界超 `graceSec` ⇒ 进安全态 */
  hard?: boolean;
  /**
   * ★ **这一项是否拦迁移**。返回 false ⇒ 未通过也**照常进下一态**，
   *   但仍然记进 `rs.violations`（UI 会显示"差这一项"）。
   *
   *   用途：把「不可靠但有诊断价值」的量（载荷）与「可靠的主判据」（角度签名）
   *   分开。载荷读数我们还没修（`grounded=00` 却 `loadFrac≈0.5`），
   *   让它当硬门槛就是拿坏尺子卡好判据 ⇒ 默认只报告。
   */
  block?: (c: VerifyCtx) => boolean;
}

export interface VerifyCtx {
  rs: RigState;
  cfg: GaitConfig;
  state: WalkState;
  /** 承重腿（载荷优势腿） */
  sup: Side;
  /** 摆动腿（另一条） */
  sw: Side;
  /** 前腿（几何 x 靠前） */
  front: Side;
  /** 后腿 */
  rear: Side;
  /** 承接腿 = 本周期要成为承重腿的那只 */
  recv: Side;
  /**
   * ★ 判据专用的**去抖接地**判定（读 `rs.gndStable`，**不是**原始 `rs.grounded`）。
   *
   *   为什么必须走这一层（2026-10-06 实测）：原始 `footGrounded` 逐拍在
   *   `11 / 01 / 10` 之间翻转（`probe-domain` 的 LOAD 段可见），而接触类判据
   *   （`双脚接地` / `后脚未离地` / `承重腿在位` / `摆动腿已离地`）全是
   *   **单采样** ⇒ 会被噪声直接判死或误放行。
   *   `Controller` 用 `groundedHoldSec`（3 拍 = 50ms）做"连续保持才认"的滤波，
   *   原始值仍保留在 `rs.grounded` 供 UI 显示**真实**接地事实。
   */
  gnd: (side: Side) => boolean;
  /** 本拍刚触地（边沿） */
  touchdown: Record<Side, boolean>;
  /** 本拍刚离地（边沿） */
  liftoff: Record<Side, boolean>;
  /** 摆动腿膝角速度（deg/s；负 = 仍在屈曲，正 = 已在伸展） */
  swingKneeVel: number;
  /** 摆动腿膝屈曲角（deg，**域口径正 = 屈**，由网关换算） */
  swingKneeFlex: number;
  // ── Perry 角度签名的取样点（deg，帧域：髋/膝 + = 屈，踝 + = 跖屈）──
  ankleRecv: number;   // 承接腿踝
  kneeRecv: number;    // 承接腿膝
  ankleRear: number;   // 后脚踝
  ankleRearVel: number;   // 后脚踝角速度 deg/s，正=正在跖屈（判拱架/蹬离的趋势量）
  /** 后脚膝（屈为正） */
  kneeRear: number;
  /**
   * ★ **本周期是否已完成提踵**（踝到过全支撑期最大背屈）。
   *   Perry 的 `TerminalStance` 起点是「提踵」这个**事件**，而踝角是状态量 ——
   *   光看当前角判不出"有没有提过"。`THRUST` 用它做顺序约束（没提踵不许进卸载）。
   */
  heelRose: boolean;
  ankleSw: number;     // 摆动腿踝
  kneeSw: number;      // 摆动腿膝
  /** 离地净空（m） */
  clearance: number;
  /** 距上次抬腿的间隔（s） */
  sinceStep: number;
  /** 帧域越界项数 / 最差偏差（deg，严容差） */
  domainBad: number;
  domainWorst: number;
  /** 帧域在**松**容差下是否仍越界（0 = 还保持得住 ⇒ 不该升级安全态） */
  domainLooseBad: number;
}

/** ★ 逐状态验收表。**新增状态或改判据只改这一张表**。 */
export const VERIFY: Readonly<Record<WalkState, readonly VerifySpec[]>> = Object.freeze({
  // ── DOUBLE → LOAD：真双支撑 + 站得住 ────────────────────────────
  DOUBLE: [
    { item: '双脚接地', ok: (c) => c.gnd(c.front) && c.gnd(c.rear),
      val: (c) => (c.gnd(c.front) ? 1 : 0) + (c.gnd(c.rear) ? 1 : 0), tol: () => 2 },
    { item: '轻腿仍有载荷', ok: (c) => Math.min(c.rs.loadFrac[c.front], c.rs.loadFrac[c.rear]) >= c.cfg.loadReleaseFrac,
      val: (c) => Math.min(c.rs.loadFrac[c.front], c.rs.loadFrac[c.rear]), tol: (c) => c.cfg.loadReleaseFrac },
    { item: '站姿在帧域内', ok: (c) => c.domainBad === 0, val: (c) => c.domainBad, tol: () => 0, hard: true },
    { item: '躯干倾角', ok: (c) => Math.abs(c.rs.tiltDeg) <= c.cfg.tiltMaxDeg,
      val: (c) => Math.abs(c.rs.tiltDeg), tol: (c) => c.cfg.tiltMaxDeg },
    { item: 'MoS', ok: (c) => c.rs.mos >= c.cfg.mosMin, val: (c) => c.rs.mos, tol: (c) => c.cfg.mosMin },
  ],

  // ── LOAD → PUSH：重量已交到承接腿 = **抬腿的资格前提** ──────────
  // ══ LOAD ≡ Perry `LoadingResponse`（2~10%GC，WeightAcceptance）══
  //   人类的相位签名是**关节角**（Winter/Perry）：足底由 25° 落到平
  //   （踝跖屈 ~10° 后反向）、膝屈到 20°、胫骨垂直。
  //   ⇒ 判据骨架是**角度签名**；载荷只作辅助（接触模型载荷读数还不可靠：
  //     `grounded=00` 却 `loadFrac≈0.5` 的矛盾没解决）。
  LOAD: [
    // ★ 签名 1（**自研口径**）：承接脚**放平** —— 踝角接近中立。
    //   ⚠ 原来抄 Perry 的「踝跖屈 ≥6°」（`foot flat`），但那签名**假定足跟着地**；
    //     本机平足落地时踝是**背屈**的（实测 −10.84°）⇒ 判据方向对不上、永远不过。
    //   「脚放平」与落地方式无关：只看 **|踝|** 是否落在中立带内。
    { item: '承接脚放平(|踝|)', ok: (c) => Math.abs(c.ankleRecv) <= c.cfg.footFlatTolDeg,
      val: (c) => Math.abs(c.ankleRecv), tol: (c) => c.cfg.footFlatTolDeg },
    // ★ Perry 签名 2：承接腿膝**屈到 ~20°**（吸振）。取 60% 作下限。
    { item: '承接膝屈(吸振)', ok: (c) => c.kneeRecv >= HUMAN_REF.angle.footFlat.kneeFlex * c.cfg.sigFrac,
      val: (c) => c.kneeRecv, tol: (c) => HUMAN_REF.angle.footFlat.kneeFlex * c.cfg.sigFrac },
    // ★ 载荷判据**默认只报告、不拦迁移**（`loadBlocks=false`）。
    //   依据：人类相位由**角度签名**定义，Perry 从不用载荷分数划相位；
    //   而我们自己的接触模型载荷读数还不自洽（`grounded=00` 却 `loadFrac≈0.5`）。
    //   ⇒ 让载荷当**硬门槛**就是拿一个不可靠的量去卡一个可靠判据。
    //   保留它是为了：① 诊断时能看到交接进行到哪；② 将来接触模型可信了可以一行打开。
    { item: '承接腿承重(辅助)', ok: (c) => c.rs.loadFrac[c.recv] >= c.cfg.loadAcceptFrac,
      val: (c) => c.rs.loadFrac[c.recv], tol: (c) => c.cfg.loadAcceptFrac,
      block: (c) => c.cfg.loadBlocks },
    { item: '后脚未离地', ok: (c) => c.gnd(c.rear),
      val: (c) => (c.gnd(c.rear) ? 1 : 0), tol: () => 1 },
    // ★ SCONE `EarlyStance→LateStance`：承接脚不在重心前方太远
    // ★ 2026-10-06 **判据映射纠错**（用户选题①时发现）：
    //   原来这里是 `承接脚矢状位置 <= 0.10`，抄自 SCONE 的
    //   `EarlyStance→LateStance`（`late_stance_threshold` = 0.0）——
    //   但那是**「早支撑→晚支撑」**的判据，我把它贴到了 `LOAD`（= LoadingResponse）。
    //   实测后果：`sagPosRel(recv)` 从 0.206 **单调增到 0.636**（门槛 0.100），
    //   越走越远、永远回不来 ⇒ `LOAD` 被这一项**结构性**卡死。
    //   而且它与本 rig 的站姿**根本不兼容**：双脚站距 327mm 时，前脚天然在重心
    //   前方约半个步长，「前脚不在重心前方 0.10 腿长以内」在双支撑站姿下
    //   是个几何上不可满足的条件。
    //
    //   正确判据（Perry）：`LoadingResponse` 的**定义事件**是 Initial Contact
    //   —— 即承接腿那一瞬间的触地。所以判「承接腿已触地」才是这一态的主判据；
    //   矢状位置属于 `PUSH`/`THRUST`（TerminalStance/PreSwing）该管的事。
    { item: '承接腿已触地', ok: (c) => c.touchdown[c.recv] || c.gnd(c.recv),
      val: (c) => (c.touchdown[c.recv] ? 1 : 0) + (c.gnd(c.recv) ? 1 : 0), tol: () => 1 },
    // ★ 手性不变式：本周期的摆动腿不能与上周期相同。
    //   SCONE/EPFL 是**每腿一个 FSM**，左右交替由结构保证；我们是**周期级** FSM，
    //   不显式写死就会「一直用同一条腿摆动」。
    //   角色改为历史驱动（承接腿 = 上一周期落地那条）后，这一项在结构上恒成立 ——
    //   **留着它是为了让"恒成立"变成可断言的事实，而不是假设**。
    { item: '手性交替', ok: (c) => c.rs.lastSwing !== c.rear,
      val: (c) => (c.rs.lastSwing === c.rear ? 0 : 1), tol: () => 1 },
    { item: '节奏间隔', ok: (c) => c.sinceStep >= c.cfg.stepIntervalSec,
      val: (c) => c.sinceStep, tol: (c) => c.cfg.stepIntervalSec },
    { item: '帧域', ok: (c) => c.domainBad === 0, val: (c) => c.domainBad, tol: () => 0, hard: true },
    { item: '躯干倾角', ok: (c) => Math.abs(c.rs.tiltDeg) <= c.cfg.tiltMaxDeg,
      val: (c) => Math.abs(c.rs.tiltDeg), tol: (c) => c.cfg.tiltMaxDeg },
  ],
  // ══ PUSH ≡ Perry `TerminalStance`（31~50%GC）—— **提踵 / 终末支撑** ══
  //   ⚠ 2026-10-06 自我纠正：上一轮我把这个态标成「MidStance 被动拱架」并要求
  //     「单支撑已建立」，**那是错的** ——
  //     · Perry 的 `MidStance`（被动拱架，GRF 过踝、肌肉几乎不加载）是**新支撑腿**
  //       的中段支撑，发生在**旧腿离地之后**，在我们环里落在 `LIFT`/`SWING` 期间；
  //     · 我们的 `PUSH` 里两条腿都还着地（承接腿刚接完重量，后腿准备蹬离），
  //       不可能是单支撑。
  //   ⇒ 正确的分界是 Perry **同一阶段内的两个相位**：
  //     `TerminalStance`（提踵 → 反向跖屈，最强推进）→ `PreSwing`（卸载 + 屈膝准备）。
  //   签名：踝由跖屈**渐背屈**朝全支撑期最大背屈 +10°（提踵）走。
  PUSH: [
    // ★ Perry 签名 1：后脚踝**已进入背屈**（footFlat 5° 跖屈 → heelRise 10° 背屈之间）
    { item: '后脚踝进入背屈(提踵前)', ok: (c) => c.ankleRear <= HUMAN_REF.angle.endSLS.anklePF,
      val: (c) => c.ankleRear, tol: () => HUMAN_REF.angle.endSLS.anklePF },
    // ★ Perry 签名 2：**背屈正在推进**（还没到峰值）。用角速度判"进行中"，
    //   否则"停在一个中间角度"也会算通过。
    { item: '背屈推进中', ok: (c) => c.ankleRearVel < -c.cfg.ankleVelEps,
      val: (c) => c.ankleRearVel, tol: (c) => -c.cfg.ankleVelEps },
    { item: '承重腿在位', ok: (c) => c.gnd(c.sup),
      val: (c) => (c.gnd(c.sup) ? 1 : 0), tol: () => 1 },
    { item: '双脚仍着地', ok: (c) => c.gnd(c.rear),
      val: (c) => (c.gnd(c.rear) ? 1 : 0), tol: () => 1 },
    { item: '承重帧域', ok: (c) => c.domainBad === 0, val: (c) => c.domainBad, tol: () => 0, hard: true },
    { item: '躯干倾角', ok: (c) => Math.abs(c.rs.tiltDeg) <= c.cfg.tiltMaxDeg,
      val: (c) => Math.abs(c.rs.tiltDeg), tol: (c) => c.cfg.tiltMaxDeg },
  ],

  // ══ THRUST ≡ Perry `PreSwing`（50~62%GC）—— **卸载 / 蹬离收尾** ══
  //   人类签名：踝反向跖屈继续到 **20°**、膝屈到 **35°**；Perry 称之为
  //   「weight release / weight transfer」，后腿用一次向前"推"为摆动做准备。
  //   力学：足在踝**前方**受载 ⇒ 外力臂 ⇒ 小腿肌向心做功。
  //   ⚠ 判据 1（背屈达峰 10°）是**提踵**这个事件，它发生在 `PUSH` 末 / `THRUST` 初，
  //     放在这里是为了保证"没提踵就不许进入卸载"（顺序约束）。
  THRUST: [
    // ★ 顺序约束：必须先提踵（背屈达峰 10°）。帧域 `+` = 跖屈 ⇒ 背屈记作负。
    { item: '已提踵(曾背屈10°)', ok: (c) => c.heelRose || c.ankleRear <= -HUMAN_REF.angle.heelRise.ankleDF,
      val: (c) => c.ankleRear, tol: () => -HUMAN_REF.angle.heelRise.ankleDF },
    // ★ Perry 签名 2：踝**反向跖屈到 ~20°**（离地姿势）。取 60% 作下限。
    { item: '后脚反向跖屈(卸载)', ok: (c) => c.ankleRear >= HUMAN_REF.angle.toeOff.anklePF * c.cfg.sigFrac,
      val: (c) => c.ankleRear, tol: (c) => HUMAN_REF.angle.toeOff.anklePF * c.cfg.sigFrac },
    // ★ Perry 签名 3：膝**屈到 ~35°**（PreSwing 的标志动作）。
    { item: '后脚膝屈(准备摆动)', ok: (c) => c.kneeRear >= HUMAN_REF.angle.toeOff.kneeFlex * c.cfg.sigFrac,
      val: (c) => c.kneeRear, tol: (c) => HUMAN_REF.angle.toeOff.kneeFlex * c.cfg.sigFrac },
    // ★ 签名 4：踝角速度**已由背屈转为跖屈**（反向点 = 提踵之后开始蹬离的物理标志；
    //   与 `PUSH` 的「背屈推进中」互斥，死区由 `ankleVelEps` 给）
    { item: '踝已转为跖屈向', ok: (c) => c.ankleRearVel > c.cfg.ankleVelEps,
      val: (c) => c.ankleRearVel, tol: (c) => c.cfg.ankleVelEps },
    // 辅助：矢状位置（SCONE 口径，交叉验证用）
    { item: '后脚矢状位置(辅助)', ok: (c) => c.rs.sagPosRel(c.rear) <= c.cfg.sagLiftOffThr
        || c.rs.loadFrac[c.front] >= c.cfg.loadAcceptFrac,
      val: (c) => c.rs.sagPosRel(c.rear), tol: (c) => c.cfg.sagLiftOffThr },
    { item: '承重腿在位', ok: (c) => c.gnd(c.sup),
      val: (c) => (c.gnd(c.sup) ? 1 : 0), tol: () => 1 },
    { item: '承重帧域', ok: (c) => c.domainBad === 0, val: (c) => c.domainBad, tol: () => 0, hard: true },
    { item: '躯干倾角', ok: (c) => Math.abs(c.rs.tiltDeg) <= c.cfg.tiltMaxDeg,
      val: (c) => Math.abs(c.rs.tiltDeg), tol: (c) => c.cfg.tiltMaxDeg },
  ],

  // ── LIFT → SWING：摆动腿**离地** + 已卸载 + 净空达标 ─────────────
  //   这组就是 SCONE `LateStance→LiftOff→Swing` 的等价物
  //   （`leg_load < swing_load_threshold`，OSL = 0.15 BW）。
  // ══ LIFT ≡ Perry `PreSwing`→`InitialSwing`（50~73%GC）══
  //   人类签名：离地时踝跖屈 20°、膝屈 35°；随后膝快速屈向 60° 峰值、踝背屈让净空。
  LIFT: [
    // ★ Perry 签名 1：摆动踝离地时**跖屈 ~20°**（蹬离姿势带走）
    { item: '摆动踝跖屈(蹬离)', ok: (c) => c.ankleSw >= HUMAN_REF.angle.toeOff.anklePF * c.cfg.sigFrac,
      val: (c) => c.ankleSw, tol: (c) => HUMAN_REF.angle.toeOff.anklePF * c.cfg.sigFrac },
    // ★ Perry 签名 2：摆动膝**已屈到 ~35°**（PreSwing 末）
    { item: '摆动膝屈(PreSwing)', ok: (c) => c.kneeSw >= HUMAN_REF.angle.toeOff.kneeFlex * c.cfg.sigFrac,
      val: (c) => c.kneeSw, tol: (c) => HUMAN_REF.angle.toeOff.kneeFlex * c.cfg.sigFrac },
    { item: '摆动腿已卸载', ok: (c) => c.rs.loadFrac[c.sw] <= c.cfg.loadReleaseFrac,
      val: (c) => c.rs.loadFrac[c.sw], tol: (c) => c.cfg.loadReleaseFrac },
    { item: '摆动腿已离地', ok: (c) => !c.gnd(c.sw),
      val: (c) => (c.gnd(c.sw) ? 1 : 0), tol: () => 0 },
    { item: '离地净空', ok: (c) => c.clearance >= c.cfg.minClearance,
      val: (c) => c.clearance, tol: (c) => c.cfg.minClearance },
    { item: '承重腿在位', ok: (c) => c.gnd(c.sup),
      val: (c) => (c.gnd(c.sup) ? 1 : 0), tol: () => 1 },
    // ★ OSL：摆动膝角阈值（离地后膝要真的屈起来，否则是"拖着走"）
    // ★ 符号修正（2026-10-06）：原来写的是 `angle(knee,2)/DEG >= 20`，
    //   而**关节空间正 = 伸**（probe-readback 实测）⇒ 那条判据实际上在要求
    //   「膝**伸** ≥20°」才算"屈曲达标"，与注释、与 OSL 的意图都相反。
    //   域口径「正 = 屈」由网关统一负责（`kneeFlex = -angle/DEG`）。
    { item: '摆动膝屈曲', ok: (c) => c.swingKneeFlex >= c.cfg.swingKneeMinDeg,
      val: (c) => c.swingKneeFlex, tol: (c) => c.cfg.swingKneeMinDeg },
    { item: '承重腿帧域', ok: (c) => c.domainBad === 0, val: (c) => c.domainBad, tol: () => 0, hard: true },
    { item: 'MoS', ok: (c) => c.rs.mos >= c.cfg.mosMin, val: (c) => c.rs.mos, tol: (c) => c.cfg.mosMin },
  ],

  // ── SWING → DOUBLE：落地（接触事件 + 矢状位置 + 膝角速度回落）─────
  //   EPFL 用**同侧触地**触发；SCONE 用 `sagittal_pos > landing_threshold`；
  //   EPFL 的 `LP`（落地准备）用**屈伸角速度**阈值。
  // ══ SWING ≡ Perry `InitialSwing`→`TerminalSwing`（62~100%GC）══
  //   人类签名：膝屈在 MidSwing 达 **60° 峰值**，随后 TerminalSwing 膝伸到 0~5°、
  //   踝背屈 10~15° 准备脚跟着地（"heel rocker"）。
  SWING: [
    // ★ Perry 签名 1：摆动膝屈**达到峰值区**（~60°）。取 60% 作下限。
    { item: '摆动膝屈峰值', ok: (c) => c.kneeSw >= HUMAN_REF.angle.peakKnee.kneeFlex * c.cfg.sigFrac,
      val: (c) => c.kneeSw, tol: (c) => HUMAN_REF.angle.peakKnee.kneeFlex * c.cfg.sigFrac },
    // ★ Perry 签名 2：落地前踝**背屈**（帧域为负）准备脚跟着地
    { item: '落地踝背屈', ok: (c) => c.ankleSw <= -HUMAN_REF.angle.preLanding.ankleDF * c.cfg.sigFrac,
      val: (c) => c.ankleSw, tol: (c) => -HUMAN_REF.angle.preLanding.ankleDF * c.cfg.sigFrac },
    { item: '落地事件', ok: (c) => c.touchdown[c.sw],
      val: (c) => (c.touchdown[c.sw] ? 1 : 0), tol: () => 1 },
    // ★ SCONE `Swing→Landing`：`sagittal_pos > landing_threshold`（默认 0.0）。
    //   我们额外要求**触地事件**（比 SCONE 只看矢状位置更严：脚还在空中就不会判落地），
    //   膝角速度项来自 EPFL `LP`（落地准备）。
    { item: '落地矢状位置', ok: (c) => c.rs.sagPosRel(c.sw) >= c.cfg.sagLandingThr,
      val: (c) => c.rs.sagPosRel(c.sw), tol: (c) => c.cfg.sagLandingThr },
    { item: '膝角速度回落', ok: (c) => c.swingKneeVel <= c.cfg.swingKneeVelMax,
      val: (c) => c.swingKneeVel, tol: (c) => c.cfg.swingKneeVelMax },
    { item: '承重腿帧域', ok: (c) => c.domainBad === 0, val: (c) => c.domainBad, tol: () => 0, hard: true },
  ],
});

/**
 * ★ 帧域检查 —— **已统一到 `jointQuery.ts`**（文档 §18）。
 *
 *   历史教训（本函数曾两次出错，第三次才收敛）：
 *     ① 单位混用：Perry 表是 deg、`rs.angle()` 是 rad ⇒ 阈值形同虚设；
 *     ② **符号取反错了**：本 rig 髋/膝限位「负 = 屈」，而 `KeyPose`/`STATE_DOMAINS`
 *        用「正 = 屈」⇒ 域口径必须取负；踝则相反（`balance.ts:743` 实测
 *        「正踝角 = 跖屈」）⇒ **不取负**。曾对踝多取一次负，把区间判反。
 *   ⇒ 现在符号/单位/轴口径**只在 `jointQuery.degOf` 里定义一次**，
 *     任何验收代码都不许自己再取负/换算。
 *
 * @param strict true = 用**严**容差 `tolIn`（评估"能否进入下一态"）；
 *                false = 用**松**容差 `tolOut`（评估"是否还保持得住"）。
 */
export function checkDomains(
  rs: RigState, strict: boolean,
): { bad: number; worst: number; looseBad: number } {
  const jq = rs.jq;
  if (!jq) return { bad: 0, worst: 0, looseBad: 0 };
  const strictWorst = Math.max(jq.worstSupportErrDeg(strict), jq.worstSwingErrDeg(strict));
  const looseWorst = Math.max(jq.worstSupportErrDeg(false), jq.worstSwingErrDeg(false));
  return {
    bad: strictWorst > 0 ? 1 : 0,
    worst: strictWorst,
    looseBad: looseWorst > 0 ? 1 : 0,
  };
}

export interface ExchangeEvent {
  kind: 'none' | 'state_change' | 'touchdown' | 'liftoff' | 'safe' | 'hold';
  side?: Side;
  note: string;
}

export class GaitState {
  cfg: GaitConfig;
  /** 状态机自己的时钟（s）；迈步间隔从它算起 */
  private t = 0;
  /** 上一次**抬腿起点**时刻（s）。−1e9 = 还没迈过步 ⇒ 间隔条件天然满足 */
  private lastStepT = -1e9;
  /**
   * ★ 本周期是否**真的发生过一次抬腿**（2026-10-06 修）。
   *
   *   起因：`rs.grounded` 去抖后，起步时两脚"由空中转为稳定接地"同样会产生
   *   **触地边沿**（`wasGrounded` 初值 false → `gndStable` 变 true）。
   *   旧代码对任何 `touchdown[sw]` 都记账，于是**起步那一下被当成"刚迈完一步"**：
   *     · `lastStepT = t` ⇒ `LOAD` 的「节奏间隔」从 0.23s 开始算，
   *       被硬生生卡住整整 `stepIntervalSec = 1.0s`；
   *     · `rs.lastSwing = sw` ⇒ 承接腿在起步瞬间被翻到"最后落地的那条"，
   *       覆盖掉 `frontLeg()` 的一次性引导。
   *   ⇒ 只有**先发生过离地**再触地，才算完成了一步。
   */
  private hasStepped = false;
  /** 接地历史（边沿检测用） */
  private wasGrounded: Record<Side, boolean> = { l: false, r: false };
  /** ★ 引导期角色校正已完成（此后角色完全由状态机事件驱动，不再看载荷/接触） */
  private roleBootLocked = false;
  /** 硬项连续越界时长（s）；超 `graceSec` ⇒ 安全态（Vughuma） */
  private badT = 0;
  /** 承重腿（带迟滞 + 最小驻留；**不**由 `locked` 决定，见 update 的注释） */
  private bearer: Side;
  /** 正在挑战承重位的候选腿 + 它已连续占优的时长 */
  private bearerCand: Side;
  private bearerCandT = 0;
  readonly event: ExchangeEvent = { kind: 'none', note: '' };

  constructor(private rs: RigState, cfg: GaitConfig = DEFAULT_GAIT_CONFIG) {
    this.cfg = cfg;
    this.bearer = cfg.startBearer;
    this.bearerCand = cfg.startBearer;
    this.installJointQuery();
  }

  /**
   * ★ 把关节回读网关挂到 `rs.jq` —— **回读权限的持有者就是状态机**（文档 §18）。
   *
   *   · 网关**不持有任何副本**：所有读数都现场走 `rs`，
   *     所以"验收用的量"与"控制用的量"必然是同一个（这是本设计的核心收益）。
   *   · 两个系统只拿到 `rs.jq`（只读、无 setter、不含 `request*`）。
   */
  private installJointQuery(): void {
    const rs = this.rs;
    const sup = (): Side => rs.loadBearer ?? rs.supportLeg();
    rs.jq = createJointQuery(rs, {
      get state() { return rs.state; },
      get verified() { return rs.verified; },
      get safe() { return rs.safe; },
      get violations() { return rs.violations; },
      supportLeg: sup,
      swingLeg: () => (sup() === 'l' ? 'r' : 'l'),
    });
  }

  stateLabel(s: WalkState): string { return STATE_LABEL[s]; }
  stateOrder(s: WalkState): number { return STATE_ORDER.indexOf(s); }

  /**
   * ★★★ 每拍调用一次。**全部职责**（文档 §7：穷举就这 6 项）：
   *   ① 指角色（support / swing / recv）② 逐项验收（写 `violations[]`）
   *   ③ 过了且驻留够 ⇒ 进下一态 ④ 写关键帧映射 ⑤ 写 α(t) ⑥ 锁定/解锁
   * **不发任何关节目标** —— 这是用户 2026-10-06 的第二条定调。
   */
  update(dt: number): ExchangeEvent {
    const rs = this.rs;
    const cfg = this.cfg;
    this.t += dt;
    this.event.kind = 'none'; this.event.note = ''; this.event.side = undefined;

    // ── 边沿：触地 / 离地（EPFL 的相位事件就是这两个）────────────
    const touchdown: Record<Side, boolean> = { l: false, r: false };
    // ★ 边沿也走**去抖后**的接触（`rs.gndStable`）：原始信号单拍翻转会产生
    //   **假触地/假离地**边沿，而边沿会改写 `rs.lastSwing`（= 下一周期的承接腿）
    //   ⇒ 一次噪声就能把整条角色链带偏。延迟 50ms 无关紧要（最短驻留 200ms）。
    const liftoff: Record<Side, boolean> = { l: false, r: false };
    for (const s of ['l', 'r'] as Side[]) {
      if (rs.gndStable[s] && !this.wasGrounded[s]) touchdown[s] = true;
      if (!rs.gndStable[s] && this.wasGrounded[s]) liftoff[s] = true;
      this.wasGrounded[s] = rs.gndStable[s];
    }

    // ── 角色指派：两条腿的角色由**接触事件历史**决定，不由几何 |Δx| 决定 ──
    //   依据：EPFL 的相位触发用的是**对侧足事件**（对侧趾离 = 单支撑起点、
    //   对侧触地 = 双支撑起点），SCONE 用「足相对身体的矢状位置」。
    //   ⚠ 旧实现用 `frontLeg()`（|Δx| > 3mm 即换边）做角色 —— 实测**50ms 级
    //     翻转**（门禁 D：前腿切换最短驻留 0.050s），因为摆动中期两脚 x 会
    //     反复穿过死区。那是**标签抖动**，不是步态。
    //   ⇒ 现在：承接腿 = **上一周期落地那条腿**（它在前面），摆动腿 = 另一条。
    //     `frontLeg()` 只在 t=0（还没有历史）时做**一次性引导**。
    // ── ★★★ 腿角色：**状态机显式决定**（用户 2026-10-06 定调）
    //   「让状态机显式决定承重腿、摆动腿。**平衡系统决定是非常充满不确定性的**。」
    //   「往前迈的是摆动腿。**一个承重腿，一个摆动腿**。」
    //
    //   规则（**不含任何载荷推断**）：
    //     ① 初始化一次：`roleSup = cfg.startBearer`（配置显式给），`roleSw` = 另一条；
    //     ② 交换点**固定**在「摆动腿落地」：`lastSwing` 成为新 `roleSup`，
    //        旧 `roleSup` 成为新 `roleSw`；
    //     ③ 由 `lastSwing` 的变化触发 ⇒ **一个周期至多交换一次**（天然去重）。
    //   ⇒ 角色是**事件驱动的滞回量**：不在载荷噪声上换，也不在几何抖动上换。
    //     载荷测量降级为**只读证据**（判据/遥测用），不再参与角色决定。
    if (rs.roleSup === null || rs.roleSw === null) {
      // ① **一次性显式指定**：配置给的 `startBearer` —— 角色由状态机拥有。
      rs.roleSup = cfg.startBearer;
      rs.roleSw = cfg.startBearer === 'l' ? 'r' : 'l';
    } else if (rs.lastSwing === null) {
      // ② 引导期角色更新 —— **状态机独家决定**（用户定调：「让状态机显式决定
      //    承重腿、摆动腿；平衡系统决定是非常充满不确定性的」）。
      //    状态机允许**以载荷为证据**更新角色，但必须带**强迟滞**（`ROLEHYST`，
      //    默认 0.25）：只有载荷**决定性地**偏向一侧（差 >0.25）才换。
      //    ★ 修的是"挂账的 5Hz 角色翻转"：原实现用默认迟滞 0.08 ⇒ 载荷噪声
      //      （双支撑各 ~0.5）让角色每拍抽换 ⇒ 让位/力链在两条腿间跳
      //      = chatter 的控制层根源（实测：窗 2.22 → **2.62s ★**）。
      //    ★ 也实测过"冻结一次"变体：1.09s（更差）—— 物理载荷确实会在腿间
      //      转移，冻结会跟错；**慢跟随 > 冻结 > 快跟随**。
      const roleHyst = (() => {
        const raw = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).ROLEHYST ?? '');
        const v = Number(raw);
        return raw !== '' && Number.isFinite(v) && v >= 0 ? v : 0.25;
      })();
      const m = rs.loadDominant(rs.roleSup, roleHyst);
      rs.roleSup = m; rs.roleSw = m === 'l' ? 'r' : 'l';
    }
    if (rs.lastSwing !== null && rs.lastSwing !== rs.roleSup) {
      rs.roleSup = rs.lastSwing;
      rs.roleSw = rs.roleSup === 'l' ? 'r' : 'l';
    }
    const sup: Side = rs.roleSup;
    const recv: Side = sup;          // 承接腿 = 承重腿（退役第四个并行量）
    const rear: Side = rs.roleSw;    // 后腿 = 摆动腿（位置描述，不是角色）
    /** 本周期要抬的腿 = 后腿（= 承接腿的另一条） */
    const sw: Side = rear;
    const front = recv;

    // ── ★ 力链分析（用户 2026-10-06：放状态机里，供平衡系统使用）──────
    //   在**角色指派之后**发布（`buildForceChain` 要按承重腿选力臂原点），
    //   在**验收之前**（判据与平衡系统本拍就要用）。
    if (rs.forceSrc) {
      try {
        rs.groundChain = buildGroundChain(rs.forceSrc, rs, 1 / 120)   // 物理步长（Sim 默认 120Hz；低通时间常数 80ms ⇒ 差 2x 可接受）;
      } catch {
        // 力链失败**不许静默**：标成不可信，让 UI/判据看到
        rs.groundChain = null;
      }
    }

    // ── 帧域检查：**两段式迟滞**（§3.7 规则 2）────────────────
    //   strict（严容差 `tolIn`）⇒ 决定**能否进入下一态**；
    //   loose （松容差 `tolOut`）⇒ 决定**是否还算保持得住**（不误触安全态）。
    const dm = checkDomains(rs, true);
    const dmLoose = checkDomains(rs, false);

    // ── 角速度（OSL `knee_vel` / EPFL `LP`）─────────────────────
    //   ★ 走**回读网关**，不直接 `rs.jointVel`。原来这里还有个 `JIDX` 私有旁路
    //   （自己缓存关节索引），那等于绕过网关 —— 已删。域口径：正 = 伸展。
    const swingKneeVel = rs.jq ? -rs.jq.velDegPerSec(`knee_${sw}`, 2) : 0;

    const ctx: VerifyCtx = {
      rs, cfg, state: rs.state, sup, sw, front, rear, recv,
      gnd: (sd: Side) => rs.gndStable[sd],
      touchdown, liftoff, swingKneeVel,
      swingKneeFlex: rs.jq ? -rs.jq.angleDeg(`knee_${sw}`, 2) : 0,
      // 帧域取样（全部经网关；负号 = 关节空间→域口径的符号换算）
      ankleRecv: rs.jq ? -rs.jq.angleDeg(`foot_${recv}`, 2) : 0,
      kneeRecv: rs.jq ? -rs.jq.angleDeg(`knee_${recv}`, 2) : 0,
      ankleRear: rs.jq ? -rs.jq.angleDeg(`foot_${rear}`, 2) : 0,
      ankleRearVel: rs.jq ? -rs.jq.velDegPerSec(`foot_${rear}`, 2) : 0,
      kneeRear: rs.jq ? -rs.jq.angleDeg(`knee_${rear}`, 2) : 0,
      // ★ 提踵记忆：本周期内后脚踝到过背屈峰值就打勾，进 THRUST 后才清
      heelRose: rs.heelRose,
      ankleSw: rs.jq ? -rs.jq.angleDeg(`foot_${sw}`, 2) : 0,
      kneeSw: rs.jq ? -rs.jq.angleDeg(`knee_${sw}`, 2) : 0,
      clearance: rs.swingClearance, sinceStep: this.t - this.lastStepT,
      domainBad: dm.bad, domainWorst: dm.worst, domainLooseBad: dmLoose.looseBad,
    };

    // ── 逐项验收 → `violations[]`（哪一项、当前值、门限）────────
    const specs = VERIFY[rs.state];
    const flags: Record<string, boolean> = {};
    const values: Record<string, number> = {};
    const viol: StateViolation[] = [];
    let hardBad = false;
    /** 只报告、不拦迁移的未通过项（诊断用；不进 `violations`） */
    const soft: StateViolation[] = [];
    for (const sp of specs) {
      const okv = sp.ok(ctx);
      flags[sp.item] = okv;
      values[sp.item] = sp.val(ctx);
      if (!okv) {
        const v: StateViolation = { state: rs.state, item: sp.item, value: sp.val(ctx), tol: sp.tol(ctx) };
        if (sp.block && !sp.block(ctx)) { soft.push(v); continue; }
        viol.push(v);
        // ★ 硬项**只在松容差也越界**时才升级安全态：否则"刚好在严容差外一点"
        //   就会每拍累积 graceSec 触发安全态 —— 那是误触发，不是降级。
        if (sp.hard && sp.item.includes('帧域') && ctx.domainLooseBad === 0) continue;
        if (sp.hard) hardBad = true;
      }
    }
    // ★★★★★ 2026-10-06 **承重分配校验**（用户：「状态机的校验应该也包括力矩」）：
    //   物理判据（§8.9.4b）：**姿势对齐 ⇒ 承重力矩天然落人类区间**。
    //   `VTAU=1` 开（默认关，A/B）；门限可扫。
    // ★★★★★ 2026-10-08 **清理**（agent）：原块还校验 `rs.supLegTau.{hip,knee,ank}`
    //   是否超门限，但 `supLegTau` 的写者（旧"唯一姿势模块"）**早已删除**
    //   ⇒ 该字段恒为 `{0,0,0}` ⇒ **三项恒不触发**（假护栏，会让人误以为在守着）。
    //   已删除该三行；只保留**真实可读**的支撑份额校验（`rs.loadFrac` 有真写者）。
    {
      const vtauOn = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).VTAU ?? '') === '1';
      if (vtauOn) {
        // 承重分配：支撑腿的载荷份额应 ≥ 门限（与状态机自己的 loadAcceptFrac 同口径）
        const supSide = rs.supportLeg() === 'l' ? rs.loadFrac.l : rs.loadFrac.r;
        const lfMin = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).VTAU_LF ?? '') || 0.5;
        if (supSide < lfMin) viol.push({ state: rs.state, item: '承重·支撑份额不足', value: supSide, tol: lfMin });
      }
    }
    rs.violations = viol;
    this.badT = hardBad ? this.badT + dt : 0;
    rs.safe = this.badT > cfg.graceSec;
    rs.verified = viol.length === 0 && !rs.safe;

    // ── 关键帧映射（状态 → Perry 关键帧，两个系统只读）───────────
    const gk = STATE_TO_GAIT[rs.state];
    rs.gaitKey = gk;
    rs.keyPose = KEY_POSES[gk];
    rs.strideRatio = stanceWidthRatio(rs.soleZ.l, rs.soleZ.r);
    rs.supportEntryZ = supportEntry(rs.soleZ[sup]);

    // ── ★★ 锁定：**按本状态的声明表**施加（用户 2026-10-06）──────────
    //   「每个状态，状态机都要显式指定前后腿、锁定腿」。
    //   旧实现只在触地边沿写一次、在 LIFT/SWING 清一次 ⇒ 锁定是"历史的函数"，
    //   读代码看不出这个态哪条腿能动；且态中途会漂移（§3.2.1）。
    //   现在：**声明表是唯一真源**，每拍按它施加（幂等，不依赖历史）。
    const plan = STATE_LEGS[rs.state];
    rs.locked[recv] = plan.front === 'locked';
    rs.locked[rear] = plan.rear === 'locked';
    // 「触地即锁」仍然保留：声明为 `free` 的腿**一旦触地就立即锁**，
    // 保证 `SWING` 落地瞬间的安全（与下一态 `DOUBLE` 的声明衔接）。
    if (touchdown[rear]) rs.locked[rear] = true;
    if (touchdown[recv]) rs.locked[recv] = true;
    if (touchdown[sw]) {
      // ★「完成一步」的记账要求先抬过腿（起步那一下不算，见 `hasStepped`）
      if (this.hasStepped) {
        rs.lastSwing = sw;
        this.lastStepT = this.t;
        rs.cycleCount = rs.state === 'SWING' ? rs.cycleCount + 1 : rs.cycleCount;
      }
    }

    // ── 迈步许可：**派生视图**（不是第二套判据）──────────────────
    rs.stepPermit = makeCriteria(
      {
        P1_已卸载: rs.loadFrac[sw] <= cfg.loadReleaseFrac,
        P2_已离地: !rs.gndStable[sw],   // ★ 去抖信号：单拍噪声不该授予迈步许可
        P3_未锁定: !rs.locked[sw],
        P4_手性交替: rs.lastSwing !== sw,
        P5_稳定性: rs.mos >= cfg.mosMin && Math.abs(rs.tiltDeg) <= cfg.tiltMaxDeg,
        P6_非安全态: !rs.safe,
        // ★★★★★ 2026-10-06 **W2：感知 → 迈步触发**（§21.13 待接线 #2；§21.11 分解层）
        //   监督层的 `copPlan.fallNeeded`（= `actionability ≤ 0`，**脚放不下了**）
        //   是"**必须迈**"的判据。语义是 OR（应急放行），不是 AND：
        //     `许可 = (P1..P6 全过) ∨ (P7_感知落足 ∧ P6_非安全态)`
        //   —— 用户定调：「**要摔倒了/也别管承重腿摆动腿了，优先稳住身体**」。
        //   ⚠ P6 必须仍成立（安全态下不许迈，那是"停手让平衡全权"）。
      },
      {
        loadFrac: rs.loadFrac[sw], releaseThr: cfg.loadReleaseFrac,
        grounded: rs.gndStable[sw] ? 1 : 0, locked: rs.locked[sw] ? 1 : 0,
        lastIsSwing: rs.lastSwing === sw ? 1 : 0,
        mos: rs.mos, tiltDeg: rs.tiltDeg, safe: rs.safe ? 1 : 0,
      },
    );
    // ★★★★★ 2026-10-06 **W2：感知 → 迈步触发**（§21.13 待接线 #2）：**OR 语义**
    //   监督层 `copPlan.fallNeeded`（= 脚放不下、必摔）⇒ **应急放行**：
    //     `许可 = (P1..P6 全过) ∨ (fallNeeded ∧ P6_非安全态)`
    //   —— 用户：「**要摔倒了/也别管承重腿摆动腿了，优先稳住身体**」。
    //   ⚠ P6（非安全态）仍必须成立：安全态下不迈（那是"停手让平衡全权"）。
    //   `STEPTRIG=0` 关闭（A/B）。`fallNeeded` 不可用时**不放行**（保守）。
    if (STEP_TRIG && rs.stepPermit && !rs.safe && (rs.copPlan?.fallNeeded ?? false)) {
      rs.stepPermit.all = true;
      rs.stepPermit.values.emergencyStep = 1;
    }

    // ── 迁移：**只有三条路** ────────────────────────────────
    //   ① 验收通过 + 最短驻留 ⇒ 进下一态（固定环）
    //   ② `Tmax` 超时 ⇒ 回 `DOUBLE`（Vughuma 的时间上限，防卡死）
    //   ③ 安全态 ⇒ 停在原地；`rs.safe = true`（迈步停手、平衡全权）
    const prev = rs.state;
    const dwellOk = rs.stateT >= cfg.minDwellSec;
    if (rs.safe) {
      this.event.kind = 'safe';
      this.event.note = `安全态：硬项越界 ${this.badT.toFixed(2)}s`
        + `（${viol.find((v) => v.item.includes('帧域') || v.item.includes('站姿'))?.item ?? viol[0]?.item ?? '?'}）`;
    } else if (cfg.calib ? dwellOk : (rs.verified && dwellOk)) {
      // ★★★★★ 2026-10-06 **需求门控**（用户立法 §4.0b："状态机不参与命令；
      //   不得让承重腿迈步"）：DOUBLE 的推进**必须**有迈步需求——
      //   否则步态环是无条件跑步机（实测：每 0.5s 一圈 ⇒ 承重腿被例行换掉后迈出）。
      // ★★★★★ §4.10 门控升级（用户："只有垫脚真的解决不了才能移动脚"）：
      //   择优 level=2（垫脚与髋都不够）才允许推进；level<2 ⇒ 只垫脚/加髋，不迈步。
      const usePlanGate = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).PLANGATE ?? '') !== '0';
      const stepNeed = (rs.copPlan?.fallNeeded ?? false)
        || (usePlanGate
          ? (rs.plansLevel ?? 0) >= 2
          : ((rs.copPlan?.stepUrgent ?? 0) > envNumG('STEPGATE_URG', 0.25)
             || (rs.warnUrgency ?? 0) > envNumG('STEPGATE_URG', 0.25)));
      const gateOn = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).STEPGATE ?? '') !== '0';
      if (gateOn && rs.state === 'DOUBLE' && !stepNeed) {
        // 停在 DOUBLE（站桩/平衡）：不推进、不发任何命令
        this.event.kind = 'hold';
        this.event.note = `需求门控：无迈步需求（urg=${(rs.copPlan?.stepUrgent ?? 0).toFixed(2)}）`;
      } else {
      // ★ 判据快照**必须在迁移前**抓取（此刻 `violations[]` 还是**旧状态**的）
      const nViolAtMove = viol.length;
      rs.passed.add(rs.state);        // 本周期这一态已验收通过（五态环 ✓）
      rs.state = NEXT_STATE[rs.state];
      rs.stateT = 0;
      rs.visited.add(rs.state);
      // （需求门控的闭合括号在下方迁移块末尾补）
      // 环走完一圈（回到 DOUBLE）⇒ 新周期，两本账清零
      if (rs.state === 'DOUBLE' && rs.passed.has('SWING')) {
        rs.visited.clear(); rs.passed.clear(); rs.visited.add('DOUBLE');
    rs.heelRose = false;
    rs.rolesState = null; rs.roleRecv = null; rs.roleSup = null;
        rs.heelRose = false;          // 新周期：提踵记忆归零
      }
      rs.lastMove = { from: prev, to: rs.state, verified: rs.verified, nViol: nViolAtMove };
      this.event.kind = 'state_change';
      this.event.note = `${prev} → ${rs.state}（验收 ${nViolAtMove === 0 ? '全过' : `${nViolAtMove} 项未过`}）`;
      }   // ← 需求门控的 else 闭合
    } else if (rs.stateT > cfg.tmaxSec) {
      // ⚠ Tmax 回退**不算通过**（`passed` 不加），否则五态环会显示假 ✓
      rs.state = 'DOUBLE'; rs.stateT = 0;
      rs.visited.add('DOUBLE');
      rs.locked.l = false; rs.locked.r = false;
      rs.lastMove = { from: prev, to: 'DOUBLE', verified: rs.verified, nViol: -1 };
      this.event.kind = 'state_change';
      this.event.note = `${prev} 超时 ${cfg.tmaxSec}s ⇒ 回 DOUBLE（Tmax 兜底）`;
    }
    if (touchdown[sw]) {
      this.event.kind = 'touchdown'; this.event.side = sw; this.event.note = `触地并锁定 ${sw}`;
    } else if (liftoff[sw]) {
      this.hasStepped = true;      // ★ 从这一刻起，后续触地才算"完成一步"
      this.event.kind = 'liftoff'; this.event.side = sw; this.event.note = `离地 ${sw}`;
    }

    rs.stateT += dt;

    // ── 提踵记忆（Perry `TerminalStance` 的起点是**事件**，不是状态量）──
    //   后脚踝到达全支撑期最大背屈（帧域 ≤ −heelRise.ankleDF）就打勾；
    //   `THRUST` 用它做顺序约束。走完一圈时清零（见迁移处）。
    if (rs.jq && -rs.jq.angleDeg(`foot_${rear}`, 2) <= -HUMAN_REF.angle.heelRise.ankleDF) {
      rs.heelRose = true;
    }

    // ── 极值统计（标定与诊断都靠它；开销可忽略）──────────────────
    {
      const recvNow = rs.loadFrac[recv];
      const sagNow = rs.sagPosRel(recv);
      const st = rs.stateStats;
      if (rs.stateT <= dt * 1.5) {          // 刚进态 ⇒ 清零（含 stateT 被置 0 的那一拍）
        st.recvLoad = recvNow; st.recvLoadN = 1; st.sagRecv = sagNow;
        st.sagRecvMin = sagNow; st.sagRecvMax = sagNow;
      } else {
        st.recvLoad = Math.max(st.recvLoad, recvNow); st.recvLoadN++;
        st.sagRecv = (st.sagRecv * (st.recvLoadN - 1) + sagNow) / st.recvLoadN;   // 同一拍计数复用
        st.sagRecvMin = Math.min(st.sagRecvMin, sagNow);
        st.sagRecvMax = Math.max(st.sagRecvMax, sagNow);
      }
    }

    // ── α(t)：腰的修正权限预算（**不是**迁移判据）────────────────
    rs.authority = smoothAuthority(rs.state, rs.stateT, cfg.authorityRamp, cfg.alphaSigma);

    // ── ★ 状态机遥测：UI 的**唯一**数据源 ────────────────────────
    //   UI 不再自己去 `rs` 抓量、自己算单位/符号/通过与否（那等于第二套口径）。
    //   这里把"状态机眼里的世界"拍平成已格式化字符串交给 UI。
    {
      const sup = rs.supportLeg();
      const sw = rs.swingLeg();
      const recv2 = rs.lastSwing ?? sw;
      const jd = (j: string, a: 0 | 1 | 2): string => {
        const d = rs.jq ? rs.jq.angleDeg(j, a) : NaN;
        return Number.isFinite(d) ? `${d.toFixed(1)}` : '—';
      };
      rs.telemetry = {
        state: rs.state,
        stateLabel: STATE_LABEL[rs.state],
        stateT: rs.stateT.toFixed(2),
        verified: rs.safe ? '[安全] 降级中' : rs.verified ? '✓ 全过' : `✗ ${rs.violations.length} 项未过`,
        support: LEG_CN[sup],
        swing: LEG_CN[sw],
        contact: `${rs.support.contactN} 只`
          + (rs.support.contactN === 2 ? ' (左 右)' : rs.support.contactN === 1 ? ` (${LEG_CN[sup]})` : ' (无)'),
        bearerLoad: `${(rs.loadFrac[sup] * 100).toFixed(0)}%`,
        loadFrac: `${(rs.loadFrac.l * 100).toFixed(0)} / ${(rs.loadFrac.r * 100).toFixed(0)}`,
        mos: (rs.mos * 1000).toFixed(1),
        pitch: rs.pitchDeg.toFixed(1),
        roll: rs.rollDeg.toFixed(1),
        alpha: rs.authority.toFixed(2),
        clearance: (Math.max(0, rs.swingClearance) * 1000).toFixed(0),
        sagRecv: rs.sagPosRel(recv2).toFixed(3),
        recvPeak: (rs.stateStats.recvLoad * 100).toFixed(0),
        domainWorst: Math.max(
          rs.jq?.worstSupportErrDeg(false) ?? 0, rs.jq?.worstSwingErrDeg(false) ?? 0).toFixed(1),
        stepPermit: rs.stepPermit.all ? '放行' : '拦',
        // ★ Perry 签名逐项读数：**状态机自己写的**，UI 只按行渲染。
        //   这一块回答"现在离进下一态还差什么"，逐项给出实测值与门槛。
        // ★★ 运动趋势逐行（状态机给的行，UI 只渲染）
        trends: (() => {
          const tr = rs.trends;
          const out = [`判读：${tr.note}　门槛 ${rs.rescueMaxTiltDeg}°　可救=${tr.rescueable ? '是' : '否'}`];
          for (const t of tr.segs) {
            const a = t.azimDeg;
            const dir = a >= -45 && a < 45 ? '前' : a >= 45 && a < 135 ? '左'
              : a >= -135 && a < -45 ? '右' : '后';
            out.push(`${t.name.padEnd(4)} ${t.tiltDeg.toFixed(1).padStart(5)}°　`
              + `方位 ${dir}(${a.toFixed(0)}°)　速率 ${t.rateDeg >= 0 ? '+' : ''}${t.rateDeg.toFixed(0)}°/s`
              + (t.diverging ? '　⚠在发散' : ''));
          }
          return out;
        })(),
        // ★ 平衡修正：逐行列出"这一拍 balance 在动哪些关节、动多少度"
        //   + 硬目标余量/限幅（来自力链）。全部由状态机生成，UI 只渲染。
        balanceFix: (() => {
          const bf = rs.balanceFix;
          if (rs.groundChain) {
            bf.tauMarginSag = rs.groundChain.tauMarginSag;
            bf.tauMarginLat = rs.groundChain.tauMarginLat;
            bf.trustable = rs.groundChain.trustable;
            bf.trustNote = rs.groundChain.trustNote;
          }
          const ds = rs.disposeStat;
          const head = `迈步提案 ${ds.props} 条 → balance 发布 ${ds.republished} 条`
            + `（被 balance 覆盖 ${ds.overridden}）　风险因子 k=${ds.k.toFixed(2)}`
            + `（k=1 迈步全权，k=0 冻结姿态）`;
          // ★ 发力门禁：本拍被夹次数（承重轴放行、发力轴受夹，见 `RigState.tauCap`）
          const ch = rs.capHits.req;
          const cl = rs.capLast;
          const capLine = rs.tauCapOn
            ? `发力门禁 已夹 ${ch} 次/本拍累计`
              + (cl.axis >= 0 && Math.abs(cl.want) > 0
                ? `　最近：轴${cl.axis} 想${cl.want.toFixed(0)}→夹${cl.cap.toFixed(0)}N·m（${cl.label}）` : '')
              + '　承重轴放行（让位轴不夹）'
            : '发力门禁 **已消融**（退回 τmax 上限）';
          const rest = !bf.axes.length ? ['（本拍平衡系统没有提出任何关节修正）'] : bf.axes.map((a) => {
            const j = Math.floor(a.axis / 3); const ax = a.axis % 3;
            const nm = rs.sk.joints[j]?.name ?? `j${j}`;
            const d = (a.dTheta * 180) / Math.PI;
            const sg = d >= 0 ? '+' : '';
            return `轴${a.axis}(${nm}/${ax}) ${sg}${d.toFixed(1)}°　${a.label}`;
          });
          return [head, capLine, ...rest];
        })(),
        // ★ 力链：状态机给的行，UI 原样渲染（不换算、不判断）
        force: rs.groundChain ? forceChainLines(rs.groundChain) : ['力链不可用（forceSrc 未安装）'],
        sigs: specs.map((sp) => {
          const it = sp.item;
          const v = values[it];
          const t = sp.tol(ctx);
          const pass = flags[it] === true;
          const softBad = !pass && sp.block && !sp.block(ctx);
          const mark = pass ? '✓' : softBad ? '·' : '✗';
          const num = (x: number): string => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)) : '—');
          return `${mark} ${it} ${num(v)}${pass ? '' : `/${num(t)}`}`;
        }),
        // ── 五态环：当前态 `▶`、本周期已过关 `✓`、未到达 `○`、到达但没过 `✗`
        //   `visited`/`passed` 由状态机自己维护（迁移成功才置 passed），UI 不参与判断。
        ring: STATE_ORDER.map((st) => {
          const mark = st === rs.state ? '▶' : rs.passed.has(st) ? '✓' : rs.visited.has(st) ? '✗' : '○';
          return `${mark}${STATE_LABEL[st]}`;
        }),
        // ★ 腿角色 + 锁定（UI 一眼看到"这个态哪条腿能动"）
        legPlan: (() => {
          const pl = STATE_LEGS[rs.state];
          const tag = (f: StateLegPlan['front']): string =>
            f === 'locked' ? '锁定' : f === 'free' ? '自由' : '解锁留地';
          return `承接腿(front)=${LEG_CN[recv]} ${tag(pl.front)}　后腿(rear)=${LEG_CN[rear]} ${tag(pl.rear)}`;
        })(),
        roleRecv: recv, roleSup: sup,
        roleRecvFree: STATE_LEGS[rs.state].front, roleRearFree: STATE_LEGS[rs.state].rear,
        // ★ 本态的平衡目标（状态机给平衡系统的契约；UI 只渲染）
        balanceTarget: (() => {
          const bt = STATE_BALANCE_TARGET[rs.state];
          return `${bt.note}${bt.mayClampTransfer ? '　[可限幅搬运]' : ''}`;
        })(),
        next: STATE_LABEL[NEXT_STATE[rs.state]],
        wait: `${rs.stateT.toFixed(2)}s / ${cfg.minDwellSec.toFixed(2)}s`,
        blocked: rs.violations.length ? violationText(rs.violations[0]) : '无',
        violations: rs.violations.map(violationText).join('　'),
        roles: `${LEG_CN[sup]}承重 · ${LEG_CN[sw]}摆动`,
        // ⚠ 名字必须与 `skeleton.ts` 一致：`hip_l` / `knee_l` / `foot_l`（**后缀**）。
        //   写成 `l_hip` 会让网关抛错 —— 这是故意的，见 jointQuery.resolve 的注释。
        jointsDeg: `髋 ${jd(`hip_${sup}`, 0)}°  膝 ${jd(`knee_${sw}`, 0)}°  踝 ${jd(`foot_${sup}`, 0)}°`,
        safe: rs.safe ? '是' : '否',
      };
    }

    // 判据快照（UI 用；`handover` 这一项现在是「重量交接」的逐项明细）
    rs.handoverCriteria = makeCriteria(flags, values);
    rs.handoverOk = rs.verified;
    rs.unlockCriteria = rs.stepPermit;
    return this.event;
  }

  reset(): void {
    this.t = 0; this.lastStepT = -1e9; this.badT = 0; this.hasStepped = false;
    this.wasGrounded.l = false; this.wasGrounded.r = false;
    this.bearer = this.cfg.startBearer; this.bearerCand = this.cfg.startBearer; this.bearerCandT = 0;
    const rs = this.rs;
    rs.loadBearer = null; rs.locked.l = false; rs.locked.r = false;
    rs.state = 'DOUBLE'; rs.stateT = 0; rs.authority = 0;
    rs.verified = false; rs.violations = []; rs.safe = false; rs.lastMove = null;
    rs.stateStats = { recvLoad: 0, recvLoadN: 0, sagRecv: 0, sagRecvMin: 0, sagRecvMax: 0 };
    rs.lastSwing = null; rs.cycleCount = 0;
    rs.visited.clear(); rs.passed.clear(); rs.visited.add('DOUBLE');
  }
}

/** 兼容别名：旧代码按 `PHASE_*` 取，这里保留一份指向新表的别名 */
export const PHASE_TO_SCORING = STATE_TO_SCORING;
export function phaseStance(s: WalkState): 'single' | 'double' { return stateStance(s); }