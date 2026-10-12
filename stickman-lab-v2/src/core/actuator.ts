/**
 * actuator.ts —— 逐自由度**执行器模型**（人类式）
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 论文依据
 * ══════════════════════════════════════════════════════════════════════════
 * · 肌肉是**黏弹执行器**，不是理想力矩源：
 *     力-长度（FL）+ 力-速度（FV）+ 一阶激活动力学
 *     —— Hill 1938；Zajac 1989；Thelen 2003（"Adjustment of muscle mechanics
 *        model parameters to simulate dynamically ..."）；Millard et al. 2013（OpenSim 肌骨模型）。
 * · 姿态由**平衡点/阻抗**控制而不是刚性位置伺服：τ = K(θ*−θ) + B(0−ω)，
 *   K/B 随共收缩变化 —— Feldman 平衡点假说；Hogan 1985 阻抗控制。
 * · 阻尼必须**隐式**积分，否则小惯量关节在显式步进下发散：
 *     Tan, Liu & Turk 2011（Stable PD）把 D 项做隐式；
 *     Tassa/Erez/Todorov 2012 与 MuJoCo 2012 用惯量与 dt 生成的临界阻尼增益。
 *   本文件把阻尼写成一阶精确形式 `J = −I·ω·(1−e^(−B·dt/I))`：无论 B 多大都稳定。
 *
 * 纯被动自由度（无激活命令）：只剩黏弹阻尼 ⇒ 肢体像"松开的肌肉"一样自然下垂。
 */

import type { Dof } from './body';

export interface ActuatorOptions {
  /** 一阶激活动力学时间常数（s）。人类 ~10–50 ms，取 30 ms */
  activationTau: number;
  /** 被动阻尼系数 = `passiveDampingFrac × tauMax`（N·m·s/rad） */
  passiveDampingFrac: number;
  /** 被动弹性刚度（回到关节零位）= `passiveStiffnessFrac × tauMax`（N·m/rad） */
  passiveStiffnessFrac: number;
  /** 是否启用 Hill 力-长/力-速调制 */
  hill: boolean;
  /** 力-速系数：向心收缩每 1×ωmax 折减多少（Hill 双曲的线性近似） */
  hillConcGain: number;
  /** 力-速系数：离心收缩最多放大到多少倍（人类 1.2~1.8） */
  hillEccGain: number;
  /** 力-长宽度：到限位的一半处衰减到 e^-1 的归一化宽度 */
  hillLenWidth: number;
  /** 关节角速度归一化基准（rad/s） */
  jointMaxSpeed: number;
}

export const DEFAULT_ACTUATOR_OPTIONS: ActuatorOptions = {
  activationTau: 0.03,
  passiveDampingFrac: 0.02,     // 髋 200 ⇒ 4.0；踝 120 ⇒ 2.4；肘 40 ⇒ 0.8 N·m·s/rad
  passiveStiffnessFrac: 0.0,    // 默认无被动回位（姿态交给控制器/肌肉）
  hill: true,
  hillConcGain: 0.5,
  hillEccGain: 0.5,
  hillLenWidth: 0.6,
  jointMaxSpeed: 9.0,
};

export class Actuator {
  readonly opt: ActuatorOptions;
  /** 每自由度激活值 ∈ [−1,1]（− = 负向肌，+ = 正向肌） */
  private readonly activation: Float64Array;
  /** 每自由度激活目标（NaN = 无命令 ⇒ 衰减到 0） */
  private readonly actTarget: Float64Array;
  /** 每自由度被动阻尼系数（N·m·s/rad） */
  private readonly damp: Float64Array;
  /** 每自由度被动刚度（N·m/rad） */
  private readonly stiff: Float64Array;

  constructor(dofs: Dof[], opt: Partial<ActuatorOptions> = {}) {
    this.opt = { ...DEFAULT_ACTUATOR_OPTIONS, ...opt };
    const n = dofs.length;
    this.activation = new Float64Array(n);
    this.actTarget = new Float64Array(n).fill(Number.NaN);
    this.damp = new Float64Array(n);
    this.stiff = new Float64Array(n);
    dofs.forEach((d, i) => {
      this.damp[i] = this.opt.passiveDampingFrac * d.tauMax;
      this.stiff[i] = this.opt.passiveStiffnessFrac * d.tauMax;
    });
  }

  /** 设置净激活（+ = 正向肌群发力，− = 负向） */
  setActivation(dofIdx: number, a: number): void {
    this.actTarget[dofIdx] = Math.max(-1, Math.min(1, a));
  }

  clearActivation(dofIdx: number): void {
    this.actTarget[dofIdx] = Number.NaN;
  }

  clearAll(): void {
    this.actTarget.fill(Number.NaN);
  }

  activationOf(dofIdx: number): number {
    return this.activation[dofIdx]!;
  }

  dampingOf(dofIdx: number): number {
    return this.damp[dofIdx]!;
  }

  stiffnessOf(dofIdx: number): number {
    return this.stiff[dofIdx]!;
  }

  /**
   * 推进一阶激活动力学（精确积分，dt > τ 也不会振荡）：
   *   a ← a + (a* − a)·(1 − e^(−dt/τ))
   */
  updateActivation(dt: number): number {
    const k = 1 - Math.exp(-dt / this.opt.activationTau);
    let sum = 0;
    for (let i = 0; i < this.activation.length; i++) {
      const t = this.actTarget[i]!;
      const target = Number.isNaN(t) ? 0 : t;
      const a = this.activation[i]! + (target - this.activation[i]!) * k;
      this.activation[i] = a;
      sum += Math.abs(a);
    }
    return sum;
  }

  /**
   * 主动力矩（Hill 型）：τ = a·τmax·FL(θ)·FV(ω)。
   * 注意：FV 的离心支会让力随速度**增大**（负阻尼），所以量级必须温和
   * （默认最多 1.5×），并且整个主动通道还要过 Drive 的一步收敛护栏。
   */
  activeTorque(d: Dof, dofIdx: number): number {
    const a = this.activation[dofIdx]!;
    if (a === 0) return 0;
    let f = 1;
    if (this.opt.hill) {
      // 力-长度：以 0 为最优长度（控制角 = 静姿态）
      const half = Math.max(0.2, Math.min(Math.abs(d.min), Math.abs(d.max)) || 0.5);
      const x = d.angle / (this.opt.hillLenWidth * half);
      f *= Math.exp(-x * x);
      // 力-速度：向心（速度与激活同号）折减；离心（反向）放大
      const v = d.vel * Math.sign(a);
      if (v > 0) f *= 1 / (1 + this.opt.hillConcGain * v / this.opt.jointMaxSpeed);
      else f *= Math.min(1 + this.opt.hillEccGain * (-v) / this.opt.jointMaxSpeed, 1 + this.opt.hillEccGain);
    }
    return a * d.tauMax * f;
  }
}
