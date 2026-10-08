/**
 * stability.ts —— ★ 摔倒预警（原 balance.ts，按用户定调改造中）
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 角色（用户定调）
 * ══════════════════════════════════════════════════════════════════════════
 * **平衡模块属于预警**：预警是稳定性的"大脑"——它算 CoM/XcoM/CoP、决定怎么修，
 * 并输出**提案**（`StabilityProposal`），提案里包含**如何使用反射弧**
 * （`reflexDirectives`）。反射弧只是它手里的工具箱，控制模块负责整合与执行。
 *
 * 内部技术（照旧）：
 *   ① 静态重力补偿（RNEA 静态项，Featherstone & Orin 2000）
 *   ② 质心 PD（LIPM/CoP：p = x − (h/g)·a_des）+ 踝策略
 *
 * ⚠ 过渡状态：`step()` 目前仍直接写关节（旧路径），待控制模块的整合器拆出后，
 *   只保留 `propose()`（只读提案），写入统一由控制模块完成。
 */

import type { World } from './world';
import type { Drive } from './drive';
import { ManualControl } from './manual';

/**
 * ★ 摔倒预警提案（每拍连续输出；只读，不直接写关节）。
 * 控制模块拿它与动作提案整合后发布关节命令。
 */
export interface StabilityProposal {
  /** 期望 CoM 修正（世界系加速度） */
  comAdjust: { ax: number; az: number };
  /** 期望 CoP（世界系；踝/柔性足的去处） */
  desiredCop: { x: number; z: number } | null;
  /** ★ 反射用法：本拍要用哪些反射、参数是什么（反射弧是被动工具箱） */
  reflexDirectives: {
    id: 'pad' | 'hip' | 'step' | 'brace' | 'kneel' | string;
    weight: number;
    params?: Record<string, number>;
  }[];
  /** 等级（派生标签：0 正常 / 1 饱和 / 2 出界） */
  level: 0 | 1 | 2;
  reason: string;
}

export interface BalanceOptions {
  /** 是否启用静态重力补偿（人工控制时几乎必须开） */
  gravityComp: boolean;
  /** 质心位置增益（1/s²） */
  comKp: number;
  /** 质心速度阻尼（1/s） */
  comKd: number;
  /** 水平推力上限（× Mg） */
  maxForceFrac: number;
  /**
   * **姿势张力系数**（0~1，相对 Drive 默认刚度）：
   * 没有被手动目标指定的关节，以零位为平衡点保持张力。
   * 没有它，膝/肘这类"没人管"的关节在动态载荷下会直接软掉（实测鞠躬
   * 0.5s 就把膝折到 −78°）。这是人体肌肉基础张力的对应物。
   * 0 = 纯被动（会瘫）；1 = Drive 默认刚度（τmax/量程 量级）。
   */
  postureTone: number;
  /** 自动标定（实测接触雅可比 G）；false 时用几何 Jacobian（侧向不可靠） */
  autoCalibrate: boolean;
  /** 单个脉冲时长（秒） */
  calPulseTime: number;
  /** 标定脉冲力矩 = calTorqueFrac × τmax（每轴正负各一次） */
  calTorqueFrac: number;
  /**
   * 侧向 CoM 控制开关。
   * 侧向（z）的接触中介映射在静态几何 J 下符号不自洽（实测：+z 目标先往 −z 走、
   * 随后权限饱和发散）——腿链能给出的侧向地面力受足底几何/无踝滚转限制。
   * `false` = 只做矢状（x）平衡；侧向交给姿势张力 + 下一步的在线辨识/AQP。
   */
  lateralControl: boolean;
  /**
   * **踝策略**（Winter 1995；Hof 2005 的 LIPM/CoP 控制）：
   *   倒立摆 ẍ = (g/h)(x − p) ⇒ 要得到 a_des 的 CoP： p = x − (h/g)·a_des
   *   踝力矩实现 CoP 偏移： τ = F_z · (p − p_踝)
   * 这是浮动基座唯一能"把身体推回来"的通道（重力补偿只管关节，不管倾倒）。
   */
  ankleStrategy: boolean;
  /** 踝屈伸力矩 → CoP 的符号（实测标定：+ = 跖屈方向） */
  ankleFlexSign: number;
  /** 踝内外翻力矩 → CoP 的符号（实测标定） */
  ankleInvSign: number;
  /**
   * 踝让位：FootPad/垫脚反射接管踝时，姿势张力**跳过踝自由度**。
   * 否则 900 N·m/rad 级的姿势弹簧会和垫脚力矩对抗（实测恢复被卡在 5–8cm）。
   */
  postureSkipAnkles: boolean;
}

