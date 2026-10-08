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
  /** 侧向转移（髋策略）符号：+1 已由 `_probe-lean` 标定；0 = 关闭该 directive */
  leanSign: number;
  /** 侧向转移增益（**角度式**：rad per m 误差）与阻尼（rad per m/s） */
  leanKp: number;
  leanKd: number;
  /** 前后弯腰（髋屈伸）符号：由 `_probe-bend` 标定；0 = 关闭 */
  bendSign: number;
  bendKp: number;
  bendKd: number;
  /**
   * ★ 单支撑预倾辅助（负载驱动，不是误差驱动）：
   * 单支撑时支撑髋扛着全身+抬起腿的滚转力矩（实测需求 ~120+ N·m 顶满 0.6×200 上限），
   * 而躯干/摆臂通道闲置。按支撑侧把上半身预倾过去，替支撑髋卸力矩。
   * 量：脊柱每段侧屈角（rad）与双肩角（rad）的固定偏置。
   */
  leanAssistSpine: number;
  leanAssistArm: number;
  /** 触发预倾的单支撑判据：|Fl−Fr| / (Fl+Fr) 超过它 */
  leanAssistImbalance: number;
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
  leanSign: 1,
  leanKp: 2.0,
  leanKd: 0.6,
  bendSign: 1,
  bendKp: 200,
  bendKd: 25,
  leanAssistSpine: 0.1,
  leanAssistArm: 0.25,
  leanAssistImbalance: 0.6,
};

/**
 * ★ 侧向幅度预算（Pai & Patton 1997 的"可恢复 CoM 幅度"思想 + 分量静力学标定）
 * 需求 q（m，世界系：正 = CoM 要往 +z 搬）→ 各级关节角幅值。
 * 标定来源：
 *   · 髋外展 ≈1.2 rad/m（`_probe-lean`：θ=−0.19 rad ↔ CoM −0.15 m）
 *   · 脊柱侧屈 ≈0.27 m/rad·段（`_probe-sideaxis`：spine2/0 0.3 rad → 胸腔 15cm，
 *     躯干质量占比 ~50%）
 *   · 摆臂 ≈0.0675 m/rad（`_probe-armaxis`：双肩 0.8 rad → CoM 5.4cm）
 * 各级饱和后的余量传给下一级；全饱和仍不够 → residual 非零（升 level）。
 */
export const LATERAL_BUDGET = {
  hip: { ratio: 1.6, cap: 0.4 },       // rad/m, rad（实测骨盆权限 ~0.63 m/rad → 1/0.63≈1.6）
  spine: { gain: 0.27, cap: 0.2 },     // m/rad/段, rad/段（加强腰部侧屈修正）
  arm: { gain: 0.0675, cap: 1.0 },     // m/rad, rad
};

export function planLateral(q: number): { hip: number; spine: number; arm: number; residual: number } {
  // ★ 固定分账（实测：只搬骨盆不弯躯干，单脚保持相不稳；通过版是 hips=θ、spine=0.3θ）
  const hip = Math.max(-LATERAL_BUDGET.hip.cap, Math.min(LATERAL_BUDGET.hip.cap, 0.7 * LATERAL_BUDGET.hip.ratio * q));
  const spine = Math.max(-LATERAL_BUDGET.spine.cap, Math.min(LATERAL_BUDGET.spine.cap, 0.5 * q));
  const remain = q - hip / LATERAL_BUDGET.hip.ratio - spine * LATERAL_BUDGET.spine.gain;
  // ★ 摆臂符号与髋/脊柱**相反**（实测：双肩 +0.8 → CoM 向 −z）：要覆盖 +q 的 CoM
  //   需求，肩角必须是 −q/gain。之前的同号实现是正反馈（回中时越摆越把 CoM 推倒）。
  const arm = Math.max(-LATERAL_BUDGET.arm.cap, Math.min(LATERAL_BUDGET.arm.cap, -remain / LATERAL_BUDGET.arm.gain));
  return { hip, spine, arm, residual: remain + arm * LATERAL_BUDGET.arm.gain };
}

/** 矢状幅度预算：髋屈伸（≈0.8 rad/m, ±0.4）→ 脊柱屈伸（同上）→ 摆臂前后（≈0.05 m/rad） */
export const SAGITTAL_BUDGET = {
  hip: { ratio: 0.8, cap: 0.4 },
  spine: { gain: 0.27, cap: 0.15 },
  arm: { gain: 0.05, cap: 1.0 },
};

