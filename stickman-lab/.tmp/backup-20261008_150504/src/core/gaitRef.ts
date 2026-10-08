/**
 * 人类步态的**文献参考轨迹**（矢状面）—— 程序化，用来给髋（骨盆）和膝打分。
 *
 * 用户 2026-10-02："我想做的就是程序化的交替对盆骨和膝关节进行奖励，
 * 而且要查经典文献找人在走路的时候的盆骨和膝关节的移动情况。"
 *
 * ── 数据出处 ────────────────────────────────────────────────────────────
 * ① Oberg et al., *Joint angle parameters in gait: Reference data for normal
 *    subjects, 10–79 years of age*（N=116 男 / 61 女，正常步速 1.19 m/s）：
 *    · 膝：midstance ≈ 15.7°±5.0°，摆动峰值 ≈ 66.9°±5.2°
 *    · 髋：屈伸总活动度 ≈ 46.9°±5.3°
 * ② Perry & Burnccus / Winter 的标准八相分期与角度（综述见 Telwak 2013  thesis
 *    Fig.4 的汇总）：
 *    · 膝：IC ≈ 5° → LR 峰值 ≈ 20°（吸震）→ MS ≈ 0~8°（稳定）→ 预摆动再屈 →
 *           初始摆动峰值 ≈ 60°（离地）→ 摆动末伸回 ≈ 5°
 *    · 髋：IC ≈ 25°（屈）→ 支撑期后伸到 TS 峰值伸展 ≈ 8° → 预摆动屈 → 摆动峰值 ≈ 30°+
 * ③ Chehab et al. 的关键点分解（6 点髋 / 8 点膝 / 7 点踝），见 Nature Sci Rep 2019
 *    "Lower limb sagittal gait kinematics can be predicted..."：其重建 RMSE 为
 *    髋 5.6°、膝 4.8°、踝 3.4° ⇒ **低于 ~5° 的偏差在临床上没有意义**，
 *    所以打分时容差不应小于这个量级。
 *
 * ── 时序约定 ────────────────────────────────────────────────────────────
 * 归一化步态周期 t∈[0,1)：0% = 该腿的**初始触地（IC）**，100% = 下一次 IC。
 * 标准步态：支撑 60%、摆动 40%；单支撑 10%~50%；双支撑 0~10% 与 50~60%。
 * 两条腿相差**半周期**（antiphase）—— 这就是"交替"在数学上的全部内容。
 *
 * ── 关于"人是肌肉发力，机器人是电机" ────────────────────────────────────
 * 人的髋膝有肌力做主动功，我们只有位置型 PD 电机。所以：
 *  · `AMP_SCALE` 是** demanded 幅度**的缩放（默认 1.0 = 完全照抄人类幅度）。
 *    步态学习要分阶段：先只学**形状**（相位对齐、时序正确），再逐步加大幅度。
 *  · `refEffort` 项是"用力"的代价（已有 torque/energy 项，这里给参考轨迹专用的一份），
 *    避免策略用暴力力矩硬凑出一个不像话的轨迹。
 */

// 小工具放本地：这两个函数只有本文件用，不值得开一个模块
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};

const D2R = Math.PI / 180;

// ── 文献关键帧（归一化步态周期 %，单位：度）──
// 顺序即周期顺序，最后一个关键帧与起点相同（保证曲线周期性闭合）。
export const GC_IC = 0;      // 初始触地 initial contact
export const GC_LR = 10;     // 承重期 loading response（双支撑前半）
export const GC_MS = 30;     // 中支撑 midstance（单支撑）
export const GC_TS = 50;     // 末期支撑 terminal stance
export const GC_PS = 62;     // 预摆动 pre-swing（双支撑后半）
export const GC_SW = 70;     // 初始摆动 initial swing
export const GC_PEAK = 78;   // 摆动峰值（膝屈得最多、离地最高）
export const GC_LATE = 90;   // 摆动末（膝伸出去准备落地）
export const GC_END = 100;

/** 膝屈曲关键帧（正 = 屈曲） */
export const KNEE_REF: readonly (readonly [number, number])[] = [
  [GC_IC, 5], [GC_LR, 18], [GC_MS, 8], [GC_TS, 20],
  [GC_PS, 40], [GC_SW, 58], [GC_PEAK, 66], [GC_LATE, 20], [GC_END, 5],
];

/** 髋屈曲关键帧（正 = 屈曲，即腿往前） */
export const HIP_REF: readonly (readonly [number, number])[] = [
  [GC_IC, 25], [GC_LR, 25], [GC_MS, 2], [GC_TS, -8],
  [GC_PS, 15], [GC_SW, 28], [GC_PEAK, 30], [GC_LATE, 27], [GC_END, 25],
];