export const DEFAULT_BALANCE_OPTIONS: BalanceOptions = {
  gravityComp: true,
  // ★ 必须大于倒立摆发散率：ω² = g/h ≈ 6.9 1/s²（h≈1.43 m）。
  //   低于它的增益在数学上无法稳定（实测 Kp=4/6 都在 1s 后倒）。
  comKp: 12,
  comKd: 5,
  maxForceFrac: 0.35,
  postureTone: 0.6,
  autoCalibrate: false,
  calTorqueFrac: 0.2,
  calPulseTime: 0.08,
  lateralControl: true,
  ankleStrategy: true,
  // ★ 实测/推导：正屈伸力矩 = 勾脚（CoP 后移）⇒ flexSign = −1；
  //   内外翻：+z 目标实测走反 ⇒ invSign = +1（`_probe-balance-sign` 标定）。
  ankleFlexSign: -1,
  ankleInvSign: +1,
  postureSkipAnkles: false,
};

export class StabilityWarner {
  readonly opt: BalanceOptions;
  readonly drive: Drive;
  readonly manual: ManualControl;
  private readonly comBuf = new Float64Array(3);
  private readonly velBuf = new Float64Array(3);
  private readonly gBuf: Float64Array;
  private readonly jBuf: Float64Array;
  private readonly jBufC: Float64Array;
  private readonly comTarget = { x: 0, z: 0 };
  /** 最近一步的遥测（探针/UI 回读） */
  readonly telemetry = { comX: 0, comZ: 0, Fx: 0, Fz: 0, gravitySum: 0, clampFrac: 0, calibrated: false, calProgress: 0 };
  // ── 在线标定（接触雅可比 G：nDofs×3，"关节力矩 → CoM 加速度"实测） ──
  private G: Float64Array | null = null;
  private K: Float64Array | null = null;
  private calActive = false;
  private calPhase = 0;          // 0=静置, 1=正脉冲, 2=负脉冲
  private calIdx = 0;
  private calT = 0;
  private calV0 = new Float64Array(3);
  private calAcc = new Float64Array(3);
  private readonly calG: Float64Array;
  /** 踝关节自由度（踝策略用）：每只脚的屈伸 + 内外翻 */
  private readonly ankles: { side: 'l' | 'r'; flex: number; inv: number }[] = [];

  constructor(private readonly world: World, opt: Partial<BalanceOptions> = {}) {
    this.opt = { ...DEFAULT_BALANCE_OPTIONS, ...opt };
    this.drive = world.drive;
    this.manual = new ManualControl(world.body, world.drive);
    this.manual.defaultStiffnessFrac = this.opt.postureTone;
    const n = world.body.dofs.length;
    this.gBuf = new Float64Array(n);
    this.jBuf = new Float64Array(n * 3);
    this.jBufC = new Float64Array(n * 3);
    this.calG = new Float64Array(n * 3);
    for (const side of ['l', 'r'] as const) {
      const flex = world.body.dofByName(`foot_${side}`, 2);
      const inv = world.body.dofByName(`foot_${side}`, 0);
      if (flex >= 0) this.ankles.push({ side, flex, inv });
    }
  }

  /** 是否已完成接触雅可比标定 */
  get calibrated(): boolean {
    return this.K !== null;
  }

  /** 手动启动/重跑标定（期间不执行 CoM 控制，只做张力+重力补偿+测试脉冲） */
  startCalibration(): void {
    this.calActive = true;
    this.calPhase = 0;
    this.calIdx = 0;
    this.calT = 0;
    this.calG.fill(0);
    this.G = null;
    this.K = null;
  }

  /** 标定过程中每个自由度的测试力矩（正负对称，抵消漂移） */
  private calTorqueOf(dofIdx: number, sign: number): number {
    const d = this.world.body.dofs[dofIdx]!;
    if (d.engineMotor) return 0;
    return sign * this.opt.calTorqueFrac * Math.max(10, d.tauMax);
  }

  /** 质心水平目标（默认 0,0 = 静姿态质心正下方） */
  setComTarget(x: number, z: number): void {
    this.comTarget.x = x;
    this.comTarget.z = z;
  }

  getComTarget(): { x: number; z: number } {
    return { ...this.comTarget };
  }

