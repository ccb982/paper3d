/**
 * drive.ts —— 命令层：把"想干什么"翻译成每步的关节力矩，写进 Executor
 *
 * 三条命令通道（可同时使用，Executor 求和后统一施加）：
 *   · `setAngle`     平衡点/阻抗命令：τ = K(θ*−θ)，D 项隐式（Stable PD）
 *   · `setTorque`    前馈力矩（重力补偿 / 平衡修正）
 *   · `setActivation` 肌肉激活命令：τ = a·τmax·FL·FV（actuator.ts）
 *
 * 数值稳定（Tan/Liu/Turk 2011；Tassa 2012）：
 *   · 显式弹簧/前馈/主动力矩合计被"一步收敛护栏"夹住：
 *       |τ_explicit| ≤ α · I_eff · ωmax / dt
 *   · 阻尼项做成隐式角冲量 `J = −I·ω·(1−e^(−B·dt/I))`，与 B 的大小无关。
 * 因此就算 kP 很大、dt 就算变大，也不会出现 v1 那种"显式 PD 发散"。
 */

import type { Skeleton } from './skeleton';
import type { Body, Dof } from './body';
import type { Executor } from './executor';
import { Actuator, DEFAULT_ACTUATOR_OPTIONS, type ActuatorOptions } from './actuator';

export interface DriveOptions extends ActuatorOptions {
  /** 一步收敛系数 α（1 = 一步内最多吃掉一个 ωmax 的误差速度，不过冲） */
  alpha: number;
  /** 限位越界回正速率（1/s，Baumgarte 型位置投影） */
  limitRate: number;
  /** 限位权限相对马达权限的安全系数（限位冲量 ≥ 该系数 × 马达每步冲量） */
  limitSafety: number;
  /** ★ IT band（髂胫束）被动髋外展元件：接入阈值（rad）；0=关 */
  itbThreshold: number;
  /** ★ IT band 幅值（N·m，指数型 T=k·(e^(over/τ)−1)；0=关） */
  itbStiffness: number;
  /** ★ IT band 指数时标 τ（rad） */
  itbTau: number;
  /** ★ 腰椎被动并联（胸腰筋膜/韧带）：接入阈值（rad）；0=关 */
  lumbarPassiveThreshold: number;
  /** ★ 腰椎被动刚度（N·m/rad²，每节、轴0/轴2 各计；0=关） */
  lumbarPassiveStiffness: number;
}

export const DEFAULT_DRIVE_OPTIONS: DriveOptions = {
  ...DEFAULT_ACTUATOR_OPTIONS,
  alpha: 1.0,
  limitRate: 20,
  limitSafety: 8,
  // ★ IT band（Inman 1947：单腿站立约一半髋外展力矩由被动组织承担；标定目标：
  //   内收超阈 0.3 rad ≈ 50 N·m、0.4 rad ≈ 88 N·m——危险角度自动分担）
  itbThreshold: 0.10,
  // ★ 按人体实测被动曲线拟合（Ashton-Miller 2020：10°内收≈5 N·m、22°≈26 N·m）：
  //   T = k·(e^(over/τ)−1)，k=12、τ=0.25 → over 0.075→4.2、0.285→26 ✓
  itbStiffness: 12,
  itbTau: 0.25,
  // ★ 腰椎被动并联（胸腰筋膜/韧带；与 IT band 同一优雅原则：执行层被动件，不碰增益）：
  //   单腿实测侧向在 102 N·m/节（τmax）饱和 → 被动项在大角度补足；小角度零干扰。
  lumbarPassiveThreshold: 0.08,
  lumbarPassiveStiffness: 600,
};

export class Drive {
  readonly opt: DriveOptions;
  readonly actuator: Actuator;
  /** 位置目标（rad，相对静姿态；NaN = 无命令） */
  private readonly target: Float64Array;
  /** 逐自由度伺服增益（N·m/rad、N·m·s/rad） */
  private readonly kp: Float64Array;
  private readonly kd: Float64Array;
  /** 前馈力矩（N·m） */
  private readonly ff: Float64Array;
  /** 最近一步各通道的统计（探针回读） */
  readonly stats = { passive: 0, active: 0, servo: 0, ff: 0, damp: 0, limitHits: 0 };

  constructor(
    private readonly sk: Skeleton,
    private readonly body: Body,
    private readonly executor: Executor,
    opt: Partial<DriveOptions> = {},
  ) {
    this.opt = { ...DEFAULT_DRIVE_OPTIONS, ...opt };
    this.actuator = new Actuator(body.dofs, this.opt);
    const n = body.dofs.length;
    this.target = new Float64Array(n).fill(Number.NaN);
    this.kp = new Float64Array(n);
    this.kd = new Float64Array(n);
    this.ff = new Float64Array(n);
  }

