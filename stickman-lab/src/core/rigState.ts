/**
 * ══════════════════════════════════════════════════════════════════
 * ②  rigState.ts —— **唯一的关节状态**（承重标识 / 锁定 / 需求 / 仲裁）
 * ══════════════════════════════════════════════════════════════════
 *
 * 存在的理由：重构前每个模块各自持一份数据副本（`BalanceHoldInput` 一份、
 * `StepSystemInput` 一份、旧的 `teacher.ts` 还有 45 个可变 `let`；这三个模块
 * 现已删除），于是"同一根轴被两个模块各写一次"这件事在**物理上无法避免**
 * —— 实测 `hip_l/0` 一格里 `balance` 与 `step` 同时在写。
 *
 * 本文件把三件事收敛成**一份**：
 *   1. **身份**：承重腿（达标授予的标识）、锁定腿（触地置位的闸门）
 *   2. **仲裁**：两系统**并发**提需求，按固定优先级合并成唯一的 target
 *   3. **快照**：不可变、每拍整体替换 ⇒ UI 与冒烟测试读的是同一份
 *
 * ── 两个关键区分（用户 2026-10-03 的核心要求）────────────────────
 *   **承重腿 ≠ 锁定腿**
 *     · 承重腿 = 标识，必须**检测达标**才授予
 *     · 锁定腿 = 闸门，**触地瞬间**无条件获得，禁止再抬
 *   两者是**独立字段**。用同一个 bool 表达它们 ⇒ 永远分不开。
 */

import { AXES_PER_JOINT, jointIndexByName, type Skeleton } from './skeleton';

// ─────────────────────────────────────────────────── 身份

export type Side = 'l' | 'r';
/** 四相状态机（交换协议见 gaitState.ts） */
/** 四相 + 蹬离（`PUSH`）—— 见重构方案 §13.5：蹬离是前进的唯一来源 */
export type Phase = 'DOUBLE' | 'SHIFT' | 'SINGLE' | 'PUSH' | 'STEP';

/** 两套系统的标识 */
export type SystemId = 'balance' | 'step';

/** 三类系统标签（UI 上色用） */
export type SystemTag = 'hold' | 'step' | 'servo' | 'none';

/** 力矩通道的一条需求（单位 N·m，不是归一化比例） */
export interface TorqueRequest {
  value: number;
  system: SystemId;
  label: string;
}

// ─────────────────────────────────────────────────── 判据（逐条可回读）

export interface Criteria {
  /** 逐条真假，UI 直接显示 ⇒ "为什么没迈步"不用推断 */
  flags: Record<string, boolean>;
  /** 逐条数值 */
  values: Record<string, number>;
  all: boolean;
}

// ─────────────────────────────────────────────────── 需求与仲裁

export interface AxisRequest {
  value: number;
  system: SystemId;
  /** 短标签（机制名），供 UI 显示 */
  label: string;
}

export interface AxisTarget {
  value: number;
  owner: SystemId | 'bind' | 'none';
  ownerLabel: string;
  tag: SystemTag;
  /** 被压制的需求（可见！不允许静默取优先级） */
  suppressed: { system: SystemId; label: string }[];
  /** 被锁定闸门否决的 */
  vetoed: { system: SystemId; label: string }[];
  clamped: boolean;
}

/** 固定优先级（§6.2）。索引小 = 优先。 */
const PRIORITY: Record<SystemId, number> = { balance: 0, step: 1 };

/**
 * 承重判定的**载荷迟滞**（量级 = 载荷比例，不是"几乎相等"）。
 *   本 rig 双支撑时各约 0.5，所以 0.08 相当于"要领先 8 个百分点才算换腿"。
 *   ⚠ 调成 1e-3 级别 = 没有迟滞 ⇒ 接触噪声直接变成每拍翻转
 *     （见 `loadDominant()` 的病历）。
 */
export const LOAD_HYSTERESIS = 0.08;

export interface RigStateConfig {
  /** 目标角变化率上限（单位：目标比例/秒）。防止抖。 */
  slewLimit: number;
  /** 腰的"受限修正槽"最大幅度（rad）—— 文献：骨盆横断面旋转 6° */
  waistSlotMax: number;
  /**
   * ★ 迈步系统在腰上允许的**捕获点余量**预算（m）。
   *   依据：好的单腿保持 MoS 侧向 −0.025 m（arXiv:2608.00500），取 10%。
   *   **注意：没有任何文献规定次级系统的权限上限，这个数是我们自己推的。**
   */
  mosBudgetZ: number;
}

export const DEFAULT_RIGSTATE_CONFIG: RigStateConfig = {
  slewLimit: 8.0,
  waistSlotMax: 6 * Math.PI / 180,
  mosBudgetZ: 0.0025,
};

// ─────────────────────────────────────────────────── 快照（唯一可读出口）

export interface AxisSnapshot {
  key: string;
  joint: number;
  axis: number;
  pos: number;
  vel: number;
  target: number;
  owner: AxisTarget['owner'];
  ownerLabel: string;
  tag: SystemTag;
  suppressed: AxisTarget['suppressed'];
  vetoed: AxisTarget['vetoed'];
  clamped: boolean;
  limitHit: boolean;
}

export interface SideSnapshot {
  side: Side;
  grounded: boolean;
  loadFrac: number;
  /** 离地高度（m，脚底相对地面） */
  soleY: number;
  /**
   * ★ 脚底的**世界 z**（m）。存在的理由：轴约定里左右在 z 上（`+Z = 左`），
   *   而这个约定很容易看反 —— 所以把实测 z 放进快照，让 UI 图例**用数据自证**
   *   （左腿应恒为正 z、右腿恒为负 z），而不是只印一行说明文字。
   */
  footZ: number;
  /** 脚底世界 x（m） */
  footX: number;
  /** 是否为前腿（实测脚 x，不是硬编码左右） */
  isFront: boolean;
  isBack: boolean;
  isBearer: boolean;
  locked: boolean;
  /** 压力中心相对该脚踝点的偏移（m，矢状 x / 额状 z） */
  cop: { x: number; z: number; load: number };
}

