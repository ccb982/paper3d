/**
 * "迈步 → 稳住"的课程式奖励（用户 2026-10-02）：
 * > 交替奖励不得太快，教会迈步之后的稳住才行，甚至要把迈步之后能稳住也纳入奖励之中。
 *
 * ── 文献依据（这一节是立论基础，全部可量化）──────────────────────────
 * ① 【稳定裕度 MoS】Hof et al. 2005：MoS = BoS边缘 − XCoM，其中
 *    **XCoM = x + ẋ/ω**（速度修正的质心位置）。MoS > 0 才是**动态稳定**；
 *    MoS < 0 叫"不稳的一步"（Pai & Patton 1997 同源）。MoS 与"把身体推倒所需的冲量"
 *    直接成正比。
 * ② 【人把 MoS 维持在近似恒定值】Hof 2008；Rosenblatt & Grabiner 2010、
 *    MacLellan & Patla 2006：平均 MoS 在不同地面/跑台/截肢患者上都近似不变
 *    ⇒ 人**用落脚位置来控制 MoS**。所以奖励不该是"越稳越好"（越大越不可能），
 *    而是"**MoS 落在合理带内**"。
 * ③ 【迈步不能太快】Maki et al.：摆动 30 ms 太快 ⇒ 支撑域来不及减速 CoM；
 *    把摆动延长到 **~270 ms** 才能达到最大稳定性；实测人们**主动比"最小稳定值"
 *    多花约 135 ms**，得到约 80% 的最优稳定性。行为上**明显偏重稳定性而非速度**。
 *    Hof et al. 2010：侧向落脚需要 **~0.28 s**。
 * ④ 【不稳的步会被立刻修正】Dingwell/Cusumano 的一回归分析：MoS<0 的步
 *    几乎总是紧跟一个 MoS≥0 的步（Q4 象限）⇒ "迈步后能稳住"在数据上就等于
 *    **"这一步不稳、下一步稳"**，这正是人类步态里 recovery step 的判据。
 * ⑤ 【三种策略的次序】Horak & Nashner 1986/1987：踝策略、**髋策略（近端）**、
 *    迈步策略；扰动变大时**髋与迈步策略先于踝策略到达极限**出现
 *    ⇒ 近端（骨盆）优先（见 gaitRef.ts 的 PelvisFirstTracker）。
 *
 * ── 设计要点：奖励"稳住过的步"，而不是"迈出去的步" ────────────────────
 * 交替奖励过快会被"抖动刷分"：步数越多、按时间平均的分越高。
 * 这里的做法是**按"结算过的步"计价**：
 *   一步要拿到分，必须 ① 摆动时间 ≥ MIN_SWING（文献③）② 随后的 SETTLE 窗口内
 *   MoS 保持 ≥ 0（文献①④）。快速抖动 ⇒ 摆动太短 ⇒ 一分不给。
 * 于是"交替得慢但每步都稳住"才是最优解 —— 这正是文献里人的策略。
 */

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export { clamp01 };

/** MoS：XCoM = x + ẋ/ω（Hof 2005）。返回**有符号**裕度，正 = 稳定。 */
export function marginOfStability(
  comX: number, comVx: number, om: number, supEdgeX: number, comZ: number, comVz: number,
  supEdgeZ: number,
): { x: number; z: number } {
  const xcoM = comX + (om > 1e-3 ? comVx / om : 0);
  const zcoM = comZ + (om > 1e-3 ? comVz / om : 0);
  return { x: supEdgeX - xcoM, z: supEdgeZ - zcoM };
}

/** 最小摆动时长（s）：Hof 2010 侧向落脚需 ~0.28 s；Maki 指出 30 ms 太快 */
export const MIN_SWING = 0.28;
/** "稳住"观察窗：触地后这段时间内 MoS 要保持非负 */
export const SETTLE_WIN = 0.45;
/** MoS 目标带（m）：下界 0（不倒），上界按"人维持恒定 MoS"取一个够用但不宽松的值 */
export const MOS_TARGET = 0.30;
/**
 * ★ "像婴儿学步"：两次触地之间的**最小间隔**（s），用户 2026-10-02：
 *   "必须要和婴儿学步一样，再增大每步间隔一点，重点必须是每一步之后的稳定"。
 *   ⇒ 步频被限制在 1/MIN_CYCLE。发育依据：4 岁前儿童质心垂直/侧向摆幅显著大于
 *   成人、速度更低（McNair 2004）—— 婴儿式步态就是"慢、晃、每步都停一下"。
 *   默认 0.9 s ⇒ ≤1.1 步/秒（成人约 1.8~2.0 步/秒，所以这确实更"婴儿"）。
 */
