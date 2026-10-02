/**
 * 步态的**顺序结构**：迈步 → 调整身体 → 再迈步（用户 2026-10-02）。
 *
 * > 卖出第一步后站不住啊，而且迈步间隔太小，无法调整自身平衡。
 * > 我认为走路大致是迈步，调整身体，再迈步的步骤。
 *
 * ── 文献依据（这正是经典步态分期）────────────────────────────────────────
 * · Perry 八相分期把**支撑相**分成 承重期(0~10%) / 中期(10~30%) / 末期(30~50%) /
 *   预摆动(50~60%)，其中**双支撑（0~10% 与 50~60%）就是"调整身体"的窗口**；
 *   单支撑（10~50%）才是真正"站住"。
 * · Usherwood 2023（碰撞力学）："vaulting stances are separated by a brief
 *   **step-to-step transition**" —— 迈步与迈步之间确实存在一个专门的过渡段。
 * · Maki：重稳定轻速度；Hof 2010：侧向落脚需要 ~0.28 s。
 * ⇒ 所以"迈步→调整→迈步"不是比喻，而是可编码的**三相状态机**。
 *
 * ── 为什么必须是"顺序"的，而不是一堆独立的时间积分 ────────────────────
 * 之前 `lift` / `single` / `moS` / `placement` / `refHip` … 全是**独立**的时间积分，
 * 于是**任何"一直在动"的动作都能同时把它们全部满足**（实测脚高主频 3.9 Hz 的抖动
 * 就能刷 ≈3.5 分）。改成顺序结构后：**没有走完"迈步→调整"这个循环，一分不给**。
 * 这一条是关住抽搐的**结构性**办法，比任何单个阈值都强。
 */

/** 迈步相最少时长（s）：文献 Hof 2010 侧向落脚需 ~0.28 s */
export const STEP_MIN = 0.28;
/** ★ 调整相最少时长（s）：用户"迈步间隔太小，无法调整自身平衡" ⇒ 必须给足时间 */
export const ADJUST_MIN = 0.70;
/** 调整相里"稳住"的判据：整段 MoS ≥ 0（负值按比例罚） */
export const ADJUST_MOS_TOL = 0.0;
/** 一次完整循环各部分的评分权重（和为 1） */
export const W_SHAPE = 0.35;      // 髋/膝是否贴合文献参考形状
export const W_MOS = 0.30;        // MoS 是否保持在带内
export const W_PLACE = 0.20;      // 落点是否在捕获点附近
export const W_PELVIS = 0.15;     // 盆骨是否先于膝启动

export type GaitPhase = 'both' | 'step' | 'adjust';

/** 单条腿 */
export type Leg = 'l' | 'r';

/**
 * ★★ 调试用的状态标签：**该迈哪条腿 + 身体该不该动**（用户 2026-10-02 明确要求）。
 * 例：`step:L 身体冻结` / `adjust:L 身体可动` / `both 过渡`
 */
export function stateLabel(phase: GaitPhase, swing: Leg | null, bodyFree: boolean): string {
  if (phase === 'both') return 'both 过渡（双脚着地）';
  const s = swing === 'l' ? '左腿' : '右腿';
  return phase === 'step' ? `step:${s === '左腿' ? 'L' : 'R'} 迈步中·身体冻结` : `adjust:${s === '左腿' ? 'L' : 'R'} 稳住中·身体可动`;
}

/** 状态机里发生的一次转移（调试用） */
export interface StateEvent {
  t: number;
  /** 转移后的状态标签 */
  label: string;
  /** 该状态**为什么**没通过（空 = 通过）—— 调试时直接指名哪一个状态不合格 */
  fail: string;
  /** 该次持续时长（s） */
  dur: number;
}

export interface CycleTally {
  nStep: number;
  nAdjustOk: number;
  lastCredit: number;
  accCredit: number;
  lastAdjustSec: number;
  meanAdjustSec: number;
  /** 诊断：抖动次数（离地不够就换支撑脚） */
  flickers: number;
}

export class GaitPhaseMachine {
  private phase: GaitPhase = 'both';
  /** ★ 该迈哪条腿（由载荷决定： unloaded 的那条迈） */
  private swing: Leg | null = null;
  private t = 0;
  private tPhase = 0;
  private tStep = 0;
  private tAdjust = 0;
  private mosAcc = 0;
  private mosN = 0;
  private placeAcc = 0;
  private placeN = 0;
  private shapeAcc = 0;
  private shapeN = 0;
  private pelvisAcc = 0;
  private lastCredit = 0;
  private accCredit = 0;
  private nStep = 0;
  private nAdjustOk = 0;
  private flickers = 0;
  private adjSum = 0;
  private evs: StateEvent[] = [];
  private peakClr = 0;   // 本次迈步的离地峰值（诊断）
  private mosEnd = 0;    // 调整窗末的 MoS（诊断）

  reset(): void {
    this.phase = 'both'; this.tStep = 0; this.tAdjust = 0;
    this.mosAcc = 0; this.mosN = 0; this.placeAcc = 0; this.placeN = 0;
    this.shapeAcc = 0; this.shapeN = 0; this.pelvisAcc = 0;
    this.lastCredit = 0; this.accCredit = 0;
    this.nStep = 0; this.nAdjustOk = 0; this.flickers = 0; this.adjSum = 0;
  }