export interface RigSnapshot {
  /** 拍号（单调递增，用于判断快照新鲜度） */
  tick: number;
  t: number;
  phase: Phase;
  phaseT: number;
  loadBearer: Side | null;
  supportLeg: Side;
  swingLeg: Side;
  locked: { l: boolean; r: boolean };
  /** 迈步系统的腰修正权限预算 α(t) ∈ [0,1] */
  authority: number;
  com: { x: number; y: number; z: number; vx: number; vy: number; vz: number };
  dcm: { x: number; z: number };
  /**
   * ★ VIP 摆角 `q_vip`（rad，矢状）。
   *   Morasso2019 (PLOS ONE 14:e0213870) 的 DIP+VIP 模型里，
   *   这条「踝 → 全身 CoM」的虚拟摆的摆角**在物理上就等于 CoP 在支撑面上的位置**
   *   （CoP 必须落在重力垂线上）。它是踝刚度 `τ = K_a·q_vip` 的输入。
   */
  qVip: number;
  /** 踝 VIP 刚度律输出的力矩（N·m，矢状） */
  ankleTauVip: number;
  /** 踝 VIP 力矩是否已饱和（> `τmax`）⇒ flat-foot 约束触发 */
  ankleTauSat: boolean;
  support: { cx: number; cz: number; halfX: number; halfZ: number; contactN: number };
  mos: number;
  grf: { x: number; y: number };
  /**
   * ★ 上层**命令**的 GRF（`τ = JᵀF` 里那个 F），N。
   *   与 `grf`（实测）分开：`grf.x` 是从接触反推的，`grfCmd.x` 是控制器要的。
   *   单腿站立能不能"施加横向力"，直接看这个量 —— 之前 `grf.x` 恒为 0，
   *   所以"横向力"这件事在诊断里根本不可见。
   */
  grfCmd: { x: number; y: number; z: number };
  /** 当前前腿（按实测脚 x）—— 交接判据与 UI 用 */
  frontLegSide: Side;
  /** 当前后腿（要动的那条） */
  rearLegSide: Side;
  /** 骨盆抬升偏置（rad）。见 `RigState.pelvicLift` */
  pelvicLift: number;
  /**
   * ★★ **力链**（自下而上的关节传递力）。用户 2026-10-04：
   *   「力应该是自脚往上传的，盆骨只是运用了这股力」「应该从下往上查」。
   *
   *   每项 = 一个关节的**子侧子树**约束力 `F = m·(a_com − g)`（`Ragdoll.jointForce`）。
   *   关节的 `subtree` 是它**下方**的刚体，所以读数天然自下而上递增：
   *     踝 → 只有脚掌；膝 → 小腿+脚；髋 → 大腿+小腿+脚。
   *   轴：x=矢状(前) y=竖直 z=额状(左)。`ready=false` 表示速度环未填满，
   *   此时数值为 0 但**不可信**（UI 必须显示"未就绪"，不能显示 0）。
   */
  forceChain: {
    ready: boolean;
    joints: { name: string; fx: number; fy: number; fz: number; f: number; mass: number }[];
  };
  /**
   * ★★ **重心转移诊断** —— 用户 2026-10-04：「我需要看的是**如何把重心转移到单腿中**」。
   *   单腿力链看不到是因为转移做不到（因果反了）⇒ 这里画**转移过程本身**。
   */
  comTransfer: ComTransfer;
  /** 摆动脚净空（m） */
  swingClearance: number;
  /** 捕获点 ξ_x / ξ_z（Houska balance point） */
  captureX: number;
  captureZ: number;
  /** 倒立摆自然频率 ω₀（rad/s） */
  omega0Val: number;
  /** 腰额状精调输出（rad）。正 = 把重心推向 +Z */
  /** ★ 腰额状**控制目标**（弧度），由 `balance.ts` 的捕获点余量驱动写入 */
  waistTrim: number;
  /**
   * ★ 腰到支撑脚的**诊断量**（米）：`com.z − soleZ[support]`。
   *   此前它和 `waistTrim`（控制目标，弧度）**共用一个字段**，且写入顺序在
   *   控制目标之后 ⇒ 把控制目标覆盖成一个米制诊断量（用户 2026-10-04 期间实测：
   *   腰的目标 −0.051 m 被读成 −9.20°，捕获点余量驱动完全没生效）。
   *   ⇒ 两者彻底分开：`waistTrim` 只做控制，`waistGapM` 只做诊断/UI。
   */
  waistGapM: number;
  /** 额状主力（支撑髋外展）力矩命令（N·m）。正 = 把重心推向 +Z */
  hipLatTau: number;
  torsoY: number;
  tiltDeg: number;
  /**
   * ★★ 倾角**按平面分解**（度）。轴约定：x=矢状(前) y=竖直 z=额状(左)
   *   - `pitchDeg` 绕 z 轴 => 顶部倒向 ±x => **前倾 / 后倾**
   *   - `rollDeg`  绕 x 轴 => 顶部倒向 ±z => **左倾 / 右倾**
   *
   *   只看合成的 `tiltDeg`（平面无关的大小）**分不出是前倾还是侧倒**
   *   —— 我曾因此把「腰向前折」误判成侧倒，来回排查了很久
   *   （用户 2026-10-03：「之前还是侧向折，现在只是向前折」）。
   */
  pitchDeg: number;
  rollDeg: number;
  /** pitchDeg / rollDeg 的**角速度**（deg/s）。腰的姿态保持必须用 PD：
   *  纯 P 的指令会被 spine 的 ±15~25° 限幅打饱和 ⇒ 过冲 ⇒ 折向翻转
   *  （实测前折 +80°，加腰控制器后变成后折 −79°，就是过冲）。 */
  pitchRate: number;
  rollRate: number;
  legs: Record<Side, SideSnapshot>;
  axes: AxisSnapshot[];
  /** ★ 轴归属冲突（同一轴被位置与力矩两个通道、不同系统申领）。
   *  对应 `balance.AXIS_OWNERSHIP` 不变量；门禁要求默认路径下恒为 0。 */
  axisConflicts: { axis: number; joint: string; mode: string; by: string; against: string }[];
  criteria: {
    bearer: Criteria;
    /** 交接判据（重心在前腿 + 间隔 1s） */
    handover: Criteria;
    unlock: Criteria;
    stepPermit: Criteria;
  };
  /** 事件（每拍增量） */
  events: { touchdownL: boolean; touchdownR: boolean; lockReleasedL: boolean; lockReleasedR: boolean };
}

// ─────────────────────────────────────────────────── 主体

/**
 * ★★ **重心转移诊断** —— 用户 2026-10-04：「我需要看的是**如何把重心转移到单腿中**」。
 *
 *   单腿力链看不到，是因为重心转移做不到（因果反了）。所以这里**不画力，画转移过程本身**，
 *   并且刻意把「谁在出力」和「谁真的在动」并排放：
 *     · `cmdHipLatTau` / `cmdWaistTrim` / `cmdGrfLat` = 各执行器的命令
 *     · `rateLat` = **实测** d(com.z)/dt —— 若命令很大而它≈0，就直接证明
 *       "力发出去了但没作用到重心"，而不是让人猜。
 *     · `hist` = 横向误差的滚动历史，用来看**趋势**（收敛 / 卡住 / 发散）。
 */