export const MIN_CYCLE = 1.0;
/**
 * ★★ 步幅目标：**2~3 个脚长**。
 *   文献：Usherwood 2023（*The collisional geometry of economical walking*,
 *   J R Soc Interface）用碰撞力学推出：一步长度 S = 2（点质量模型）或 3（无限转动惯量
 *   模型）个**脚长**，并明确指出"明显短于 2 脚长或长于 3 脚长的步态显得别扭、
 *   也很少观察到"。
 *   用户 2026-10-02："先稳定步幅"——步幅必须**有目标**，否则"越快越好"会让策略抽搐。
 *   脚长用实测值（rig 的鞋底长约 0.22 m，见 src/data/limbAxes.json）。
 */
export const STEP_LEN_IN_FEET = [2.0, 3.0] as const;

/** 把实际步长换算成"脚长"单位的目标分：落在 [2,3] 得 1，偏离按脚长数衰减 */
export function stepLenScore(stepLenM: number, footLenM: number): number {
  if (footLenM <= 1e-6) return 0;
  const f = stepLenM / footLenM;
  const [lo, hi] = STEP_LEN_IN_FEET;
  if (f >= lo && f <= hi) return 1;
  // 偏离按"脚长"归一，超出 1.5 个脚长就得 0
  const d = f < lo ? lo - f : f - hi;
  return Math.max(0, 1 - d / 1.5);
}
/** MoS 带内得分高于下界的比例（带内线性上升，到 MOS_TARGET 满分） */
export const mosBand = (mos: number): number => {
  if (mos < 0) return -clamp01(-mos / 0.25);          // 不稳：罚（越负越罚）
  if (mos <= MOS_TARGET) return clamp01(mos / MOS_TARGET);
  // 太大：不是"更稳"，而是"已经在往前扑" ⇒ 缓慢衰减
  return Math.exp(-2 * ((mos - MOS_TARGET) / 0.4) ** 2);
};

/** 单腿的迈步-稳住跟踪器。 */
export class StepSettleTracker {
  /** 脚长（m）：步长目标"2~3 个脚长"要用（见 STEP_LEN_IN_FEET） */
  footLenM = 0.22;
  // ⚠ 初始必须是 **settle**（"正站着"），不是 swing。
  //   我第一版初始化成 'swing'，结果一条**从不离地**的腿被当成"刚落地、摆动 0 秒"
  //   ⇒ 站桩的镇定器被判了 26 次"摆动太快"（实测），奖励完全反了。
  private phase: 'swing' | 'settle' = 'settle';
  private swungTicks = 0;              // 本次离地确实观测到的帧数（0 = 一直踩着）
  // ★ 接触去抖：Rapier 的接触信号会**抖动**（脚在空中偶发一帧接地）。
  //   不去抖的话，teacher 实测被判了 9 次"摆动太快"——摆动计时被那一帧清零。
  private airRun = 0; private gndRun = 0;
  private static readonly MIN_RUN = 2;      // 连续 2 帧才算真的换状态
  /**
   * ★ 构成"一步"所需的**最小腾空帧数**（4 帧 ≈ 33 ms）。
   *   没有它的话，接触抖动（站桩时脚会偶发 2 帧"离地"）会被当成迈步：
   *   实测站着的镇定器因此拿到 **24 个结算步**。33 ms 的门槛把抖动全部挡掉，
   *   同时远小于 MIN_SWING=0.28 s，不会误伤真正的短摆动。
   */
  private static readonly MIN_FLIGHT = 4;
  private tSwing = 0;
  private tSettle = 0;
  private mosMin = Infinity;          // 本步 settle 窗内的 MoS 最小值
  private mosEnd = 0;                 // settle 窗**结束**时的 MoS（"最后稳住了"的判据）
  private mosAtTouch = 0;             // 触地瞬间的 MoS（用来判"这一步稳不稳"）
  private credit = 0;                 // 本步结算出的分
  private tSinceLast = 1e9;           // 距上次结算过了多久（用于最小步间隔）
  private accCredit = 0;              // 累计结算分（渐进塑形，进适应度用）
  // ★ 步长记账：**只在结算步上累计**（稳不住 ⇒ 步长一分不给，这是"先稳定步幅"的落点）
  private accLenScore = 0;
  private lenSum = 0;
  private lenSumN = 0;
  private prevTouchX = NaN;
  private lastStepLen = 0;
  private tooFast = 0;
  private settled = 0;
  private unstableSteps = 0;
  private flights = 0;              // 被识别为"一步"的次数（不论稳不稳）
  private recovered = 0;
  /** 上一结算步的 MoS（−1 = 还没有） */
  private prevTouchMos = -1;
  private stepT = 0;                  // 本步总时长

