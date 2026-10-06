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
  state: GaitState;
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
  /** 帧域越界项数 / 最差偏差（deg） */
  domainBad: number;
  domainWorst: number;
}

// 关节索引缓存（`RigState` 构造时绑定一次；避免每拍 `findIndex`）
const JIDX = { l: { hip: -1, knee: -1, foot: -1 }, r: { hip: -1, knee: -1, foot: -1 } };

/** ★ 逐状态验收表。**新增状态或改判据只改这一张表**。 */
export const VERIFY: Readonly<Record<GaitState, readonly VerifySpec[]>> = Object.freeze({
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
    // ★ 手性不变式：本周期的摆动腿不能与上周期相同
    //   （SCONE/EPFL 是每腿一个 FSM，左右交替由结构保证；我们是周期级 FSM，
    //     不显式写死就会「一直用同一条腿摆动」）
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
 * ★ 帧域检查：实际姿态是否落在「本状态该有的区间」内（`STATE_DOMAINS`）。
 *
 *   两段式迟滞（Rezazadeh 2018 的 FSM：`q > q₄₁` 进 S2、`q < q₄₃` 回 S1）：
 *   · 评估「**进入**下一态」时用 `tolIn`（严）
 *   · 「**保持**」本态时用 `tolOut`（松）
 *   没有它，接触噪声会让状态逐帧抖（旧实现「20 拍全 DOUBLE」就有这一份）。
 *
 * @param entering 是否在评估「进入下一态」⇒ 用严容差
 */
export function checkDomains(
  rs: RigState, state: GaitState, sup: Side, sw: Side, entering: boolean,
): { bad: number; worst: number } {
  const legDeg = (leg: Side, axis: StateDomain['axis']): number => {
    switch (axis) {
      case 'hipFlex': return rs.angle(JIDX[leg].hip, 2) / DEG;
      case 'hipAbd': return rs.angle(JIDX[leg].hip, 0) / DEG;
      case 'kneeFlex': return rs.angle(JIDX[leg].knee, 2) / DEG;
      case 'ankle': return -rs.angle(JIDX[leg].foot, 2) / DEG;   // 正 = 跖屈
      default: return 0;
    }
  };
  let bad = 0;
  let worst = 0;
  const hit = (q: number, d: StateDomain): void => {
    const tol = entering ? d.tolIn : d.tolOut;
    const over = Math.max(d.lo - q, q - d.hi, 0);
    if (over > tol) { bad++; worst = Math.max(worst, over - tol); }
  };
  for (const d of stateDomains(state)) {
    if (d.leg === 'trunk') continue;
    hit(legDeg(d.leg === 'support' ? sup : sw, d.axis), d);
  }
  for (const d of stateDomains(state, 'trunk')) {
    hit(d.axis === 'trunkPitch' ? rs.pitchDeg : rs.rollDeg, d);
  }
  return { bad, worst };
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
  readonly event: ExchangeEvent = { kind: 'none', note: '' };

  constructor(private rs: RigState, cfg: GaitConfig = DEFAULT_GAIT_CONFIG) {
    this.cfg = cfg;
    const nm = (n: string): number => rs.sk.joints.findIndex((j) => j.name === n);
    JIDX.l = { hip: nm('hip_l'), knee: nm('knee_l'), foot: nm('foot_l') };
    JIDX.r = { hip: nm('hip_r'), knee: nm('knee_r'), foot: nm('foot_r') };
  }

  stateLabel(s: GaitState): string { return STATE_LABEL[s]; }
  stateOrder(s: GaitState): number { return STATE_ORDER.indexOf(s); }

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

    // ── 角色：承重腿 = **载荷优势腿**（唯一判据；SCONE/OSL 同口径）──
    //   ⚠ 不再"锁定优先"：旧实现锁承重腿，四篇实现一致由**载荷**决定承重腿。
    const sup = rs.loadDominant(rs.loadBearer, cfg.bearerLoadHyst);
    rs.loadBearer = sup;
    const sw: Side = sup === 'l' ? 'r' : 'l';
    const front = rs.frontLeg();
    const rear = rs.rearLeg();
    /** 承接腿 = 本周期要成为承重腿的那只 = 前腿（几何 x 靠前） */
    const recv = front;

    // ── 帧域检查（评估「进入下一态」⇒ 严容差）───────────────────
    const dm = checkDomains(rs, rs.state, sup, sw, true);

    // ── 角速度（OSL `knee_vel` / EPFL `LP`）─────────────────────
    const swingKneeVel = (rs.jointVel(JIDX[sw].knee, 2) ?? 0) * DEG;

    const ctx: VerifyCtx = {
      rs, cfg, state: rs.state, sup, sw, front, rear, recv,
      touchdown, liftoff, swingKneeVel,
      clearance: rs.swingClearance, sinceStep: this.t - this.lastStepT,
      domainBad: dm.bad, domainWorst: dm.worst,
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
    if (touchdown.sw) {
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
    } else if (rs.verified && dwellOk) {
      rs.state = NEXT_STATE[rs.state];
      rs.stateT = 0;
      this.event.kind = 'state_change';
      this.event.note = `${prev} → ${rs.state}`;
    } else if (rs.stateT > cfg.tmaxSec) {
      rs.state = 'DOUBLE'; rs.stateT = 0;
      rs.locked.l = false; rs.locked.r = false;
      this.event.kind = 'state_change';
      this.event.note = `${prev} 超时 ${cfg.tmaxSec}s ⇒ 回 DOUBLE`;
    }
    if (touchdown.sw) {
      this.event.kind = 'touchdown'; this.event.side = sw; this.event.note = `触地并锁定 ${sw}`;
    } else if (liftoff.sw) {
      this.event.kind = 'liftoff'; this.event.side = sw; this.event.note = `离地 ${sw}`;
    }

    rs.stateT += dt;

    // ── α(t)：腰的修正权限预算（**不是**迁移判据）────────────────
    rs.authority = smoothAuthority(rs.state, rs.stateT, cfg.authorityRamp, cfg.alphaSigma);

    // 判据快照（UI 用；`handover` 这一项现在是「重量交接」的逐项明细）
    rs.handoverCriteria = makeCriteria(flags, values);
    rs.handoverOk = rs.verified;
    rs.unlockCriteria = rs.stepPermit;
    return this.event;
  }

  reset(): void {
    this.t = 0; this.lastStepT = -1e9; this.badT = 0;
    this.wasGrounded.l = false; this.wasGrounded.r = false;
    const rs = this.rs;
    rs.loadBearer = null; rs.locked.l = false; rs.locked.r = false;
    rs.state = 'DOUBLE'; rs.stateT = 0; rs.authority = 0;
    rs.verified = false; rs.violations = []; rs.safe = false;
    rs.lastSwing = null; rs.cycleCount = 0;
  }
}

/** 兼容别名：旧代码按 `PHASE_*` 取，这里保留一份指向新表的别名 */
export const PHASE_TO_SCORING = STATE_TO_SCORING;
export function phaseStance(s: GaitState): 'single' | 'double' { return stateStance(s); }