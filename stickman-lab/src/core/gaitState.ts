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
  loadAcceptFrac: 0.60,      // OSL 0.40 BW 量级；取 0.60 因为本 rig 双支撑各约 0.5
  loadReleaseFrac: 0.15,     // OSL `loadESwing = 0.15 BW`
  bearerLoadHyst: 0.08,      // 载荷量级迟滞（与旧实现同值，双支撑各约 0.5）
  bearerMinDwellSec: 0.12,   // 承重腿换边最小驻留（双阈值迟滞的另一半）
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
  DOUBLE: '双脚支撑', LOAD: '重量交接', PUSH: '蹬离', LIFT: '抬腿离地', SWING: '摆动落地',
};

/** 兼容别名（旧名，2026-10-06 改名；保留给旧日志/旧探针读） */
export const PHASE_LABEL = STATE_LABEL;

const LEG_CN: Record<Side, string> = { l: '左', r: '右' };

/** 越界项 → 人话（给 UI 用的**唯一**措辞表，避免 UI 自己拼字符串） */
function violationText(v: StateViolation): string {
  if (!Number.isFinite(v.value) || !Number.isFinite(v.tol)) return `${v.item} ${v.value}/${v.tol}`;
  return `${v.item} ${v.value.toFixed(3)}/${v.tol > 0 ? '' : '-'}${Math.abs(v.tol).toFixed(3)}`;
}

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
  /** 本拍刚触地（边沿） */
  touchdown: Record<Side, boolean>;
  /** 本拍刚离地（边沿） */
  liftoff: Record<Side, boolean>;
  /** 摆动腿膝角速度（deg/s；负 = 仍在屈曲，正 = 已在伸展） */
  swingKneeVel: number;
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

// 关节索引缓存（`RigState` 构造时绑定一次；避免每拍 `findIndex`）
const JIDX = { l: { hip: -1, knee: -1, foot: -1 }, r: { hip: -1, knee: -1, foot: -1 } };