export interface ComTransfer {
  /** 横向误差 com.z − stanceZ（m）。正 = 重心在支撑腿那一侧 */
  errLat: number;
  /** 矢状误差 com.x − stanceX（m）。正 = 重心在支撑脚前方 */
  errSag: number;
  /** 横向误差速率（m/s），实测有限差分 */
  rateLat: number;
  /** 横向误差滚动历史（m），最新在末尾 */
  hist: number[];
  cmdHipLatTau: number;
  cmdWaistTrim: number;
  /** 腰到支撑脚的诊断量（米）`com.z − soleZ[support]`，UI 用 */
  waistGapM: number;
  cmdGrfLat: number;
  cmdPelvicLift: number;
  /** 载荷分配与稳定裕度 —— 转移的真正"果" */
  loadFront: number;
  loadRear: number;
  mosMm: number;
  /** 交接判据逐条（UI 直接显示，"为什么没转移"不用推断） */
  handover: Criteria;
}

export class RigState {
  readonly sk: Skeleton;
  readonly cfg: RigStateConfig;

  // ── 身份（唯一真源）
  loadBearer: Side | null = null;
  /** 上一拍的前腿（并齐时保持用，避免与 loadBearer 循环依赖，见 frontLeg） */
  frontPrev: Side | null = null;
  readonly locked: { l: boolean; r: boolean } = { l: false, r: false };
  phase: Phase = 'DOUBLE';
  phaseT = 0;
  authority = 0;

  // ── 读数（每拍从物理回读一次，两系统共享）
  readonly pos: Float64Array;
  readonly vel: Float64Array;
  readonly loadFrac: Record<Side, number> = { l: 0, r: 0 };
  readonly grounded: Record<Side, boolean> = { l: false, r: false };
  /**
   * ★★ **"现在是真单支撑吗"** —— 控制与计分的**收敛判据**，由
   *   `Ragdoll.stanceIsSingleSupport()` 统一给出（接触数 + 净空门槛 + 滞回）。
   *
   * ⚠ 与 `grounded` 的区别：`grounded` 是**逐脚原始接地事实**（B1 与 UI 用），
   *   本字段是由它派生出的**单支撑判断**。不要拿它当"某只脚着地了吗"。
   *
   * ⚠ 为什么不直接用裸接触数 `nGround === 1`：计分侧注释实测
   *   「88% 的离地不到 3 cm ⇒ 多数是接触抖动」，裸接触数在抖动帧里会闪。
   */
  stanceSingle = false;
  com = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  dcm = { x: 0, z: 0 };
  support = { cx: 0, cz: 0, halfX: 0, halfZ: 0, halfZActive: 0, contactN: 0 };
  mos = 0;
  grf = { x: 0, y: 0 };
  torsoY = 0;
  tiltDeg = 0;
  pitchDeg = 0;
  rollDeg = 0;
  pitchRate = 0;
  rollRate = 0;
  soleX: Record<Side, number> = { l: 0, r: 0 };
  /**
   * 脚底中心的**横向**位置（m）。
   * ★ 两脚在 Z 向分开（z ≈ ±0.10）⇒ **左右载荷分配由 CoM.z 决定**，
   *   所以额状面平衡的目标量必须是这个，不是支撑域中心（两脚中点）。
   */
  soleZ: Record<Side, number> = { l: 0, r: 0 };
  // ── 倒立摆 / 力层量（Houska balance point 用）────────────────────
  /** CoM 横向加速度（m/s²，由 vz 有限差分）。`F_y = m(z_c·a_des − x_c·a)` 要用 */
  comAz = 0;
  /** 上一拍的 vz（算 comAz 用） */
  private vzPrev = 0;
  /** 摆动腿脚底 z（支撑腿的镜像；预判用） */
  /**
   * ★ 骨盆抬升偏置（rad）：支撑髋外展里**专门给摆动侧骨盆抬高**的那一份
   *   （Saunders 1953：摆动侧骨盆抬 2~5cm 是最小足净空的决定因素）。
   *   与额状面平衡**共用**支撑髋外展这一个执行器。
   */
  pelvicLift = 0;
  /** 摆动脚净空（m）。骨盆抬升外环的判据量（Saunders 1953 的最小足净空） */
  swingClearance = 0;
  /** 力链缓冲（N·m/分量，逐关节 5 个数）与就绪标志。由 `updateForceChain` 写 */
  readonly forceBuf = new Float64Array(0);
  forceReady = false;
  /** 腰额状精调输出（rad）。正 = 把重心推向 +Z（实测标定，见 systems/balance.ts） */
  waistTrim = 0;
  waistGapM = 0;
  /** ★ VIP 摆角 `q_vip = atan2(com.x − ankle.x, com.y − ankle.y)`（rad，矢状） */
  qVip = 0;
  /** ★ 踝 VIP 刚度律输出的力矩（N·m，矢状，**已钳到 τmax**），诊断/UI 用 */
  ankleTauVip = 0;
  /**
   * ★ 踝 VIP 力矩**是否已饱和**（请求值 > `τmax`）。
   *   对应文献的 **flat-foot 约束**：CoP 走到脚掌边缘后踝力矩自动饱和，
   *   策略随之让位给髋（Michaels & Ting 2025）。
   */
  ankleTauSat = false;
  /** 额状主力（支撑髋外展）力矩命令（N·m）。正 = 把重心推向 +Z */
  hipLatTau = 0;
  /** 捕获点（Houska）：ξ = com + v/ω₀。UI 回读用 */
  captureX = 0;
  captureZ = 0;
  /** 倒立摆自然频率 ω₀ = √(g/h)（由上层 wantedForce 写入，供 UI 回读） */
  omega0Val = 3.1;
  /** 上层命令的 GRF（`τ = JᵀF` 的那个 F），N。`grf` 是实测、`grfCmd` 是命令 */
  grfCmd = { x: 0, y: 0, z: 0 };
  /** 本拍 `τ = JᵀF` 分配到的各轴力矩（诊断/回读；N·m） */
  tauJ = new Float32Array(0);
  /** 脚底离地高度（m）。UI 显示用；必须与快照同源，所以存在状态里 */
  readonly soleY: Record<Side, number> = { l: 0, r: 0 };
  /** ★ 真·压力中心（由接触冲量加权，`Ragdoll.readCoP`）—— 足部"发力"的直接测量 */
  readonly cop: Record<Side, { x: number; z: number; load: number }> = {
    l: { x: 0, z: 0, load: 0 }, r: { x: 0, z: 0, load: 0 },
  };