export function planSagittal(q: number): { hip: number; spine: number; arm: number; residual: number } {
  let remain = q;
  const hip = Math.max(-SAGITTAL_BUDGET.hip.cap, Math.min(SAGITTAL_BUDGET.hip.cap, remain * SAGITTAL_BUDGET.hip.ratio));
  remain -= hip / SAGITTAL_BUDGET.hip.ratio;
  const spine = Math.max(-SAGITTAL_BUDGET.spine.cap, Math.min(SAGITTAL_BUDGET.spine.cap, remain / SAGITTAL_BUDGET.spine.gain));
  remain -= spine * SAGITTAL_BUDGET.spine.gain;
  const arm = Math.max(-SAGITTAL_BUDGET.arm.cap, Math.min(SAGITTAL_BUDGET.arm.cap, remain / SAGITTAL_BUDGET.arm.gain));
  remain -= arm * SAGITTAL_BUDGET.arm.gain;
  return { hip, spine, arm, residual: remain };
}

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
    // ★★ 伺服 v2：幅度预算（Pai & Patton 1997, J Biomech 30(4):347-354 ——
    //    "可恢复 CoM 速度-位置可行域/平衡稳定边界"，即重心修复幅度的上界。
    //    Simoneau & Corbeil 2005 实验验证；Hof 2005 给出 XCoM 判据）
    //   需求：q = 目标 − (CoM + v/ω0)（把 CoM 停到目标所需的"等效位移"；
    //   含动量项，天然带阻尼，替代原来的粗糙 PD）。
    //   分配序（每级有实测标定增益，饱和则留给下一级）：
    //     踝/垫脚（±2cm 侧 / +14/−5cm 矢）→ 髋（≈1.2 rad/m, ≤0.35 rad）
    //     → 脊柱（≈0.27 m/rad/段, ≤0.15 rad/段）→ 摆臂（≈0.0675 m/rad, ≤1.0 rad）
    //   总幅度不足（residual 仍大）时 level 升 1（未来接"迈步提案"）。
    const hCoM = Math.max(0.3, this.comBuf[1]!);
    const omega0 = Math.sqrt(gAbs / hCoM);
    const qZ = errZ - this.velBuf[2]! / omega0;
    void planSagittal;
    // ★ 单支撑预倾辅助（负载驱动）：支撑髋扛全身+抬起腿的滚转力矩（实测需求顶满
    //   0.6×200=120 N·m 而缓慢下沉），躯干/摆臂通道却闲置 → 把上半身预倾到支撑侧，
    //   替支撑髋卸力矩（人类单脚站也是把骨盆/躯干压到支撑腿上）。
    let assistSpine = 0, assistArm = 0;
    const Fl = body.footNormalForce('l', this.world.dt);
    const Fr = body.footNormalForce('r', this.world.dt);
    const fTot = Fl + Fr;
    if (fTot > 0.3 * (body.sk.massTotal * gAbs)) {
      const imbalance = Math.abs(Fl - Fr) / Math.max(fTot, 1e-6);
      if (imbalance > this.opt.leanAssistImbalance) {
        const suppZ = Fl > Fr ? 1 : -1;             // 支撑侧的世界 z 符号
        assistSpine = suppZ * this.opt.leanAssistSpine;    // 侧屈向支撑侧
        assistArm = -suppZ * this.opt.leanAssistArm;       // 双肩正角把 CoM 推向 −z
      }
    }
    if ((Math.abs(qZ) > 0.02 || assistSpine !== 0) && this.opt.leanSign !== 0) {
      const plan = planLateral(qZ);
      const clamp1 = (v: number) => Math.max(-1.2, Math.min(1.2, v));
      reflexDirectives.push({
        id: 'lean',
        weight: 1,
        params: {
          hip: plan.hip,
          spine: clamp1(plan.spine + assistSpine),
          arm: clamp1(plan.arm + assistArm),
          sign: this.opt.leanSign,
        },
      });
      if (Math.abs(plan.residual) > 0.04) { level = 1; reason = '侧向幅度预算用尽（髋+脊柱+摆臂全饱和）'; }
    }
    // 矢状（前后）：髋力矩帮助 + **脊柱前后位置式**（腰部主动修正，2026-10 增强；
    // 前弯 = spine/2 负，由 BOW 关键帧实测）。动作播放期间其脚本关节已 pin，不会抢。
    const qX = errX - this.velBuf[0]! / omega0;
    if (Math.abs(qX) > 0.06 && this.opt.bendSign !== 0) {
      const spineSag = Math.max(-0.08, Math.min(0.08, -qX * 1.0));
      reflexDirectives.push({
        id: 'bend',
        weight: 1,
        params: {
          x: this.comTarget.x,
          kp: this.opt.bendKp,
          kd: this.opt.bendKd,
          sign: this.opt.bendSign,
          cap: 60,
          spine: spineSag,
        },
      });
    }
    return { comAdjust: { ax, az }, desiredCop, reflexDirectives, level, reason };
  }

  /**
   * 平衡基建：姿势张力 + 重力补偿。
   * @param skip 该步已被更高优先级源（动作/保护）接管的自由度集合，姿势张力跳过
   */
  contributeBaseline(skip?: Set<number>): void {
    const body = this.world.body;
    const ex = this.world.executor;
    const gY = this.world.world.gravity.y;

    // ⓪ 姿势张力：手动没管的关节，默认回零位（τmax/量程 量级的小刚度）
    const ankleSet = new Set<number>();
    if (this.opt.ankleStrategy || this.opt.postureSkipAnkles) {
      for (const a of this.ankles) { ankleSet.add(a.flex); if (a.inv >= 0) ankleSet.add(a.inv); }
    }
    for (const d of body.dofs) {
      if (d.engineMotor) continue;
      if (this.manual.hasAngle(d.dofIndex)) continue;
      if (skip?.has(d.dofIndex)) continue;      // 动作层/保护程序已接管
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
  }

  /** 每物理步（旧路径；控制模块可直接调 propose + 执行方，不必经过它） */
  step(dt: number): void {
    this.manual.step(dt);
    this.contributeBaseline();
    const body = this.world.body;
    const ex = this.world.executor;
    const gY = this.world.world.gravity.y;
    const M = this.world.sk.massTotal;

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
