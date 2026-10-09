/**
 * executor.ts —— 执行器：**唯一的关节力矩写入与施加点**
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 设计目标（v1 的"死通道"教训）
 * ══════════════════════════════════════════════════════════════════════════
 * v1 有至少 4 条写 τ 的路径（位置伺服 / V4 前馈 / 让位通道 / 限位冲量），
 * 且 `torqueCmd` 被后写的通道静默覆盖 ⇒ 探针永远看不到效果而代码看起来正常。
 *
 * v2 结构性根除：
 *   · 所有通道（被动 / 激活 / 命令 / 伺服）只调用 `addTorque()`；
 *   · `applyAll(dt)` 每步**每自由度恰好施加一次**（先求和、再饱和、再成对冲量）；
 *   · 记账可回读：cmd / applied / saturated / writes。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 物理约定（论文）
 * ══════════════════════════════════════════════════════════════════════════
 * · 关节空间中每个自由度施加**等大反向力偶**（力矩冲量 J = τ·dt 绕关节轴，
 *   子侧 +J、父侧 −J）——这是最大坐标冲量引擎里关节马达的标准等价形式
 *   （Featherstone & Orin 2000, "Robot dynamics: equations and algorithms";
 *    Bender et al. 2014, "Interactive Simulation of Rigid Body Dynamics"）。
 * · 轴方向 = b1 刚体本地轴旋转到世界。正 τ ⇒ 正关节角（两者同一轴、同一手性）。
 */

import type RAPIER from '@dimforge/rapier3d';
import { qRotateVec, qOf, type Vec3 } from './quat';

/** 一个可驱动自由度（= 一个真实引擎关节 / 一个串联铰链）的描述 */
export interface DofDef {
  /** 所属逻辑关节（骨架 joints 下标） */
  joint: number;
  /** 逻辑关节名（探针用） */
  name: string;
  /** 逻辑轴：0=X 外展 / 1=Y 扭转 / 2=Z 屈伸 */
  axis: number;
  /** 力偶施加的两侧刚体下标：b1 侧 −J、b2 侧 +J */
  b1: number;
  b2: number;
  /**
   * 力偶**实际施加**的刚体对（默认 = b1/b2）。
   *
   * 串联铰链（球窝 → 3×revolute）的 b1/b2 是中间体（轴方向的载体，1e-3 kg），
   * 但力矩不能直接打在中间体上 —— `J/I_mid` 会是几十万 rad/s（实测爆炸）。
   * 关节空间执行器的正解（Featherstone & Orin 2000）：力偶施加在**逻辑父子
   * 真实刚体**上，让 sub-铰链约束把反作用传给中间体 ⇒ 中间体只承担约束，
   * 不承担执行器冲量。
   */
  applyB1: number;
  applyB2: number;
  /** 轴在 b1 本地系里的方向 */
  axisLocal: Vec3;
  /** 力矩上限（N·m） */
  tauMax: number;
  /** 限位通道的每步冲量上限（N·m·s）—— 限位必须能压过马达，见 Drive 的限位实现 */
  impulseMax: number;
}

/** 逐自由度账本（每步重写，可回读） */
export interface DofLedger {
  /** 本步各通道求和后的**期望**力矩（N·m） */
  cmd: number;
  /** ★ 被动并联通道（韧带/IT band）：不参与肌肉 τmax 饱和，自己的封顶 = τmax。
   *  物理含义：τmax 是**肌肉**上限，被动组织是与之并联的第二条承载路径。 */
  passive: number;
  /** 实际下发的力矩（N·m，= clamp(cmd, ±τmax) + 被动并联分量） */
  applied: number;
  /** 限位通道本步的冲量（N·m·s，已按 impulseMax 削） */
  limit: number;
  /** 本步写入次数（多通道求和；>1 是正常语义，施加仍只有一次） */
  writes: number;
  /** 是否被 τmax 削 */
  saturated: boolean;
}

