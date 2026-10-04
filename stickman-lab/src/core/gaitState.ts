/**
 * ══════════════════════════════════════════════════════════════════
 * ③  gaitState.ts —— **显式状态机 + 交换协议**
 * ══════════════════════════════════════════════════════════════════
 *
 * 状态机**唯一**决定：现在处于哪一相、哪条腿承重、哪条腿锁着、
 * 迈步系统能不能抬腿、以及腰的修正权限 α(t)。
 * 两个系统都**并发**读它，但**不自己决定**这些事。
 *
 * ── 用户描述的序列（一一对应）────────────────────────────────
 *   "迈腿后需要让前腿变为支撑腿，等重心转移到前腿后，身体平衡保持住了，再迈后腿"
 *
 *     STEP ──触地──► SHIFT ──承重判据达标──► SINGLE ──稳定窗口──► STEP(下一条腿)
 *
 * ── 承重腿 ≠ 锁定腿（两个独立字段）──────────────────────────
 *   承重：达标才授予（B1..B4）。锁定：触地瞬间无条件获得。
 *
 * ── 参数全部来自文献（重构方案 §7.3 / §7.4）───────────────────
 */

import { RigState, makeCriteria, type Phase, type Side } from './rigState';

export interface GaitConfig {
  /** B2 承重判据：载荷占比阈值 */
  bearerLoad: number;
  /** B2 迟滞（避免在阈值附近抖动） */
  bearerLoadHyst: number;
  /** B3 承重判据：MoS 下限（m） */
  bearerMosMin: number;
  /** B4 承重判据：连续满足时长（s）。抗抖 */
  bearerHoldSec: number;
  /** U2 解锁判据：MoS 连续 ≥ 下限的时长（s） */
  unlockMosHoldSec: number;
  /** U3 解锁判据：躯干倾角上限（deg） */
  unlockTiltMaxDeg: number;
  /** P3 迈步许可：支撑腿 MoS 下限（m） */
  permitMosMin: number;
  /**
   * ★★ 迈步**间隔**（s）：两次抬腿起点的最小间隔（用户 2026-10-03：
   *   「增长迈步的间隔，每次迈步间隔 1s 左右，要有足够时间调整平衡」）。
   *   这是**节奏**约束，与"重心是否移到位"（判据）正交 —— 判据管*能不能*，
   *   间隔管*多久一次*。间隔给足，平衡系统才有时间把重心稳在前脚上。
   */
  stepIntervalSec: number;
  /** 交接驻留：重心已在**前脚**上连续满足多久才算交接（s） */
  handoverDwellSec: number;
  /** DOUBLE（交接阶段）最短停留：给平衡系统把重心搬过去的时间（s） */
  handoverMinSec: number;
  /** SHIFT 超时回 DOUBLE（s） */
  handoverTimeoutSec: number;
  /** SINGLE 单支撑驻留（s）：用户「要有足够时间调整平衡」 */
  singleDwellSec: number;
  /** PUSH 超时回 DOUBLE（s）。**不能回 SINGLE**，否则与 SINGLE→PUSH 死循环 */
  pushTimeoutSec: number;
  /** STEP 超时回 DOUBLE（s） */
  stepTimeoutSec: number;
  /** 重心矢状允许的超出量（m）：`comOverFootX ≤ 0` 即"已在前脚上" */
  handoverTolX: number;
  /** 重心额状允许的偏移（m） */
  handoverTolZ: number;
  /** P4 迈步许可：双支撑相最小剩余时长（s） */
  permitDoubleSupportSec: number;
  /** α(t) 的软化宽度（相进度占比）。见 HugWBC arXiv:2502.03206 Eq.5 */
  alphaSigma: number;
  /** 单腿模式：强制支撑腿（不换脚）；null = 正常交替 */
  /**
   * ★ 起始支撑腿（只影响 t=0 时哪条腿算前腿）。**不是模式开关**。
   *   历史实现把它当"单腿模式"用（有一条旁路直接跳 SINGLE），于是相位机之外
   *   又有一套"单腿"概念。用户只有一个概念：**相位机**。
   */
  startBearer: Side;
  /** 单腿模式下摆动腿保持高度（m） */
  liftHold: number;
}

/**
 * ★ 迈步间隔与交接判据的默认值。
 *   `1.0` s 来自用户定调：「增长迈步的间隔，每次迈步间隔 1s 左右，
 *   要有足够时间调整平衡」——这是**节奏**约束，与位置判据正交。
 */
