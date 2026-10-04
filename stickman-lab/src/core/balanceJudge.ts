/**
 * 身体平衡的**可计算判据**（用户 2026-10-02："加个身体不平衡扣分项，
 * 人在走路的时刻都是身体平衡的，这个至关重要，必须找文献"）。
 *
 * ⚠⚠ **本文件 formerly 叫 `balance.ts`，已改名为 `balanceJudge.ts`。**
 *   原因：与 `systems/balance.ts`（**平衡维持系统**，产出控制需求）**同名**，
 *   而两者职责完全无关 —— 一个是"判据/打分"（读 WBAM/CMP，算罚分），
 *   一个是"控制律"（算关节力矩）。同名必然误读：
 *   本轮审计里我本人就把 `balance` 误读成控制系统。
 *   ⇒ 见 `probe:axisown` 门禁 F：无同名歧义。
 *
 * ── 文献依据 ────────────────────────────────────────────────────────────
 * ① ★【全身体角动量 WBAM ≈ 0】Herr, McF added… *Angular momentum in human walking*
 *    （Herr/Hastie/Hughes 等，2008）：
 *    "whole-body angular momentum is highly regulated throughout the walking cycle
 *    about **all three spatial directions, L(t) ≈ 0**"，尽管各段动量都很大，
 *    靠**段间抵消**实现：侧向 ~95%、前后 ~70%、垂向 ~80%。
 *    而且"**centroidal moment pivot (CMP) 全程不离开地面支撑面**"，
 *    CMP 与实测 CoP 的归一化距离只有 **14±2% 足长**。
 *    ⇒ 判据：|WBAM| 应当**接近 0**，且它的**变化率**（= 地面反作用力对质心的合力矩）
 *      也要小。CMP 不出支撑面 ⇔ 净力矩在把身体"罩住"。
 * ② Nature Sci Rep 2023 补充：WBAM 维持在**小范围**（不是严格 0），
 *    矢状面主要靠段间抵消、额状面主要靠 GRF；双支撑相的净力矩明显更大。
 *    ⇒ 所以惩罚要作用在"偏离小范围"上，且允许双支撑相有更大瞬时值。
 * ③ ★【头/质心的垂直起伏很小】正常走路有明显的"点头/起伏"，但幅度只有几厘米
 *    （竖直摆动是摆锤式节能机制）。发育研究（McNair 等，2004）显示
 *    **4 岁前儿童的质心垂直与侧向摆幅显著大于成人**，前向摆幅要到 7 岁才成熟
 *    ⇒ "像婴儿学步"在运动学上就意味着：**垂直/侧向摆幅更大、速度更低**。
 *    本模块用"头高比"作为**有效性的闸门**：头掉下去（身体塌了）时，
 *    这一帧的距离/迈步分**一律作废** —— 这正是用户说的
 *    "头和脚竖直距离很近才算得分有效"（即头必须在该在的高度）。
 */

/** 头高比的有效区间：低于下界 = 身体塌了（分作废），高于上界 = 异常 */
export const HEAD_MIN = 0.86;
export const HEAD_MAX = 1.06;
/**
 * ★ 躯干倾角上限（rad）：超过它就算"正在倒"，距离分作废。
 *   **头高单独不够用**——实测摔倒时身体是**先前倾**、头的高度几乎不掉
 *   （6 秒内头高比全程 100%），光靠头高根本抓不住"快倒下"。
 *   0.70 rad ≈ 40°，是明显的前扑（正常走路躯干前倾只有 5~10°）。
 */
export const MAX_PITCH = 0.70;
/**
 * ★★ MoS 阈值：XCoM 落到支撑面外这么多米就作废距离分。
 *   **倾角单独也不够用**——实测这个 rig "前扑"是**在髋部俯仰**，躯干本身几乎不倾斜
 *   （teacher / 相位种子 / 零输出三个摔倒个体的躯干倾角都没超过 40°）。
 *   所以真正的判据必须用文献那个量：**MoS < 0 = 质心的外推位置已经跑到支撑面外**
 *   （Hof 2005），也就是"正在倒"。留 −0.02 m 容差，免得一瞬间的越界把整段作废。
 */
export const MOS_VOID = -0.02;

/** 竖直方向上 WBAM 的归一化尺度（rad·kg·m/s），由 `calibrate` 实测标定 */
let WBAM_NORM = 6.0;
/** WBAM 变化率的归一化尺度 */
let WBAM_RATE_NORM = 40.0;

/**
 * 全身体角动量（关于质心，**轨道部分**）：Σ m_i (r_i − r_com) × v_i。
 *
 * ★ 为什么只算轨道部分：文献里的"全身体角动量"也是这么定义的（各段的轨道动量之和）；
 *   自旋部分 Σ I_i ω_i 在本 rig 里量级小得多，而且 Rapier 的惯量张量取法会带来
 *   额外的建模误差。**先测出来对比量级**，如果自旋不可忽略再加（见 probe-balance）。
 */
export function wholeBodyAngularMomentum(
  doll: { bodies: readonly { mass(): number; translation(): { x: number; y: number; z: number }; linvel(): { x: number; y: number; z: number } }[] },
  com: { x: number; y: number; z: number },
  out: Float64Array,
): Float64Array {
  let lx = 0, ly = 0, lz = 0;
  for (const b of doll.bodies) {
    const m = b.mass();
    const r = b.translation();
    const v = b.linvel();
    const rx = r.x - com.x, ry = r.y - com.y, rz = r.z - com.z;
    lx += m * (ry * v.z - rz * v.y);
    ly += m * (rz * v.x - rx * v.z);
    lz += m * (rx * v.y - ry * v.x);
  }
  out[0] = lx; out[1] = ly; out[2] = lz;
  return out;
}

