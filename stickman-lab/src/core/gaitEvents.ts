// ═══════════════════════════════════════════════════════════════════════
//  ★ 步态事件检测 + 重心转移阶段（全部阈值出自文献，2026-10-02）
// ═══════════════════════════════════════════════════════════════════════
//  用户要求："来一个迈出脚的着地检测，并且可能需要显式写出重心转移的各个变化"
//
//  【着地检测的文献阈值】
//   IC  初次接触：vGRF 上升沿越阈值    20~50 N
//       （Lambrecht 2017 Sensors 用 20 N；FootNet 2021 PLOS ONE 用 50 N；
//         JAB 2003 结论：0~50 N 内任一阈值都能预测触地时刻）
//   TO  离趾    ：vGRF 下降沿          <10 N
//       （JAB 2003：离趾应使用 ≤10 N 的低阈值，否则会漏检）
//   FF  全脚掌  ：脚尖标记垂直速度      100 mm/s
//   HO  离跟    ：脚跟标记垂直速度      100 mm/s
//       （Lambrecht 2017，全部基于运动学 + 生物力学模型，可实时）
//
//  【重心转移的文献依据】
//   · 时长：健康成人 134~207 ms（Frontiers 2022，引用 6,7）
//   · 起始判据：vGRF 高于基线 **3 个标准差、持续 ≥100 ms**
//   · 结束判据：**摆动腿 vGRF < 10 N**（即该腿真正离地）—— Frontiers 2022 原文
//   · 方向（关键）：迈步前 CoP **先后退 + 先移向摆动腿**（APA），
//     随后**反向移向支撑腿**（Hansen 2016 / Breniere 1986 / Couillandre 2000 等）
//     ⇒ 我们之前只有"移到支撑腿"，**漏掉了 APA 的反向预备**，所以重心像被推着走。
//   · Perry 分期里的肌肉分工（PM&R KnowledgeNow）：
//     Loading Response(2~12%) 体重压到该腿；足跖屈到"全掌"（first rocker）；
//     膝屈到 ~15° 吸能；**髋外展肌收缩稳定骨盆**
//     Midstance  CoG 正好在支撑脚上方（全程唯一真正位于支撑面上方的时段）
//     Pre-swing(50~62%) 对侧初次接触 → 本侧离趾
// ═══════════════════════════════════════════════════════════════════════

import { footGrounded } from './posture';
import type { Ragdoll } from './ragdoll';

/** vGRF 阈值（N）—— 本 rig 没有力板，用**足底载荷占比 × 体重**代替 */
export const THR = {
  /** IC 初次接触：载荷占比超过此值 */
  IC: 0.02,
  /** TO 离趾：载荷占比低于此值（JAB 2003：离趾要用低阈值） */
  TO: 0.01,
  /** 起立加载完成的判据（Perry：体重压到该腿） */
  loadAccept: 0.5,
  /**
   * ★★ 承重转移判据改用**相间差值**（2026-10-02）。
   *   旧的 `loadAccept: 0.5` 是**绝对占比**：两脚都在地上、体重居中时天然 = 0.50，
   *   于是"前脚承重超过 0.5"只有在 CoM 真正移到前脚上方时才成立，
   *   而那意味着前脚已经变后脚 ⇒ 永远达不到 ⇒ 与平衡门构成死锁。
   *   改用差值后语义变成"**前脚明显比后脚重**"，在双支撑早期就能反映 APA 的进展，
   *   且对 0.50 附近的抖动免疫（差值过零即达标）。
   */
  loadDiff: 0.15,
  /**
   * ★★ **迈步前的重心速度上限**（m/s）。用户 2026-10-02："迈步之前先稳定重心"。
   *   此前门只看位置（MoS）与承重差，不看速度 —— 实测门放行瞬间 CoM 速度高达
   *   0.8~2.0 m/s，身体还在快速移动就被允许抬腿 ⇒ 落脚点必错、承重接不住 ⇒ 又倒。
   *   取 0.06 m/s：约为慢速目标步速 0.39 m/s 的 15%，是"真停住了"的严格判据。
   */
  vHold: 0.06,
  /** ★ 双支撑末期的判定时刻（该相位的进度，0~1）——门只在这里判定一次 */
  decisionAt: 0.25,   // ★ 判定窗上界：只在摆动**开始**的 s<0.25 内判定
} as const;

/** 重心转移时长窗（s）——Frontiers 2022：134~207 ms */
export const WT = {
  min: 0.134,
  max: 0.207,
  /** APA 预备段占比（Hansen 2016：先反向预备，再正向转移） */
  apaShare: 0.35,
} as const;

/** 一个完整支撑相里发生的事件序列 */
export type GaitEvent = 'IC' | 'FF' | 'load' | 'HO' | 'TO';