  // ── 仲裁
  //  ⚠⚠ 用**固定长度 + fill(undefined)** 清空，**不要**用 `length = 0`：
  //     那会把数组真的清空，于是 `i >= this.req.length` 恒成立 ⇒
  //     `request()` 全部静默 return ⇒ 控制器退化成开环，而所有指标看起来"正常"，
  //     只有增益扫描会暴露（16 行逐位相同）。已踩过。
  private readonly req: (AxisRequest | undefined)[] = [];
  /** 本拍真正被登记的需求数（诊断用：0 ⇒ 控制器根本没在控制） */
  requestCount = 0;
  /** 越界请求累计（应当恒为 0；非 0 说明有调用方用了不存在的关节/轴） */
  badRequests = 0;
  /** 力矩请求（与 `req` 并立；单位 N·m） */
  private readonly treq: (TorqueRequest | undefined)[] = [];
  private torqueRequestCount = 0;
  /** 本拍仲裁出的力矩（N·m），可直接喂 `Ragdoll.setTorqueTargets` */
  tauOut = new Float32Array(0);
  private readonly nAxes: number;
  private readonly tgt: AxisTarget[] = [];
  private readonly prevTarget: Float32Array;

  // ── 事件
  touchdown: Record<Side, boolean> = { l: false, r: false };
  lockReleased: Record<Side, boolean> = { l: false, r: false };

  // ── 判据（由 gaitState 写入，逐条回读）
  bearerCriteria: Criteria = { flags: {}, values: {}, all: false };
  unlockCriteria: Criteria = { flags: {}, values: {}, all: false };
  /**
   * ★ 交接判据 H1..H4 + I（重心在前腿 / 驻留 / 前腿承重 / 稳定 / 间隔 1s）。
   *   用户的交接定义：「满足 1s 间隔并且重心真在前腿了，才能解锁后腿」。
   */
  handoverCriteria: Criteria = { flags: {}, values: {}, all: false };
  /** 当前的前腿 / 后腿（按实测脚 x）。字段名带 Side 以免与 `frontLeg()` 方法同名 */
  frontLegSide: Side = 'l';
  rearLegSide: Side = 'r';
  stepPermit: Criteria = { flags: {}, values: {}, all: false };

  private tickNo = 0;
  private tSec = 0;
  /** 上一拍的 target，供斜率限制 */
  private readonly prevOut: Float32Array;

  constructor(sk: Skeleton, cfg: RigStateConfig = DEFAULT_RIGSTATE_CONFIG) {
    this.sk = sk;
    this.cfg = cfg;
    const n = sk.joints.length * AXES_PER_JOINT;
    this.nAxes = n;
    this.pos = new Float64Array(n);
    this.vel = new Float64Array(n);
    this.prevTarget = new Float32Array(n);
    this.prevOut = new Float32Array(n);
    // ⚠ 这两个必须**按轴数初始化**。曾声明成 `=[]`（长度 0），
    //   于是 `this.hold[i]` 恒为 `undefined`（falsy）⇒ `requestHold` 的
    //   「已让位就不重复登记」永不命中、`hold[i]=true` 写不进去。
    this.hold.fill(false);
    for (let i = 0; i < n; i++) { this.hold[i] = false; this.axisMode[i] = 0; this.holdMask[i] = 0; }
    this.tauOut = new Float32Array(n);
    this.tauJ = new Float32Array(n);
    this.forceBuf = new Float64Array(sk.joints.length * 5);
    this.treq.fill(undefined);
    for (let i = 0; i < n; i++) {
      this.tgt.push({
        value: 0, owner: 'none', ownerLabel: '—', tag: 'none',
        suppressed: [], vetoed: [], clamped: false,
      });
    }
  }

  // ── 读写接口（两系统只能用这些）────────────────────────────

  bearer(): Side | null { return this.loadBearer; }

  /**
   * 承重腿；**没有标识时退化为"当前实际在承重的那条"**。
   *
   * ⚠ 双支撑时**必须取载荷大的那条**，不能写死 `'l'`：
   *   曾写死左脚，于是判据在评估一条只承担 29% 的腿，而右腿承担 71%
   *   ⇒ B2 永远不达标 ⇒ 承重标识永远授不出来 ⇒ 迈步许可 P1 永远为 false
   *   ⇒ 表现是"控制器完全不动"，但所有指标看起来都在正常回读。
   */
  /**
   * ★ **载荷优势腿**（带迟滞）—— 承重判定的**唯一实现**。
   *
   * 双支撑时两条腿都在承重，"承重腿"只是个约定，必须**迟滞**否则噪声会让它
   * 每拍翻转。实测代价（两条路径犯过同一个错）：
   *   · `supportLeg()` 早先用 1e-3 迟滞 ⇒ 接触噪声让载荷在 50.1/49.9 之间跳
   *     ⇒ 每拍翻转 ⇒ 相位抖动 ⇒ 额状面主通道反复开关 ⇒ **8s → 1.68s**；
   *   · `gaitState` 里给 `loadBearer` 的兜底干脆写成裸比较 `loadFrac.l > loadFrac.r`
   *     ⇒ **零迟滞** ⇒ UI 的"★承重"标签逐帧闪（用户 2026-10-04 亲见）。
   * ⇒ 迟滞取**载荷量级** 0.08（本 rig 双支撑各约 0.5），且必须是**同一个**函数。
   *
   * @param prev 上一拍的结论（用来做迟滞）；不传则用当前 `loadBearer`
   * @param hyst 载荷迟滞阈值。**必须由调用方（`gaitState`）传它自己的
   *   `cfg.bearerLoadHyst`**，否则会与 `X5` 用两套阈值打架（实测 6 次抽换腿）：
   *     · `gaitState.X5` 用 `bearerLoadHyst = 0.45`（前腿载荷 ≥45% 才算承重腿）
   *     · 本函数默认 `LOAD_HYSTERESIS = 0.08`（载荷差 8% 就换边）
   *   载荷掉到 0.44 时 `X5` 判"不算承重腿"、本函数判"还是同一只脚"
   *   ⇒ 两个判据给出相反结论 ⇒ 承重腿来回抽换，**永远进不了单腿站立**。
   *   默认值保留仅为兼容旧调用方，状态机路径必须显式传参。
   */
  loadDominant(prev?: Side | null, hyst: number = LOAD_HYSTERESIS): Side {
    const l = this.loadFrac.l;
    const r = this.loadFrac.r;
    const H = hyst;
    if (l > r + H) return 'l';
    if (r > l + H) return 'r';
    // 落在死区内 ⇒ 保持上一拍（这就是迟滞），再退化为已锁定的那条
    if (prev) return prev;
    if (this.locked.l) return 'l';
    if (this.locked.r) return 'r';
    return 'l';
  }

  supportLeg(): Side {
    if (this.loadBearer) return this.loadBearer;
    if (this.grounded.l && !this.grounded.r) return 'l';
    if (this.grounded.r && !this.grounded.l) return 'r';
    if (this.grounded.l && this.grounded.r) return this.loadDominant();
    return 'l';
  }