  get now(): GaitPhase { return this.phase; }
  /** ★ 该迈哪条腿（null = 双脚着地，没有"该迈的腿"） */
  get swingLeg(): Leg | null { return this.swing; }
  /** ★★ 身体该不该动：只有"稳住中"才允许动（用户："迈步时身体别动，落地后再动"） */
  get bodyFree(): boolean { return this.phase === 'adjust'; }
  /** 调试标签 */
  get label(): string { return stateLabel(this.phase, this.swing, this.bodyFree); }
  /** 状态转移轨迹（含"哪个状态没通过"） */
  get trace(): readonly StateEvent[] { return this.evs; }
  /** 正在"调整身体"阶段（此时其它项才允许计分） */
  get inAdjust(): boolean { return this.phase === 'adjust'; }
  /** 刚结算完一个循环（那一帧允许把分记进适应度） */
  get justSettled(): boolean { return this.lastCredit > 0; }
  get tally(): CycleTally {
    return {
      nStep: this.nStep, nAdjustOk: this.nAdjustOk, lastCredit: this.lastCredit,
      accCredit: this.accCredit, lastAdjustSec: this.tAdjust,
      meanAdjustSec: this.nAdjustOk > 0 ? this.adjSum / this.nAdjustOk : 0, flickers: this.flickers,
    };
  }

  /**
   * 每控制拍喂一次。
   * @param nGround 接地脚数（0/1/2）
   * @param clearance 本次腾空的最大离地高度（m）—— 用来区分"真迈步"和"抖动"
   * @param mosX 矢状面 MoS（m）
   * @param shape 髋/膝贴合文献参考的分数 0..1
   * @param place 落点贴合捕获点的分数 0..1
   * @param pelvis 盆骨先于膝的分数（可为负）
   * @param dt
   */
  step(
    nGround: number, clearance: number, mosX: number,
    shape: number, place: number, pelvis: number, dt: number,
    swingLeg: Leg | null = null,
  ): void {
    this.t += dt; this.tPhase += dt;
    // ★ 状态持续够久就结算成一条事件（带"为什么没通过"）—— 调试时直接指名哪一个状态不合格
    if (this.tPhase > 0.45) {
      const fail = this.phase === 'step'
        ? (this.swing === null ? '未指定摆动腿' : `摆动腿未离地达标（峰值 ${(this.peakClr * 1000).toFixed(0)}mm < 30mm）`)
        : this.phase === 'adjust'
          ? (this.mosEnd < 0 ? `未稳住（窗末 MoS ${(this.mosEnd * 1000).toFixed(0)}mm < 0）` : `稳住时长不足（${this.tPhase.toFixed(2)}s < ${ADJUST_MIN}s）`)
          : '';
      this.evs.push({ t: this.t - this.tPhase, label: this.label, fail, dur: this.tPhase });
      this.tPhase = 0;
    }
    this.swing = swingLeg;
    // ── 相 1：迈步（单支撑）──
    if (nGround === 1) {
      // ★ 进入新的"迈步相"要清零离地峰值，否则会拿上一次的成绩来判这一次
      if (this.phase !== 'step') this.peakClr = 0;
      this.peakClr = Math.max(this.peakClr, clearance);
      if (this.phase !== 'adjust') { this.phase = 'step'; this.tStep += dt; }
      if (this.phase === 'step' && clearance >= 0.03 && this.tStep >= STEP_MIN) {
        // 迈步达标：进入"调整"相
        this.phase = 'adjust';
        this.nStep++;
        this.tAdjust = 0;
this.mosAcc = 0; this.mosN = 0; this.placeAcc = 0; this.placeN = 0;
        this.mosEnd = 0;
        this.shapeAcc = 0; this.shapeN = 0; this.pelvisAcc = 0;
      } else if (this.phase === 'step' && clearance < 0.03) {
        this.flickers++;      // 抖动：离地不够，不算一步
      }
      return;
    }
    // ── 相 3：双脚着地（过渡）──
    if (nGround === 2) {
      this.phase = 'both'; this.tStep = 0; this.tAdjust = 0;
      this.lastCredit = 0;
      return;
    }
    // ── 相 2：调整（也是单支撑，但是"刚迈完步"的那条腿在撑）──
    if (this.phase === 'adjust') {
      this.tAdjust += dt;
      this.mosAcc += mosX; this.mosN++; this.mosEnd = mosX;
      this.placeAcc += place; this.placeN++;
      this.shapeAcc += shape; this.shapeN++;
      this.pelvisAcc += pelvis;
      // ★ 只有**调整相待够时间**才结算 —— 这就是"迈步间隔要够大才有时间调平衡"
      if (this.tAdjust >= ADJUST_MIN) {
        const mosAvg = this.mosN > 0 ? this.mosAcc / this.mosN : 0;
        const mosScore = mosAvg > ADJUST_MOS_TOL ? 1 : Math.max(0, 1 + mosAvg / 0.25);
        const placeAvg = this.placeN > 0 ? this.placeAcc / this.placeN : 0;
        const shapeAvg = this.shapeN > 0 ? this.shapeAcc / this.shapeN : 0;
        const pelvisAvg = this.pelvisAcc;
        const credit = W_SHAPE * shapeAvg + W_MOS * mosScore + W_PLACE * placeAvg
          + W_PELVIS * Math.max(0, Math.min(1, pelvisAvg));
        this.lastCredit = credit;
        this.accCredit += credit;
        this.nAdjustOk++;
        this.adjSum += this.tAdjust;
        this.phase = 'both'; this.tStep = 0; this.tAdjust = 0;
        this.lastCredit = credit;      // 保留一帧供 sim 记账
      }
      return;
    }
    // nGround === 0（两脚都飞）：不属于任何相，取消当前循环
    this.phase = 'both'; this.tStep = 0; this.tAdjust = 0; this.lastCredit = 0;
  }
}