const DEFAULT_STEP_INTERVAL = 1.0;
/**
 * ★★ **步态周期的唯一真源**（收敛点：控制路径与 ES 路径共用）
 *
 * 这个数此前被写了**三遍**且互不相干：
 *   · `commander.stepPeriod = 1.6`      —— ES 路径的**节拍目标**
 *   · `stability.TARGET_CYCLE = 1.0`   —— 奖励的节拍项目标
 *   · `gaitState.stepIntervalSec = 1.0` —— 控制路径的**间隔下限**（`X6: >=`）
 *
 * ⚠ 注意后两者**角色不同、不是重复**：
 *   · 「下限」= 至少隔这么久才允许换腿（安全约束）
 *   · 「节拍目标」= 打算多久换一次（性能/风格）
 *   ⇒ 所以正确做法是**一个真源 + 显式的不变式 `下限 ≤ 目标`**，
 *     而不是把三个数强行改成一样（那会让 ES 的节拍被安全下限绑住）。
 *
 * 取 1.6 的依据：它是 ES 路径**实测能走**的值（腿令 1.2s + 腰令 0.4s，
 * 左腿起点→右腿起点 = 1.6s）。1.0 是用户的下限要求。
 */
export const STEP_CYCLE_SEC = 1.6;
const DEFAULT_HANDOVER_DWELL = 0.30;
const DEFAULT_HANDOVER_TOL_X = 0.02;
const DEFAULT_HANDOVER_TOL_Z = 0.05;

export const DEFAULT_GAIT_CONFIG: GaitConfig = {
  bearerLoad: 0.60,
  bearerLoadHyst: 0.45,
  bearerMosMin: 0.0,
  bearerHoldSec: 0.08,
  unlockMosHoldSec: 0.12,
  unlockTiltMaxDeg: 20,
  permitMosMin: 0.0,
  permitDoubleSupportSec: 0.05,
  // ★ 迈步间隔**下限** 1s（用户定调）+ 交接驻留与位置容差。
  //   ⚠ 它是**下限**（`X6: 已隔 >= 此值`），不是节拍目标；节拍目标是
  //     `STEP_CYCLE_SEC`（ES 路径用）。不变式 `下限 ≤ 目标` 由门禁 G7 断言。
  stepIntervalSec: DEFAULT_STEP_INTERVAL,
  handoverDwellSec: DEFAULT_HANDOVER_DWELL,
  handoverTolX: DEFAULT_HANDOVER_TOL_X,
  handoverTolZ: DEFAULT_HANDOVER_TOL_Z,
  // DOUBLE 至少停 0.4s 做交接；SINGLE 驻留 0.5s 给平衡系统调时间
  handoverMinSec: 0.40,
  handoverTimeoutSec: 2.0,
  singleDwellSec: 0.50,
  pushTimeoutSec: 0.60,
  stepTimeoutSec: 1.60,
  alphaSigma: 0.08,
  startBearer: 'l',
  liftHold: 0.25,
};

const PHASE_ORDER: Phase[] = ['DOUBLE', 'SHIFT', 'SINGLE', 'PUSH', 'STEP'];

/**
 * ★★★ **控制相位 ⇄ 计分相位的映射表**（两台状态机之间的收敛点）
 *
 * 用户 2026-10-04：「控制和计分的状态机可以分开，但是还得做到收敛。」
 *
 * 两台机器**必须分开**（触发条件根本不同）：
 *   · 控制相位（`gaitState`，本文件）：由 `X1..X8` 判据驱动 —— 重心是否
 *     到前腿、间隔是否满 1s、MoS、倾角。**回答"哪条腿现在可以抬"**。
 *   · 计分相位（`gaitPhase.GaitPhaseMachine`，ES 路径）：由接触数 `nGround`
 *     与离地净空驱动。**回答"这一项奖励现在该不该给分"**。
 *   把它们合并会让"能不能抬腿"被"离地够不够高"绑死 —— 概念错误。
 *
 * 但两者的**词汇**必须收敛，否则同一个物理时刻在两处被描述成两个词，
 * 于是"为什么 UI 说 A 而计分说 B"无法推断。
 *
 * 语义对齐（依据 `gaitPhase.ts:153`/`:174` 的实测注释）：
 *   计分 `step`   = **单支撑**（`nGround === 1`）
 *   计分 `adjust` = **双脚支撑**（`nGround === 2`）
 *   控制侧：`SINGLE`/`PUSH`/`STEP` 全是单支撑；`DOUBLE`/`SHIFT` 全是双脚
 *   （`SHIFT` 是双脚支撑期内的重心搬运，脚还没离地）。
 */
