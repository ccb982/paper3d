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
import { FuturePipe } from './servo/futurePipe';
import { NowPipe } from './servo/nowPipe';
import { qRotateVec, type Quat } from './quat';

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
    /** 相位：双支撑 / 预转移 / 落地前预转移 / 单支撑保持 / 回正 */
    phase: 'double' | 'preshift' | 'preland' | 'hold' | 'recenter';
    /** XCoM 到支撑区边界余量（m；正 = 区内，负 = 已越界） */
    marginX: number;
    marginZ: number;
    /** 单支撑时体重是否真在支撑脚（≥0.8W；"正确发力把身体撑起来"的判据） */
    loadOk: boolean;
    /** 支撑锚点（调试回读；单支撑时的支撑脚踝世界坐标） */
    supX: number;
    supZ: number;
    /** ★ 给动作层的只读建议（P1）：ok / 建议回中 / 不迈步救不回 */
    suggest: 'ok' | 'recenter' | 'step';
  };
  /**
   * ★ 摔倒预测回读（2026-10，用户定调：提案与预测都要能回读迭代）：
   *   XCoM（含动量）与到支撑区边界的预计到达时间（TTB），及派生风险等级。
   *   risk: 0 常规 / 1 TTB<0.35s / 2 已越界。ttb=Infinity = 该轴无危险方向速度。
   */
  est: {
    xcomX: number;
    xcomZ: number;
    ttbX: number;
    ttbZ: number;
    risk: 0 | 1 | 2;
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
   * ★ 默认站姿的矢状目标（m，相对脚踝锚点）：**脚弓 +0.045**。
   * 实测（`_probe-sag`）：comX≈0（贴踵侧）时后向 CoP 余量只剩 ~4cm，后推 >0.1 m/s
   * 必倒；**前移 +0.025 是安静工作点与矢状余量的甜蜜点**（HF 站立 2e-5、挺腰 60；
   * +0.03 起挺腰 HF 爆到 345、+0.035 站立炸——脚弓工作点会抬起柔性足链微极限环）。
   * +0.045 的站姿后推门限可达 0.2 m/s 但站立不稳，故取 0.025。仅用于**伺服回中/
   * 无发话**的默认目标；主动方显式目标不受影响。
   */
  standX: number;
  /**
   * 前后弯腰（髋屈伸）符号。★ 修正（2026-10，P1 隔离实测）：**−1 才是正确方向**
   * （`_probe-bend` 的旧标定被垫脚脚尖权限污染：pad 一开，±1 看着都能动）。
   * 隔离（pad 关）实测：+1 → CoM 反向跑到 −1.09（倒）；−1 → 朝目标方向。
   */
  bendSign: number;
  /**
   * ★★ 腰椎二轴参数（用户定调 2026-10：腰椎 = S 矢状 / L 侧向两轴；
   *    每轴 = 承重主项（经验证通道）+ **自身姿态微调**（读自己的倾角/角速度=动量））。
   *   · 轴S 主项：spineGainFwd/Back（qX 幅度预算）、spineFwd/BackCap、bendHipCap、
   *     bendDeadNormal/Danger、bendRiskMargin；微调：sagAttKp/sagAttKd、sagDead
   *   · 轴L 主项：postureGainHip/Spine（承重脚相对误差 del）；微调：latAttKp/latAttKd
   */
  sagAttKp: number;
  sagAttKd: number;
  sagDead: number;
  latAttKp: number;
  /** ★ 侧向速度增益（文献：速度项主导） */
  latVelGain: number;
  latAttKd: number;
  spineGainFwd: number;
  spineGainBack: number;
  spineFwdCap: number;
  spineBackCap: number;
  bendHipCap: number;
  bendDeadNormal: number;
  bendDeadDanger: number;
  bendRiskMargin: number;
  postureGainHip: number;
  postureGainSpine: number;
  /** ★ 单支撑目标守护的侧向钳制半宽（m；训练调） */
  singleClampZ: number;
  /** ★ 自然站姿：手臂**内收**偏置（rad；轴0 正=外展 ⇒ 用负值把手臂往身体收拢） */
  armInward: number;
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
  sagAttKp: 0.5,
  sagAttKd: 0.1,
  sagDead: 0.03,
  latAttKp: 0.5,
  /** ★ 侧向速度增益（文献：速度项主导；rad / (m/s)） */
  latVelGain: 0.5,
  latAttKd: 0.1,
  spineGainFwd: 1.0,
  spineGainBack: 1.0,
  spineFwdCap: 0.08,
  spineBackCap: 0.10,
  bendHipCap: 60,
  bendDeadNormal: 0.06,
  bendDeadDanger: 0.035,
  bendRiskMargin: 0.035,
  postureGainHip: 1.0,
  postureGainSpine: 0.5,
  singleClampZ: 0.06,
  armInward: 0.08,
  standX: 0.025,
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
  /** preland 期间 x 的临时目标（双脚中点 x） */
  private govXTmp = 0;
  /** 最近一步的遥测（探针/UI 回读） */
  readonly telemetry = { comX: 0, comZ: 0, Fx: 0, Fz: 0, gravitySum: 0, clampFrac: 0 };
  /** ★ Future 管道（§2.13：预测与预期——独立于 Now 管道，只读纯计算） */
  private readonly future = new FuturePipe();
  /** ★ 回读：最近一次 posture 指令的 hip 目标（侧向净效果审计） */
  lastPostureHip = 0;
  /** ★ 动作相位入口（§2.23：单支撑语义必须相位驱动——几何阈值与转移期不可分） */
  actionPhase: string | null = null;
  setActionPhase(p: string | null): void { this.actionPhase = p; }
  /** ★ 单支撑记忆时刻（防 single 标志瞬时闪断导致地板丢失——审计实测 4.4s 摆到 −0.30 内收） */
  private lastSingleT = -9;
  /** ★ 最近一次 Future 管道输出（公开回读：sagittalStab 等消费预警） */
  lastFut: { xcomX: number; xcomZ: number; marginX: number; marginZ: number; ttbX: number; ttbZ: number; risk: 0 | 1 | 2; sagTrigger: boolean } | null = null;
  private prevVelX = 0;
  /** ★ 矢状躯干参考（动作层设置：抬腿前主动弯腰）——≠0 期间伺服 fold/姿态**暂停写脊柱前后**（动作赢）；
   *  符号：spine 轴2 **正=向后弯**（sensX 实测；旧文档"正=前弯"注为错），前弯用负值。 */
  private trunkRef = 0;
  setTrunkRef(rad: number): void { this.trunkRef = rad; }
  /** ★ Now 管道（§2.13：当前修正核心——与 Future 互不读中间量） */
  private readonly now = new NowPipe();
  /** ★ 只读：某轴的实际下发力矩（ledger.applied）——动作层做反作用补偿用 */
  appliedOf(joint: string, axis: number): number {
    const i = this.world.body.dofByName(joint, axis);
    return i >= 0 ? (this.world.executor.ledger[i]?.applied ?? 0) : 0;
  }
  /** ★ 最近一拍的支撑有效性（只读；动作层可读它判断"落点真能撑住"与否） */
  readonly supportState = {
    mode: 'both' as 'both' | 'l' | 'r' | 'none',
    phase: 'double' as 'double' | 'preshift' | 'preland' | 'hold' | 'recenter',
    marginX: 0, marginZ: 0,
    loadOk: true,
    suggest: 'ok' as 'ok' | 'recenter' | 'step',
  };
  /** 踝关节自由度（踝策略用）：每只脚的屈伸 + 内外翻 */
  private readonly ankles: { side: 'l' | 'r'; flex: number; inv: number }[] = [];
  private readonly ankleIdx: { l: number; r: number } = { l: -1, r: -1 };
  /** ★ P1 落地预测：摆腿脚体索引 + 上一步高度（算 vy） */
  private readonly footBodyIdx = { l: -1, r: -1 };
  private readonly prevFootY = { l: NaN, r: NaN };
  /** ★ 髋力矩用**滤波质心速度**（与旧执行方 sensors 100ms 一致，避免动态期噪声力矩） */
  private readonly velF = new Float64Array(3);
  /** ★ 腰椎二轴控制器：躯干段索引 + up 向量缓存（自身状态读取） */
  private readonly torsoIdx: number;
  private readonly trUpQuat: Quat = { x: 0, y: 0, z: 0, w: 1 };
  private readonly trUp = new Float64Array(3);
  constructor(private readonly world: World, opt: Partial<BalanceOptions> = {}) {
    this.opt = { ...DEFAULT_BALANCE_OPTIONS, ...opt };
    this.drive = world.drive;
    this.manual = new ManualControl(world.body, world.drive);
    this.manual.defaultStiffnessFrac = this.opt.postureTone;
    // ★ 默认站姿直接给脚弓目标（standX）——避免"从 0 回中"的一次性过渡
    //   （过渡会让静站 HF 测量窗失真；`_probe-sag` 证明脚弓站姿后推余量翻倍）
    this.comTarget.x = this.opt.standX;
    this.torsoIdx = world.body.indexByKey.get('spine4')
      ?? world.body.indexByKey.get('spine3') ?? 0;
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
      this.footBodyIdx[side] = world.body.indexByKey.get(`foot_${side}`) ?? -1;
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
    // ★ 腰椎二轴控制器输入 = **自身状态**（躯干倾角 + 角速度 = 自身动量）；
    //   推的方向/大小不进入这里（用户定调）。
    const trb = body.bodies[this.torsoIdx]!;
    const trq = trb.rotation();
    this.trUpQuat.x = trq.x; this.trUpQuat.y = trq.y; this.trUpQuat.z = trq.z; this.trUpQuat.w = trq.w;
    qRotateVec(this.trUpQuat, 0, 1, 0, this.trUp);
    const pitch = Math.atan2(this.trUp[0]!, this.trUp[1]!);
    const roll = Math.atan2(this.trUp[2]!, this.trUp[1]!);
    const tw = trb.angvel();
    const pitchRate = tw.z;   // 绕侧向轴的角速度（俯仰率）
    const rollRate = tw.x;    // 绕前后轴的角速度（滚转率）
    // 质心速度低通（~100ms；与旧执行方的 sensors.comVel 一致）
    const kf = 1 - Math.exp(-this.world.dt / 0.1);
    for (let i = 0; i < 3; i++) this.velF[i] = this.velF[i]! + (this.velBuf[i]! - this.velF[i]!) * kf;
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
    // ★ P1 修正：仅**卸载**（脚还踩在地上）不等于单支撑——摆动脚必须真的离地
    //   （脚体间隙 > 2cm）才能进入单支撑语义（否则 CoP 可用双足底面，钳制/门控都不该收紧）。
    const yL = this.footBodyIdx.l >= 0 ? body.bodies[this.footBodyIdx.l]!.translation().y : 0;
    const yR = this.footBodyIdx.r >= 0 ? body.bodies[this.footBodyIdx.r]!.translation().y : 0;
    const groundY = Math.min(yL, yR);
    const gapL = yL - groundY, gapR = yR - groundY;

    // ★★ P1 支撑控制①：支撑模式（**滞回**：入单支撑 imb>0.7、退 <0.5；总重不足=腾空；
    //    支撑脚失载且另一脚接管 = 换脚）与支撑锚点。滞回防边界翻抖（夹位在 ±6cm/±0.17 切换）。
    let mode: 'both' | 'l' | 'r' | 'none';
    if (fTotG < 0.3 * Wg) mode = 'none';
    else if (this.supMode === 'both' || this.supMode === 'none') {
      const unloadedSide: 'l' | 'r' = fl > fr ? 'r' : 'l';
      const unloadedUp = (unloadedSide === 'l' ? gapL : gapR) > 0.02;
      mode = imb > 0.7 && unloadedUp ? (fl > fr ? 'l' : 'r') : 'both';
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
    // ★ 单支撑语义（§2.23 相位驱动）——**已实现但暂缓启用**：相位驱动验证成功（B–E 走单支撑分支），
    //   但 0.244 是围绕"语义死"调出的刀刃平衡，通电后旧侧向调参全部失配（0.174/0.138/0.651 全试）。
    //   启用顺序：先按 §2.27 系统性重调侧向（地板/翻号/速度项/增益），再开语义。
    const single = mode === 'l' || mode === 'r';
    const ankleL = this.ankleIdx.l >= 0 ? body.dofs[this.ankles[this.ankleIdx.l]!.flex]! : null;
    const ankleR = this.ankleIdx.r >= 0 ? body.dofs[this.ankles[this.ankleIdx.r]!.flex]! : null;
    if (single) {
      const a = mode === 'l' ? ankleL : ankleR;
      if (a) { this.supZ = a.anchorWorld[2]!; this.supX = a.anchorWorld[0]!; }
    }

    const fresh = this.timeAcc - this.lastSetT < 0.6;
    // ★★ P1 支撑控制③：**落地预测**（单支撑中摆腿下落 → 预测触地时间）。
    //    TTC 用"摆脚相对支撑脚的间隙 / 下降速度"；轻触（fz>5N）也算落地在望。
    let preland = false;
    if (single) {
      const swingSide = mode === 'l' ? 'r' : 'l';
      const si = this.footBodyIdx[swingSide];
      const supSide: 'l' | 'r' = mode === 'l' ? 'l' : 'r';
      const pi = this.footBodyIdx[supSide];
      const swingFz = swingSide === 'l' ? fl : fr;
      const gap = swingSide === 'l' ? gapL : gapR;
      if (si >= 0 && pi >= 0) {
        const y = body.bodies[si]!.translation().y;
        const prev = this.prevFootY[swingSide];
        const vy = Number.isNaN(prev) ? 0 : (y - prev) / dtg;
        this.prevFootY[swingSide] = y;
        const tt = gap > 0.005 && vy < -0.03 ? gap / -vy : Infinity;
        // 轻触只在**摆动脚确实离地**（gap>1cm）时算落地在望；卸载的站地脚不算（P1 修正）
        const lightTouch = swingFz > 5 && gap > 0.01;
        preland = lightTouch || (vy < -0.03 && tt < 0.35);
      } else if (swingFz > 5 && gap > 0.01) {
        preland = true;
      }
    }
    // ★★ P1 支撑控制②：相位（双支撑 / 预转移 / 落地前 / 单支撑保持 / 回正）
    let phase: 'double' | 'preshift' | 'preland' | 'hold' | 'recenter';
    if (single) phase = preland ? 'preland' : 'hold';
    else if (imb > 0.35) phase = 'preshift';
    else if (!fresh || this.timeAcc - this.doubleT < 0.8) phase = 'recenter';
    else phase = 'double';

    // ── 侧向目标守护（z）──
    let lo = -0.17, hi = 0.17, rate = 0.1;
    let wanted: number;
    if (single && preland) {
      // ★ P1 落地前预转移（**温和版**，替代被否的"猛拽承重脚"）：落点在望时，
      //   目标以低速（0.05 m/s）滑向**双脚中点**——中点随摆脚下降连续变化、无跳变，
      //   让触地瞬间 CoM 已在新（双支撑）多边形内侧，随后自然进入回中。
      const midZ = ankleL && ankleR ? (ankleL.anchorWorld[2]! + ankleR.anchorWorld[2]!) / 2 : this.govZ;
      const midX = ankleL && ankleR ? (ankleL.anchorWorld[0]! + ankleR.anchorWorld[0]!) / 2 : this.govX;
      wanted = midZ;
      this.govXTmp = midX + 0.05;   // x 温和滑向中点并**前移 5cm**（给放腿冲量留边距）
      rate = 0.05;
    } else if (single) {
      // 单支撑：主动方还在发话 → 钳在支撑脚 ±6cm（别太过）；
      // 主动方没发话（抬腿是主动的，之后收拾是伺服的）→ 伺服自己把重心管到支撑脚上。
      lo = this.supZ - this.opt.singleClampZ; hi = this.supZ + this.opt.singleClampZ;
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
    if (single && preland) {
      wantedX = this.govXTmp;
      xrate = 0.05;
    } else if (fresh) {
      wantedX = Math.max(xlo, Math.min(xhi, this.comTarget.x));
    } else {
      wantedX = Math.max(xlo, Math.min(xhi, this.opt.standX));   // ★ 默认回脚弓（不再回 0=踵侧）
      xrate = 0.05;
    }
    const dgx = wantedX - this.govX;
    const stepx = xrate * dtg;
    this.govX += Math.abs(dgx) <= stepx ? dgx : Math.sign(dgx) * stepx;
    // XCoM 与边界余量（bend 风险门控 + 末尾 est 回读共用）——★ Future 管道（§2.13）
    const accX = (this.velBuf[0]! - this.prevVelX) / Math.max(dtg, 1e-6);
    this.prevVelX = this.velBuf[0]!;
    const fut = this.future.compute({
      comX: this.comBuf[0]!, comZ: this.comBuf[2]!,
      velX: this.velBuf[0]!, velZ: this.velBuf[2]!,
      accX,
      hCoM: this.comBuf[1]!, gAbs, xlo, xhi, lo, hi,
    });
    this.lastFut = fut;
    const xcom = fut.xcomX, zcom = fut.xcomZ;
    const marginX = fut.marginX, marginZ = fut.marginZ;

    // ★ Now 管道（§2.13）：当前修正核心（comAdjust + 摩擦预算饱和 + CoP 投影）
    const errX = this.govX - this.comBuf[0]!;
    const errZ = this.govZ - this.comBuf[2]!;
    const now = this.now.compute({
      govX: this.govX, govZ: this.govZ,
      comX: this.comBuf[0]!, comZ: this.comBuf[2]!, comY: this.comBuf[1]!,
      velX: this.velBuf[0]!, velZ: this.velBuf[2]!,
      gAbs, comKp: this.opt.comKp, comKd: this.opt.comKd,
      maxForceFrac: this.opt.maxForceFrac,
      ankleZ: this.ankles.map((a) => body.dofs[a.flex]!.anchorWorld[2]!),
      ankleX: this.ankles.map((a) => body.dofs[a.flex]!.anchorWorld[0]!),
      ankleY: this.ankles.length > 0 ? body.dofs[this.ankles[0]!.flex]!.anchorWorld[1]! : 0,
    });
    const ax = now.ax, az = now.az;
    const desiredCop = now.desiredCop;
    let level: 0 | 1 | 2 = 0;
    let reason = '常规：垫脚';
    if (now.saturated) { level = 1; reason = '需求超过摩擦预算（饱和）'; }
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
    // ══════════════════════════════════════════════════════════════════
    // ★★ 腰椎 · 二轴（用户定调 2026-10）：S=矢状 / L=侧向。
    //    每轴 = **承重主项（经验证的伺服通道）** + **自身姿态微调（读自己的倾角/角速度=动量）**。
    //    关节层不需要懂"两轴"——执行方把轴输出翻译成逐关节力矩/角度目标（applyTrunk/applyPosture）。
    // ══════════════════════════════════════════════════════════════════
    // ── 轴L（侧向）：主项 = 承重脚相对误差 del（把 CoM 拉向承重脚，转移/单支撑必需）；
    //    微调 = −(latAttKp·roll + latAttKd·rollRate)（自身滚转/动量，把躯干转回竖直）
    if (this.opt.bendSign !== 0 && imb > 0.7) {
      const supA = fl > fr ? ankleL : ankleR;
      if (supA) {
        const del = Math.max(-0.2, Math.min(0.2, supA.anchorWorld[2]! - this.comBuf[2]!));
        // ★ 姿态微调**常开**（用户定调：竖直情况要时刻调整）——动作负责粗姿势，伺服
        //   连续把躯干纠回竖直；主项仍由 qX/del 驱动。
        // ★ 实测：速率项符号翻为阻尼（−kd）——原 +kd 在翻转后的目标叠加里是正反馈（反阻尼），
        //   3.7s 振荡（目标 +0.156、伺服 200 打满）的源。
        const attL = this.opt.latAttKp * roll - this.opt.latAttKd * rollRate;
        reflexDirectives.push({
          id: 'posture',
          weight: 1,
          params: {
            // ★ 2026-10 实测修正：attL 原为 **减号** → 单腿漂移时目标被推向 +0.21（与漂移同向，
            //   正反馈 → 伺服 169 N·m 内推 → 支撑卸载倒下）。翻为 **加号**（姿态微调与承重主项同向叠加）。
            // ★ 骨盆水平保持（§2.17 ①）：单支撑目标**内收有底**（−0.02，骨盆不许塌）；
            //   外展可调；与躯干侧倾权限（lateralStab cap 0.15）**协同**——单独各试均差
            //   （floor 单开 0.167、cap 单开 0.186），合开 0.225（历史最佳）=协调机制。
            // ★ 符号分期修正（2026-10 回读 CoM）：del = 支撑踝z − comZ。**单支撑期**原 +gain×del
            //   是正反馈（CoM 往里→目标内收→骨盆塌→CoM 更往里，实测漂离支撑 11cm）；翻为 −gain×del。
            //   **转移期（A）**原号是对的（翻了会把转移顶崩 0.2cm）——故分期。
            // ★ 水平地板（§2.17"骨盆水平保持"落实）：单支撑目标 **≥0**（只许外展不许内收）——
            //   实测目标跟 CoM 摆到 −0.169=骨盆塌=侧倒（"侧身还在塌陷"的直接写手）。
            // ★ 速度项（文献 Suissa 2018：侧向恢复=速度相关力矩主导、位置退居其次）：
            //   comVel[2] 正=向摆动侧漂 → 加速外展（+kD×v）。
            hip: (() => {
              if (single) this.lastSingleT = this.timeAcc;
              const supMem = single;   // （§2.23：四次提前判定尝试均级联——单支撑语义需动作相位驱动，非几何阈值）
              const v = supMem
                ? Math.max(0, Math.min(0.35,
                    -this.opt.postureGainHip * del + this.opt.latVelGain * this.velBuf[2]! + attL))
                : Math.max(-0.30, Math.min(0.35, this.opt.postureGainHip * del + attL));
              this.lastPostureHip = v;
              return v;
            })(),
            spine: Math.max(-0.12, Math.min(0.12, this.opt.postureGainSpine * del - attL * 0.5)),
          },
        });
      }
    }
    // ── 轴S（矢状）：主项 = qX 幅度预算（XCoM 误差；风险门控早介入）；
    //    微调 = −(sagAttKp·pitch + sagAttKd·pitchRate)（自身俯仰/动量，把躯干转回竖直）
    const qX = errX - VEL_GAIN * this.velBuf[0]! / omega0;
    // ★ 主动弯腰期间（trunkRef≠0）暂停伺服对脊柱前后通道的写入（用户定调：动作赢）
    if (this.opt.bendSign !== 0 && Math.abs(qX) > 0.001 && this.trunkRef === 0) {
      const dangerX = marginX < this.opt.bendRiskMargin || xcom > xhi - 0.02;
      const deadBend = dangerX ? this.opt.bendDeadDanger : this.opt.bendDeadNormal;
      // ★ 同上：姿态微调常开（竖直时刻调整）
      const attS = this.opt.sagAttKp * pitch + this.opt.sagAttKd * pitchRate;
      if (Math.abs(qX) > deadBend || Math.abs(attS) > this.opt.sagDead || this.trunkRef !== 0) {
        const gainS = qX > 0 ? this.opt.spineGainFwd : this.opt.spineGainBack;
        const capF = this.opt.spineFwdCap + Math.max(0, this.trunkRef);
        const capB = this.opt.spineBackCap + Math.max(0, -this.trunkRef);
        // ★ 叠加：动作参考（弯腰）+ 平衡修正（fold 不再是绝对目标）
        const fold = Math.max(-capB, Math.min(capF, this.trunkRef + qX * gainS - attS));
        // ★ 旧版公式恢复：tau = −(200·errX − 25·v_f) = −200·errX + 25·v_f（v_f = 滤波速度）
        // ★ 2026-10 实测修正：单支撑时髋扭矩限小（±15）——矢状纠正走髋**会压屈支撑柱**
        //   （Winter：髋在支撑里是伸展；晚期实测髋净 +68 屈把柱压塌）。单支撑优先保柱，
        //   矢状余额交给脊柱 fold（已有）。双腿站立维持原上限。
        const hipCap = single ? 15 : this.opt.bendHipCap;
        const tau = Math.max(-hipCap, Math.min(hipCap, -200 * errX + 25 * this.velF[0]!));
        reflexDirectives.push({
          id: 'trunk',
          weight: 1,
          params: { tau, fold, side: single ? (mode === 'l' ? 1 : 2) : 0 },
        });
      }
    }
    // （旧的 qX 幅度预算 bend 已被腰椎二轴自身状态控制器取代——见上方 trunk/posture）

    // ★★ P1 支撑有效性预测：XCoM 到支撑区边界余量（提前算：bend 的风险门控要用）
    const loadOk = !single || (mode === 'l' ? fl : fr) >= 0.7 * Wg;   // 【试 0.7】D 相支撑 66-69% 时别撤撑
    if (marginX < -0.01 || marginZ < -0.01) {
      level = 1;
      reason = marginX < -0.01 ? '支撑越界（矢状，不迈步救不回）' : '支撑越界（侧向，不迈步救不回）';
    }
    // ★★ P1 自动撑地（用户定调：支撑属伺服、属自动化撑地）：摆动腿**无人主动指挥**
    //    时，伺服自动把撑点建起来——落点在望 → 预撑（轻屈膝缓冲配置，触地即能承重）；
    //    支撑已越界 → 加深预撑（catch）。有主动指挥（pin/手动角/手力矩）则让位。
    //    执行：消力的 preBrace 常驻项（与负载退让同一执行路径，让位/写戳规则共用）。
    if (single) {
      const swingSide: 'l' | 'r' = mode === 'l' ? 'r' : 'l';
      const kdof = body.dofByName(`knee_${swingSide}`, 2);
      const free = kdof >= 0
        && !this.manual.isPinned(`knee_${swingSide}`, 2)
        && !this.manual.hasAngle(kdof)
        && this.manual.torqueOf(kdof) === 0;
      const outOfRegion = marginX < -0.01 || marginZ < -0.01;
      if (free && (outOfRegion || preland)) {
        reflexDirectives.push({
          id: 'support',
          weight: 1,
          params: { side: swingSide === 'l' ? 0 : 1, depth: outOfRegion ? 0.16 : 0.08 },
        });
      }
    }
    // ★★ P1 支撑腿撑住（负载反射，Nashner 1976 / Geyer & Herr 2010）：单支撑时支撑腿
    //    在负载下屈曲（膝角超过阈值）→ 给**伸展力矩**把身体"撑住"（防腿软）——
    //    用户定调：单腿撑地时支撑腿也要有伺服帮助；让位规则同其它反射（执行方跳过被
    //    主动指挥的轴）。膝伸展 = 正力矩（PUSH_RISE 关键帧实测）。
    if (single) {
      const supSide: 'l' | 'r' = mode === 'l' ? 'l' : 'r';
      const kdof2 = body.dofByName(`knee_${supSide}`, 2);
      if (kdof2 >= 0) {
        const flex = -body.dofs[kdof2]!.angle;          // 膝屈曲 = 负角 → 屈曲量为 −angle
        const over = Math.min(Math.max(flex - 0.10, 0), 0.5);
        // ★ Winter 支撑力矩框架（2026-10 架构化）：支撑腿不塌 = 踝跖屈+膝伸+髋伸之和。
        //   文献（2012 抗重力肌）：跖屈肌是**持续激活**（触发=所需踝力矩，非载荷）→
        //   常开 tonic 支撑力矩 + 屈服增量；比例按 Winter（踝主、膝次、髋辅），
        //   由 `applySupportBrace` 分到三关节。
        // （③ 试过 preland 预激活：0.139 更差——C 相轻触即触发，时机错；预激活触发条件待另设计）
        if (loadOk) {
          reflexDirectives.push({
            id: 'load',
            weight: 1,
            params: { side: supSide === 'l' ? 0 : 1, tau: Math.min(180, 50 + 800 * over) },   // 50=L0 tonic（posture.supportTonic）、800×over=L1 负载屈服
          });
        }
      }
    }
    const suggest: 'ok' | 'recenter' | 'step' =
      (marginX < -0.01 || marginZ < -0.01) ? 'step'
      : (phase === 'recenter' || phase === 'preland') ? 'recenter' : 'ok';
    // ★ 摔倒预测回读（Future 管道输出）：TTB / risk
    const ttbX = fut.ttbX, ttbZ = fut.ttbZ, risk = fut.risk;
    // ★ 常驻支撑状态（只读；动作层可读）
    this.supportState.mode = mode;
    this.supportState.phase = phase;
    this.supportState.marginX = marginX;
    this.supportState.marginZ = marginZ;
    this.supportState.loadOk = loadOk;
    this.supportState.suggest = suggest;
    return {
      comAdjust: { ax, az }, desiredCop, reflexDirectives, level, reason,
      support: { mode, phase, marginX, marginZ, loadOk, supX: this.supX, supZ: this.supZ, suggest },
      est: { xcomX: xcom, xcomZ: zcom, ttbX, ttbZ, risk },
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
    // ★ 自然站姿：肩轴0（外展轴）的姿势目标 = −armInward（下垂+内收），而非 0
    const shoulder0 = new Set<number>();
    for (const sd of ['l', 'r'] as const) {
      const si = body.dofByName(`shoulder_${sd}`, 0);
      if (si >= 0) shoulder0.add(si);
    }
    const ankleSet = new Set<number>();
    if (this.opt.ankleStrategy || this.opt.postureSkipAnkles) {
      for (const a of this.ankles) { ankleSet.add(a.flex); if (a.inv >= 0) ankleSet.add(a.inv); }
    }
    // ★ 支撑髋矢状（轴2）伸展保持律（2026-10，用户定调"削弱到伺服能化解"）：
    //   单支撑时姿势目标 = min(0, 当前角)——**伸展时保持不回拉**（原目标 0 反手 +48 屈=落地
    //   骤减速的力源→头/脊被动鞭梢），**屈曲时仍回 0**（保留承重：C 相 −25~−38 伸展就是它给的）。
    const supMode = this.supportState.mode === 'l' || this.supportState.mode === 'r' ? this.supportState.mode : null;
    for (const d of body.dofs) {
      if (d.engineMotor) continue;
      if (supMode && d.axis === 2 && d.name === `hip_${supMode}`) {
        const lim2 = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
        // （试过"目标 −0.08 微伸展 + kp×1.5"：实际仍 +0.16 顶不动——躯干 25° 弯的屈曲矩
        //   经重力补偿通道耦合，单改支撑髋 PD 无效；0.206→0.183 已回退。
        //   用户洞察成立：脊柱前弯+骨盆后留=折腰被拽倒——需在**弯腰的设计**里让骨盆同步前移。）
        this.drive.setAngle(d.dofIndex, Math.min(0, d.angle), this.opt.postureTone * 0.5 * d.tauMax / lim2);
        continue;
      }
      if (this.manual.hasAngle(d.dofIndex)) continue;
      if (skip?.has(d.dofIndex)) continue;      // 动作层/保护程序已接管
      if (ankleSet.has(d.dofIndex)) continue;   // 踝策略接管的轴，姿势张力让位
      const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
      const kp = this.opt.postureTone * 0.5 * d.tauMax / lim;
      const rest = shoulder0.has(d.dofIndex) ? -this.opt.armInward : 0;
      if (kp > 0) this.drive.setAngle(d.dofIndex, rest, kp);
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