export interface BalanceReadings {
  /** |WBAM| 归一化（1 = 达到标定尺度） */
  wbam: number;
  /** |dWBAM/dt| 归一化 */
  wbamRate: number;
  /** 头高比（相对初始站姿） */
  headRatio: number;
  /** 本帧是否"有效"（头没塌、没超出上界） */
  valid: boolean;
}

/**
 * 平衡判据的逐帧跟踪器。
 * ★ 关键设计：**用实测标定的尺度**做归一化，而不是拍一个魔法数。
 *   `calibrate()` 会用一段"已知站得住"的运动（镇定器）测出它的 |WBAM|，
 *   把那个值当作"平衡"的参照；奖励里罚的是"相对这个参照恶化了多少"。
 */
export class BalanceJudge {
  private prev = new Float64Array(3);
  private prevL = 0;
  private hasPrev = false;
  private head0 = 0;
  /** 累积不平衡（供奖励逐拍积分） */
  private accImb = 0;
  private accTicks = 0;
  /** 无效帧数（头塌了）—— 诊断用 */
  private badHead = 0;
  private wbamMax = 0;
  private headMin = 1;

  reset(): void {
    this.hasPrev = false; this.accImb = 0; this.accTicks = 0;
    this.badHead = 0; this.wbamMax = 0; this.headMin = 1; this.head0 = 0;
  }

  /** 记录初始站姿的头高（`begin()` 时调用） */
  setRefHead(y: number): void { if (this.head0 <= 0) this.head0 = y; }

  /** 归一化尺度的标定结果（诊断用） */
  get norms(): { wbam: number; rate: number } { return { wbam: WBAM_NORM, rate: WBAM_RATE_NORM }; }

  get stats(): { accImb: number; ticks: number; badHead: number; wbamMax: number; headMin: number } {
    return { accImb: this.accImb, ticks: this.accTicks, badHead: this.badHead, wbamMax: this.wbamMax, headMin: this.headMin };
  }

  /**
   * @param lbuf  wholeBodyAngularMomentum 的输出（3 元素）
   * @param headY 当前头（或最高点）世界高度
   * @param dt
   */
  step(lbuf: Float64Array, headY: number, dt: number, pitch = 0, mosX = 1): BalanceReadings {
    const mag = Math.hypot(lbuf[0]!, lbuf[1]!, lbuf[2]!);
    let rate = 0;
    if (this.hasPrev) {
      const dl = Math.hypot(lbuf[0]! - this.prev[0]!, lbuf[1]! - this.prev[1]!, lbuf[2]! - this.prev[2]!);
      rate = dl / Math.max(1e-6, dt);
    }
    this.prev[0] = lbuf[0]!; this.prev[1] = lbuf[1]!; this.prev[2] = lbuf[2]!;
    this.hasPrev = true;

    const wbam = mag / WBAM_NORM;
    const wbamRate = rate / WBAM_RATE_NORM;
    const headRatio = this.head0 > 0 ? headY / this.head0 : 1;
    // 有效性 = 头在该在的高度 **且** 躯干没在扑 **且** 质心外推位置还在支撑面内
    // （最后一条是 Hof 的判据；前两条是防"塌"和"扑"，见各自常量的注释）
    const valid = headRatio >= HEAD_MIN && headRatio <= HEAD_MAX
      && Math.abs(pitch) < MAX_PITCH && mosX > MOS_VOID;

    // 不平衡度：WBAM 幅度 + 变化率。**惩罚**（恒非负），由 sim 乘负权重。
    // 用 tanh 压到 0..~1，保证不会因为一次冲击 dominate 整个 episode。
    const imb = Math.tanh(0.7 * wbam) + 0.5 * Math.tanh(0.7 * wbamRate);
    this.accImb += imb * dt;
    this.accTicks += dt;
    if (!valid) this.badHead += dt;      // ⚠ 累加**时间**，不是帧数
    //   （我第一版写的是 badHead++，而 ticks 累加的是 dt ⇒ 单位不一致，
    //    badHead/ticks 成了 34.7 而不是 0~1 的比例，整个不平衡项被放大了几十倍。）
    this.wbamMax = Math.max(this.wbamMax, mag);
    this.headMin = Math.min(this.headMin, headRatio);
    return { wbam, wbamRate, headRatio, valid };
  }

  /**
   * 用一段"已知站得住"的运动标定尺度：取它 |WBAM| 的 90 分位作为 1.0。
   * ⚠ 没有这一步的话，归一化尺度只能靠猜，而惩罚力度就会变成一个说不清来源的魔法数。
   */
  static calibrate(wbamSamples: number[]): void {
    if (wbamSamples.length < 8) return;
    const s = [...wbamSamples].sort((a, b) => a - b);
    const p90 = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]!;
    WBAM_NORM = Math.max(1e-3, p90);
    WBAM_RATE_NORM = Math.max(1e-3, WBAM_NORM * 6);
  }

  /** 测试/探针用：直接指定尺度（不做标定） */
  static setNorms(wbam: number, rate: number): void {
    WBAM_NORM = Math.max(1e-6, wbam);
    WBAM_RATE_NORM = Math.max(1e-6, rate);
  }
}