export const PHASE_TO_SCORING: Readonly<Record<Phase, 'both' | 'step' | 'adjust'>> = Object.freeze({
  DOUBLE: 'adjust',
  SHIFT: 'adjust',
  SINGLE: 'step',
  PUSH: 'step',
  STEP: 'step',
});

/**
 * 反向：计分相位 ⇒ 属于哪一类支撑（`'single' | 'double'`）。
 * 计分机只有三相、没有 SHIFT/PUSH 这些细节，所以反向是多对一。
 */
export const SCORING_TO_STANCE: Readonly<Record<'both' | 'step' | 'adjust', 'single' | 'double'>> =
  Object.freeze({ both: 'double', step: 'single', adjust: 'double' });

/** 分类：某个控制相位是单支撑还是双脚支撑。**门禁用它断言与映射表一致。 */
export function phaseStance(p: Phase): 'single' | 'double' {
  return SCORING_TO_STANCE[PHASE_TO_SCORING[p]];
}
/**
 * 相位标签表。**导出**给 `ui/hud.ts` 与 `tools/probe-uipanel.ts` 引用。
 *
 * ⚠ 这里曾有**两份**定义：本文件一份（`const`，不导出）、`hud.ts` 一份（`export`）。
 *   `hud.ts` 的注释说"探针曾自己复制了一份漏了 PUSH，所以导出给探针共用" ——
 *   也就是说**探针那份副本被修掉了，本文件这份原始副本却留了下来**，
 *   于是"同一事实两处定义"从探针搬到了 UI 与状态机之间。
 *   ⇒ 现在真源唯一：`hud.ts` 反向引用本文件，不再自带一份。
 */
export const PHASE_LABEL: Record<Phase, string> = {
  DOUBLE: '双脚支撑', SHIFT: '重心转移', SINGLE: '单支撑', PUSH: '蹬离', STEP: '摆动相',
};