  /**
   * ★ 目标接口：只出提案，不写关节（反射用法随提案一起给出）。
   * ⚠ 过渡期：`step()` 仍在直接写关节；整合器拆出后 step() 退役。
   */
  propose(): StabilityProposal {
    const body = this.world.body;
    body.com(this.comBuf);
    body.comVel(this.velBuf);
    const gAbs = Math.abs(this.world.world.gravity.y) || 9.81;
    const errX = this.comTarget.x - this.comBuf[0]!;
    const errZ = this.comTarget.z - this.comBuf[2]!;
    let ax = this.opt.comKp * errX + this.opt.comKd * -this.velBuf[0]!;
    let az = this.opt.comKp * errZ + this.opt.comKd * -this.velBuf[2]!;
    const aMax = this.opt.maxForceFrac * gAbs;
    const am = Math.hypot(ax, az);
    let level: 0 | 1 | 2 = 0;
    let reason = '常规：垫脚';
    if (am > aMax) { ax *= aMax / am; az *= aMax / am; level = 1; reason = '需求超过摩擦预算（饱和）'; }
    // 期望 CoP：p = x − (h/g)·a
    let desiredCop: { x: number; z: number } | null = null;
    if (this.ankles.length > 0) {
      const d0 = body.dofs[this.ankles[0]!.flex]!;
      const h = Math.max(0.3, this.comBuf[1]! - d0.anchorWorld[1]!);
      desiredCop = {
        x: this.comBuf[0]! - (h / gAbs) * ax,
        z: this.comBuf[2]! - (h / gAbs) * az,
      };
    }
    // ★ 反射用法：这一拍要用哪些反射（工具箱被动执行）
    const reflexDirectives: StabilityProposal['reflexDirectives'] = [
      { id: 'pad', weight: 1, params: { kp: this.opt.comKp, kd: this.opt.comKd } },
    ];
    return { comAdjust: { ax, az }, desiredCop, reflexDirectives, level, reason };
  }