  reset(): void {
    this.phase = 'settle'; this.tSwing = 0; this.tSettle = 0; this.swungTicks = 0;
    this.accCredit = 0; this.airRun = 0; this.gndRun = 0; this.tSinceLast = 1e9;
    this.mosMin = Infinity; this.mosAtTouch = 0; this.credit = 0; this.tooFast = 0;
    this.settled = 0; this.unstableSteps = 0; this.recovered = 0; this.flights = 0;
    this.prevTouchMos = -1; this.stepT = 0;
  }

  get settleRatio(): number { return this.settled; }
  /** 累计结算分（渐进塑形，0..~1 每次） */
  get creditSum(): number { return this.accCredit; }
  /** ★ 累计"结算步的步长分"（只有稳住且间隔够的步才计入） */
  get lenCredit(): number { return this.accLenScore; }
  /** 结算步的平均步长（m），诊断用 */
  get meanStepLen(): number { return this.lenSumN > 0 ? this.lenSum / this.lenSumN : 0; }
  get settledCount(): number { return this.lenSumN; }
  /** 诊断快照：为什么没结算（一行看完状态机） */
  debug(): string {
    return `phase=${this.phase} swung=${this.swungTicks} tSwing=${(this.tSwing * 1000).toFixed(0)}ms`
      + ` tSettle=${(this.tSettle * 1000).toFixed(0)}ms mosEnd=${(this.mosEnd * 1000).toFixed(0)}mm`
      + ` settled=${this.settled} tooFast=${this.tooFast} flights=${this.flights} air=${this.airRun} gnd=${this.gndRun}`;
  }
  get fastCount(): number { return this.tooFast; }
  /** 被识别成"一步"的次数（诊断用：机制有没有在工作） */
  get flightCount(): number { return this.flights; }
  get unstable(): number { return this.unstableSteps; }
  get recoveredCount(): number { return this.recovered; }

