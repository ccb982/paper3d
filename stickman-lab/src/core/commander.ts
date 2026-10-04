// ═══════════════════════════════════════════════════════════════════════
//  ★★★ 发令者 / 伺服层 分离（用户 2026-10-02）
// ═══════════════════════════════════════════════════════════════════════
//  用户原话：
//    "也不能说是模块开关这么简单，应该是主动发令控制一个模块，
//     其余模块进行调整和平衡的稳定。主动发令顺序就是腿、腰、腿这样。
//     但是是只发令，别精确控制腿部落点这样。
//     这样兼具程序化指令和机器学习的反应随机性"
//
//  ⇒ 这不是"开关"，是**分层控制**（iCub 的 hierarchical / layered control）：
//
//    第 1 层  发令者 Commander（离散、顺序、低维）
//      只说三件事：**哪条腿**、**什么时候到腰**、**该走了没有**。
//      绝不说"脚落在 x=0.35 m"这种连续量 —— 那是伺服层的活。
//      顺序固定：左腿 → 腰 → 右腿 → 腰 → …
//
//    第 2 层  伺服 Servo（连续、高维、只稳不指）
//      落地位置、MoS、WBAM、摆动相身体冻结……
//      它们**永远待命**，但只在被需要时**修正**，不负责发令。
//      人体也是这个结构：脊髓先给"迈左腿"的意向（皮层→下行），
//      落点由脊髓反射 + 视觉前馈实时修正，而不是大脑逐点指定。
//
//  ⇒ "程序化指令 + 机器学习反应随机性"就落在 jitter 上：
//    发令的**时刻**由 `jitter` 扰动（可注入：默认探索噪声，也可换成学出来的 policy），
//    而发令的**内容**永远是离散顺序 ⇒ 既有程序的骨架，又有反应的随机。
// ═══════════════════════════════════════════════════════════════════════

import type { Leg } from './gaitPhase';
// ★ 步态周期的唯一真源（见 `gaitState.STEP_CYCLE_SEC` 的说明）。
//   只 import 一个**常数**、不引入状态 ⇒ 对 ES 路径没有运行时耦合，
//   但把"节拍周期是多少"这件事收敛到一处。
import { STEP_CYCLE_SEC } from './gaitState';

/** 一条发令：只表示"该动哪一块"，不含任何位置/角度目标 */
export type Order = 'legL' | 'legR' | 'waist';

/** 发令的中文标签（调试直接打印） */
export function orderLabel(o: Order | null): string {
  if (o === 'legL') return '发令：迈左腿';
  if (o === 'legR') return '发令：迈右腿';
  if (o === 'waist') return '发令：转腰调身';
  return '发令：无';
}

/** 该发令属于哪条腿（腰归属 null） */
export function orderLeg(o: Order | null): Leg | null {
  return o === 'legL' ? 'l' : o === 'legR' ? 'r' : null;
}

/** 一次发令的时间线记录 */
export interface OrderEvent {
  t: number;
  order: Order;
  /** 上一条发令到这一条的实际间隔（含随机抖动） */
  gap: number;
  /** 是否因为"伺服说还没稳住"而推迟 */
  delayed: boolean;
}

export interface CommanderOpts {
  /**
   * ★ **迈步间隔**（s）：从"迈左腿"到"迈右腿"的**节拍目标**周期。
   *
   *   ⚠ 它与 `gaitState.stepIntervalSec`（**下限**，用户定调 ≥1s）**角色不同**：
   *     本值是"打算多久换一次"，那个是"至少隔多久才允许换"。
   *     ⇒ 不变式 `下限 ≤ 目标` 由门禁 `probe:axisown` G7 断言。
   *   ⚠ 默认值取自 `STEP_CYCLE_SEC`（唯一真源）。此前这里硬写 `1.6`，
   *     而 `stability.TARGET_CYCLE` 硬写 `1.0`、`stepIntervalSec` 也硬写 `1.0`
   *     —— 同一个物理量三处互不相干。
   *
   *   注意：这是**腿到腿**的周期，不是单条令的时长 —— 一个周期里有
   *   `迈腿 → 转腰` 两条令，所以每条令的时长 ≈ stepPeriod/2。
   *   （之前只给了 `minDur` 而没有"迈步间隔"这个量，导致实测腿到腿只有 0.57 s。）
   */
  stepPeriod: number;
  /** 间隔随机抖动的幅度（s，±）：这就是"反应随机性"的注入口 */
  jitter: number;
  /** 腰令占周期的比例（其余留给迈腿） */
  waistShare: number;
  /** 随机数（0..1），默认用确定性 LCG，保证可复现 */
  rand?: () => number;
}

