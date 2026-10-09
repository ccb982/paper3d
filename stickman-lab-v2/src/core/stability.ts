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
 * ★ 只提案，不写关节：`propose()`（含反射用法与幅度预算）+ `contributeBaseline()`
 *   （平衡基建，由控制模块在整合流程里调用）。旧的自带 step()/在线标定路径已删除。
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
  /**
   * **踝策略**（Winter 1995；Hof 2005 的 LIPM/CoP 控制）：
   *   倒立摆 ẍ = (g/h)(x − p) ⇒ 要得到 a_des 的 CoP： p = x − (h/g)·a_des
   *   踝力矩实现 CoP 偏移： τ = F_z · (p − p_踝)
   * 这是浮动基座唯一能"把身体推回来"的通道（重力补偿只管关节，不管倾倒）。
   */
  ankleStrategy: boolean;
  /**
   * 踝让位：FootPad/垫脚反射接管踝时，姿势张力**跳过踝自由度**。
   * 否则 900 N·m/rad 级的姿势弹簧会和垫脚力矩对抗（实测恢复被卡在 5–8cm）。
   */
  postureSkipAnkles: boolean;
  /** 侧向转移（髋策略）符号：+1 已由 `_probe-lean` 标定；0 = 关闭该 directive */
  leanSign: number;
  /** 前后弯腰（髋屈伸）符号：由 `_probe-bend` 标定；0 = 关闭 */
  bendSign: number;
  bendKp: number;
  bendKd: number;
  /** ★ 单支撑分账：每单位失衡 boost，脊柱追加的增益（rad/m；0=回到固定分账） */
  leanBoostSpineGain: number;
  /** ★ 单支撑摆臂偏置幅（rad；随误差淡出） */
  leanBoostArmBias: number;
}

export const DEFAULT_BALANCE_OPTIONS: BalanceOptions = {
  gravityComp: true,
  // ★ 必须大于倒立摆发散率：ω² = g/h ≈ 6.9 1/s²（h≈1.43 m）。
  //   低于它的增益在数学上无法稳定（实测 Kp=4/6 都在 1s 后倒）。
  comKp: 12,
  comKd: 5,
  maxForceFrac: 0.35,
  postureTone: 0.6,
  ankleStrategy: true,
  postureSkipAnkles: false,
  leanSign: 1,
  bendSign: 1,
  bendKp: 200,
  bendKd: 25,
  leanBoostSpineGain: 2.0,
  leanBoostArmBias: 0.3,
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
  spine: { gain: 0.27, cap: 0.22 },    // m/rad/段, rad/段（加强腰部侧屈修正）
  arm: { gain: 0.0675, cap: 1.0 },     // m/rad, rad
};