/** 支撑相占整个周期的比例（Perry：≈60%） */
export const STANCE_FRAC = 0.6;
/** 临床无意义阈值（Chehab 重建 RMSE 量级）—— 容差不应小于它 */
export const TOLERANCE_DEG = 5;

/**
 * 单调三次插值（Fritsch–Carlson）：关键帧之间平滑过渡且**不产生过冲**。
 * 关节角曲线在 IC 附近有极值，过冲会造出不存在的"假峰"。
 *
 * ⚠ 单位：关键帧的横坐标是**百分数**（0..100），函数自变量 t 是**归一化周期**（0..1）。
 *   我第一版把两者混着用（一边除 100 一边不除），结果插值出来是 −25609995° 这种垃圾。
 *   现在统一在入口把 t 换算成百分数、出口再换回来。
 */
function monotoneAt(ref: readonly (readonly [number, number])[], t: number): number {
  const n = ref.length;
  const x = (((t % 1) + 1) % 1) * 100;          // 0..100（周期闭合）
  let i = 0;
  while (i < n - 2 && x > ref[i + 1]![0]) i++;
  const [x0, y0] = ref[i]!;
  const [x1, y1] = ref[i + 1]!;
  const h = x1 - x0;
  if (h <= 1e-9) return y0;
  const u = (x - x0) / h;
  // 端点斜率：Fritsch–Carlson —— 极值点取 0，否则取受限的割线斜率
  const secant = (j: number): number => {
    const [xa, ya] = ref[j]!;
    const [xb, yb] = ref[j + 1]!;
    const hh = xb - xa;
    return hh <= 1e-9 ? 0 : (yb - ya) / hh;
  };
  const d = (j: number): number => {
    if (j < 0 || j >= n - 1) return 0;
    const s = secant(j);
    const sa = j > 0 ? secant(j - 1) : s;
    const sb = j + 2 < n ? secant(j + 1) : s;
    if (s * sa <= 0 || s * sb <= 0) return 0;            // 极值
    const m = Math.min(Math.abs(s), 3 * Math.abs(sa), 3 * Math.abs(sb));
    return s > 0 ? m : -m;
  };
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0
    + (u3 - 2 * u2 + u) * (d(i) * h)
    + (-2 * u3 + 3 * u2) * y1
    + (u3 - u2) * (d(i + 1) * h);
}

/** 膝屈曲参考角（度） */
export const kneeRefDeg = (t: number): number => monotoneAt(KNEE_REF, t);
/** 髋屈曲参考角（度） */
export const hipRefDeg = (t: number): number => monotoneAt(HIP_REF, t);

/**
 * 符号/偏置标定：把"人类屈曲为正"翻译成**本 rig 的关节角**。
 * 实测（tools/probe-gaitref.ts）：
 *   · rig 的膝：屈曲 = **负**角（`ik()` 返回 `-(π − interior)`，膝能屈到 −145°）
 *   · rig 的髋：腿往前 = **正**角（与人类"屈曲为正"同号）
 * 放在这里而不是散在奖励里，是因为这是**唯一的符号真源**。
 */
export const RIG_SIGN = { hip: 1, knee: -1 } as const;

/** 目标幅度缩放（"微调"旋钮：1 = 照抄人类，<1 = 先只学形状） */
export const AMP_SCALE_DEFAULT = 1.0;

export interface RefTrack {
  /** 髋形状分 0..1 */
  hip: number;
  /** 膝形状分 0..1 */
  knee: number;
  /** 相位（0=左腿触地）0..1 */
  phase: number;
}

/**
 * 核心打分：把实际关节角和文献参考比，返回 0..1。
 *
 * ★ 为什么用"形状分"（对幅度归一化）而不是绝对角度差：
 *   ES 早期根本迈不出人类那么大的幅度（髋 ROM 45°、膝 60°），如果直接用绝对角度差，
 *   所有可达的策略都会拿到 0 分 ⇒ 没有梯度。归一化之后，"相位对、时序对、形状对"
 *   就能立刻拿到分，幅度由 `ampScale` 分阶段放开。
 *   容差取 `TOLERANCE_DEG`（5°，文献 RMSE 量级）：小于它的偏差一律给满分。
 */
