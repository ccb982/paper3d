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
  singleLeg: Side | null;
  /** 单腿模式下摆动腿保持高度（m） */
  liftHold: number;
}

/**
 * ★ 迈步间隔与交接判据的默认值。
 *   `1.0` s 来自用户定调：「增长迈步的间隔，每次迈步间隔 1s 左右，
 *   要有足够时间调整平衡」——这是**节奏**约束，与位置判据正交。
 */
const DEFAULT_STEP_INTERVAL = 1.0;
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
  // ★ 迈步间隔 1s（用户定调）+ 交接驻留与位置容差
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
  singleLeg: 'l',
  liftHold: 0.25,
};

const PHASE_ORDER: Phase[] = ['DOUBLE', 'SHIFT', 'SINGLE', 'PUSH', 'STEP'];
const PHASE_LABEL: Record<Phase, string> = {
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
  private bearerT = 0;
  private unlockT = 0;
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

    // ── B1..B4 承重判据（**达标才授予标识**）────────────────
    const lf = rs.loadFrac[supSide], rf = rs.loadFrac[swing];
    const thr = this.hadBearer ? this.cfg.bearerLoadHyst : this.cfg.bearerLoad;
    const B1 = rs.grounded[supSide];
    const B2 = lf >= thr;
    const B3 = rs.mos >= this.cfg.bearerMosMin;
    const B4 = this.bearerT >= this.cfg.bearerHoldSec;
    if (B1 && B2 && B3) this.bearerT += dt; else this.bearerT = 0;
    rs.bearerCriteria = makeCriteria(
      { B1_接地: B1, B2_载荷: B2, B3_MoS: B3, B4_持续: B4 },
      { loadFrac: lf, thr, mos: rs.mos, holdSec: this.bearerT, otherLoad: rf },
    );

    // ══════════════════════════════════════════════════════════════
    // ── 交接判据 H1..H4：**满足 1s 间隔 且 重心真在前腿** 才解锁后腿 ──
    //   用户 2026-10-03 两次纠正：
    //     ①「要显式的把重心移动到前腿，然后才允许动后腿，
    //        锁定前腿，前腿是支撑腿并且解锁后腿」
    //     ②「交接瞬间锁前腿、解后腿 也不对啊，
    //        肯定是满足 **1s 间隔**并且**重心真在前腿了**，才能解锁后腿」
    //   ⇒ 解锁是**两个条件的合取**，不是瞬时交换。
    //     锁定规则不变：**触地即锁**（前腿一落地就锁，杜绝"刚落地又抬"）。
    //
    //   ⚠ 「重心在前腿」用**位置判据**（矢状 + 额状），不用载荷：
    //     载荷是结果、位置是原因。用户说"显式"，指的就是位置。
    const front = rs.frontLeg();      // 按实测脚 x，前进方向为 +x
    const rear = rs.rearLeg();
    const dxOver = rs.comOverFootX(front);   // ≤ handoverTolX 即"重心已在前脚上"
    const dzOver = rs.comOverFootZ(front);
    const H1 = dxOver <= this.cfg.handoverTolX && dzOver <= this.cfg.handoverTolZ;
    if (H1) this.handoverT += dt; else this.handoverT = 0;
    const H2 = this.handoverT >= this.cfg.handoverDwellSec;   // 驻留确认（防抖）
    // 间隔：距**上一次抬腿起点**的时长
    const intervalOk = this.t - this.lastStepT >= this.cfg.stepIntervalSec;
    // 前腿承重（结果侧佐证，与位置判据互为印证）
    const H3 = rs.loadFrac[front] >= this.cfg.bearerLoadHyst;
    const H4 = rs.mos >= this.cfg.permitMosMin && rs.tiltDeg <= this.cfg.unlockTiltMaxDeg;
    const handOver = H1 && H2 && intervalOk && H3 && H4;
    rs.frontLegSide = front; rs.rearLegSide = rear;   // 供快照/UI 回读
    rs.handoverCriteria = makeCriteria(
      {
        H1_重心在前腿: H1, H2_驻留: H2, H3_前腿承重: H3, H4_稳定: H4,
        I_间隔1s: intervalOk,
      },
      {
        dxOverMm: dxOver * 1000, dzOverMm: dzOver * 1000, tolXmm: this.cfg.handoverTolX * 1000,
        tolZmm: this.cfg.handoverTolZ * 1000, dwellSec: this.handoverT, needSec: this.cfg.handoverDwellSec,
        frontLoad: rs.loadFrac[front], intervalSec: this.t - this.lastStepT,
        needInterval: this.cfg.stepIntervalSec, mos: rs.mos, tiltDeg: rs.tiltDeg,
      },
    );

    // ★ 解锁**只发生在后腿**，且必须 handOver 全成立：
    //     「满足 1s 间隔 且 重心真在前腿 ⇒ 才解锁后腿」
    for (const s of ['l', 'r'] as Side[]) {
      rs.unlockCriteria = makeCriteria(
        {
          U1_是后腿: s === rear, U2_重心在前腿: H1, U3_驻留: H2,
          U4_间隔1s: intervalOk, U5_前腿承重: H3, U6_稳定: H4,
        },
        {
          handOver: handOver ? 1 : 0, isRear: s === rear ? 1 : 0,
          dxOverMm: dxOver * 1000, intervalSec: this.t - this.lastStepT,
        },
      );
      if (rs.locked[s] && s === rear && handOver) {
        rs.locked[s] = false; rs.lockReleased[s] = true;
        this.event.kind = 'lock_released'; this.event.side = s;
        this.event.note = `解锁后腿（间隔 ${(this.t - this.lastStepT).toFixed(2)}s、重心在前腿 ${(dxOver * 1000).toFixed(0)}mm）`;
      }
    }

    // ── P1..P5 迈步许可（抬**后腿**）─────────────────────────
    //   P1 = 重心已在前腿（位置判据，带驻留）  ← 用户"显式把重心移到前腿"
    //   P2 = 后腿**已解锁**                    ← 交接完成才允许动
    //   P3 = 间隔 ≥1s                          ← 用户"每次迈步间隔 1s 左右"
    //   P4 = MoS 达标
    //   P5 = 前腿承重（结果佐证）
    const rearLocked = rs.locked[rear];
    const P1 = H1 && H2;
    const P2 = !rearLocked;
    const P3 = intervalOk;
    const P4 = rs.mos >= this.cfg.permitMosMin;
    const P5 = H3;
    rs.stepPermit = makeCriteria(
      { P1_重心在前腿: P1, P2_后腿已解锁: P2, P3_间隔1s: P3, P4_MoS: P4, P5_前腿承重: P5 },
      {
        dxOverMm: dxOver * 1000, rearLocked: rearLocked ? 1 : 0,
        intervalSec: this.t - this.lastStepT, needInterval: this.cfg.stepIntervalSec,
        mos: rs.mos, frontLoad: rs.loadFrac[front],
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

    // ── 承重标识的授予/撤销（带迟滞）────────────────────────
    if (!this.hadBearer && rs.bearerCriteria.all) {
      rs.loadBearer = supSide; this.hadBearer = true;
      this.event.kind = 'bearer_granted'; this.event.side = supSide;
      this.event.note = `承重标识授予 ${supSide}（载荷 ${lf.toFixed(2)} / MoS ${(rs.mos * 1000).toFixed(0)}mm）`;
    } else if (this.hadBearer && rs.loadBearer) {
      const cur = rs.loadBearer;
      if (!rs.grounded[cur] || rs.loadFrac[cur] < this.cfg.bearerLoadHyst) {
        rs.loadBearer = null; this.hadBearer = false; this.bearerT = 0;
      }
    }

    // ── α(t)：腰的修正权限预算 ──────────────────────────────
    const ramp = this.cfg.singleLeg ? 1.2 : 0.4;
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
    const hv = rs.handoverCriteria.flags;
    /** 交接验证通过 = 重心已在前腿（位置判据 + 驻留）**且** 间隔 ≥1s */
    const handoverOk = hv['H1_重心在前腿'] === true && hv['H2_驻留'] === true
      && hv['I_间隔1s'] === true;
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
    this.bearerT = 0; this.unlockT = 0; this.hadBearer = false; this.doubleT = 0;
    this.wasGrounded.l = false; this.wasGrounded.r = false;
    this.rs.loadBearer = null; this.rs.locked.l = false; this.rs.locked.r = false;
    this.rs.phase = 'DOUBLE'; this.rs.phaseT = 0; this.rs.authority = 0;
  }
}