  /**
   * @param grounded 该脚是否着地（原始接触信号，会抖动）
   * @param mosX 矢状面 MoS（m，正 = 稳定）
   * @param dt
   * @returns 本拍该脚拿到的分（带符号；负 = 罚）
   */
  step(grounded: boolean, mosX: number, dt: number, footX = NaN): number {
    // ---- 接触去抖：连续 2 帧才算真的换了状态 ----
    if (grounded) { this.gndRun++; this.airRun = 0; } else { this.airRun++; this.gndRun = 0; }
    const air = this.airRun >= StepSettleTracker.MIN_RUN;      // 真的离地了
    const gnd = this.gndRun >= StepSettleTracker.MIN_RUN;      // 真的踩住了
    if (!air && !gnd) return 0;                                // 抖动帧：什么都不做

    this.tSinceLast += dt;
    if (air) {
      // ── 摆动相 ──
      if (this.phase === 'settle') {
        // 上一步还没走完稳住窗口就又抬脚 ⇒ 属于"抖"，上一步作废
        this.credit = 0;
        this.phase = 'swing';
        this.tSwing = 0; this.tSettle = 0; this.mosMin = Infinity; this.stepT = 0;
      }
      this.swungTicks++;
      this.tSwing += dt;
      return 0;
    }

    // ── 着地相 ──
    if (this.phase === 'swing') {
      if (this.swungTicks < StepSettleTracker.MIN_FLIGHT) {
        // 腾空不足 4 帧 ⇒ 那是**接触抖动**，不是"迈了一步"：不给分、不计数、不罚。
        // （否则站桩会被反复判成"零时长摆动的步"：实测拿到 24 个结算步。）
        this.phase = 'settle'; this.tSettle = 0; this.mosMin = mosX; this.mosEnd = mosX;
        this.swungTicks = 0;
        return 0;
      }
      this.flights++;
      // ★ 步长 = 本次落点 − 上次落点（**脚的世界 x**，与"距离以脚为准"同一口径）
      if (Number.isFinite(footX)) {
        if (Number.isFinite(this.prevTouchX)) this.lastStepLen = footX - this.prevTouchX;
        this.prevTouchX = footX;
      }
      this.mosAtTouch = mosX;
      if (this.mosAtTouch < 0) this.unstableSteps++;
      this.phase = 'settle';
      this.tSettle = 0;
      this.mosMin = mosX;
      this.mosEnd = mosX;
      this.stepT = this.tSwing;
      // ③ 摆动时长不足 ⇒ 记一次"太快"，但**用渐进塑形**而不是一刀切。
      //   ⚠ 原来这里是硬阈值：tSwing < MIN_SWING 就直接 0 分且倒扣。
      //   后果实测：ES 现有的迈步只有 ~0.1 s 摆动，硬阈值让它**一步都拿不到分**，
      //   `steptrain` 从 altCount=7 掉回 0 —— 悬崖式奖励把梯度也一起砍掉了。
      //   改成 paceFrac = clamp01(tSwing / MIN_SWING)：0.1 s → 0.36 分，0.28 s → 满分，
      //   "慢而稳"始终严格优于"快而抖"，但存在可爬升的坡。
      if (this.tSwing < MIN_SWING) {
        this.tooFast++;
        this.credit = 0;
        return 0;
      }
      return 0;
    }
    // ── 稳住窗口：持续按 MoS 给梯度分（**只在真步的窗口内**，否则站桩能靠 MoS 刷满）──
    if (this.swungTicks > 0) this.accCredit -= 0;   // 保持可读：真正累加在下面的 gain 里
    this.tSettle += dt;
    this.mosMin = Math.min(this.mosMin, mosX);
    this.mosEnd = mosX;
    const gain = mosBand(mosX) * dt;
    // ⚠ 用 -dt/2 的容差：否则 tSettle 恰好停在 0.4499… 时永远结不了算（我踩过）
    if (this.tSettle >= SETTLE_WIN - dt * 0.5) {
      // ★ 步速分：摆动时长相对 MIN_SWING 的达成度（0..1，渐进）
      const paceFrac = clamp01(this.stepT / MIN_SWING);
      // ★ 判"稳住了"用**窗口结束时的 MoS**（mosEnd ≥ 0），不是整窗最小值。
      //   理由来自文献④：MoS<0 的步**总是**紧跟一个 MoS≥0 的步（Q4 象限），
      //   也就是说"这一步一开始不稳、最后稳住了"正是人类 recovery step 的样子。
      //   如果用"整窗最小值 ≥ 0"来判，recovery step 永远无法被认定（我踩过）。
      const okStable = this.mosEnd >= 0;
      const cleanStable = this.mosMin >= 0;
      // ★ 婴儿学步：间隔不够（上一结算步离现在太近）⇒ 不给结算分，只记一次"太快"
      const cycleOk = this.tSinceLast >= MIN_CYCLE;
      if (!cycleOk) this.tooFast++;
      if (okStable && cycleOk) {
        // ★ 计数只认"步速达标"的步（诊断 + 罚分用）；但**适应度看到的分是渐进的**，
        //   短摆动也能拿 paceFrac 那一部分 —— 这样 ES 才有坡可爬（见上面的注释）。
        if (this.stepT >= MIN_SWING) this.settled++;
        // ★★ 步幅只在**结算步**上计价，目标 2~3 个脚长（Usherwood 2023）。
        //   抽搐式的高速蹭脚：步长再大也拿不到这一分。
        this.lenSum += this.lastStepLen; this.lenSumN++;
        this.accLenScore += stepLenScore(this.lastStepLen, this.footLenM);
        this.credit = paceFrac * (cleanStable ? 1 : 0.7);
        if (this.mosAtTouch < 0) this.recovered++;
      } else {
        this.credit = okStable ? 0 : paceFrac * 0.3;   // 没稳住：只给很少的分
      }
      this.accCredit += this.credit;
      this.tSinceLast = 0;
      this.prevTouchMos = this.mosAtTouch;
      this.phase = 'swing';
      this.tSwing = 0; this.tSettle = 0; this.mosMin = Infinity; this.swungTicks = 0;
    }
    return gain;
  }

  /** 本步结算出的总分（0 或 1，或 0.3） */
  get lastCredit(): number { return this.credit; }
}