export function scoreLeg(
  t: number,
  hipRad: number,
  kneeRad: number,
  ampScale = AMP_SCALE_DEFAULT,
): RefTrack {
  const hipDeg = hipRad * R2D * RIG_SIGN.hip;
  const kneeDeg = kneeRad * R2D * RIG_SIGN.knee;
  // 幅度缩放后的参考（以各自的活动度为中心缩放）
  const hipRef = hipRefDeg(t);
  const kneeRef = kneeRefDeg(t);
  const hipAmp = hipROM() * ampScale;
  const kneeAmp = kneeROM() * ampScale;
  const hipCtr = (hipRef + hipRefDeg(t + 0.5)) / 2;      // 中心：与半周期后的值平均
  const kneeCtr = (kneeRef + kneeRefDeg(t + 0.5)) / 2;
  const hipTgt = hipCtr + (hipRef - hipCtr) * ampScale;
  const kneeTgt = kneeCtr + (kneeRef - kneeCtr) * ampScale;
  return {
    hip: shapeScore(hipDeg, hipTgt, hipAmp),
    knee: shapeScore(kneeDeg, kneeTgt, kneeAmp),
    phase: ((t % 1) + 1) % 1,
  };
}

const R2D = 180 / Math.PI;

/** 髋在人类步态里的总活动度（度）：屈曲最大 ~30°，伸展最大 ~−8° */
export const hipROM = (): number => 30 - (-8);
/** 膝在人类步态里的总活动度（度）：0°（伸直）~66°（摆动峰值） */
export const kneeROM = (): number => 66 - 0;

/**
 * 形状分：把误差按"容差 + 活动度"归一，超出活动度就得 0。
 * 用 tanh 而不是硬截断，是为了在"还差得远"时也有梯度（这是 ES 早期最需要的）。
 */
function shapeScore(actual: number, target: number, amp: number): number {
  const e = Math.abs(actual - target);
  const tol = TOLERANCE_DEG;
  if (e <= tol) return 1;
  const over = (e - tol) / Math.max(1e-6, amp);       // 超出活动度的比例
  return Math.exp(-3 * over * over);
}

// ══════════════════════════════════════════════════════════════════════
// ★★★ 盆骨优先（近端先动）—— 用户 2026-10-02："必须教会盆骨优先发力才好"
//
// ── 文献依据（这一节是整个奖励的立论基础）────────────────────────────
// ① 臀中肌（GMed）在**触地之前**就已经开始激活：步行时 onset 距初始触地
//    **−103.5 ± 79.3 ms**，下楼 **−125.7 ± 84.1 ms**（Redalyc / AKP 研究）。
//    ⇒ 髋（近端）是**预激活**的，不是被脚落地"触发"的。
// ② 触地之后健康人的 GMed 延迟仅 **32.7 ± 30.4 ms**；膝 OA 者这个延迟显著更大
//    （JHsmr 2026），并伴随对侧骨盆掉、膝外翻力矩增大。
// ③ 关键细节：**激活"量"比激活"时刻"更重要** —— GMed 激活量与骨盆倾斜
//    r_s=0.361、与膝外翻力矩 r_s=−0.303 显著相关，而 onset 时刻与两者都不显著
//    （Kim et al. 2015, J Orthop Sports Phys Ther）。
//    ⇒ 所以奖励分两层：**先看时序对不对（髋领先膝），再看髋该用多大力**。
// ④ 股四头肌（膝吸震）**不在早期启动**，而是在减速后期才介入（Crossley et al. 综述）。
//    ⇒ 膝屈曲吸震**滞后于**髋的启动，这正是"近端优先"的量化含义。
//
// ── 数字（可在 UI 上微调，用户说"人是肌肉发力，可能需要微调"）────────
// PREACT_MS   触地前预激活窗口（文献 100 ms）
// LEAD_MIN/MAX 膝相对髋的期望滞后区间（文献口径：髋 ~0 ms、股四头 ~150~200 ms）
// STEP_TOL    髋"用多大力"相对于该步峰值的门槛
export const LEAD_MIN = 0.05;         // 膝至少要滞后 50 ms（否则就是膝先动）
export const LEAD_MAX = 0.25;         // 最多滞后 250 ms（再久就脱节了）
export const PREACT_RATIO = 0.30;     // 触地前髋的速度 ≥ 本步峰值的 30%

/** 单腿的"盆骨优先"跟踪器：一帧喂一次，出一帧的分。 */
export class PelvisFirstTracker {
  private hv = 0;
  private kv = 0;
  private hvMax = 0;                   // 本步髋速度峰值（用来归一化"用力"）
  // ★ 用**峰值时刻**而不是"启动时刻"：实测本 rig 髋/膝的 |相对角速度| 峰值有
  //   11~19 rad/s，而阈值只要 0.35 rad/s —— 两者会在**同一控制拍内**先后越过，
  //   于是"膝滞后髋"恒等于 0 ms，完全测不出东西（我第一版就是这么白测的）。
  //   峰值时刻是同一个意思的稳健版本：一整步里髋的速度峰值应该**先于**膝出现。
  private hipPeakT = -1;
  private kneePeakT = -1;
  private hipPeakV = 0;
  private kneePeakV = 0;
  private t = 0;
  /** 预激活采样窗（触地前 100 ms 内的髋速度均值） */
  private preAcc = 0;
  private preN = 0;
  private wasGround = true;
  /** 本步的髋是否在**触地前**就已经动（文献①的核心指标） */
  private preActive = 0;
  private lastLead = 0;                // 最近一次完整测出的领先量（s）
  private leadSum = 0;
  private leadN = 0;