  /** 每物理步（World 在 Drive 之前调用） */
  step(dt: number): void {
    this.manual.step(dt);
    const body = this.world.body;
    const ex = this.world.executor;
    const gY = this.world.world.gravity.y;
    const M = this.world.sk.massTotal;

    // ⓪ 姿势张力：手动没管的关节，默认回零位（τmax/量程 量级的小刚度）
    const ankleSet = new Set<number>();
    if (this.opt.ankleStrategy) {
      for (const a of this.ankles) { ankleSet.add(a.flex); if (a.inv >= 0) ankleSet.add(a.inv); }
    }
    if (this.opt.postureSkipAnkles) {
      for (const a of this.ankles) { ankleSet.add(a.flex); if (a.inv >= 0) ankleSet.add(a.inv); }
    }
    for (const d of body.dofs) {
      if (d.engineMotor) continue;
      if (this.manual.hasAngle(d.dofIndex)) continue;
      if (ankleSet.has(d.dofIndex)) continue;   // 踝策略接管的轴，姿势张力让位
      const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
      const kp = this.opt.postureTone * 0.5 * d.tauMax / lim;
      if (kp > 0) this.drive.setAngle(d.dofIndex, 0, kp);
    }

    // ① 重力补偿
    let gsum = 0;
    if (this.opt.gravityComp) {
      body.gravityComp(this.gBuf, gY);
      for (const d of body.dofs) {
        const t = this.gBuf[d.dofIndex]!;
        if (d.engineMotor || t === 0) continue;
        ex.addTorque(d.dofIndex, t);
        gsum += Math.abs(t);
      }
    }
    this.telemetry.gravitySum = gsum;

    // ★ 在线接触雅可比标定期间：只做张力/重力补偿 + 测试脉冲
    if (this.calActive || (this.opt.autoCalibrate && this.K === null)) {
      if (!this.calActive) this.startCalibration();
      this.calStep(dt);
      return;
    }

    // ② 质心 PD → 期望质心加速度
    body.com(this.comBuf);
    body.comVel(this.velBuf);
    const errX = this.comTarget.x - this.comBuf[0]!;
    const errZ = this.comTarget.z - this.comBuf[2]!;
    let aX = this.opt.comKp * errX + this.opt.comKd * -this.velBuf[0]!;
    let aZ = this.opt.lateralControl
      ? this.opt.comKp * errZ + this.opt.comKd * -this.velBuf[2]!
      : 0;
    const aMax = this.opt.maxForceFrac * Math.abs(gY);   // 摩擦预算：|F| ≤ frac·Mg ⇔ |a| ≤ frac·g
    const amag = Math.hypot(aX, aZ);
    if (amag > aMax) { aX *= aMax / amag; aZ *= aMax / amag; }
    this.telemetry.Fx = M * aX; this.telemetry.Fz = M * aZ;
    this.telemetry.clampFrac = aMax > 0 ? amag / aMax : 0;

    // ③ 任务力矩
    if (this.opt.ankleStrategy && this.ankles.length > 0) {
      // ── 踝策略（LIPM/CoP）：p = x − (h/g)·a_des；τ = F_z·(p − p_踝) ──
      const gAbs = Math.abs(gY);
      let ankleX = 0, ankleY = 0, ankleZ = 0, nA = 0;
      for (const a of this.ankles) {
        const d = body.dofs[a.flex]!;
        ankleX += d.anchorWorld[0]!; ankleY += d.anchorWorld[1]!; ankleZ += d.anchorWorld[2]!; nA++;
      }
      if (nA > 0) { ankleX /= nA; ankleY /= nA; ankleZ /= nA; }
      const h = Math.max(0.3, this.comBuf[1]! - ankleY);
      // ★ 足底 CoP 的**物理可达范围**（踝在足跟附近 ⇒ 前后不对称）：
      //   向前（趾侧）~14cm、向后（跟侧）只有 ~5cm、侧向 ~3.5cm。
      //   期望加速度必须先按可达 CoP 限幅，否则 PD 会"要一个给不出的力"
      //   ⇒ 饱和后正反馈（实测 +x 目标失控）。
      const copFwd = 0.14, copBack = 0.05, copSide = 0.035;
      const aXMax = (gAbs / h) * copFwd;
      const aXMin = -(gAbs / h) * copBack;
      if (aX > aXMax) aX = aXMax; else if (aX < aXMin) aX = aXMin;
      const aZMax = (gAbs / h) * copSide;
      if (aZ > aZMax) aZ = aZMax; else if (aZ < -aZMax) aZ = -aZMax;
      this.telemetry.clampFrac = Math.max(Math.abs(aX) / Math.max(1e-9, aXMax), Math.abs(aZ) / Math.max(1e-9, aZMax));
      const pX = this.comBuf[0]! - (h / gAbs) * aX;
      const pZ = this.comBuf[2]! - (h / gAbs) * aZ;
      let dpx = pX - ankleX;
      let dpz = pZ - ankleZ;
      if (dpx > copFwd) dpx = copFwd; else if (dpx < -copBack) dpx = -copBack;
      if (dpz > copSide) dpz = copSide; else if (dpz < -copSide) dpz = -copSide;
      for (const a of this.ankles) {
        const Fz = Math.max(0, body.footNormalForce(a.side, dt));
        if (Fz < 1) continue;
        const df = body.dofs[a.flex]!;
        let tf = Fz * dpx * this.opt.ankleFlexSign;
        const fcap = 0.9 * df.tauMax;
        if (tf > fcap) tf = fcap; else if (tf < -fcap) tf = -fcap;
        if (tf !== 0) ex.addTorque(a.flex, tf);
        if (a.inv >= 0 && this.opt.lateralControl && Math.abs(dpz) > 1e-6) {
          const di = body.dofs[a.inv]!;
          let ti = Fz * dpz * this.opt.ankleInvSign;
          const icap = 0.9 * di.tauMax;
          if (ti > icap) ti = icap; else if (ti < -icap) ti = -icap;
          if (ti !== 0) ex.addTorque(a.inv, ti);
        }
      }
    } else if (this.K !== null) {
      for (const d of body.dofs) {
        if (d.engineMotor) continue;
        const i3 = d.dofIndex * 3;
        const tau = this.K[i3]! * aX + this.K[i3 + 2]! * aZ;
        if (tau !== 0) ex.addTorque(d.dofIndex, tau);
      }
    } else {
      // 几何回退：腿链（脚接地）用互补侧；躯干/手臂用子端侧
      body.comJacobian(this.jBuf);
      body.comJacobianComplement(this.jBufC);
      for (const d of body.dofs) {
        if (d.engineMotor) continue;
        const i3 = d.dofIndex * 3;
        const leg = /^(foot|knee|hip|arch|mfoot|ankle)/.test(d.name);
        const jx = leg ? this.jBufC[i3]! : this.jBuf[i3]!;
        const jz = leg ? this.jBufC[i3 + 2]! : this.jBuf[i3 + 2]!;
        const tau = jx * M * aX + jz * M * aZ;
        if (tau !== 0) ex.addTorque(d.dofIndex, tau);
      }
    }

    // ④ 手动力矩（附加通道）
    for (const d of body.dofs) {
      const t = this.manual.torqueOf(d.dofIndex);
      if (!d.engineMotor && t !== 0) ex.addTorque(d.dofIndex, t);
    }

    this.telemetry.comX = this.comBuf[0]!;
    this.telemetry.comZ = this.comBuf[2]!;
  }