export class GaitCommander {
  /** 固定顺序：腿 → 腰 → 腿 → 腰 → …（用户指定的节奏） */
  private readonly seq: readonly Order[];
  private idx = 0;
  private tCur = 0;
  private tAbs = 0;      // ★ 绝对时间：时间线要显示真实时刻，不是恒为 0
  private tLast = -1;
  private dNeed = -1;      // ★ 本条令的时长（发令时抽一次抖动并锁定）
  private cur: Order | null = null;
  private lastDelayed = false;
  private readonly rand: () => number;
  /** 发令时间线（调试） */
  readonly events: OrderEvent[] = [];
  /** 本回合发了多少条令 */
  nOrders = 0;

  constructor(seq: readonly Order[] = ['legL', 'waist', 'legR', 'waist'], private o: CommanderOpts = { stepPeriod: STEP_CYCLE_SEC, jitter: 0.15, waistShare: 0.5 }) {
    this.seq = seq;
    // 确定性 LCG（可注入真正的 policy 输出来替换 —— 见 note）
    let s = 12345;
    this.rand = o.rand ?? (() => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; });
    // note: 想让"什么时候发令"由**学习**决定时，把 rand 换成一个由 brain 驱动的函数即可，
    //       其余结构（离散顺序 + 伺服分离）完全不用动。
  }

  reset(): void { this.idx = 0; this.tCur = 0; this.tAbs = 0; this.tLast = -1; this.dNeed = -1; this.cur = null; this.events.length = 0; this.nOrders = 0; }
  get now(): Order | null { return this.cur; }
  get label(): string { return orderLabel(this.cur); }

  /**
   * 推进发令者。
   * @param dt       控制周期
   * @param ready    **伺服层的反馈**："上一个动作已经稳住/落地了，可以发下一条令"。
   *                 发令者等这个才走 —— 这就是"其余模块进行稳定"的接口。
   */
  step(dt: number, ready: boolean): void {
    this.tCur += dt;
    this.tAbs += dt;
    // ★★★ 抖动必须**发令时抽一次就锁定**（dNeed），不能每帧重掷。
    //   之前写成每帧重抽 `need` ⇒ 等效于"每帧和随机数比大小"，实际时长远短于 minDur：
    //   实测单条令只有 0.20~0.30s，而 minDur 写的是 0.28s ⇒ 腿到腿只有 0.57s。
    if (this.dNeed < 0) {
      // ★ 由**迈步间隔**推出单条令时长：一个 stepPeriod 里有 2 条令
      //   （迈腿 + 转腰），腰令占 waistShare，其余给迈腿。
      //   抖动按比例缩放，保持"间隔≈1s"这个主目标不被抖动吃掉。
      const base = this.o.stepPeriod / 2 * (this.cur === 'waist' ? this.o.waistShare : 2 - this.o.waistShare);
      this.dNeed = Math.max(0, base * (1 + (this.rand() * 2 - 1) * this.o.jitter));
    }
    const canGo = this.tCur >= this.dNeed && ready;
    if (!canGo) return;
    if (!this.cur) { this.cur = this.seq[this.idx]!; this.tCur = 0; this.tLast = this.tAbs; this.nOrders++; this.events.push({ t: this.tAbs, order: this.cur, gap: 0, delayed: false }); return; }
    // 换下一条令
    const gap = this.tCur;
    // ★ "被伺服推迟"：等 ready 的时间超���了 minDur 才拿到许可
    const wasDelayed = gap > this.dNeed + 0.05;
    this.idx = (this.idx + 1) % this.seq.length;
    this.cur = this.seq[this.idx]!;
    this.tCur = 0;
    this.dNeed = -1;      // ★ 下一条令重抽抖动（锁定，不是每帧抽）
    this.lastDelayed = wasDelayed;
    this.nOrders++;
    this.events.push({ t: this.tAbs, order: this.cur, gap, delayed: wasDelayed });
  }
  get wasDelayed(): boolean { return this.lastDelayed; }

  /** 调试时间线 */
  timeline(): string {
    return this.events.map(e => `${e.t.toFixed(2)}s ${orderLabel(e.order)}`).join('  →  ');
  }
}