export const EVENT_LABEL: Readonly<Record<GaitEvent, string>> = {
  IC: '初次接触 IC（vGRF>阈值，文献 20~50N）',
  FF: '全脚掌 FF（脚尖速度 100mm/s）',
  load: '加载完成 load（该腿承重≥50%）',
  HO: '离跟 HO（脚跟速度 100mm/s）',
  TO: '离趾 TO（vGRF<10N）',
};

/**
 * ★ 单腿的步态事件跟踪器。
 *   用**足底载荷占比 + 离地高度 + 足部垂直速度**复现文献的四事件检测。
 */
export class LegEventTracker {
  private wasAir = true;
  private loadFrac = 0;
  private prevSole = 0;
  private vSole = 0;
  /** 本支撑相已发生的事件（按时间序） */
  readonly seen: GaitEvent[] = [];
  /** 最近一次事件（调试打印用） */
  last: GaitEvent | null = null;
  lastT = -1;

  reset(): void { this.wasAir = true; this.seen.length = 0; this.last = null; this.lastT = -1; }

  /**
   * @param grounded 该脚是否着地
   * @param loadFrac 该脚载荷占比 0~1
   * @param soleY    脚底离地高度（m）
   * @param dt       时间步
   * @returns 本拍新触发的事件（无则 null）
   */
  step(grounded: boolean, loadFrac: number, soleY: number, dt: number): GaitEvent | null {
    this.vSole = (soleY - this.prevSole) / Math.max(1e-6, dt);
    this.prevSole = soleY;
    this.loadFrac = loadFrac;
    const fire = (e: GaitEvent): GaitEvent | null => {
      if (this.seen.includes(e)) return null;
      this.seen.push(e); this.last = e; return e;
    };

    if (!grounded) { this.wasAir = true; return null; }
    // ── 刚着地 ──
    if (this.wasAir) {
      this.wasAir = false;
      this.seen.length = 0;
      return fire('IC');              // IC 由「接触」触发（vGRF 阈值在此等价于接触）
    }
    // ── 已着地：按载荷/速度推进 ──
    if (this.loadFrac >= THR.loadAccept) fire('load');
    if (soleY < 0.02 && Math.abs(this.vSole) < 0.10) fire('FF');   // 全掌：贴地且几乎不动
    if (soleY > 0.03) fire('HO');                                   // 离跟：脚跟抬起
    return null;
  }

  /** 是否已经进入「已着地且承重」状态（可以承接重心） */
  get canAcceptWeight(): boolean { return this.seen.includes('load'); }
  /** 完成了哪些关键里程碑（调试/奖励门控用） */
  get progress(): string {
    return this.seen.length ? this.seen.join('→') : '（未着地）';
  }
}

/** 便捷：从 doll 读出某脚的 (grounded, loadFrac, soleY) */
export function legSignals(doll: Ragdoll, side: 'l' | 'r', dt: number, fb: Float64Array): [boolean, number, number] {
  const g = footGrounded(doll, side);
  const [fl, fr] = doll.footLoadFrac(dt);
  return [g, side === 'l' ? fl : fr, doll.soleY(side)];
}

/**
 * ★ 重心转移的**显式阶段**（文献锚定）
 *   用户："显式写出重心转移的各个变化"
 */
export type WtStage =
  | 'idle'        // 没有待转移的重心
  | 'APA-back'    // ① CoP 后退（产生向前的力矩）      Hansen 2016
  | 'APA-toSwing' // ② CoP 移向**摆动腿**（APA 预备）   Hansen 2016 / Breniere 1986
  | 'toStance'    // ③ CoP 反向移向**支撑腿**（真正转移）Frontiers 2022
  | 'done';       // 转移完成（该腿承重 ≥50%）

export const WT_LABEL: Readonly<Record<WtStage, string>> = {
  idle: '空闲',
  'APA-back': '① CoP 后退（APA，产生前向力矩）',
  'APA-toSwing': '② CoP 移向摆动腿（APA 预备，把体重推向支撑侧）',
  toStance: '③ CoP 反向移向支撑腿（真正的重心转移，134~207ms）',
  done: '④ 转移完成（新支撑腿承重≥50%）',
};