  /** 横向倒立摆的自然频率 `ω₀ = √(g/h)`（h = CoM 高出支撑面的高度） */
  omega0(): number {
    const h = Math.max(0.2, this.com.y - Math.max(0, this.soleY[this.supportLeg()] ?? 0) - 0.0);
    return Math.sqrt(9.81 / Math.max(0.3, h - 0.05));
  }
  /**
   * 更新 `comAz`（低通后的横向加速度，仅供诊断/上层参考）。
   * ⚠ 必须传**物理步长**。曾用控制拍 dt=1/60 差分，而拍内物理走了 2 步
   *   ⇒ 算出的加速度是真实值的 **2 倍**且带噪 ⇒ 上层输出 ±996 N 的荒谬横向力。
   */
  updateComAccel(dtPhys: number): void {
    if (dtPhys <= 1e-6) { this.vzPrev = this.com.vz; return; }
    const raw = (this.com.vz - this.vzPrev) / dtPhys;
    this.vzPrev = this.com.vz;
    // 一阶低通（τ≈50 ms）：捕获点律对加速度噪声很敏感，未滤波会自激
    this.comAz = this.comAz * 0.75 + raw * 0.25;
  }
  swingLeg(): Side { return this.supportLeg() === 'l' ? 'r' : 'l'; }

  /**
   * ★★ **前腿 / 后腿**（用户 2026-10-03 的交接定义）。
   *
   *   用户原话：「要显式的把重心移动到前腿，然后才允许动后腿，
   *   锁定前腿，前腿是支撑腿并且解锁后腿」。
   *
   *   ⚠ 必须按**实测脚 x** 判定，不能写死左右、也不能用载荷：
   *     · 左右在 **z** 轴上（+z=左），前后在 **x** 轴上（+x 朝前）——两轴不同
   *     · 前后腿在步态过程中会**互换**，写死就必错
   *   约定：**x 大的是前腿**。x 差小于 3mm 视为并齐 ⇒ 用承重腿兜底。
   */
  frontLeg(): Side {
    const dz = this.soleX.l - this.soleX.r;
    if (dz > 0.003) { this.frontPrev = 'l'; return 'l'; }
    if (dz < -0.003) { this.frontPrev = 'r'; return 'r'; }
    // ★ 并齐（|Δx| ≤ 3mm）时保持**上一拍的前腿**，不再回落到 `loadBearer`。
    //   原来这里回落 `loadBearer`，而 `gaitState` 里又有
    //   `bearer = X1 && X5 ? front : …` ⇒ 两者互为对方 ⇒ **自激振荡**：
    //   站立时两脚 x 差长期 <3mm ⇒ 20s 里承重/前腿各切 5 次（门禁阈值 ≤3，
    //   历史基线 1 次），且迟滞被 `X1 && X5` 分支整条旁路 ⇒ 门禁报
    //   「迟滞没生效或存在第二份判据」。实测确认：`loadDominant` 加驻留
    //   完全无效（5→5），因为它根本没被走到。
    //   现在前后腿**只由几何 x 决定**，承重腿**只由载荷决定**，互不依赖。
    return this.frontPrev ?? 'l';
  }
  /** 后腿（要动的那条） */
  rearLeg(): Side { return this.frontLeg() === 'l' ? 'r' : 'l'; }

  /**
   * ★ 重心的**矢状**位置误差：重心是否落在指定脚**前方**（m）。
   *   >0 = 重心在前脚前方（该脚接不住，重心会继续前移）
   *   ≤0 = 重心已在前脚**上方或后方** ⇒ 该脚可以承重（交接条件）
   *   归一化到腿长量级便于设阈值：`com.x − foot.x − halfLen`，`halfLen ≈ 0.06m`。
   */
  comOverFootX(side: Side): number {
    return this.com.x - this.soleX[side] - 0.06;
  }
  /** 重心的**额状**偏移（m）：|com.z − foot.z| 才是横向支撑裕度 */
  comOverFootZ(side: Side): number {
    return Math.abs(this.com.z - this.soleZ[side]);
  }
  isLocked(s: Side): boolean { return this.locked[s]; }

  jointPos(joint: number, axis: number): number { return this.pos[joint * 3 + axis] ?? 0; }
  /** 按真实索引取角（重构后的内部统一用这个；名字查询只用于外部配置） */
  angle(joint: number, axis = 2): number { return this.pos[joint * 3 + axis] ?? 0; }
  jointVel(joint: number, axis: number): number { return this.vel[joint * 3 + axis] ?? 0; }
  /** 按名字取当前角；关节不存在返回 NaN（**调用方必须处理，不许静默当 0**） */
  angleOf(name: string, axis = 2): number {
    const i = jointIndexByName(this.sk, name);
    if (i < 0) return NaN;
    return this.pos[i * 3 + axis] ?? 0;
  }

  /**
   * ★ 提需求。两个系统**并发**调用同一个 `rigState`，由 `arbitrate()` 合并。
   *   注意语义：这是"登记意图"，**不直接改 target**。
   */
  request(joint: number, axis: number, value: number, system: SystemId, label: string): void {
    const i = joint * 3 + axis;
    if (i < 0 || i >= this.nAxes) {
      // ★ 越界必须可见：说明调用方传了不存在的关节/轴（rig.ts 的断言本该拦住）
      this.badRequests++;
      return;
    }
    const cur = this.req[i];
    this.requestCount++;
    if (cur && PRIORITY[cur.system] <= PRIORITY[system]) {
      // 已有更高（或同）优先级的需求：新需求直接记为被压制
      this.tgt[i]!.suppressed.push({ system, label });
      return;
    }
    if (cur) this.tgt[i]!.suppressed.push({ system: cur.system, label: cur.label });
    this.req[i] = { value, system, label };
  }

  /**
   * ★★ 按**角度**提需求（内部换算成该轴量程的比例）。
   *
   *   为什么需要它：`request()` 收的是**目标角比例**（`-1..1`，映射到该轴量程），
   *   直接传 PD 的输出是**量纲错误** —— 会把"膝该往回顶一点"变成
   *   "命令膝弯 46°"，实测开局就深蹲塌下去。
   *   ⇒ 控制器里凡是"我要这个角"的语义，都必须走这个接口。
   */
  // ── 轴模式声明与冲突检测（重构不变量）─────────────────────────
  /**
   * ★★ 每个 (关节,轴) 在 `balance.AXIS_OWNERSHIP` 里**恰好一个模式**
   *   （`pos` 位置伺服 / `tau` 力矩通道）。本字段在运行时**检测**违反：
   *   同一根轴同时被位置和力矩两个通道以**不同系统**申领 ⇒ 记一次冲突。
   *
   *   为什么是"检测"而不是"直接拒收"：拒收会改变行为、可能引入新的塌陷；
   *   先把它变成**可断言的量**（`axisConflicts`），由 `tools/probe-axisown.ts`
   *   门禁要求默认路径下为 0。等它稳定为 0 之后就可以升级成硬拒收。
   *
   *   这条不变量对应本轮的三次实测故障（见 `systems/balance.ts` 顶部注释）：
   *   `hip/1` 三写者、`requestHold` 双副本、消融工具说谎。
   */
  private readonly axisMode: number[] = [];       // 0=无 1=pos 2=tau
  private readonly axisModeOwner: SystemId[] = [];
  /** 本拍观测到的轴归属冲突（UI/门禁回读） */
  axisConflicts: { axis: number; joint: string; mode: string; by: string; against: string }[] = [];