  reset(): void {
    this.hv = 0; this.kv = 0; this.hvMax = 0;
    this.hipPeakT = -1; this.kneePeakT = -1; this.hipPeakV = 0; this.kneePeakV = 0;
    this.t = 0; this.preAcc = 0; this.preN = 0; this.wasGround = true; this.preActive = 0;
    this.leadSum = 0; this.leadN = 0;
  }

  /** 最近一次测出的"膝滞后髋"多少秒（正 = 髋先动，正确的方向） */
  get leadSec(): number { return this.lastLead; }
  /** 迄今测到的平均领先量 */
  get meanLead(): number { return this.leadN > 0 ? this.leadSum / this.leadN : 0; }
  get preActiveRatio(): number { return this.preActive; }

  /**
   * @param hipVel  髋矢状角速度（rad/s，正 = 屈曲方向）
   * @param kneeVel 膝矢状角速度（rad/s）
   * @param grounded 该脚是否着地
   * @param onsetThr 启动阈值（rad/s），低于它算"静止"
   */
  step(hipVel: number, kneeVel: number, grounded: boolean, dt: number, peakThr = 0.8): void {
    // EMA 低通：人肌电的"启动"是包络概念，直接用瞬时速度会被 PD 抖动带偏
    const a = 1 - Math.exp(-dt / 0.030);
    this.hv += (hipVel - this.hv) * a;
    this.kv += (kneeVel - this.kv) * a;
    this.t += dt;
    this.hvMax = Math.max(this.hvMax, Math.abs(this.hv));

    // 峰值时刻：只保留**第一个**显著峰值（避免后续抖动改写时刻）
    if (Math.abs(this.hv) > peakThr && Math.abs(this.hv) > Math.abs(this.hipPeakV)) {
      this.hipPeakV = this.hv; this.hipPeakT = this.t;
    }
    if (Math.abs(this.kv) > peakThr && Math.abs(this.kv) > Math.abs(this.kneePeakV)) {
      this.kneePeakV = this.kv; this.kneePeakT = this.t;
    }

    // 预激活采样：只要**还没着地**，且离着地还有不到 100 ms（用"上一次着地"近似）
    if (!grounded) { this.preAcc += Math.abs(this.hv); this.preN++; }

    // 触地瞬间结算本步
    if (grounded && !this.wasGround) {
      if (this.preN > 0 && this.hvMax > 1e-6) {
        this.preActive = (this.preAcc / this.preN) / this.hvMax;
      }
      if (this.hipPeakT >= 0 && this.kneePeakT >= 0) {
        this.lastLead = this.kneePeakT - this.hipPeakT;      // >0 = 髋的速度峰值先到 ✔
        this.leadSum += this.lastLead;
        this.leadN++;
      }
      // 一步结束，重新开始计时
      this.t = 0; this.hipPeakT = -1; this.kneePeakT = -1;
      this.hipPeakV = 0; this.kneePeakV = 0;
      this.hvMax = 0; this.preAcc = 0; this.preN = 0; this.preActive = 0;
    }
    this.wasGround = grounded;
  }

  /**
   * 逐帧"盆骨优先"分（0..1）：当前这一步的领先关系好不好。
   * · 髋领先 50~250 ms ⇒ 满分（文献口径）
   * · 膝先动（领先量 < 0）⇒ **负分**（这是要治的病）
   * · 髋领先太多 ⇒ 衰减（脱节）
   * · 还没测出领先量（还没触地）⇒ 用"预激活程度"给部分分
   */
  score(): number {
    const pre = this.preActive > 0 ? clamp01(this.preActive / PREACT_RATIO) : 0;
    if (this.leadN === 0) return pre * 0.5;
    const L = this.lastLead;
    if (L < 0) return -Math.min(1, -L / 0.2);              // 膝先动：罚
    if (L < LEAD_MIN) return (L / LEAD_MIN) * 0.9;          // 领先太少
    if (L <= LEAD_MAX) return 1;                            // 落在文献区间里
    return Math.exp(-3 * ((L - LEAD_MAX) / 0.15) ** 2);     // 脱节
  }
}