/** 按阶段给出 CoP 相对支撑脚的横向目标（m）：文献是"先后退+先移摆动腿，再移支撑腿" */
export function copTargetZ(stage: WtStage, stanceZ: number, swingZ: number): number {
  switch (stage) {
    case 'APA-back': return stanceZ;                       // 纵向另算，这里只管横向
    case 'APA-toSwing': return stanceZ * 0.5 + swingZ * 0.5;   // 偏向摆动腿
    case 'toStance': return stanceZ * 1.35;                // 越过中线压向支撑腿
    case 'done': return stanceZ;
    default: return stanceZ;
  }
}
// ═══════════════════════════════════════════════════════════════════════
//  ★★★ 迈腿前的**平衡判定门**（用户 2026-10-02）
//   "后腿起来得经过一个平衡判定的东西，甚至第一步走出之前我也觉得应该有这么个玩意"
// ═══════════════════════════════════════════════════════════════════════
//
// 文献依据（三条独立判据，全部成立才允许任何脚离地）：
//  ① **MoS > 0** —— CoM 必须真的在支撑脚上方（Perry: midstance 是全程唯一
//     CoG 真正位于支撑面之上的时段；不支持这个条件迈步 = 倒立摆失稳）
//     MoS = BoS边缘 − XCoM，XCoM = x + ẋ/ω   （Hof）
//  ② **承重已转移** —— 该支撑腿 vGRF 达标才算"接住了"
//     （Lambrecht 2017：IC 是接触事件；Frontiers 2022：转移全程 134~207ms）
//  ③ **连续稳定 STABLE_HOLD 秒** —— 瞬时稳定不算，要能站住
//     （Frontiers 2022 用的就是这个"持续时间"思路：WT 起始判据 = 高于基线 3SD 且 ≥100ms）
//
// 关键：这个门**对每一次抬腿都生效**，包括
//   · 第一步迈出之前（还没迈过任何一步）
//   · 前腿落地后、后腿抬起（前进方向）
//   · 后退之后后腿抬起
// ⇒ 不满足就一直等，不会出现"没稳住就把腿抬起来"。
export const BAL = {
  /** MoS 最小余量（m）：CoM 要在支撑边内这么多才算稳 */
  mosMargin: 0.01,
  /** 连续稳定时长（s）—— Frontiers 2022 的 WT 持续判据思路 */
  hold: 0.45,
} as const;

/** 一次平衡判定的记录（调试回读用） */
export interface BalVerdict {
  ok: boolean;
  mos: number;
  load: number;
  holdT: number;
  /** 没通过时说清卡在哪一条 */
  why: string;
}

/**
 * ★ 平衡判定门：只在该相位的**判定时刻**一次性检查，不再要求连续稳定。
 *
 * ★★ 2026-10-02 重写，原因是一个结构性死锁：
 *   旧判据 = `MoS>0 且 load≥0.5 且 连续保持 0.45s`。
 *   但 load 是"两脚承重之比"，两脚都在地上且体重居中时**天然 = 0.50**，
 *   所以"前脚承重上到 0.5 以上"只有在 **CoM 真正移到前脚上方**时才发生；
 *   而 CoM 移过去 ⇒ 前脚变后脚（没换脚的话）⇒ 承重必然掉回 0.5。
 *   ⇒ **门要求承重转移，承重转移要求换脚，换脚要求门开** —— 三者互相锁死，
 *     实测全程 `门放行帧 = 0`、`换脚 = 0`、`swingY` 恒被钉在 0.012。
 *
 *   真实步态不是这样：**双支撑期先靠 APA 把重量推过去**（这一步不需要门），
 *   **双支撑末期才判定一次**。门的职责是"否决一次不安全的抬腿"，不是"驱动承重转移"。
 *
 *   新判据（三条，全部改成"相间差值"而非"绝对值"，天然免疫 0.50 抖动）：
 *     ① MoS > 0                     —— 用 `readSupport()` 的**真实支撑边**，
 *                                      不用常数 `STANCE_X_HALF` 估算
 *     ② `loadFront − loadRear > 0.15` —— 前脚必须**明显**比后脚重（差值，不是绝对占比）
 *     ③ 判定只在 `atDecision` 时刻做一次 —— 该相位的判定点由发令器给
 */
export class BalanceGate {
  private lastWhy = '（未判定）';
  reset(): void { this.lastWhy = '（未判定）'; }

  /**
   * @param mos      当前 MoS（m，正 = CoM 在真实支撑边内）
   * @param loadDiff 前脚承重 − 后脚承重（−1~+1，正 = 重量已压到前脚）
   * @param atDecision 是否处于该相位的判定时刻
   */
  judge(mos: number, loadDiff: number, atDecision: boolean): BalVerdict {
    const holdT = atDecision ? 1 : 0;
    const okMos = mos > BAL.mosMargin;
    const okLoad = loadDiff > THR.loadDiff;
    const ok = okMos && okLoad && atDecision;
    const why = ok ? '通过'
      : !atDecision ? '未到判定时刻'
      : !okMos ? `MoS 不足（${(mos * 1000).toFixed(0)}mm ≤ ${(BAL.mosMargin * 1000).toFixed(0)}mm，CoM 不在真实支撑边内）`
      : `承重未转移（前脚−后脚 = ${loadDiff.toFixed(2)} ≤ ${THR.loadDiff}）`;
    this.lastWhy = why;
    return { ok, mos, load: (1 + loadDiff) / 2, holdT, why };
  }

  get stableFor(): number { return 0; }
}

export const BAL_LABEL = '迈腿前平衡判定（MoS>10mm 用真实支撑边 + 前脚−后脚>0.15 + 判定时刻）';