  private claimAxis(joint: number, axis: number, mode: number, system: SystemId): void {
    const i = joint * 3 + axis;
    if (i < 0 || i >= this.nAxes) return;
    if (this.axisMode[i] === 0) {
      this.axisMode[i] = mode;
      this.axisModeOwner[i] = system;
      return;
    }
    if (this.axisMode[i] === mode) return;          // 同模式：交给既有优先级仲裁
    // 模式冲突：记下来，但**不改变行为**（保持既有仲裁结果）
    this.axisConflicts.push({
      axis: i,
      joint: this.sk.joints[joint]?.name ?? `?${joint}`,
      mode: mode === 1 ? 'pos' : 'tau',
      by: system,
      against: this.axisModeOwner[i] ?? 'none',
    });
  }

  requestAngle(joint: number, axis: number, rad: number, system: SystemId, label: string): void {
    this.claimAxis(joint, axis, 1, system);
    const def = this.sk.joints[joint];
    if (!def) { this.badRequests++; return; }
    const span = Math.max(Math.abs(def.minRad[axis]), Math.abs(def.maxRad[axis]));
    if (span <= 1e-6) { this.badRequests++; return; }
    // 与 ragdoll.posRefScale（0.9）保持一致：目标不占满量程
    this.request(joint, axis, (rad * 0.9) / span, system, label);
  }

  // ── 力矩请求通道（`τ = JᵀF` 的产物，N·m）────────────────────────
  /**
   * ★ 与角度通道**并联**的第二条通道。单位是 N·m，不是归一化比例。
   *   为什么必须分开：角度通道会被 `Ragdoll` 的位置环换算成
   *   `τ = kP·(θ_ref−θ)·τmax/ωmax`（反馈量），而 `τ = JᵀF` 是**定量前馈** ——
   *   单腿站立需要 ~52 N·m 的静态髋力矩**在位**，不能等误差长出来。
   *   两者在 `driveMotors` 里相加后再按 τmax 饱和。
   *   仲裁规则与角度通道一致（balance 优先于 step），锁腿仍然否决。
   */
  requestTorque(joint: number, axis: number, tau: number, system: SystemId, label: string): void {
    this.claimAxis(joint, axis, 2, system);
    const i = joint * 3 + axis;
    if (i < 0 || i >= this.nAxes) { this.badRequests++; return; }
    const cur = this.treq[i];
    this.torqueRequestCount++;
    if (cur && PRIORITY[cur.system] <= PRIORITY[system]) {
      this.tgt[i]!.suppressed.push({ system, label: `${label}(力矩)` });
      return;
    }
    if (cur) this.tgt[i]!.suppressed.push({ system: cur.system, label: `${cur.label}(力矩)` });
    this.treq[i] = { value: tau, system, label };
  }
  /** 锁定闸门的力矩版本：被锁定腿上的抬腿力矩直接丢弃 */
  requestSwingLegTorque(side: Side, joint: number, axis: number, tau: number, label: string, isLift: boolean): void {
    if (isLift && this.locked[side]) {
      const i = joint * 3 + axis;
      if (i >= 0 && i < this.nAxes) this.tgt[i]!.vetoed.push({ system: 'step', label: `${label}(力矩)` });
      return;
    }
    this.requestTorque(joint, axis, tau, 'step', label);
  }

  // ── 位置伺服「让位」通道（阻抗/纯阻尼）─────────────────────────
  /**
   * ★★ 让某个轴的**位置伺服退化为纯阻尼**：`err = −kD·ω_rel`（P 项置零）。
   *
   *   为什么需要（这是本项目最隐蔽的一类冲突）：
   *     位置环是 `τ = kP·(θ_ref−θ)·τmax/ωmax`，而 `τ = JᵀF` 是**定量前馈**。
   *     两者**相加**（在 `driveMotors` 里）本该没问题，但历史实现里它们
   *     在**同一轴上互相顶**：位置环发"目标角"、力矩通道发"定量力矩"，
   *     加上 `request()` 同级只保留第一次，于是谁先到谁说了算、另一个被静默吞掉
   *     （实测：`kStanceExt` 扫 0.3/0.6/0.9 **三行逐位相同**，通道根本没执行）。
   *
   *   正确分工：**定量支撑交给 `τ = JᵀF`，位置环只留阻尼**（提供关节阻尼、
   *   抑制数值发散，但不再贡献刚度）。这样两者**职责不重叠、不会互相顶**。
   *
   *   ⚠ 不用 `requestAngle(j, a, 当前角)` 代替：那样有量纲错误 ——
   *     `requestAngle` 内部会按量程归一化（`(rad·0.9)/span`），再乘回去
   *     得到 `θ_ref ≈ 0.81·θ`，P 项并不为零（还剩 19% 的刚度）。
   */
  requestHold(joint: number, axis: number, system: SystemId, label: string): void {
    const i = joint * 3 + axis;
    if (i < 0 || i >= this.nAxes) { this.badRequests++; return; }
    if (this.hold[i]) return;                 // 已让位，不重复登记
    this.hold[i] = true;
    this.holdList.push({ i, system, label });
    this.requestCount++;
  }
  /** 撤销让位（让该轴交回给常规位置伺服）—— `τ=JᵀF` 与位置偏置共存时用 */
  clearHold(joint: number, axis: number): void {
    const i = joint * 3 + axis;
    if (i < 0 || i >= this.nAxes) return;
    this.hold[i] = false;
    this.holdMask[i] = 0;
    // ⚠⚠ 必须同时从 `holdList` 移除：每拍 `reset()` 会用 `holdList`
    //   重新填 `holdMask`，只清 `hold[i]`/`holdMask[i]` 会被**下一拍复活**。
    //   （旧实现只清这两个 ⇒ `clearHold` 实际上无效。）
    for (let k = this.holdList.length - 1; k >= 0; k--) {
      if (this.holdList[k]!.i === i) this.holdList.splice(k, 1);
    }
  }

  /** 内部用：让位标记（每拍清空） */
  private readonly hold: boolean[] = [];
  private holdList: { i: number; system: SystemId; label: string }[] = [];
  /** 本拍让位的轴（供快照回读：谁在让位给 `τ=JᵀF`） */
  holdMask: number[] = [];