export function planLateral(q: number, spineBoost = 0, boostSpineGain = 3.0, boostArmBias = 0.3): { hip: number; spine: number; arm: number; residual: number } {
  // ★ 负载驱动的分账：单支撑（spineBoost→1）时髋本来就饱和 → 让髋少分、腰多分。
  //   全部按误差 q 幅度驱动（不是加性偏置）——加性偏置会在 CoM 到目标后继续外推，
  //   把身体推过支撑脚（实测回中发散）。
  const hipGain = 1.6 * (1 - 0.35 * spineBoost);
  const spineGain = 0.5 + boostSpineGain * spineBoost;
  const hip = Math.max(-LATERAL_BUDGET.hip.cap, Math.min(LATERAL_BUDGET.hip.cap, 0.7 * hipGain * q));
  const spine = Math.max(-LATERAL_BUDGET.spine.cap, Math.min(LATERAL_BUDGET.spine.cap, spineGain * q));
  const remain = q - hip / LATERAL_BUDGET.hip.ratio - spine * LATERAL_BUDGET.spine.gain;
  // ★ 摆臂符号与髋/脊柱**相反**（实测：双肩 +0.8 → CoM 向 −z）：要覆盖 +q 的 CoM
  //   需求，肩角必须是 −q/gain。之前的同号实现是正反馈（回中时越摆越把 CoM 推倒）。
  let arm = Math.max(-LATERAL_BUDGET.arm.cap, Math.min(LATERAL_BUDGET.arm.cap, -remain / LATERAL_BUDGET.arm.gain));
  // ★ 单支撑摆臂偏置：推向目标侧，幅度随 q 淡出（|q|<3cm 自动归零——防推到目标外）
  if (spineBoost > 0) {
    const dir = Math.max(-1, Math.min(1, q / 0.03));
    arm += -dir * LATERAL_BUDGET.arm.cap * boostArmBias * spineBoost;
  }
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
  /** ★ 脚力的低通状态（单支撑判据用；原始 Fz 逐帧抖 ±30%，直接判会高频切换辅助） */
  private readonly fzLp = new Float64Array(2);
  private readonly gBuf: Float64Array;
  private readonly jBuf: Float64Array;
  private readonly jBufC: Float64Array;
  private readonly comTarget = { x: 0, z: 0 };
  /** 最近一步的遥测（探针/UI 回读） */
  readonly telemetry = { comX: 0, comZ: 0, Fx: 0, Fz: 0, gravitySum: 0, clampFrac: 0 };
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
    for (const side of ['l', 'r'] as const) {
      const flex = world.body.dofByName(`foot_${side}`, 2);
      const inv = world.body.dofByName(`foot_${side}`, 0);
      if (flex >= 0) this.ankles.push({ side, flex, inv });
    }
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
    const VEL_GAIN = 1.0;                      // ★ 速度阻尼：XCoM 阻尼项加大（"动量太大"）
    const qZ = errZ - VEL_GAIN * this.velBuf[2]! / omega0;
    // ★ 单支撑预倾（负载驱动）：脚力先低通（原始 Fz 逐帧抖 ±30%），失衡度 0.45→0.70
    //   线性爬到满——**作为"分账权重"传给计划**（单支撑时腰多分、髋让位），
    //   而不是加性偏置（加性会把 CoM 推过支撑脚，实测回中发散）。
    let spineBoost = 0;
    const Fl0 = body.footNormalForce('l', this.world.dt);
    const Fr0 = body.footNormalForce('r', this.world.dt);
    const kFz = 1 - Math.exp(-this.world.dt / 0.08);
    this.fzLp[0] = this.fzLp[0]! + (Fl0 - this.fzLp[0]!) * kFz;
    this.fzLp[1] = this.fzLp[1]! + (Fr0 - this.fzLp[1]!) * kFz;
    const Fl = this.fzLp[0]!, Fr = this.fzLp[1]!;
    const fTot = Fl + Fr;
    if (fTot > 0.3 * (body.sk.massTotal * gAbs)) {
      const imbalance = Math.abs(Fl - Fr) / Math.max(fTot, 1e-6);
      spineBoost = Math.max(0, Math.min(1, (imbalance - 0.45) / 0.25));
    }
    if ((Math.abs(qZ) > 0.02 || spineBoost > 0) && this.opt.leanSign !== 0) {
      const plan = planLateral(qZ, spineBoost, this.opt.leanBoostSpineGain, this.opt.leanBoostArmBias);
      reflexDirectives.push({
        id: 'lean',
        weight: 1,
        params: { hip: plan.hip, spine: plan.spine, arm: plan.arm, sign: this.opt.leanSign },
      });
      if (Math.abs(plan.residual) > 0.04) { level = 1; reason = '侧向幅度预算用尽（髋+脊柱+摆臂全饱和）'; }
    }
    // 矢状（前后）：髋力矩帮助 + **脊柱前后位置式**（腰部主动修正，2026-10 增强；
    // 前弯 = spine/2 负，由 BOW 关键帧实测）。动作播放期间其脚本关节已 pin，不会抢。
    const qX = errX - VEL_GAIN * this.velBuf[0]! / omega0;
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

}