/** ★ 逐状态验收表。**新增状态或改判据只改这一张表**。 */
export const VERIFY: Readonly<Record<WalkState, readonly VerifySpec[]>> = Object.freeze({
  // ── DOUBLE → LOAD：真双支撑 + 站得住 ────────────────────────────
  DOUBLE: [
    { item: '双脚接地', ok: (c) => c.rs.grounded[c.front] && c.rs.grounded[c.rear],
      val: (c) => (c.rs.grounded[c.front] ? 1 : 0) + (c.rs.grounded[c.rear] ? 1 : 0), tol: () => 2 },
    { item: '轻腿仍有载荷', ok: (c) => Math.min(c.rs.loadFrac[c.front], c.rs.loadFrac[c.rear]) >= c.cfg.loadReleaseFrac,
      val: (c) => Math.min(c.rs.loadFrac[c.front], c.rs.loadFrac[c.rear]), tol: (c) => c.cfg.loadReleaseFrac },
    { item: '站姿在帧域内', ok: (c) => c.domainBad === 0, val: (c) => c.domainBad, tol: () => 0, hard: true },
    { item: '躯干倾角', ok: (c) => Math.abs(c.rs.tiltDeg) <= c.cfg.tiltMaxDeg,
      val: (c) => Math.abs(c.rs.tiltDeg), tol: (c) => c.cfg.tiltMaxDeg },
    { item: 'MoS', ok: (c) => c.rs.mos >= c.cfg.mosMin, val: (c) => c.rs.mos, tol: (c) => c.cfg.mosMin },
  ],

  // ── LOAD → PUSH：重量已交到承接腿 = **抬腿的资格前提** ──────────
  LOAD: [
    { item: '承接腿承重', ok: (c) => c.rs.loadFrac[c.recv] >= c.cfg.loadAcceptFrac,
      val: (c) => c.rs.loadFrac[c.recv], tol: (c) => c.cfg.loadAcceptFrac },
    { item: '后脚未离地', ok: (c) => c.rs.grounded[c.rear],
      val: (c) => (c.rs.grounded[c.rear] ? 1 : 0), tol: () => 1 },
    // ★ SCONE `EarlyStance→LateStance`：承接脚不在重心前方太远
    { item: '承接脚矢状位置', ok: (c) => c.rs.sagPosRel(c.recv) <= c.cfg.sagLoadThr,
      val: (c) => c.rs.sagPosRel(c.recv), tol: (c) => c.cfg.sagLoadThr },
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

  // ── PUSH → LIFT：后脚已后移到可离地位置（SCONE `LateStance→LiftOff`）──
  PUSH: [
    { item: '后脚矢状位置', ok: (c) => c.rs.sagPosRel(c.rear) <= c.cfg.sagLiftOffThr,
      val: (c) => c.rs.sagPosRel(c.rear), tol: (c) => c.cfg.sagLiftOffThr },
    { item: '承重腿在位', ok: (c) => c.rs.grounded[c.sup],
      val: (c) => (c.rs.grounded[c.sup] ? 1 : 0), tol: () => 1 },
    { item: '承重帧域', ok: (c) => c.domainBad === 0, val: (c) => c.domainBad, tol: () => 0, hard: true },
    { item: '躯干倾角', ok: (c) => Math.abs(c.rs.tiltDeg) <= c.cfg.tiltMaxDeg,
      val: (c) => Math.abs(c.rs.tiltDeg), tol: (c) => c.cfg.tiltMaxDeg },
  ],

  // ── LIFT → SWING：摆动腿**离地** + 已卸载 + 净空达标 ─────────────
  //   这组就是 SCONE `LateStance→LiftOff→Swing` 的等价物
  //   （`leg_load < swing_load_threshold`，OSL = 0.15 BW）。
  LIFT: [
    { item: '摆动腿已卸载', ok: (c) => c.rs.loadFrac[c.sw] <= c.cfg.loadReleaseFrac,
      val: (c) => c.rs.loadFrac[c.sw], tol: (c) => c.cfg.loadReleaseFrac },
    { item: '摆动腿已离地', ok: (c) => !c.rs.grounded[c.sw],
      val: (c) => (c.rs.grounded[c.sw] ? 1 : 0), tol: () => 0 },
    { item: '离地净空', ok: (c) => c.clearance >= c.cfg.minClearance,
      val: (c) => c.clearance, tol: (c) => c.cfg.minClearance },
    { item: '承重腿在位', ok: (c) => c.rs.grounded[c.sup],
      val: (c) => (c.rs.grounded[c.sup] ? 1 : 0), tol: () => 1 },
    // ★ OSL：摆动膝角阈值（离地后膝要真的屈起来，否则是"拖着走"）
    { item: '摆动膝屈曲', ok: (c) => c.rs.angle(JIDX[c.sw].knee, 2) / DEG >= c.cfg.swingKneeMinDeg,
      val: (c) => c.rs.angle(JIDX[c.sw].knee, 2) / DEG, tol: (c) => c.cfg.swingKneeMinDeg },
    { item: '承重腿帧域', ok: (c) => c.domainBad === 0, val: (c) => c.domainBad, tol: () => 0, hard: true },
    { item: 'MoS', ok: (c) => c.rs.mos >= c.cfg.mosMin, val: (c) => c.rs.mos, tol: (c) => c.cfg.mosMin },
  ],

  // ── SWING → DOUBLE：落地（接触事件 + 矢状位置 + 膝角速度回落）─────
  //   EPFL 用**同侧触地**触发；SCONE 用 `sagittal_pos > landing_threshold`；
  //   EPFL 的 `LP`（落地准备）用**屈伸角速度**阈值。
  SWING: [
    { item: '落地事件', ok: (c) => c.touchdown[c.sw],
      val: (c) => (c.touchdown[c.sw] ? 1 : 0), tol: () => 1 },
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
  kind: 'none' | 'state_change' | 'touchdown' | 'liftoff' | 'safe';
  side?: Side;
  note: string;
}

export class GaitState {
  cfg: GaitConfig;
  /** 状态机自己的时钟（s）；迈步间隔从它算起 */
  private t = 0;
  /** 上一次**抬腿起点**时刻（s）。−1e9 = 还没迈过步 ⇒ 间隔条件天然满足 */
  private lastStepT = -1e9;
  /** 接地历史（边沿检测用） */
  private wasGrounded: Record<Side, boolean> = { l: false, r: false };
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
    const nm = (n: string): number => rs.sk.joints.findIndex((j) => j.name === n);
    JIDX.l = { hip: nm('hip_l'), knee: nm('knee_l'), foot: nm('foot_l') };
    JIDX.r = { hip: nm('hip_r'), knee: nm('knee_r'), foot: nm('foot_r') };
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
    const liftoff: Record<Side, boolean> = { l: false, r: false };
    for (const s of ['l', 'r'] as Side[]) {
      if (rs.grounded[s] && !this.wasGrounded[s]) touchdown[s] = true;
      if (!rs.grounded[s] && this.wasGrounded[s]) liftoff[s] = true;
      this.wasGrounded[s] = rs.grounded[s];
    }

    // ── 角色指派：两条腿的角色由**接触事件历史**决定，不由几何 |Δx| 决定 ──
    //   依据：EPFL 的相位触发用的是**对侧足事件**（对侧趾离 = 单支撑起点、
    //   对侧触地 = 双支撑起点），SCONE 用「足相对身体的矢状位置」。
    //   ⚠ 旧实现用 `frontLeg()`（|Δx| > 3mm 即换边）做角色 —— 实测**50ms 级
    //     翻转**（门禁 D：前腿切换最短驻留 0.050s），因为摆动中期两脚 x 会
    //     反复穿过死区。那是**标签抖动**，不是步态。
    //   ⇒ 现在：承接腿 = **上一周期落地那条腿**（它在前面），摆动腿 = 另一条。
    //     `frontLeg()` 只在 t=0（还没有历史）时做**一次性引导**。
    const recv: Side = rs.lastSwing ?? rs.frontLeg();
    const rear: Side = recv === 'l' ? 'r' : 'l';
    // 承重腿 = 载荷优势腿，但**带双阈值迟滞 + 最小驻留**（SCONE 的
    // stance/swing 一对阈值就是迟滞带）。不再"锁定优先"：四篇实现一致
    // 由**载荷**决定承重腿，锁承重腿是旧实现的错误（见文档 §3.5）。
    const dLoad = rs.loadFrac.l - rs.loadFrac.r;
    const cand: Side = Math.abs(dLoad) < cfg.bearerLoadHyst
      ? this.bearer : (dLoad > 0 ? 'l' : 'r');
    if (cand === this.bearer) { this.bearerCand = cand; this.bearerCandT = 0; }
    else if (cand === this.bearerCand) {
      this.bearerCandT += dt;
      if (this.bearerCandT >= cfg.bearerMinDwellSec) { this.bearer = cand; this.bearerCandT = 0; }
    } else { this.bearerCand = cand; this.bearerCandT = 0; }
    const sup = this.bearer;
    rs.loadBearer = sup;
    /** 本周期要抬的腿 = 后腿（= 承接腿的另一条） */
    const sw: Side = rear;
    const front = recv;

    // ── 帧域检查：**两段式迟滞**（§3.7 规则 2）────────────────
    //   strict（严容差 `tolIn`）⇒ 决定**能否进入下一态**；
    //   loose （松容差 `tolOut`）⇒ 决定**是否还算保持得住**（不误触安全态）。
    const dm = checkDomains(rs, true);
    const dmLoose = checkDomains(rs, false);

    // ── 角速度（OSL `knee_vel` / EPFL `LP`）─────────────────────
    const swingKneeVel = (rs.jointVel(JIDX[sw].knee, 2) ?? 0) * DEG;

    const ctx: VerifyCtx = {
      rs, cfg, state: rs.state, sup, sw, front, rear, recv,
      touchdown, liftoff, swingKneeVel,
      clearance: rs.swingClearance, sinceStep: this.t - this.lastStepT,
      domainBad: dm.bad, domainWorst: dm.worst, domainLooseBad: dmLoose.looseBad,
    };

    // ── 逐项验收 → `violations[]`（哪一项、当前值、门限）────────
    const specs = VERIFY[rs.state];
    const flags: Record<string, boolean> = {};
    const values: Record<string, number> = {};
    const viol: StateViolation[] = [];
    let hardBad = false;
    for (const sp of specs) {
      const okv = sp.ok(ctx);
      flags[sp.item] = okv;
      values[sp.item] = sp.val(ctx);
      if (!okv) {
        viol.push({ state: rs.state, item: sp.item, value: sp.val(ctx), tol: sp.tol(ctx) });
        // ★ 硬项**只在松容差也越界**时才升级安全态：否则"刚好在严容差外一点"
        //   就会每拍累积 graceSec 触发安全态 —— 那是误触发，不是降级。
        if (sp.hard && sp.item.includes('帧域') && ctx.domainLooseBad === 0) continue;
        if (sp.hard) hardBad = true;
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

    // ── 锁定：**触地即锁**（用户 2026-10-03），且**只锁摆动腿** ────
    //   ⚠ 旧实现在交接开始时锁**承重腿**（"锁前腿"），与四篇实现相反。
    if (touchdown[sw]) {
      rs.locked[sw] = true;
      rs.lastSwing = sw;
      this.lastStepT = this.t;
      rs.cycleCount = rs.state === 'SWING' ? rs.cycleCount + 1 : rs.cycleCount;
    }
    // 抬腿前解锁：摆动腿在 `LIFT`/`SWING` 必须不锁（否则 requestSwingLeg 会被否决）
    if (rs.state === 'LIFT' || rs.state === 'SWING') rs.locked[sw] = false;

    // ── 迈步许可：**派生视图**（不是第二套判据）──────────────────
    rs.stepPermit = makeCriteria(
      {
        P1_已卸载: rs.loadFrac[sw] <= cfg.loadReleaseFrac,
        P2_已离地: !rs.grounded[sw],
        P3_未锁定: !rs.locked[sw],
        P4_手性交替: rs.lastSwing !== sw,
        P5_稳定性: rs.mos >= cfg.mosMin && Math.abs(rs.tiltDeg) <= cfg.tiltMaxDeg,
        P6_非安全态: !rs.safe,
      },
      {
        loadFrac: rs.loadFrac[sw], releaseThr: cfg.loadReleaseFrac,
        grounded: rs.grounded[sw] ? 1 : 0, locked: rs.locked[sw] ? 1 : 0,
        lastIsSwing: rs.lastSwing === sw ? 1 : 0,
        mos: rs.mos, tiltDeg: rs.tiltDeg, safe: rs.safe ? 1 : 0,
      },
    );

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
      // ★ 判据快照**必须在迁移前**抓取（此刻 `violations[]` 还是**旧状态**的）
      const nViolAtMove = viol.length;
      rs.passed.add(rs.state);        // 本周期这一态已验收通过（五态环 ✓）
      rs.state = NEXT_STATE[rs.state];
      rs.stateT = 0;
      rs.visited.add(rs.state);
      // 环走完一圈（回到 DOUBLE）⇒ 新周期，两本账清零
      if (rs.state === 'DOUBLE' && rs.passed.has('SWING')) {
        rs.visited.clear(); rs.passed.clear(); rs.visited.add('DOUBLE');
      }
      rs.lastMove = { from: prev, to: rs.state, verified: rs.verified, nViol: nViolAtMove };
      this.event.kind = 'state_change';
      this.event.note = `${prev} → ${rs.state}（验收 ${nViolAtMove === 0 ? '全过' : `${nViolAtMove} 项未过`}）`;
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
      this.event.kind = 'liftoff'; this.event.side = sw; this.event.note = `离地 ${sw}`;
    }

    rs.stateT += dt;

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
        // ── 五态环：当前态 `▶`、本周期已过关 `✓`、未到达 `○`、到达但没过 `✗`
        //   `visited`/`passed` 由状态机自己维护（迁移成功才置 passed），UI 不参与判断。
        ring: STATE_ORDER.map((st) => {
          const mark = st === rs.state ? '▶' : rs.passed.has(st) ? '✓' : rs.visited.has(st) ? '✗' : '○';
          return `${mark}${STATE_LABEL[st]}`;
        }),
        next: STATE_LABEL[NEXT_STATE[rs.state]],
        wait: `${rs.stateT.toFixed(2)}s / ${cfg.minDwellSec.toFixed(2)}s`,
        blocked: rs.violations.length ? violationText(rs.violations[0]) : '无',
        violations: rs.violations.map(violationText).join('　'),
        roles: `${LEG_CN[sup]}承重 · ${LEG_CN[sw]}摆动`,
        jointsDeg: `髋 ${jd(`${sup}_hip`, 0)}°  膝 ${jd(`${sw}_knee`, 0)}°  踝 ${jd(`${sup}_ankle`, 0)}°`,
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
    this.t = 0; this.lastStepT = -1e9; this.badT = 0;
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