  // ──────────────────────────────── 命令接口
  /** 阻抗/平衡点命令。kp/kd 省略时用 tauMax 与有效惯量的合理默认（临界阻尼） */
  setAngle(dofIdx: number, rad: number, kp?: number, kd?: number): void {
    const d = this.body.dofs[dofIdx]!;
    const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
    const K = kp ?? 0.5 * d.tauMax / lim;          // 到限位处约 0.5·τmax
    this.target[dofIdx] = rad;
    this.kp[dofIdx] = K;
    this.kd[dofIdx] = kd ?? NaN;                    // NaN = 每步按临界阻尼算
  }

  /** 按 关节名+轴 设置（探针/上层友好） */
  setJointAngle(name: string, axis: number, rad: number, kp?: number, kd?: number): void {
    const i = this.body.dofByName(name, axis);
    if (i >= 0) this.setAngle(i, rad, kp, kd);
  }

  /** 撤销位置目标（该自由度回到纯被动 + 激活） */
  clearAngle(dofIdx: number): void {
    this.target[dofIdx] = Number.NaN;
  }

  /** 前馈力矩 */
  setTorque(dofIdx: number, tau: number): void {
    this.ff[dofIdx] = tau;
  }

  /** 肌肉激活 ∈ [−1,1] */
  setActivation(dofIdx: number, a: number): void {
    this.actuator.setActivation(dofIdx, a);
  }

  setJointActivation(name: string, axis: number, a: number): void {
    const i = this.body.dofByName(name, axis);
    if (i >= 0) this.setActivation(i, a);
  }

  clearAll(): void {
    this.target.fill(Number.NaN);
    this.kp.fill(0);
    this.kd.fill(0);
    this.ff.fill(0);
    this.actuator.clearAll();
  }