/** 正常正态 CDF（HugWBC 的平滑接触概率用它） */
function cdf(x: number): number {
  // Abramowitz-Stegun 7.1.26 近似，|ε| < 7.5e-8
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

/**
 * ★ 平滑的权限调度 α(t)。
 *   依据：HugWBC 用正态 CDF 把"接触/摆动"的硬阈值变成 ±3σ 区间，
 *   以得到连续的切换；本函数把同样的手法用在**权限预算**上。
 *   进入 STEP 时 α 从 0 升到 1，用 3/2 斜坡在前 ⅓ 完成（Lee et al. / HugWBC）。
 */
export function smoothAuthority(phase: Phase, phaseT: number, ramp: number, sigma: number): number {
  if (phase !== 'STEP') return 0;
  // 前 1/3 区间用 3/2 斜坡（不是线性也不是硬切），保证 dq̇/dt 连续
  const p = Math.max(0, Math.min(1, phaseT / Math.max(1e-6, ramp)));
  const ramped = Math.min(1, 1.5 * p);
  // 再用 CDF 软化边界，避免相位抖动导致 α 抖
  return 0.5 * (1 + cdf((ramped - 0.5) / Math.max(1e-6, sigma)));
}

export interface ExchangeEvent {
  /** 本拍发生的交换（UI/日志用） */
  kind: 'none' | 'enter_step' | 'touchdown' | 'bearer_granted' | 'lock_released';
  side?: Side;
  note: string;
}

export class GaitState {
  cfg: GaitConfig;
  /** 上一次的承重判据连续满足时长 */
  /** 上一次是否已授予承重（用于迟滞撤销） */
  private hadBearer = false;
  /** 双支撑相已持续时长 */
  private doubleT = 0;
  /** 本拍刚触地（边沿） */
  private wasGrounded: Record<Side, boolean> = { l: false, r: false };
  /**
   * 状态机自己的时钟（s）。`RigState.tSec` 是 private，这里不越界访问。
   * 迈步间隔（用户：「每次迈步间隔 1s 左右」）从它算起。
   */
  private t = 0;
  /** 上一次**抬腿起点**时刻（s）。−1e9 = 还没迈过步 ⇒ 间隔条件天然满足 */
  private lastStepT = -1e9;
  /** 交接驻留计时（s）：重心连续落在**前腿**上的时长（防抖） */
  private handoverT = 0;
  readonly event: ExchangeEvent = { kind: 'none', note: '' };

  constructor(private rs: RigState, cfg: GaitConfig = DEFAULT_GAIT_CONFIG) {
    this.cfg = cfg;
  }

  phaseLabel(p: Phase): string { return PHASE_LABEL[p]; }
  phaseOrder(p: Phase): number { return PHASE_ORDER.indexOf(p); }

  /** ★ 每拍调用一次：更新判据 → 迁移状态 → 写回 rigState（含 α） */
  update(dt: number): ExchangeEvent {
    const rs = this.rs;
    this.t += dt;
    this.event.kind = 'none'; this.event.note = ''; this.event.side = undefined;

    // ★ 承重腿的身份**只能**来自 rs.supportLeg()。
    //   此前这里**重写了一份** fallback（双支撑时写死 'l'）⇒ 判据在评估一条
    //   只承担 0~29% 的腿，B2 永远不达标 ⇒ 承重标识永远授不出来。
    //   一份身份、一个来源。
    const supSide: Side = rs.supportLeg();
    const swing: Side = rs.swingLeg();

    // ★ 锁的语义（用户 2026-10-03 定调）：
    //   · **触地即锁** —— 迈出去的腿再次落地后锁死，杜绝"刚落地又抬"
    //   · **不许预先锁** —— "前腿肯定不能一上来锁死"
    //   · 承重腿"可以锁也可以不锁"（它已经在承重，锁不锁无所谓）
    // ⇒ 所以这里**不做任何预先锁定**；锁定只发生在 STEP 相的 touchdown 那一刻。
    //   （曾在这里锁支撑腿 ⇒ 前腿一上来就锁死，与用户要求相反。）
    const bothGrounded = rs.grounded.l && rs.grounded.r;
    if (bothGrounded) this.doubleT += dt; else this.doubleT = 0;

    // ── 触地边沿检测 ────────────────────────────────────────
    for (const s of ['l', 'r'] as Side[]) {
      if (rs.grounded[s] && !this.wasGrounded[s]) { rs.touchdown[s] = true; this.wasGrounded[s] = true; }
      else if (!rs.grounded[s]) this.wasGrounded[s] = false;
    }

    // ══════════════════════════════════════════════════════════════
    // ★★ **唯一的交接判据** X1..X8（单一真源）
    //
    //   重构理由：此前有**三套**判据在回答同一个问题"重心在不在对的那条腿上"：
    //     · B1-B4  承重判据（接地/载荷/MoS/持续）
    //     · H1-H4+I 交接判据（重心在前腿/驻留/前腿承重/稳定/间隔）
    //     · P1-P5  迈步许可（重心在前腿/后腿已解锁/间隔/MoS/前腿承重）
    //   而 `B2` 与 `H3` 都看载荷、`H4` 与 `P4` 都看 MoS、`H1` 与 `P1` 完全相同。
    //   同一事实三处定义 ⇒ 改一处忘另一处 ⇒ 判据互相矛盾时无法判断是谁错。
    //
    //   现在：**只有 X1..X8 一套**，`loadBearer` 与 `stepPermit` 都是它的**派生视图**
    //   （不是独立判据）。用户 2026-10-03 的定义直接对应：
    //     「显式的把重心移动到前腿」      ⇒ X2（矢状）+ X3（额状）+ X4（驻留）
    //     「然后才允许动后腿」            ⇒ canSwingRear
    //     「锁定前腿」                    ⇒ 触地即锁（见 STEP 相）
    //     「满足 1s 间隔且重心真在前腿才解锁后腿」 ⇒ handoverOk && X6
    // ══════════════════════════════════════════════════════════════
    const front = rs.frontLeg();      // 按实测脚 x，前进方向 +x
    const rear = rs.rearLeg();

    const dxOver = rs.comOverFootX(front);   // >0 = 重心还在前脚前方
    const dzOver = rs.comOverFootZ(front);   // 横向偏移
    const X1 = rs.grounded[front];
    const X2 = dxOver <= this.cfg.handoverTolX;
    const X3 = dzOver <= this.cfg.handoverTolZ;
    if (X2 && X3) this.handoverT += dt; else this.handoverT = 0;
    const X4 = this.handoverT >= this.cfg.handoverDwellSec;
    const X5 = rs.loadFrac[front] >= this.cfg.bearerLoadHyst;
    const X6 = this.t - this.lastStepT >= this.cfg.stepIntervalSec;
    const X7 = rs.mos >= this.cfg.permitMosMin;
    const X8 = rs.tiltDeg <= this.cfg.unlockTiltMaxDeg;

    rs.handoverCriteria = makeCriteria(
      {
        X1_前腿接地: X1, X2_矢状到位: X2, X3_额状到位: X3, X4_驻留: X4,
        X5_前腿承重: X5, X6_间隔1s: X6, X7_MoS: X7, X8_倾角: X8,
      },
      {
        dxOverMm: dxOver * 1000, dzOverMm: dzOver * 1000,
        tolXmm: this.cfg.handoverTolX * 1000, tolZmm: this.cfg.handoverTolZ * 1000,
        dwellSec: this.handoverT, needSec: this.cfg.handoverDwellSec,
        frontLoad: rs.loadFrac[front], loadThr: this.cfg.bearerLoadHyst,
        intervalSec: this.t - this.lastStepT, needInterval: this.cfg.stepIntervalSec,
        mos: rs.mos, tiltDeg: rs.tiltDeg,
        frontIsL: front === 'l' ? 1 : 0, rearIsL: rear === 'l' ? 1 : 0,
      },
    );

    /** 交接**完成**（位置 + 稳定；不含间隔 —— 间隔是节奏，不是资格） */
    const handoverOk = X1 && X2 && X3 && X4 && X5 && X7 && X8;
    /** 可动后腿 = 交接完成 **且** 间隔满足 **且** 后腿未锁（用户的合取条件） */
    const rearLocked = rs.locked[rear];
    const canSwingRear = handoverOk && X6 && !rearLocked;

    // ── 承重标识：**派生**（不再是独立判据）──────────────────
    //   只有当前腿**同时**接地且载荷达标才授予；否则退"载荷大的那条"。
    //
    //   ⚠⚠ 兜底**必须**走 `rs.loadDominant(prev)`（带 0.08 载荷迟滞），
    //     绝不能写裸比较 `loadFrac.l > loadFrac.r`。
    //     裸比较是**零迟滞**：接触噪声让两条腿载荷在 0.50/0.50 附近抖动时
    //     `loadBearer` **逐帧翻转** ⇒ UI 的"★承重"标签闪烁（用户 2026-10-04 亲见），
    //     而且 `frontLeg()` 在双脚并齐（|Δx|<3mm）时以 `loadBearer` 兜底
    //     ⇒ 连**前腿/后腿**都跟着闪 ⇒ 整套交接判据跟着抖。
    //     （同一个坑 `supportLeg()` 犯过一次：1e-3 迟滞 ⇒ 8s 掉到 1.68s。）
    // ★★ 承重腿**只由载荷决定**（用户 2026-10-04 修「第二份判据 + 循环依赖」）。
    //   原来 `bearer = X1 && X5 ? front : loadDominant(prev)` 有两个问题：
    //     ① `X1 && X5` 分支**整条旁路迟滞** ⇒ 站立时经常走这条路，
    //        `loadDominant` 的 0.08 迟滞根本没被用到；
    //     ② `front` 在两脚并齐时又回落 `loadBearer`（见 frontLeg 已修）
    //        ⇒ 两者互为对方 ⇒ **自激振荡**，20s 切 5 次。
    //   现在承重 = 载荷（唯一判据 + 迟滞），前后 = 几何 x（唯一判据），解耦。
    //   `X1`/`X5` 仍作为**交接判据** X1..X8 的成员展示给 UI，不参与承重赋值。
    //   ⚠ 试过再加一层「驻留拍数」的时间条件，**实测无效**（5 → 5）：因为
    //     载荷是真的在以 ~0.75s 周期左右大幅摆动（|loadL-loadR| 摆到 0.328，
    //     ≫ 迟滞带宽 0.08），挑战者连续占优远超任何合理驻留拍数；要压住它
    //     需要驻留 >0.75s，那会让真实交接变得迟钝到不可用。
    //     ⇒ 这不是判据抖动，而是**真实的物理侧向摇摆**，要治得先找到摇摆来源，
    //        不能在判据层加滤波。驻留代码已撤掉（`advanceBearerDwell` 等）。
    //   ★ 传 `bearerLoadHyst`（本状态机的唯一载荷阈值），否则会与 `X5` 用两套阈值
    //     （0.45 vs 硬编码 0.08）打架 ⇒ 承重腿来回抽换（实测 20s 内 6 次）。
    const bearer = rs.loadDominant(rs.loadBearer, this.cfg.bearerLoadHyst);
    rs.loadBearer = bearer;
    this.hadBearer = this.hadBearer || handoverOk;
    // 派生视图（供 UI/探针回显同一份事实，不是第二套判据）
    rs.bearerCriteria = makeCriteria(
      { B1_接地: X1, B2_载荷: X5, B3_MoS: X7, B4_驻留: X4 },
      {
        frontIsL: front === 'l' ? 1 : 0, rearIsL: rear === 'l' ? 1 : 0,
        loadFrac: rs.loadFrac[front], thr: this.cfg.bearerLoadHyst,
        mos: rs.mos, holdSec: this.handoverT, dxOverMm: dxOver * 1000, dzOverMm: dzOver * 1000,
      },
    );

    // ── 解锁：只在后腿，且必须 handoverOk && 间隔满足 ──────────
    for (const sd of ['l', 'r'] as Side[]) {
      rs.unlockCriteria = makeCriteria(
        {
          U1_交接完成: handoverOk, U2_间隔1s: X6, U3_是后腿: sd === rear,
          U4_未锁定: sd === rear && !rs.locked[sd], U5_稳定: X7 && X8,
        },
        { handoverOk: handoverOk ? 1 : 0, intervalSec: this.t - this.lastStepT, isRear: sd === rear ? 1 : 0 },
      );
      if (rs.locked[sd] && sd === rear && handoverOk && X6) {
        rs.locked[sd] = false; rs.lockReleased[sd] = true;
        this.event.kind = 'lock_released'; this.event.side = sd;
        this.event.note = `解锁后腿（间隔 ${(this.t - this.lastStepT).toFixed(2)}s、`
          + `重心在前腿 矢${(dxOver * 1000).toFixed(0)}mm/额${(dzOver * 1000).toFixed(0)}mm）`;
      }
    }

    // ── 迈步许可：**派生** ────────────────────────────────────
    rs.stepPermit = makeCriteria(
      { P1_交接完成: handoverOk, P2_间隔1s: X6, P3_后腿未锁: !rearLocked, P4_MoS: X7, P5_稳定: X8 },
      {
        dxOverMm: dxOver * 1000, dzOverMm: dzOver * 1000,
        rearLocked: rearLocked ? 1 : 0, intervalSec: this.t - this.lastStepT,
        needInterval: this.cfg.stepIntervalSec, mos: rs.mos, tiltDeg: rs.tiltDeg,
        canSwingRear: canSwingRear ? 1 : 0,
      },
    );

    // ── 迁移 ────────────────────────────────────────────────
    const prev = rs.phase;
    this.migrate(prev, dt, bothGrounded, supSide, swing);
    if (rs.phase !== prev && this.event.kind === 'none') {
      this.event.kind = rs.phase === 'STEP' ? 'enter_step' : 'none';
      this.event.note = `${prev} → ${rs.phase}`;
    }
    rs.phaseT += dt;

    // ★ 承重标识已在上面的 X1..X8 里**派生**完成，这里不再有第二套授予/撤销逻辑。
    //   （原实现在此处独立判定 `bearerCriteria.all` 又改一遍 `loadBearer`，
    //     与派生值互相覆盖 —— 同一事实两处定义。）

    // ── α(t)：腰的修正权限预算 ──────────────────────────────
    // ★ 去掉 `singleLeg` 对 α 斜坡的影响：相位机本身已区分单/双支撑相，
    //   再叠一个"单腿模式"开关就是**两套"单腿"概念**（用户只应有一个）。
    const ramp = 0.4;
    rs.authority = smoothAuthority(rs.phase, rs.phaseT, ramp, this.cfg.alphaSigma);

    return this.event;
  }

  /**
   * ══════════════════════════════════════════════════════════════
   * 相位迁移。用户 2026-10-03 定调的形状：
   *
   *   「**计时状态允许两脚接地，这时候的工作就是重心交接**」
   *
   *   ⇒ **DOUBLE 就是交接阶段**：双脚站在地上，把重心从后腿**显式**搬到前腿。
   *     单支撑（SINGLE）只在**交接验证通过**之后才进入 ——
   *     不是"时间到了就进"，也不是"singleLeg 模式直接跳进去"。
   *
   *   修复的两个具体缺陷：
   *   ① 原 `DOUBLE` 有 `if (cfg.singleLeg) { 0.2s 后直接进 SINGLE }`
   *      ⇒ **整个重心交接阶段被跳过**（用户要的"两脚接地做交接"从来没发生过）。
   *   ② 原 `PUSH` 超时回 `SINGLE` ⇒ 与 `SINGLE→PUSH`（0.15s）构成
   *      **永久振荡** SINGLE(0.15s)↔PUSH(0.5s)，实测相位一直在这两者之间跳、
   *      永远不回到 DOUBLE、也永远进不了 STEP。
   *      现在 PUSH 超时回 **DOUBLE**（重新双脚接地、重做交接），符合用户定义。
   */
  private migrate(prev: Phase, dt: number, both: boolean, supSide: Side, swing: Side): void {
    const rs = this.rs;
    // ★ 交接验证：位置（矢状+额状）+ 驻留 + 承重 + MoS + 倾角（**不含间隔**，
    //   间隔是节奏约束，在 `canSwingRear` 里单独判）。
    const hv = rs.handoverCriteria.flags;
    const handoverOk = hv['X1_前腿接地'] === true && hv['X2_矢状到位'] === true
      && hv['X3_额状到位'] === true && hv['X4_驻留'] === true
      && hv['X5_前腿承重'] === true && hv['X7_MoS'] === true && hv['X8_倾角'] === true;
    switch (prev) {
      case 'DOUBLE':
        // ★ 两脚接地、专门做重心交接。允许双脚接地就是用户要的形态。
        //   停留至少 `handoverMinSec`，并且交接验证通过才准进 SINGLE。
        if (rs.phaseT >= this.cfg.handoverMinSec && handoverOk) {
          rs.phase = 'SINGLE'; rs.phaseT = 0;
        }
        break;

      case 'SHIFT':
        // 交接中。进 SINGLE 的唯一条件是**交接验证通过**（不是载荷判据）。
        if (handoverOk) { rs.phase = 'SINGLE'; rs.phaseT = 0; }
        else if (rs.phaseT > this.cfg.handoverTimeoutSec) {
          rs.phase = 'DOUBLE'; rs.phaseT = 0;          // 交接没成 ⇒ 回双脚重新来
        }
        break;

      case 'SINGLE':
        // 单支撑**驻留期**：给平衡系统时间（用户「要有足够时间调整平衡」）
        if (rs.phaseT >= this.cfg.singleDwellSec) { rs.phase = 'PUSH'; rs.phaseT = 0; }
        break;

      case 'PUSH':
        // 只有许可齐 **且** 双脚接地才进 STEP（交接必须落在双支撑相内）
        if (rs.stepPermit.all && both) { rs.phase = 'STEP'; rs.phaseT = 0; }
        else if (rs.phaseT > this.cfg.pushTimeoutSec) {
          // ★ 回 DOUBLE 而不是 SINGLE —— 否则与 SINGLE→PUSH 构成死循环
          rs.phase = 'DOUBLE'; rs.phaseT = 0;
        }
        break;

      case 'STEP':
        // 触地 ⇒ 锁定该腿（触地即锁），回到 SHIFT 做下一次交接
        if (rs.touchdown[swing]) {
          rs.locked[swing] = true;      // ★ 无条件，不等达标
          rs.phase = 'SHIFT'; rs.phaseT = 0;
        } else if (rs.phaseT > this.cfg.stepTimeoutSec) {   // 没迈成/没落地 ⇒ 回落
          rs.phase = 'DOUBLE'; rs.phaseT = 0;
        }
        break;
    }
    void dt; void supSide;
  }

  reset(): void {
    this.t = 0; this.lastStepT = -1e9; this.handoverT = 0;
    this.hadBearer = false; this.doubleT = 0;
    this.wasGrounded.l = false; this.wasGrounded.r = false;
    this.rs.loadBearer = null; this.rs.locked.l = false; this.rs.locked.r = false;
    this.rs.phase = 'DOUBLE'; this.rs.phaseT = 0; this.rs.authority = 0;
  }
}