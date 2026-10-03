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
  /** P4 迈步许可：双支撑相最小剩余时长（s） */
  permitDoubleSupportSec: number;
  /** α(t) 的软化宽度（相进度占比）。见 HugWBC arXiv:2502.03206 Eq.5 */
  alphaSigma: number;
  /** 单腿模式：强制支撑腿（不换脚）；null = 正常交替 */
  singleLeg: Side | null;
  /** 单腿模式下摆动腿保持高度（m） */
  liftHold: number;
}

export const DEFAULT_GAIT_CONFIG: GaitConfig = {
  bearerLoad: 0.60,
  bearerLoadHyst: 0.45,
  bearerMosMin: 0.0,
  bearerHoldSec: 0.08,
  unlockMosHoldSec: 0.12,
  unlockTiltMaxDeg: 20,
  permitMosMin: 0.0,
  permitDoubleSupportSec: 0.05,
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
  readonly event: ExchangeEvent = { kind: 'none', note: '' };

  constructor(private rs: RigState, cfg: GaitConfig = DEFAULT_GAIT_CONFIG) {
    this.cfg = cfg;
  }

  phaseLabel(p: Phase): string { return PHASE_LABEL[p]; }
  phaseOrder(p: Phase): number { return PHASE_ORDER.indexOf(p); }

  /** ★ 每拍调用一次：更新判据 → 迁移状态 → 写回 rigState（含 α） */
  update(dt: number): ExchangeEvent {
    const rs = this.rs;
    this.event.kind = 'none'; this.event.note = ''; this.event.side = undefined;

    // ★ 承重腿的身份**只能**来自 rs.supportLeg()。
    //   此前这里**重写了一份** fallback（双支撑时写死 'l'）⇒ 判据在评估一条
    //   只承担 0~29% 的腿，B2 永远不达标 ⇒ 承重标识永远授不出来。
    //   一份身份、一个来源。
    const supSide: Side = rs.supportLeg();
    const swing: Side = rs.swingLeg();
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

    // ── U1..U3 解锁判据（锁定解除 = 允许再抬）──────────────
    const U1 = rs.loadBearer !== null;
    const U2 = rs.mos >= this.cfg.permitMosMin;
    const U3 = rs.tiltDeg <= this.cfg.unlockTiltMaxDeg;
    if (U2 && U3) this.unlockT += dt; else this.unlockT = 0;
    const U4 = this.unlockT >= this.cfg.unlockMosHoldSec;
    for (const s of ['l', 'r'] as Side[]) {
      const held = U1 && rs.loadBearer === s && U4;
      rs.unlockCriteria = makeCriteria(
        { U1_承重达标: held, U2_MoS: U2, U3_倾角: U3, U4_稳定窗: U4 },
        { mos: rs.mos, tiltDeg: rs.tiltDeg, winSec: this.unlockT, needSec: this.cfg.unlockMosHoldSec, held: held ? 1 : 0 },
      );
      if (rs.locked[s] && held) {
        // ★ 交换点 3：承重达标 **且** 稳定窗满足 ⇒ 解锁
        rs.locked[s] = false; rs.lockReleased[s] = true;
        this.event.kind = 'lock_released'; this.event.side = s; this.event.note = '解锁，允许再抬';
      }
    }

    // ── P1..P4 迈步许可（双钥匙：许可 AND 摆动腿确实离地/可离地）────
    const swingLocked = rs.locked[swing];
    const P1 = rs.loadBearer !== null;
    const P2 = !swingLocked;
    const P3 = rs.mos >= this.cfg.permitMosMin;
    const P4 = this.doubleT >= this.cfg.permitDoubleSupportSec;
    rs.stepPermit = makeCriteria(
      { P1_重心到位: P1, P2_未锁定: P2, P3_MoS: P3, P4_双支撑时长: P4 },
      { mos: rs.mos, doubleSec: this.doubleT, swingLocked: swingLocked ? 1 : 0 },
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

  private migrate(prev: Phase, dt: number, both: boolean, supSide: Side, swing: Side): void {
    const rs = this.rs;
    switch (prev) {
      case 'DOUBLE':
        // 进入 SHIFT：摆动腿已抬且正在落地（或单腿模式下已完成抬腿）
        if (this.cfg.singleLeg) { if (rs.phaseT > 0.2) { rs.phase = 'SINGLE'; } break; }
        if (rs.phaseT > 0.15 && (rs.loadFrac[swing] > 0.25 || rs.touchdown[swing])) rs.phase = 'SHIFT';
        break;

      case 'SHIFT':
        // ★ 承重判据达标 ⇒ 换到 SINGLE；否则继续转移
        if (rs.bearerCriteria.all) { rs.phase = 'SINGLE'; rs.phaseT = 0; }
        else if (rs.phaseT > 1.5) rs.phase = 'DOUBLE';   // 超时回退，别卡死
        break;

      case 'SINGLE':
        // 进入 PUSH：先把重心推出去（**前进的唯一来源**，见 §13.5）
        if (rs.phaseT > 0.15) rs.phase = 'PUSH';
        break;

      case 'PUSH':
        // PUSH → STEP：许可齐 + 双支撑时长够（R2：交接必须落在双支撑相内）
        if (rs.stepPermit.all && both) rs.phase = 'STEP';
        else if (rs.phaseT > 0.5) rs.phase = 'SINGLE';
        break;

      case 'STEP':
        // 触地 ⇒ SHIFT；落地时无条件锁定该腿（交换点 2）
        if (rs.touchdown[swing]) {
          rs.locked[swing] = true;      // ★ 无条件，不等达标
          rs.phase = 'SHIFT'; rs.phaseT = 0;
        } else if (rs.phaseT > 1.5) {   // 没迈成/没落地 ⇒ 回落
          rs.phase = 'DOUBLE'; rs.phaseT = 0;
        }
        break;
    }
    // 单腿模式：不做交替，锁定恒久
    if (this.cfg.singleLeg && rs.phase === 'DOUBLE' && rs.phaseT > 0.6) rs.phase = 'SINGLE';
    void dt; void supSide;
  }

  reset(): void {
    this.bearerT = 0; this.unlockT = 0; this.hadBearer = false; this.doubleT = 0;
    this.wasGrounded.l = false; this.wasGrounded.r = false;
    this.rs.loadBearer = null; this.rs.locked.l = false; this.rs.locked.r = false;
    this.rs.phase = 'DOUBLE'; this.rs.phaseT = 0; this.rs.authority = 0;
  }
}