  // ──────────────────────────────── 每步执行
  /** 计算并写入全部自由度的力矩（world.advance 里调用；applyAll 由 world 统一调用） */
  step(dt: number): void {
    this.actuator.updateActivation(dt);
    const s = this.stats;
    s.passive = 0; s.active = 0; s.servo = 0; s.ff = 0; s.damp = 0; s.limitHits = 0;

    const dofs = this.body.dofs;
    for (let i = 0; i < dofs.length; i++) {
      const d = dofs[i]!;
      if (d.engineMotor) continue;                     // 柔性足：引擎电机独占，禁止第二条路径
      const I = Math.max(1e-9, d.inertia);
      const b = this.actuator.dampingOf(i);

      // ① 显式力矩：被动弹性 + ★IT band + 主动（Hill）+ 伺服弹簧 + 前馈
      let tex = this.actuator.stiffnessOf(i) * (0 - d.angle);
      s.passive += Math.abs(tex);
      // ★ IT band（髂胫束）被动髋外展元件（执行层被动件，非控制增益——免疫 τmax 派生增益联动）：
      //   髋 ab/adduction 轴（axis0）偏离中性超阈后接入的二次渐进被动弹簧。
      //   文献：Inman 1947（人体约一半髋外展力矩靠被动组织）/ McLeish & Charnley 1970 /
      //   Prior 2014（骨盆下沉姿势臀中肌激活 −84%，转向被动承载）。小角度零干扰。
      if (d.axis === 0 && (d.name === 'hip_l' || d.name === 'hip_r') && this.opt.itbStiffness > 0) {
        const over = Math.abs(d.angle) - this.opt.itbThreshold;
        if (over > 0) {
          const tItb = -Math.sign(d.angle) * this.opt.itbStiffness * (Math.exp(over / this.opt.itbTau) - 1);
          // ★ 走被动并联通道（不受肌肉 τmax 饱和）——"优雅落点"的完整形态
          this.executor.addPassiveTorque(i, tItb);
          s.passive += Math.abs(tItb);
        }
      }
      // ★ 腰椎被动并联（胸腰筋膜/韧带；同 IT band 原则）：脊柱 1–3 的轴0（侧向）/轴2（矢状）
      if ((d.name === 'spine1' || d.name === 'spine2' || d.name === 'spine3')
        && (d.axis === 0 || d.axis === 2) && this.opt.lumbarPassiveStiffness > 0) {
        const over = Math.abs(d.angle) - this.opt.lumbarPassiveThreshold;
        if (over > 0) {
          const tLum = -Math.sign(d.angle) * this.opt.lumbarPassiveStiffness * over * over;
          this.executor.addPassiveTorque(i, tLum);
          s.passive += Math.abs(tLum);
        }
      }
      const tact = this.actuator.activeTorque(d, i);
      tex += tact;
      s.active += Math.abs(tact);
      const tgt = this.target[i]!;
      if (!Number.isNaN(tgt)) {
        const ts = this.kp[i]! * (tgt - d.angle);
        tex += ts;
        s.servo += Math.abs(ts);
      }
      const tff = this.ff[i]!;
      tex += tff;
      s.ff += Math.abs(tff);

      // ② 一步收敛护栏（α·I·ωmax/dt）
      const tCap = (this.opt.alpha * I * this.opt.jointMaxSpeed) / dt;
      if (tex > tCap) tex = tCap; else if (tex < -tCap) tex = -tCap;

      // ③ 黏性阻尼：τ_d = −B·ω（显式），|τ_d| ≤ κ·τmax。
      //
      //   ★ 为什么**不用**惯量反演的隐式公式（J = −I·ω·(1−e^(−B·dt/I))）：
      //     它需要真实关节空间惯量 M_uu，而 M_uu 是"铰接体惯量"（远端关节自由
      //     ⇒ 链会折叠 ⇒ 比刚性子树小）。用任何估算的上界都会过冲 ⇒ 负阻尼 ⇒
      //     泵能量（实测：刚性子树 300 rad/s 持续；下界又几乎不起作用）。
      //     直接黏性 τ=−B·ω 的稳定性只要求 B·dt/M_uu < 2；B 取 τmax 的小比例，
      //     配合执行器 τmax 硬夹与一步收敛护栏 ⇒ 对 M_uu 不敏感。
      let B = b;
      if (!Number.isNaN(tgt)) {
        const kdRaw = this.kd[i]!;
        // ★ 默认阻尼：**保守的小比例**（0.02·τmax）。
        //   原公式 0.5·√(kp·I) 用"刚性子树上界惯量"，对轻轴严重高估
        //   ⇒ 显式阻尼过冲 ⇒ ~76Hz 全身振铃（实测 Σ|ω|≈133）。
        //   隔离实验：固定小 kd 下 Σ|ω| 收敛到 0。
        const kdUse = Number.isNaN(kdRaw)
          ? 0.02 * Math.max(10, d.tauMax)
          : kdRaw;
        B += kdUse;
      }
      // ★ 显式阻尼的稳定上限：B·dt/I 必须 < 2。kd 是按**刚性子树上界惯量**算的，
      //   对轻轴会高估 ⇒ 超出上限 ⇒ ~76Hz 极限环（实测全身 Σ|ω|≈133）。
      //   按**下界惯量**（inertiaLow）封顶，保证永不越界。
      const Bmax = 0.8 * Math.max(1e-9, d.inertiaLow) / dt;
      if (B > Bmax) B = Bmax;
      let td = 0;
      if (B > 0 && d.vel !== 0) {
        td = -B * d.vel;
        const cap = 0.5 * d.tauMax;
        if (td > cap) td = cap; else if (td < -cap) td = -cap;
      }
      s.damp += Math.abs(td);

      this.executor.addTorque(i, tex + td);

      // ④ 限位通道（仅**没有引擎限位**的球铰自由度）。
      //   v1 的实测结论逐条照搬：
      //     · 目标角速度只由**越界量**决定（不看 ω，否则被继续越界的 ω 牵着走）；
      //     · 限位冲量上限与 I 无关、只与马达同尺度：Jcap = bias·τmax·dt
      //       （合并过 `bias·I·dt`，实测把腰甩飞）；
      //     · bias：脊柱 / 大幅越界 12，其余 8 ⇒ 限位权限恒压过马达。
      if (!d.engineLimited && !d.engineMotor && d.tauMax > 0) {
        const a = d.angle;
        const over = a > d.max ? a - d.max : a < d.min ? a - d.min : 0;
        if (over !== 0) {
          const bias = (d.name.startsWith('spine') || Math.abs(over) > (5 * Math.PI) / 180)
            ? 12 : this.opt.limitSafety;
          d.impulseMax = bias * d.tauMax * dt;
          //   ★ 惯量用**下界 × 0.5**：限位冲量宁可偏小（多花几拍回正），
          //     绝不能过冲 —— 用刚性子树惯量（上界）实测把系统泵到 900 rad/s。
          const Iax = Math.max(1e-9, 0.5 * d.inertiaLow);
          const wCap = Math.max(6, this.opt.limitSafety * d.tauMax / (Math.max(1e-9, d.inertia) / dt));
          const wTarget = -Math.sign(over) * Math.min(Math.abs(over) * this.opt.limitRate, wCap);
          const J = Math.max(-d.impulseMax, Math.min(d.impulseMax, (wTarget - d.vel) * Iax));
          this.executor.addLimitImpulse(i, J);
          s.limitHits++;
        } else {
          d.impulseMax = 0;
        }
      }
    }
  }
}