  /** 锁定闸门：被锁定腿上的抬腿需求**直接丢弃**（不是加权、不是夹紧） */
  requestSwingLeg(side: Side, joint: number, axis: number, value: number, label: string, isLift: boolean): void {
    if (isLift && this.locked[side]) {
      const i = joint * 3 + axis;
      if (i >= 0 && i < this.nAxes) this.tgt[i]!.vetoed.push({ system: 'step', label });
      return;
    }
    this.request(joint, axis, value, 'step', label);
  }

  /** 同上，但按**角度**提需求 */
  requestSwingLegAngle(side: Side, joint: number, axis: number, rad: number, label: string, isLift: boolean): void {
    const def = this.sk.joints[joint];
    if (!def) { this.badRequests++; return; }
    if (isLift && this.locked[side]) {
      const i = joint * 3 + axis;
      if (i >= 0 && i < this.nAxes) this.tgt[i]!.vetoed.push({ system: 'step', label });
      return;
    }
    this.requestAngle(joint, axis, rad, 'step', label);
  }

  /**
   * ★ 腰的**受限修正槽**：迈步系统只能提一个**有界**的修正量。
   *   幅度上限 `waistSlotMax`（文献：骨盆横断面旋转 6°）
   *   且乘上权限预算 α(t)。
   *   超出部分被夹住并标记 —— 可见，不静默。
   */
  requestWaistSlot(joint: number, axis: number, rad: number, label: string): void {
    const def = this.sk.joints[joint];
    if (!def) { this.badRequests++; return; }
    const span = Math.max(Math.abs(def.minRad[0]), Math.abs(def.maxRad[0]));
    if (span <= 1e-6) { this.badRequests++; return; }
    const capRad = this.cfg.waistSlotMax * this.authority;
    const v = Math.max(-capRad, Math.min(capRad, rad));
    this.requestAngle(joint, axis, v, 'step',
      label + (Math.abs(v - rad) > 1e-9 ? `(夹到${(capRad * 57.3).toFixed(1)}°)` : ''));
  }

  // ── 仲裁 ────────────────────────────────────────────────

  /** 每拍开始：清空需求与仲裁痕迹 */
  beginTick(dt: number): void {
    this.tickNo++;
    this.tSec += dt;
    this.req.fill(undefined);
    this.treq.fill(undefined);
    this.hold.fill(false);
    // 轴声明是**每拍**重新申领的（通道可能按相位开关）⇒ 一并清零
    for (let i = 0; i < this.axisMode.length; i++) { this.axisMode[i] = 0; this.axisModeOwner[i] = 'balance'; }
    this.axisConflicts.length = 0;
    for (const h of this.holdList) this.holdMask[h.i] = h.system === 'balance' ? 1 : 2;
    this.holdList.length = 0;
    this.torqueRequestCount = 0;
    this.requestCount = 0;
    for (let i = 0; i < this.tgt.length; i++) {
      const t = this.tgt[i]!;
      t.suppressed.length = 0; t.vetoed.length = 0; t.clamped = false;
      t.owner = 'none'; t.ownerLabel = '—'; t.tag = 'none'; t.value = 0;
    }
    this.touchdown.l = false; this.touchdown.r = false;
    this.lockReleased.l = false; this.lockReleased.r = false;
  }

  /** 每拍结束：合并成唯一的 target，返回可直接喂给 `setMotorTargets` 的数组 */
  arbitrate(dt: number): Float32Array {
    const out = this.prevOut;
    const maxStep = this.cfg.slewLimit * dt;
    for (let i = 0; i < this.nAxes; i++) {
      const r = this.req[i];
      const t = this.tgt[i];
      if (!r || !t) { out[i] = this.prevTarget[i] ?? 0; continue; }
      t.value = r.value; t.owner = r.system; t.ownerLabel = r.label;
      t.tag = r.system === 'balance' ? 'hold' : 'step';
      // 斜率限制
      const prev = this.prevTarget[i] ?? 0;
      const d = r.value - prev;
      if (Math.abs(d) > maxStep) {
        out[i] = prev + Math.sign(d) * maxStep;
        t.clamped = true;
      } else {
        out[i] = r.value;
      }
    }
    // 没被任何系统提的轴：回退到"保持上一拍"（= 绑定姿态附近），owner 记为 bind
    for (let i = 0; i < out.length; i++) {
      if (!this.req[i]) { out[i] = this.prevTarget[i] ?? 0; const t = this.tgt[i]!; if (t.owner === 'none') { t.owner = 'bind'; t.ownerLabel = '保持'; t.tag = 'servo'; } }
    }
    for (let i = 0; i < out.length; i++) this.prevTarget[i] = out[i]!;
    // 力矩通道仲裁（规则同角度通道：balance > step），再按 τmax 饱和
    for (let i = 0; i < this.nAxes; i++) {
      const r = this.treq[i];
      if (!r) { this.tauOut[i] = 0; continue; }
      const j = this.sk.joints[Math.floor(i / 3)];
      const k = i % 3;
      const tmax = j ? j.maxTorque[k]! : 0;
      let v = r.value;
      if (v > tmax) v = tmax; else if (v < -tmax) v = -tmax;
      this.tauOut[i] = v;
      const t = this.tgt[i];
      if (t && t.ownerLabel === '—') { t.owner = r.system; t.ownerLabel = `${r.label}(τ)`; }
    }
    return out;
  }

  targets(): readonly AxisTarget[] { return this.tgt; }

  // ── 快照（唯一可读出口）─────────────────────────────────

  /**
   * 力链打包（供快照 / UI）。`ready=false` 时数值**不可信**（速度环未填满），
   * UI 必须显示"未就绪"，不能把 0 当成"没有力"—— 那正是之前踩过的静默失效。
   */
  forceChain(): RigSnapshot['forceChain'] {
    const joints: RigSnapshot['forceChain']['joints'] = [];
    for (let i = 0; i < this.sk.joints.length; i++) {
      const o = i * 5;
      joints.push({
        name: this.sk.joints[i]!.name,
        fx: this.forceBuf[o] ?? 0, fy: this.forceBuf[o + 1] ?? 0,
        fz: this.forceBuf[o + 2] ?? 0, f: this.forceBuf[o + 3] ?? 0,
        mass: this.forceBuf[o + 4] ?? 0,
      });
    }
    return { ready: this.forceReady, joints };
  }

  /** 重心转移诊断（供快照/UI）。历史环形缓冲，240 帧 = 4s @60Hz */
  comTransferHist: number[] = [];
  private rateLatPrev = 0;
  private rateLatHave = false;

