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
  /** ★ P1 支撑控制：支撑状态与有效性预测（只读回读；伺服输出仍只是本提案） */
  support: {
    /** 支撑模式（滞回后）：双 / 左 / 右 / 腾空 */
    mode: 'both' | 'l' | 'r' | 'none';
    /** 相位：双支撑 / 预转移 / 单支撑保持 / 回正 */
    phase: 'double' | 'preshift' | 'hold' | 'recenter';
    /** XCoM 到支撑区边界余量（m；正 = 区内，负 = 已越界） */
    marginX: number;
    marginZ: number;
    /** 单支撑时体重是否真在支撑脚（≥0.8W；"正确发力把身体撑起来"的判据） */
    loadOk: boolean;
    /** 支撑锚点（调试回读；单支撑时的支撑脚踝世界坐标） */
    supX: number;
    supZ: number;
  };
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
  /**
   * 前后弯腰（髋屈伸）符号。★ 修正（2026-10，P1 隔离实测）：**−1 才是正确方向**
   * （`_probe-bend` 的旧标定被垫脚脚尖权限污染：pad 一开，±1 看着都能动）。
   * 隔离（pad 关）实测：+1 → CoM 反向跑到 −1.09（倒）；−1 → 朝目标方向。
   */
  bendSign: number;
  bendKp: number;
  bendKd: number;
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
  bendSign: -1,
  bendKp: 200,
  bendKd: 25,
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
  /** ★ 目标守护（伺服细节调控）：内部安全目标 z / 时间 / 目标新鲜度 */
  private govZ = 0;
  /** ★ P1：矢状目标守护（x 方向；与 z 同构） */
  private govX = 0;
  private govInit = false;
  private timeAcc = 0;
  private lastSetT = -10;
  /** ★ P1 支撑控制：模式（滞回）/相位/支撑锚点/进入双支撑时刻 */
  private supMode: 'both' | 'l' | 'r' | 'none' = 'both';
  private supZ = 0;
  private supX = 0;
  private doubleT = -10;
  /** 最近一步的遥测（探针/UI 回读） */
  readonly telemetry = { comX: 0, comZ: 0, Fx: 0, Fz: 0, gravitySum: 0, clampFrac: 0 };
  /** 踝关节自由度（踝策略用）：每只脚的屈伸 + 内外翻 */
  private readonly ankles: { side: 'l' | 'r'; flex: number; inv: number }[] = [];
  private readonly ankleIdx: { l: number; r: number } = { l: -1, r: -1 };
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
      if (flex >= 0) {
        this.ankleIdx[side] = this.ankles.length;
        this.ankles.push({ side, flex, inv });
      }
    }
  }

  /** 质心水平目标（默认 0,0 = 静姿态质心正下方） */
  setComTarget(x: number, z: number): void {
    this.comTarget.x = x;
    this.comTarget.z = z;
    this.lastSetT = this.timeAcc;   // 记录"新鲜度"（过期 → 伺服回正）
  }

  getComTarget(): { x: number; z: number } {
    return { x: this.govX, z: this.govZ };   // 守护后的 x/z（实际生效目标）
  }

  /**
   * ★ 目标接口：只出提案，不写关节（反射用法随提案一起给出）。
   */
  propose(): StabilityProposal {
    const body = this.world.body;
    body.com(this.comBuf);
    body.comVel(this.velBuf);
    const gAbs = Math.abs(this.world.world.gravity.y) || 9.81;
    // ★★ 目标守护（用户定调）：主动方发起侧移/单支撑，伺服负责**别转移太过 + 回正**：
    //   ① 单支撑（失衡>0.7）→ 内部目标钳在支撑脚 ±6cm；双支撑 → 钳在 ±0.17（组合 CoP）；
    //   ② 限速渐进（0.1 m/s）；③ 目标过期（>0.6s 未更新）且双支撑 → 0.05 m/s 回正到中线。
    const dtg = this.world.dt;
    this.timeAcc += dtg;
    if (!this.govInit) { this.govZ = this.comTarget.z; this.govX = this.comTarget.x; this.govInit = true; }
    const Wg = body.sk.massTotal * gAbs;
    const fl = body.footNormalForce('l', dtg);
    const fr = body.footNormalForce('r', dtg);
    const fTotG = fl + fr;
    const imb = fTotG > 1e-6 ? Math.abs(fl - fr) / fTotG : 0;

    // ★★ P1 支撑控制①：支撑模式（**滞回**：入单支撑 imb>0.7、退 <0.5；总重不足=腾空；
    //    支撑脚失载且另一脚接管 = 换脚）与支撑锚点。滞回防边界翻抖（夹位在 ±6cm/±0.17 切换）。
    let mode: 'both' | 'l' | 'r' | 'none';
    if (fTotG < 0.3 * Wg) mode = 'none';
    else if (this.supMode === 'both' || this.supMode === 'none') {
      mode = imb > 0.7 ? (fl > fr ? 'l' : 'r') : 'both';
    } else {
      const supFz = this.supMode === 'l' ? fl : fr;
      const otherFz = this.supMode === 'l' ? fr : fl;
      mode = (imb < 0.5 || (supFz < 0.15 * Wg && otherFz > 0.5 * Wg)) ? 'both' : this.supMode;
      if (mode === 'both' && imb > 0.7) mode = fl > fr ? 'l' : 'r';
    }
    if (mode !== this.supMode) {
      if (mode === 'both') this.doubleT = this.timeAcc;
      this.supMode = mode;
    }
    const single = mode === 'l' || mode === 'r';
    const ankleL = this.ankleIdx.l >= 0 ? body.dofs[this.ankles[this.ankleIdx.l]!.flex]! : null;
    const ankleR = this.ankleIdx.r >= 0 ? body.dofs[this.ankles[this.ankleIdx.r]!.flex]! : null;
    if (single) {
      const a = mode === 'l' ? ankleL : ankleR;
      if (a) { this.supZ = a.anchorWorld[2]!; this.supX = a.anchorWorld[0]!; }
    }

    const fresh = this.timeAcc - this.lastSetT < 0.6;
    // ★★ P1 支撑控制②：相位（双支撑 / 预转移 / 单支撑保持 / 回正）
    let phase: 'double' | 'preshift' | 'hold' | 'recenter';
    if (single) phase = 'hold';
    else if (imb > 0.35) phase = 'preshift';
    else if (!fresh || this.timeAcc - this.doubleT < 0.8) phase = 'recenter';
    else phase = 'double';

    // ── 侧向目标守护（z）──
    let lo = -0.17, hi = 0.17, rate = 0.1;
    let wanted: number;
    if (single) {
      // 单支撑：主动方还在发话 → 钳在支撑脚 ±6cm（别太过）；
      // 主动方没发话（抬腿是主动的，之后收拾是伺服的）→ 伺服自己把重心管到支撑脚上。
      lo = this.supZ - 0.06; hi = this.supZ + 0.06;
      wanted = fresh ? Math.max(lo, Math.min(hi, this.comTarget.z)) : (lo + hi) / 2;
    } else if (phase === 'preshift' && fresh) {
      // ★ P1 支撑保障：一脚在卸/加载（即将单支撑）且主动方还在发话 → 正常双支撑钳制
      //   （目标会被限制在 ±0.17 内）。★ 教训：**过期时绝不能把目标猛拽到"承重脚中心"**
      //   ——放腿落地的瞬间会把目标横跨整个身体拉过去（实测侧向踢飞、外侧翻倒）。
      wanted = Math.max(-0.17, Math.min(0.17, this.comTarget.z));
    } else {
      wanted = fresh ? Math.max(-0.17, Math.min(0.17, this.comTarget.z)) : 0;
      if (!fresh) rate = 0.05;   // 双支撑+目标过期 → 慢慢回正到中线
    }
    const dgv = wanted - this.govZ;
    const stepg = rate * dtg;
    this.govZ += Math.abs(dgv) <= stepg ? dgv : Math.sign(dgv) * stepg;

    // ── ★ P1 矢状目标守护（x，与 z 同构）──
    //    钳到可支撑区：矢状 CoP 权限前 +0.14 / 后 −0.05（实测，`_probe-bend`）；
    //    单支撑按支撑脚、双支撑按承重脚；目标过期 → 0.05 m/s 回正到中线。
    const supXref = single ? this.supX : ((fl > fr ? ankleL : ankleR)?.anchorWorld[0] ?? 0);
    const xlo = supXref - 0.05, xhi = supXref + 0.14;
    let xrate = 0.1;
    let wantedX: number;
    if (fresh) {
      wantedX = Math.max(xlo, Math.min(xhi, this.comTarget.x));
    } else {
      wantedX = Math.max(xlo, Math.min(xhi, 0));
      xrate = 0.05;
    }
    const dgx = wantedX - this.govX;
    const stepx = xrate * dtg;
    this.govX += Math.abs(dgx) <= stepx ? dgx : Math.sign(dgx) * stepx;

    const errX = this.govX - this.comBuf[0]!;
    const errZ = this.govZ - this.comBuf[2]!;
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
    // ★★ 侧向 = **差动加载**（伺服 v3，Winter 1996）：直令携带"期望 CoP"，
    //   执行方（leanReflex v3）按负载差 u=(Fr−Fl)/F 闭环驱动**同号髋力偶**。
    //   比位置环（髋角）强且最小相位——实测 v2 位置环 0.4 冲量指数增长（泵），
    //   差动加载同一冲量衰减稳定、且侧移权限足够（±20 N·m ↔ u≈0.5、CoP ±8cm）。
    if (Math.abs(qZ) > 0.02 && this.opt.leanSign !== 0 && desiredCop) {
      reflexDirectives.push({
        id: 'lean',
        weight: 1,
        params: { copZ: desiredCop.z, sign: this.opt.leanSign },
      });
      if (Math.abs(qZ) > 0.2) { level = 1; reason = '侧向需求超脚不动可恢复幅度'; }
    }
    // 矢状（前后）：髋力矩帮助 + **脊柱前后位置式**（腰部主动修正，2026-10 增强；
    // 前弯 = spine/2 负，由 BOW 关键帧实测）。动作播放期间其脚本关节已 pin，不会抢。
    // ★ P1：单支撑时把死区略微收窄（0.04），bend 只做小幅修剪 + 支撑侧髋，
    //   由 pad/CoP 回路兜底（bend 本身无 CoP 反馈，开大/开早都会一路倾——隔离实测）。
    const qX = errX - VEL_GAIN * this.velBuf[0]! / omega0;
    const deadBend = 0.06;
    if (Math.abs(qX) > deadBend && this.opt.bendSign !== 0) {
      const spineSag = Math.max(-0.08, Math.min(0.08, -qX * 1.0));
      reflexDirectives.push({
        id: 'bend',
        weight: 1,
        params: {
          x: this.govX,
          kp: this.opt.bendKp,
          kd: this.opt.bendKd,
          sign: this.opt.bendSign,
          cap: single ? 0 : 60,
          spine: single ? 0 : spineSag,
          dead: deadBend,
          // ★ P1：单支撑时髋力矩只加**支撑侧**（摆动腿髋自由，双侧同号只会甩摆腿+吃反作用）
          // 0 = 双侧 / 1 = 左 / 2 = 右
          bendSide: 0,
        },
      });
    }

    // ★★ P1 支撑有效性预测：XCoM 到支撑区边界余量 + 单支撑负载成立性。
    //    margin<0 = XCoM 已越出"垫脚可放 CoP"的区域 → 不迈步救不回（level 1，如实报告）。
    const xcom = this.comBuf[0]! + this.velBuf[0]! / omega0;
    const zcom = this.comBuf[2]! + this.velBuf[2]! / omega0;
    const marginX = Math.min(xcom - xlo, xhi - xcom);
    const marginZ = Math.min(zcom - lo, hi - zcom);
    const loadOk = !single || (mode === 'l' ? fl : fr) >= 0.8 * Wg;
    if (marginX < -0.01 || marginZ < -0.01) {
      level = 1;
      reason = marginX < -0.01 ? '支撑越界（矢状，不迈步救不回）' : '支撑越界（侧向，不迈步救不回）';
    }
    return {
      comAdjust: { ax, az }, desiredCop, reflexDirectives, level, reason,
      support: { mode, phase, marginX, marginZ, loadOk, supX: this.supX, supZ: this.supZ },
    };
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