  // ──────────────────────────────── 在线标定状态机
  /**
   * 每个自由度打一对**正负对称**力矩脉冲（各 T 秒），记录 CoM 速度变化：
   *   g_i = Δv⁺ − Δv⁻ / (2·|τ|·T)        单位 1/(kg·m)
   * 对称脉冲抵消地面摩擦/重力漂移；标定期间姿势张力与重力补偿保持开启，
   * 所以测到的是**闭环接触响应**（正是平衡控制需要的映射）。
   * 结束后 K = Gᵀ(GGᵀ + λI)⁻¹：τ = K·a_des 的最小范数解。
   */
  private calStep(dt: number): void {
    const body = this.world.body;
    const n = body.dofs.length;
    const T = this.opt.calPulseTime;
    if (this.calPhase === 0) {
      this.calT += dt;
      if (this.calT >= 0.5) { this.calPhase = 1; this.calT = 0; body.comVel(this.calV0); }
      this.updateCalProgress();
      return;
    }
    while (this.calIdx < n && body.dofs[this.calIdx]!.engineMotor) this.calIdx++;
    if (this.calIdx >= n) { this.finishCalibration(); return; }

    const sign = this.calPhase === 1 ? 1 : -1;
    const tau = this.calTorqueOf(this.calIdx, sign) / Math.abs(sign); // 原值
    if (tau !== 0) this.world.executor.addTorque(this.calIdx, tau);
    this.calT += dt;
    if (this.calT >= T) {
      body.comVel(this.velBuf);
      if (this.calPhase === 1) {
        this.calAcc[0] = this.velBuf[0]! - this.calV0[0]!;
        this.calAcc[1] = this.velBuf[1]! - this.calV0[1]!;
        this.calAcc[2] = this.velBuf[2]! - this.calV0[2]!;
        this.calPhase = 2; this.calT = 0; body.comVel(this.calV0);
      } else {
        const denom = 2 * Math.abs(tau) * T;
        const i3 = this.calIdx * 3;
        this.calG[i3] = (this.calAcc[0]! - (this.velBuf[0]! - this.calV0[0]!)) / denom;
        this.calG[i3 + 1] = (this.calAcc[1]! - (this.velBuf[1]! - this.calV0[1]!)) / denom;
        this.calG[i3 + 2] = (this.calAcc[2]! - (this.velBuf[2]! - this.calV0[2]!)) / denom;
        this.calIdx++; this.calPhase = 1; this.calT = 0; body.comVel(this.calV0);
      }
    }
    this.updateCalProgress();
  }

  private updateCalProgress(): void {
    const n = this.world.body.dofs.length;
    this.telemetry.calProgress = this.calPhase === 0 ? 0.02 + 0.1 * (this.calT / 0.5)
      : (this.calIdx / n);
  }

  private finishCalibration(): void {
    const G = this.calG;
    const n = this.world.body.dofs.length;
    // S = Σ g_i g_iᵀ（3×3）
    let s00 = 0, s01 = 0, s02 = 0, s11 = 0, s12 = 0, s22 = 0;
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const a = G[i3]!, b = G[i3 + 1]!, c = G[i3 + 2]!;
      s00 += a * a; s01 += a * b; s02 += a * c; s11 += b * b; s12 += b * c; s22 += c * c;
    }
    const lam = 1e-3 * (s00 + s11 + s22 + 1e-12);
    s00 += lam; s11 += lam; s22 += lam;
    // 3×3 逆（对称）
    const det = s00 * (s11 * s22 - s12 * s12) - s01 * (s01 * s22 - s12 * s02) + s02 * (s01 * s12 - s11 * s02);
    const id = det !== 0 ? 1 / det : 0;
    const i00 = (s11 * s22 - s12 * s12) * id;
    const i01 = -(s01 * s22 - s12 * s02) * id;
    const i02 = (s01 * s12 - s11 * s02) * id;
    const i11 = (s00 * s22 - s02 * s02) * id;
    const i12 = -(s00 * s12 - s02 * s01) * id;
    const i22 = (s00 * s11 - s01 * s01) * id;
    const K = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;
      const a = G[i3]!, b = G[i3 + 1]!, c = G[i3 + 2]!;
      K[i3] = i00 * a + i01 * b + i02 * c;
      K[i3 + 1] = i01 * a + i11 * b + i12 * c;
      K[i3 + 2] = i02 * a + i12 * b + i22 * c;
    }
    this.G = G; this.K = K;
    this.calActive = false;
    this.telemetry.calibrated = true;
    this.telemetry.calProgress = 1;
  }
}