  /**
   * 每拍更新重心转移诊断。`dt` 用**控制拍**长（历史按拍推）。
   * `cmdGrfLat` 由平衡系统写入（`grfCmd.z`），这里只读，避免两个系统互写。
   */
  updateComTransfer(dt: number): void {
    const front = this.frontLegSide;
    const stanceZ = front === 'l' ? this.soleZ.l : this.soleZ.r;
    const stanceX = front === 'l' ? this.soleX.l : this.soleX.r;
    this.comErrLat = this.com.z - stanceZ;
    this.comErrSag = this.com.x - stanceX;
    if (this.rateLatHave && dt > 1e-6) this.comRateLat = (this.comErrLat - this.rateLatPrev) / dt;
    this.rateLatPrev = this.comErrLat;
    this.rateLatHave = true;
    this.comTransferHist.push(this.comErrLat);
    if (this.comTransferHist.length > 240) this.comTransferHist.shift();
  }
  comErrLat = 0;
  comErrSag = 0;
  comRateLat = 0;
  cmdGrfLat = 0;

  comTransfer(): ComTransfer {
    return {
      errLat: this.comErrLat, errSag: this.comErrSag, rateLat: this.comRateLat,
      hist: this.comTransferHist.slice(-240),
      cmdHipLatTau: this.hipLatTau, cmdWaistTrim: this.waistTrim, waistGapM: this.waistGapM,
      cmdGrfLat: this.cmdGrfLat, cmdPelvicLift: this.pelvicLift,
      loadFront: this.loadFrac[this.frontLegSide],
      loadRear: this.loadFrac[this.rearLegSide],
      mosMm: this.mos * 1000,
      handover: { flags: { ...this.handoverCriteria.flags }, values: { ...this.handoverCriteria.values }, all: false },
    };
  }

  /** 每拍产出一次，**整体替换** ⇒ 持有旧快照不会被后续 tick 改变 */
  /**
   * ★ 只读：某根轴当前**由谁在驱动**（`balance` / `step` / `bind` / `none`…）。
   *
   * 存在的理由：门禁 `probe:axisown` 的检查 E「每根被写过的轴都必须登记在
   * `AXIS_OWNERSHIP`」需要读"这根轴有没有主人"，而 `tgt` 是 private ——
   * 探针此前直接读 `rs.tgt`（private），且 `tools/` 长期不做类型检查，
   *   所以"探针在戳私有成员"这件事一直没人管。
   * 与其放宽 TS 的 private，不如给一个**文档化的只读口**。
   *
   * @param flatIndex 扁平轴索引（`joint * AXES_PER_JOINT + axis`）
   */
  axisOwner(flatIndex: number): string { return this.tgt[flatIndex]?.owner ?? 'none'; }

  /** 轴总数（`joints.length * AXES_PER_JOINT`） */
  get axisCount(): number { return this.nAxes; }

  snapshot(limitHit: boolean[] = []): RigSnapshot {
    const footL = this.soleX.l, footR = this.soleX.r;
    void footL; void footR;   // 仅遗留局部量，判定已统一到 frontLeg()
    // ⚠ 这里原来另写了一份 `footL >= footR ? 'l' : 'r'`（裸比较、无死区），
    //   而 HUD 读的正是这份快照 ⇒ **UI 的「前腿/后腿」标签逐帧闪**
    //   （实测 20s 切 4 次；Δx 实测只有 ±1mm，正好在 3mm 死区内抖）。
    //   这已是同一个决策的**第三份实现**（前两份：承重腿的双实现）。
    const front: Side = this.frontLeg();
    const axes: AxisSnapshot[] = [];
    for (let j = 0; j < this.sk.joints.length; j++) {
      for (let a = 0; a < 3; a++) {
        const i = j * 3 + a;
        const t = this.tgt[i]!;
        axes.push({
          key: `${this.sk.joints[j]!.name}/${a}`,
          joint: j, axis: a,
          pos: this.pos[i] ?? 0, vel: this.vel[i] ?? 0,
          target: this.prevTarget[i] ?? 0,
          owner: t.owner, ownerLabel: t.ownerLabel, tag: t.tag,
          suppressed: t.suppressed.map((x) => ({ ...x })),
          vetoed: t.vetoed.map((x) => ({ ...x })),
          clamped: t.clamped,
          limitHit: !!limitHit[i],
        });
      }
    }
    return {
      tick: this.tickNo, t: this.tSec,
      phase: this.phase, phaseT: this.phaseT,
      loadBearer: this.loadBearer, supportLeg: this.supportLeg(), swingLeg: this.swingLeg(),
      locked: { ...this.locked }, authority: this.authority,
      com: { ...this.com }, dcm: { ...this.dcm }, support: { ...this.support },
      qVip: this.qVip, ankleTauVip: this.ankleTauVip, ankleTauSat: this.ankleTauSat,
      mos: this.mos, grf: { ...this.grf }, grfCmd: { ...this.grfCmd }, pelvicLift: this.pelvicLift,
      frontLegSide: this.frontLegSide, rearLegSide: this.rearLegSide,
      captureX: this.captureX, captureZ: this.captureZ, omega0Val: this.omega0Val,
      swingClearance: this.swingClearance,
      waistTrim: this.waistTrim, waistGapM: this.waistGapM, hipLatTau: this.hipLatTau,
      forceChain: this.forceChain(), comTransfer: this.comTransfer(),
      torsoY: this.torsoY, tiltDeg: this.tiltDeg,
      pitchDeg: this.pitchDeg, rollDeg: this.rollDeg,
      pitchRate: this.pitchRate, rollRate: this.rollRate,
      axisConflicts: this.axisConflicts.map((c) => ({ ...c })),
      legs: {
        l: {
          side: 'l', grounded: this.grounded.l, loadFrac: this.loadFrac.l, soleY: this.soleY.l,
          footX: this.soleX.l, footZ: this.soleZ.l,
          cop: { ...this.cop.l },
          isFront: front === 'l', isBack: front !== 'l',
          isBearer: this.loadBearer === 'l', locked: this.locked.l,
        },
        r: {
          side: 'r', grounded: this.grounded.r, loadFrac: this.loadFrac.r, soleY: this.soleY.r,
          footX: this.soleX.r, footZ: this.soleZ.r,
          cop: { ...this.cop.r },
          isFront: front === 'r', isBack: front !== 'r',
          isBearer: this.loadBearer === 'r', locked: this.locked.r,
        },
      },
      axes,
      criteria: {
        bearer: cloneCriteria(this.bearerCriteria),
        handover: cloneCriteria(this.handoverCriteria),
        unlock: cloneCriteria(this.unlockCriteria),
        stepPermit: cloneCriteria(this.stepPermit),
      },
      events: {
        touchdownL: this.touchdown.l, touchdownR: this.touchdown.r,
        lockReleasedL: this.lockReleased.l, lockReleasedR: this.lockReleased.r,
      },
    };
  }
}

function cloneCriteria(c: Criteria): Criteria {
  return { flags: { ...c.flags }, values: { ...c.values }, all: c.all };
}

export function makeCriteria(flags: Record<string, boolean>, values: Record<string, number>): Criteria {
  const ks = Object.keys(flags);
  return { flags, values, all: ks.length > 0 && ks.every((k) => flags[k]) };
}