export class Executor {
  readonly nDofs: number;
  readonly ledger: DofLedger[];
  /** 本步 applyAll 是否已调用过（beginStep 复位；重复调用 = 违例） */
  private appliedThisStep = false;
  /** 累计违例（跨步保留，checkInvariants 返回并清空） */
  private violations: string[] = [];
  /** 轴线复算缓冲 */
  private readonly axisW = new Float64Array(3);
  private readonly iv = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly bodies: RAPIER.RigidBody[],
    readonly dofs: DofDef[],
  ) {
    this.nDofs = dofs.length;
    this.ledger = new Array(this.nDofs);
    for (let i = 0; i < this.nDofs; i++) {
      this.ledger[i] = { cmd: 0, applied: 0, limit: 0, passive: 0, writes: 0, saturated: false };
    }
  }

  /** 每物理步开始前调用（清记账；不保留任何跨步状态 ⇒ 无积分饱和） */
  beginStep(): void {
    this.appliedThisStep = false;
    for (let i = 0; i < this.nDofs; i++) {
      const l = this.ledger[i]!;
      l.cmd = 0;
      l.applied = 0;
      l.limit = 0;
      l.passive = 0;
      l.writes = 0;
      l.saturated = false;
    }
  }

  /**
   * ★ 唯一写入入口。允许多个通道贡献（被动/激活/命令…），求和后统一施加。
   * 传 0 也可以 —— 账本会记录"本通道表态为 0"。
   */
  addTorque(dofIdx: number, tau: number): void {
    const l = this.ledger[dofIdx]!;
    l.cmd += tau;
    l.writes++;
  }

  /**
   * ★ 被动并联通道（韧带 / IT band；Inman 1947：单腿站立约一半髋外展力矩由被动组织承担）。
   * 与主通道物理并联：**不受肌肉 τmax 饱和**，自封顶 = τmax（总承载上限 ≤ 2·τmax）。
   * 主通道（马达/伺服/主动）仍受 τmax —— 与真实解剖一致：肌肉有上限，韧带另计。
   */
  addPassiveTorque(dofIdx: number, tau: number): void {
    this.ledger[dofIdx]!.passive += tau;
    this.ledger[dofIdx]!.writes++;
  }

  /**
   * 限位通道：直接给**角冲量**（N·m·s）。
   *
   * 为什么单独一条通道：限位在数学上必须能**压过**马达（否则角度一越界就
   * 再也回不来 —— v1 实测踝越限到 174°）。所以限位冲量不参与 τmax 饱和，
   * 而是按 `impulseMax` 削（由 Drive 按"限位权限 ≥ k×马达权限"逐轴推导）。
   * 与主通道在**同一次 applyAll** 里合并施加（仍然每自由度每步只写一次物理冲量）。
   */
  addLimitImpulse(dofIdx: number, imp: number): void {
    this.ledger[dofIdx]!.limit += imp;
  }

  /**
   * ★ 每步恰好调用一次：饱和 → 冲量 → 成对施加。
   * 返回实际下发的 τ 合计（校验用）。
   */
  applyAll(dt: number): number {
    if (this.appliedThisStep) this.violations.push('applyAll 一步内被调用多次');
    this.appliedThisStep = true;
    let sum = 0;
    for (let i = 0; i < this.nDofs; i++) {
      const d = this.dofs[i]!;
      const l = this.ledger[i]!;
      let t = l.cmd;
      if (t > d.tauMax) { t = d.tauMax; l.saturated = true; }
      else if (t < -d.tauMax) { t = -d.tauMax; l.saturated = true; }
      // ★ 被动并联（不受肌肉 τmax）：自封顶 ±τmax，加在钳位之外
      const tP = l.passive > d.tauMax ? d.tauMax : l.passive < -d.tauMax ? -d.tauMax : l.passive;
      t += tP;
      l.applied = t;
      sum += Math.abs(t);
      const impMain = t * dt;
      const jl = l.limit > d.impulseMax ? d.impulseMax : l.limit < -d.impulseMax ? -d.impulseMax : l.limit;
      l.limit = jl;
      const imp = impMain + jl;
      if (imp === 0) continue;

      const b1 = this.bodies[d.applyB1]!;
      const b2 = this.bodies[d.applyB2]!;
      const q = qOf(this.bodies[d.b1]!.rotation());
      qRotateVec(q, d.axisLocal.x, d.axisLocal.y, d.axisLocal.z, this.axisW);
      const v = this.iv;
      v.x = this.axisW[0]! * imp;
      v.y = this.axisW[1]! * imp;
      v.z = this.axisW[2]! * imp;
      b2.applyTorqueImpulse(v, true);
      v.x = -v.x; v.y = -v.y; v.z = -v.z;
      b1.applyTorqueImpulse(v, true);
    }
    return sum;
  }

  /** 记账不变量：applied == clamp(cmd, ±tauMax)、数值有限、apply 每步一次 */
  checkInvariants(): string[] {
    const bad: string[] = this.violations.splice(0);
    for (let i = 0; i < this.nDofs; i++) {
      const d = this.dofs[i]!;
      const l = this.ledger[i]!;
      const want = Math.max(-d.tauMax, Math.min(d.tauMax, l.cmd))
        + Math.max(-d.tauMax, Math.min(d.tauMax, l.passive));
      if (!Number.isFinite(l.cmd) || !Number.isFinite(l.applied)) {
        bad.push(`${d.name}/${d.axis}: 非有限值 cmd=${l.cmd} applied=${l.applied}`);
        continue;
      }
      if (Math.abs(l.applied - want) > 1e-9 + 1e-9 * d.tauMax) {
        bad.push(`${d.name}/${d.axis}: applied=${l.applied.toFixed(6)} want=${want.toFixed(6)}`);
      }
    }
    return bad;
  }

  /** 供探针回读：本步某自由度的实际下发力矩 */
  appliedOf(dofIdx: number): number {
    return this.ledger[dofIdx]!.applied;
  }
}
