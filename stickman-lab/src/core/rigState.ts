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
import { KEY_POSES, type GaitKey, type KeyPose } from './keyframe';
import type { JointQuery } from './jointQuery';

// ─────────────────────────────────────────────────── 身份

export type Side = 'l' | 'r';
/**
 * ★★★ **步态状态机的 5 个状态（固定环）** —— `架构_v2_三模块协作.md` §3
 *
 *   环：`DOUBLE → LOAD → PUSH → LIFT → SWING → DOUBLE`（一个完整迈步周期 = 一圈）
 *
 *   命名依据（文献，详见文档 §3.4）：
 *     · `LOAD`  = **重量交接**（SCONE `EarlyStance` / EPFL `MS`，由**对侧趾离**触发）
 *       —— 这是抬腿的**资格前提**（用户 2026-10-06：「迈步前需要先让重量转移到后脚」）
 *     · `PUSH`  = 蹬离（SCONE `LateStance` / EPFL `PS`）
 *     · `LIFT`  = 摆动腿离地、进入单支撑（SCONE `LiftOff`，判据 = 该腿载荷 < 阈值）
 *     · `SWING` = 摆动到落地（SCONE `Swing`→`Landing` / EPFL `IS`+`LP`）
 *
 *   ⚠ 迁移**只**由验收驱动（四篇实现一致），**没有计时器推进相位**；
 *     最短驻留只是防抖（OSL `min_time_in_state`）。
 */
/**
 * ★ 固定环的六个状态（2026-10-06 由五态扩为六态，方案 B）。
 *
 *   `THRUST` 是新拆出来的：人类把 **MidStance（被动拱架，肌肉几乎不加载）**
 *   与 **TerminalStance（主动蹬离，全周期最强推进）** 分成两个相位
 *   （Perry 八相位；力学依据见 `架构_v2_三模块协作.md` §19.3 / Usherwood 2012）。
 *   我们原来一个 `PUSH` 把两者装了 ⇒ **平衡系统无法表达"此刻该少做还是多做"**。
 */
export type WalkState = 'DOUBLE' | 'LOAD' | 'PUSH' | 'THRUST' | 'LIFT' | 'SWING';
/** 固定环的下一状态（**唯一真源**，不许散落字面量） */
export const NEXT_STATE: Readonly<Record<WalkState, WalkState>> = Object.freeze({
  DOUBLE: 'LOAD', LOAD: 'PUSH', PUSH: 'THRUST', THRUST: 'LIFT', LIFT: 'SWING', SWING: 'DOUBLE',
});

/**
 * ★ 状态的固定环顺序（**唯一真源**，2026-10-06 从 `gaitState` 下沉到这一层）。
 *
 *   为什么下沉：`RigState.telemetry.ring` 要按环序画五态环，而 `NEXT_STATE`
 *   本来就在 `rigState`。留在 `gaitState` 的话 `rigState` 得反向 import
 *   `gaitState` ⇒ 循环依赖（`gaitState` 已经 import `rigState`）。
 *   `gaitState` 改为 re-export，所以外部引用方（探针/文档）不用改。
 */
export const STATE_ORDER: readonly WalkState[] = Object.freeze(
  ['DOUBLE', 'LOAD', 'PUSH', 'THRUST', 'LIFT', 'SWING'] as WalkState[]);
/** 旧名 → 新名（迁移对照，见文档 §3.2；保留只为读旧日志/旧探针） */
export const LEGACY_STATE_ALIAS: Readonly<Record<string, WalkState>> = Object.freeze({
  DOUBLE: 'DOUBLE', SHIFT: 'LOAD', SINGLE: 'LIFT', PUSH: 'PUSH', STEP: 'SWING',
  // 旧五态里的 `PUSH`（混合拱架+蹬离）在六态里对应 `THRUST`（主动蹬离那一半）
  PUSH_THRUST: 'THRUST',
});

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

/**
 * ★ 一条**验收未通过**的明细（`rs.violations[]` 的元素）。
 *
 *   为什么要有「差多少」而不是只有一个 bool：
 *   旧判据 `comOverFootZ ≤ 50mm` 失败时只给一个 false，而那个量
 *   实测**永不收敛**（243mm，且 `soleZ` 本身随姿态移动）
 *   ⇒ 看门禁只能知道"卡住了"，没法知道"差哪一项、差多少"。
 *   ⇒ 每一项都必须能单独回答：**哪一项、当前值、门限**。
 */
/**
 * ★ 状态机遥测（UI 唯一数据源）。字段刻意做成**扁平 + 已格式化**，
 * 让 UI 不需要知道单位、符号、也不需要自己判断"通过/未通过"。
 */
export interface StateTelemetry {
  /** 状态标签（中文，来自 `STATE_LABEL`） */
  stateLabel: string;
  /** 状态枚举（`'DOUBLE' | 'LOAD' | 'PUSH' | 'LIFT' | 'SWING'`） */
  state: WalkState;
  /** 本状态驻留（s，2 位小数） */
  stateT: string;
  /** 验收结论：`✓ 全过` / `✗ N 项未过` / `[安全] 降级中` */
  verified: string;
  /** 承重腿 / 摆动腿（中文 左/右） */
  support: string;
  swing: string;
  /** 接地数（只脚）+ 明细，如 `2 只 (左 右)` */
  contact: string;
  /** 承重腿载荷占比（百分比） */
  bearerLoad: string;
  /** 两条腿的载荷（百分比），如 `52 / 48` */
  loadFrac: string;
  /** 稳定裕度 MoS（mm） */
  mos: string;
  /** 躯干前/后倾（deg） */
  pitch: string;
  /** 躯干左/右倾（deg） */
  roll: string;
  /** 腰参考偏置权限 α（0..1，2 位小数） */
  alpha: string;
  /** 摆动腿离地净空（mm；未离地为 0） */
  clearance: string;
  /** 承接腿相对身体的矢状位置（腿长归一，3 位小数，SCONE 口径） */
  sagRecv: string;
  /** 状态内承接腿载荷峰值（百分比）—— 交接能力的上界 */
  recvPeak: string;
  /**
   * ★ 五态环的可视化（长度恒为 5，顺序 = `STATE_ORDER`）。
   *   每格是**状态机自己写的**字符串，标记含义：
   *     `▶` 当前态　`✓` 本周期已通过并离开过　`○` 未到达　`✗` 到达过但未通过
   *   UI 只把这 5 个字符串塞进 5 个 span，**不判断、不排序、不推导**。
   *   为什么需要它：状态机是"验收不过就不往下走"，所以**卡在哪一态**
   *   就是全部诊断信息 —— 但以前这件事只能从日志里找。
   */
  ring: string[];
  /** 下一态（`NEXT_STATE`）的中文名 —— 状态机打算去哪 */
  next: string;
  /** 在当前态已等多久 / 最短驻留要求，形如 `1.25s / 0.20s` */
  wait: string;
  /** 当前**卡住**的首个验收项（没有则 `无`）——「在等什么」 */
  blocked: string;
  /** 帧域最差越界（deg；0 = 全在域内） */
  domainWorst: string;
  /** 迈步许可（`stepPermit.all`） */
  stepPermit: string;
  /** 未通过的验收项（人话，空 = 全过），如 `承接腿承重 0.51/0.60` */
  violations: string;
  /** 角色标签（承重/前腿），由状态机指派 */
  roles: string;
  /** 关节角（经回读网关，deg）拼成的一行：`髋 -3.1° 膝 5.2° 踝 -1.0°` */
  jointsDeg: string;
  /** 安全态 */
  safe: string;
}

export interface StateViolation {
  /** 所属状态（`rs.state`） */
  state: WalkState;
  /** 项名（与 `Criteria.flags` 的键同名，便于 UI 对齐） */
  item: string;
  /** 当前值（物理量，单位见项名） */
  value: number;
  /** 门限（与 `value` 同单位） */
  tol: number;
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
  /** ★ 当前状态（5 态固定环）。**只由 `gaitState` 写**。 */
  state: WalkState;
  /** 本状态已停留时间（**只用于防抖与 `Tmax`**，不参与推进） */
  stateT: number;
  /** 本拍验收是否通过（=「可以进下一个状态」） */
  verified: boolean;
  /** 逐项验收未通过的明细（哪一项、当前值、门限）。空数组 = 全过 */
  violations: StateViolation[];
  /** 安全态（Vughuma 2022）：硬项连续越界 ⇒ 迈步停手、平衡全权 */
  safe: boolean;
  /** 上一周期的摆动腿（手性不变式用） */
  lastSwing: Side | null;
  /** 已完成的迈步周期数 */
  cycleCount: number;
  /**
   * ★ 最近一次状态迁移的**判据快照**（诊断 / 门禁��用）。
   *
   *   为什么必须有：迁移发生在 `update()` 内部，迁移后 `violations[]` 已按
   *   **新状态**重算 ⇒ 事后无法回答"迁移那一拍的验收是不是真的全过"。
   *   没有它，"迁移只发生在验收通过时"这条不变式只能靠读代码相信。
   */
  lastMove: { from: WalkState; to: WalkState; verified: boolean; nViol: number } | null;
  /** 本状态内的极值/均值统计（标定与诊断用；进态时由状态机清零） */
  stateStats: { recvLoad: number; recvLoadN: number; sagRecv: number; sagRecvMin: number; sagRecvMax: number };
  /**
   * ★★ **状态机遥测**（UI 的**唯一**数据源）。
   *
   *   为什么要有这一块（用户 2026-10-06：「我应该回读各种状态机的数据才对，
   *   所有的回读也是消费状态机的数据」）：
   *     · 以前 UI 自己去 `rs` 上抓十几个量、各自算各自的"相/接地/MoS/倾角"，
   *       于是**同一个物理量在 UI 与状态机里有两个口径** —— 本项目栽过四次
   *       （轴索引、符号、单位、帧域）。UI 显示"验收通过"但状态机说没过，
   *       或者反过来，人就不知道该信谁。
   *     · 现在这块由 `gaitState` **每拍填写**，UI 只渲染，不再自己推导。
   *       「相、验收、角色、越界、许可」全部是状态机的原话。
   *
   *   字段全是**已格式化好的字符串**：UI 不做单位换算、不做符号推断，
   *   于是"UI 显示的"与"状态机判的"必然是同一件事。
   */
  telemetry: StateTelemetry;
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
  /**
   * ★★ DIP 髋侧被动刚度律输出的力矩（N·m，矢状）。支撑腿那一侧。
   *   Morasso 2019/2022：`τ_hip = K_h·q_hip + B_h·q̇_hip`，纯被动、无主动反馈。
   *   这是"踝刚度刻意欠临界"能成立的前提 —— 缺它则踝在 ±0.217 rad 饱和后必倒。
   */
  hipTauStiff: number;
  /**
   * ★★ 踝的**间歇延迟反馈**诊断（Bottaro 2008 / Asai 2009 / Morasso 2019）。
   *   `on` = 当前在 ON 相（反馈输出）；`gamma` = 距稳定流形的比值；
   *   `tCross` = off 相过零时间，稳定要求 `tCross > delaySec`；
   *   `omega` = off 相鞍点特征频率 √(mgh/I)；`switches` = 开关次数（抖振诊断）。
   */
  vipOn: boolean;
  vipGamma: number;
  vipTCross: number;
  vipOmega: number;
  vipSwitches: number;
  /** off 相收缩/扩张次数（论文的稳定性机制判据，见 RigState.vipOffShrink） */
  vipOffShrink: number;
  vipOffGrow: number;
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
  /** 捕获点相对支撑脚的额状误差（米）—— UI/探针回读 */
  waistErrLat: number;
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
  /**
   * ★★ 迈步系统申报的**横向驱动意图**（N，额状面地面反力分量）。
   *
   * ★★ 这条是**按文献重做**后的唯一驱动通道。两次被证伪的旧实现已删除：
   *   ① 支撑侧髋外展加"推相位"偏置 —— 实测帮倒忙（存活 3.25s→1.87s，X3 更差）。
   *   ② 躯干侧倾转移通道 —— 实测单调扣存活、零收益（3.25s→1.25s，X3 不变）。
   *
   * 文献依据：
   *   · **Pandy 2010**（JB Biomech，10段23自由度54肌肉分解）：
   *     髋外展肌把重心加速向**内**；把重心加速向外的是
   *     **髋内收肌 + 跖屈肌外翻肌**。
   *   · **Batenie 2014**（Gait & Posture，倒立摆 + PD 拟合 75 人）：
   *     "**the leg OPPOSITE the shift direction** generates an increased GRF with a
   *     lateral component that accelerates the CoM toward the target"
   *     ⇒ 驱动来自**摆动侧（轻）腿蹬地**，不是支撑侧髋把身体拽过去。
   *
   * 符号：正 = 把重心推向 +Z。单位 N（力，不是力矩）—— 力矩映射 `τ=JᵀF`
   * 由 balance 做，因为它同时掌握该轴的 τmax 与 CoP 护栏。
   */
  shiftDemandF: number;
  /** 提供驱动力的那条腿（=摆动侧/轻腿）；null = 本拍不驱动 */
  shiftDriveSide: Side | null;
  /** 驱动经护栏后**实际**施加的力矩幅值（N·m，回读用） */
  shiftPushTau: number;
  /** 推相位残余误差 `stanceZ − com.z`（米，正 = 重心还没到支撑脚上方） */
  shiftErrZ: number;
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
  /**
   * ★★ **实际送进马达的两个通道**（唯一权威回读口）。
   *
   *  为什么必须有：探针此前只能去戳 `doll` 的私有 `motorTarget`/`torqueCmd`，
   *  于���每个探针各写一遍取法 —— 本轮实测因此踩到两次假结论：
   *    ① 读 `foot_l/2` 的电机实收，而 QP 主要出力在膝/髋/腰 ⇒ 误报"解被丢弃"；
   *    ② 在裸循环里不调 `ctrl.step()`，`sim.advance` 实际没推进，
   *       却把"com 连 y 都不动"当成"该轴不产生水平力"。
   *  ⇒ 送达值必须由**仲裁器自己**产出并进快照，而不是各处现取。
   *
   *  · `motorTarget` —— 角度通道（位置伺服）的目标，已按 ±1 归一（`setMotorTargets` 的输入）
   *  · `torqueOut`   —— 力矩通道的 N·m，已按各轴 τmax 饱和（`setTorqueTargets` 的输入）
   */
  channels: { motorTarget: Float32Array; torqueOut: Float32Array };
  /**
   * 全链 QP 的本拍读数（附录 C.1）。`null` = 本拍没跑。
   * `feasible=false` 或 `grfSat=true` 时，下游**必须知道**（控制理论前提已不成立）。
   */
  qp: {
    feasible: boolean; residual: number;
    fDesX: number; fDesZ: number; xiX: number; xiZ: number; grfSat: boolean;
    names: readonly string[]; tau: Float64Array;
  } | null;
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
  /** ★ 当前 Perry 关键帧名（状态机写，两系统读） */
  gaitKey: GaitKey;
  /** ★ 当前关键帧姿态目标（两套系统的共同收敛目标，见 `keyframe.ts`） */
  keyPose: KeyPose;
  /** 站距 / 髋间距（Winter 1998 口径；其实测区间 0.5~1.5） */
  strideRatio: number;
  /** 重心进入支撑面所需的最小横移（米）＝ |soleZ| − 足半宽 */
  supportEntryZ: number;
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
  /** 迈步系统申报的重心侧移意图 / 平衡系统实际施加（含护栏后）/ 残余误差（米） */
  shiftDemandF: number;
  shiftDriveSide: Side | null;
  cmdShiftPushTau: number;
  shiftErrZ: number;
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
  /** ★ 当前状态（5 态固定环）。**只由 `gaitState` 写**。 */
  state: WalkState = 'DOUBLE';
  /** 本状态已停留时间（**只用于防抖与 `Tmax`**，不参与推进） */
  stateT = 0;
  authority = 0;

  // ── 验收输出（状态机的全部输出，见文档 §7「穷举就这 6 项」）────────
  /** 本拍验收是否通过（=「可以进下一个状态」） */
  verified = false;
  /** 逐项验收明细：哪一项没过、差多少、门限多少。**空数组 = 全过**。 */
  violations: StateViolation[] = [];
  /** 安全态（Vughuma 2022：每个正常态派生安全态 + `Tmax`） */
  safe = false;
  /** 上一周期摆动腿 —— 手性不变式：连续两周期的摆动腿必须不同 */
  lastSwing: Side | null = null;
  /** 已完成的迈步周期数（每绕环一圈 +1；门禁用它确认 5 态都被走过） */
  cycleCount = 0;
  /**
   * ★ 最近一次状态迁移的**判据快照**（诊断 / 门禁用）。
   *   `nViol = -1` 表示这次迁移是 **`Tmax` 兜底**（不是验收驱动的）。
   */
  lastMove: { from: WalkState; to: WalkState; verified: boolean; nViol: number } | null = null;
  /** 本状态内的极值/均值统计（标定与诊断用；进态时由状态机清零） */
  stateStats: { recvLoad: number; recvLoadN: number; sagRecv: number; sagRecvMin: number; sagRecvMax: number }
    = { recvLoad: 0, recvLoadN: 0, sagRecv: 0, sagRecvMin: 0, sagRecvMax: 0 };
  /**
   * ★ 本周期**到过**的状态（用于画五态环的 `○/✗`）。
   *   只由 `gaitState` 维护；UI 不读它，只读 `telemetry.ring`。
   */
  visited = new Set<WalkState>();
  /** 本周期**验收通过并离开过**的状态（五态环的 `✓`） */
  passed = new Set<WalkState>();
  /** ★ 状态机遥测（每拍由 `gaitState` 填写；UI 只渲染它） */
  telemetry: StateTelemetry = {
    stateLabel: '—', state: 'DOUBLE', stateT: '0.00', verified: '—',
    support: '—', swing: '—', contact: '—', bearerLoad: '—', loadFrac: '—',
    mos: '—', pitch: '—', roll: '—', alpha: '0.00', clearance: '0',
    sagRecv: '—', recvPeak: '—', domainWorst: '0.0', stepPermit: '—',
    ring: STATE_ORDER.map(() => '○'), next: '—', wait: '0.00s', blocked: '无',
    violations: '', roles: '—', jointsDeg: '—', safe: '否',
  };

  // ── 关节回读网关（**唯一**对外读关节的入口，见 `jointQuery.ts` / 文档 §18）──
  //   由 `Controller` 注入 `GaitState.query`：**只读、无 setter、不含 request***。
  //   R1：`balance` / `step` 不得再直读 `pos`/`vel`/`angle()`/`jointVel()`
  //      （门禁 `probe-readback` 静态断言）。
  jq: JointQuery | null = null;

  /**
   * 取关节回读网关。**两个系统读关节的唯一入口**（文档 §18 R1）。
   *
   *   为什么是抛错而不是回退到 `rs.angle()`：
   *     回退 = 又多一条读路径 ⇒ 网关形同虚设，而且"两个口径不一致"这个
   *     本次要根治的病会**静默复发**（轴索引/符号/单位三者只要有一处不同，
   *     验收与控制就会说两套话）。⇒ 缺网关就在第一拍炸掉，绝不降级。
   *
   *   唯一注入点：`Controller` 构造 `GaitState` 时挂上（`GaitState.installJointQuery`）。
   */
  jointRead(): JointQuery {
    if (!this.jq) {
      throw new Error(
        'rs.jq 未注入：关节回读必须经状态机网关（§18）。'
        + '请确认 Controller 已构造 GaitState（它在构造时调用 installJointQuery）。',
      );
    }
    return this.jq;
  }

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
  /** 捕获点相对支撑脚的额状误差（米）—— UI/探针回读 */
  waistErrLat = 0;
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
  /** ★ DIP 髋侧被动刚度律输出的力矩（N·m，矢状，**已钳到 τmax**），诊断/UI 用 */
  hipTauStiff = 0;

  // ══════════════════════════════════════════════════════════════════
  // ★★ 踝的**间歇延迟反馈**状态（Bottaro 2008 / Asai 2009 / Morasso 2019）
  // ══════════════════════════════════════════════════════════════════
  //   文献要点（全部记在代码里，理由见 balance.ts 的 vipFeedback 段）：
  //     · 开关判据作用在 **VIP 的相平面 (q, q̇)**，不是踝角
  //       （Morasso 2019：「the phase plane used by the switching rule was not
  //         that of the ankle joint but the plane of a virtual inverted pendulum」）
  //     · ON  ⟺ `q_δ · (q̇_δ − a·q_δ) < 0`，OFF ⟺ `≥ 0`，`a = −ω₀`
  //     · 反馈延迟 δ（感觉通路）必须进入判据 ⇒ 需要**延迟环形缓冲**
  //   这些量必须可回读：`on/off` 决定有没有输出、`γoff` 决定 off 相是不是
  //   真的在收缩（γ<1）、`tCross` 决定稳定性（`tCross > δ`，见论文式 16）。
  private readonly vipCap = 64;
  /** VIP (q, q̇) 的延迟环形缓冲；按 `vipLen` 覆盖最旧的 */
  private readonly vipQ = new Float32Array(64);
  private readonly vipQd = new Float32Array(64);
  private vipHead = 0;
  private vipLen = 0;
  /** 当前是否在 ON 相（反馈开启） */
  vipOn = false;
  /** 距稳定流形的比值 γoff：=1 在流形上，<1 在流形下方，>1 上方 */
  vipGamma = 1;
  /** off 相的过零时间（论文式 9）：`δ·ln((1+γ)/|1−γ|)`。稳定要求 > δ */
  vipTCross = 0;
  /** 开关次数（诊断：抖振会很高） */
  vipSwitches = 0;
  /**
   * ★ **off 相收缩计数**（论文的稳定性机制本身）：
   *   > "such contracting properties of the off-phases may compensate, on average,
   *      the expanding properties of the spiral/nodal segments during the on-phases,
   *      supporting the emergence of limit-cycle oscillations."
   * 每个 off 相开始时记 |q|，off 相结束时（切回 ON 时）再记一次；变小=收缩。
   * 这是判据"间歇机制有没有真的在起作用"，比看 ON 占比或开关次数都硬。
   */
  vipOffShrink = 0;
  vipOffGrow = 0;
  private vipOffStartQ = 0;
  private vipPrevOn = false;
  /** ω₀ = √(mgh/I)：off 相鞍点的特征频率（rad/s） */
  vipOmega = 0;
  // ── 全链 QP 的本拍读数（附录 C.1）────────────────────────────────
  // ★ 必须可回读：QP 不可行时给的是"尽力而为"的盒内点，
  //   下游若不知道就会当成有效修正 ⇒ 又一次静默失效。
  qpTick: { tau: Float64Array; names: string[]; feasible: boolean; residual: number;
            fDesX: number; fDesZ: number; nAxes: number;
            xiX: number; xiZ: number; grfSat: boolean } | null = null;
  qpGrfSat = false;
  qpFeasible = true;
  qpResidual = 0;
  /** 中间量诊断（闭环判据的四项 + 实际强度） */
  vipDiag: { qD: number; qdD: number; a: number; prod: number;
             delayTicks: number; omega0: number; q: number; qVipRate: number } | null = null;
  /** 本拍控制间隔（s）—— 延迟拍数 = δ / dtCtrl，beginTick 时写入 */
  dtCtrl = 1 / 60;
  /** `vipDelayed` 的复用输出缓冲：[q_δ, q̇_δ] */
  readonly vipD1 = new Float64Array(2);

  /** 推入一拍 VIP 状态（控制拍调用一次） */
  pushVip(q: number, qd: number): void {
    this.vipQ[this.vipHead] = q;
    this.vipQd[this.vipHead] = qd;
    this.vipHead = (this.vipHead + 1) % this.vipCap;
    if (this.vipLen < this.vipCap) this.vipLen++;
  }
  /**
   * 取 `delayTicks` 拍之前的 VIP 状态，写入 out[0]=q, out[1]=q̇。
   * 历史不够时返回**最早**的一条（等价于"从 0 开始"，不外推、不造值）。
   */
  vipDelayed(delayTicks: number, out: Float64Array): void {
    const k = Math.max(0, Math.min(this.vipLen - 1, Math.round(delayTicks)));
    const idx = (this.vipHead - 1 - k + this.vipCap * 2) % this.vipCap;
    out[0] = this.vipQ[idx]!;
    out[1] = this.vipQd[idx]!;
  }
  /** 清空（回合/会话重置时） */
  resetVip(): void {
    this.vipHead = 0; this.vipLen = 0;
    this.vipOn = false; this.vipGamma = 1; this.vipTCross = 0; this.vipSwitches = 0;
    this.vipOffShrink = 0; this.vipOffGrow = 0; this.vipPrevOn = false;
  }
  /**
   * 每拍调用（在切换判定**之后**）：结算上一个 off 相是收缩还是扩张。
   * @param qNow 本拍的 VIP 摆角
   */
  settleOffPhase(qNow: number): void {
    if (this.vipPrevOn && !this.vipOn) this.vipOffStartQ = Math.abs(qNow);   // 进入 off
    else if (!this.vipPrevOn && this.vipOn) {                                 // 离开 off
      const a0 = this.vipOffStartQ, a1 = Math.abs(qNow);
      if (a0 > 1e-5) { if (a1 < a0) this.vipOffShrink++; else this.vipOffGrow++; }
    }
    this.vipPrevOn = this.vipOn;
  }
  /** 额状主力（支撑髋外展）力矩命令（N·m）。正 = 把重心推向 +Z */
  hipLatTau = 0;
  shiftPushTau = 0;
  keyPose: KeyPose = KEY_POSES.MSt;
  gaitKey: GaitKey = 'MSt';
  strideRatio = 0.65;
  supportEntryZ = 0;
  shiftErrZ = 0;
  shiftDemandF = 0;
  shiftDriveSide: Side | null = null;
  /** 交接验证是否全过（`GaitState` 每拍写）。false = 迈步系统还有活：主动侧移 */
  handoverOk = false;
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
  /**
   * ★ 仲裁器**自己**算出的角度通道目标（即 `setMotorTargets` 的输入）。
   *   由 `arbitrate()` 在返回前写入 —— 这样快照里���的送达值与真正下发的
   *   是**同一份**，不再需要各探针去戳 `doll` 的私有 `motorTarget`。
   */
  tgtOut = new Float32Array(0);
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
    this.tgtOut = new Float32Array(n);
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

  /**
   * ★★ 支撑腿 —— **锁定优先于载荷**。
   *
   * 两种"哪条腿在支撑"必须分清：
   *   · `loadBearer`（**承重腿**）= **测量**：由载荷+迟滞决定。它会因为物理摇摆
   *     来回变（实测 3s 内翻转 1~4 次），这是**真实物理**，不该被抑制。
   *   · `locked`（**锁定腿**）= **计划约束**：本步的支撑腿已经定了，不许变。
   *
   * ⚠⚠ 原实现第一行 `if (this.loadBearer) return this.loadBearer` **直接绕过锁定**
   *   ⇒ 锁定机制形同虚设。实测：34 帧里 `locked` 从未置真（唯一加锁入口在
   *   `STEP` 触地，而 `STEP` 永远进不去）；`supportLeg` 翻转 1~4 次。
   *   ⇒ 转移控制律的**目标一直在跳**，`X3` 驻留恒为 0.00s，
   *      任何驱动都变成"追一个移动的目标"（实测加驱动反而更早倒）。
   *
   * 修正后：锁定期内支撑腿**恒定**，`ω₀`、`waistTrim` 符号、驱动目标 `soleZ[sup]`
   *   与 CoP 护栏全部拿到固定目标。
   *
   * 顺序依据（用户 2026-10-05）：**先完成重心转移才允许抬另一条腿**。
   *   锁定 = "这条腿已经是承重腿，不许动"；承重腿 = "载荷实测在哪条腿"。
   */
  supportLeg(): Side {
    // ★ 锁定优先（计划约束 > 测量）
    if (this.locked.l && !this.locked.r) return 'l';
    if (this.locked.r && !this.locked.l) return 'r';
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

  /**
   * ★★ **足相对身体的矢状位置**（SCONE `GaitStateController.sagittal_pos`，无量纲）。
   *
   *   `sagPosRel(side) = (footX[side] − com.x) / legLen`，`legLen = com.y − soleY`
   *   （腿长用 CoM 高出该脚足底的高度量，与 SCONE 的「以腿长为单位」同口径）。
   *
   *   **为什么用它取代 `comOverFootX` 做迁移判据**（文献依据）：
   *     · SCONE 的 `Landing/EarlyStance/LateStance/LiftOff/Swing` **全部**用
   *       「相对腿长的矢状足位置」阈值 + 足载阈值，**没有一个用重心位置**；
   *     · 重心位置会**自己推着自己走**：`comOverFootX` 里减的 `footX` 来自
   *       支撑脚，而支撑脚是控制器自己在推的量 ⇒ 实测永不收敛
   *       （额状 243mm，矢状同理），状态机因此卡死在 `DOUBLE`。
   *   ⇒ 判据必须是**独立于自身动作**的量：足的位置 + 脚的载荷。
   *
   *   正号 = 该脚在重心**前方**；负号 = 在重心后方。
   */
  sagPosRel(side: Side): number {
    const legLen = Math.max(0.2, this.com.y - (this.soleY[side] ?? 0));
    return ((this.soleX[side] ?? 0) - this.com.x) / legLen;
  }
  /** 腿长（用于把矢状距离归一化），与 `sagPosRel` 同一口径 */
  legLength(): number {
    const s = this.supportLeg();
    return Math.max(0.2, this.com.y - (this.soleY[s] ?? 0));
  }

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
  /**
   * ★ **强制**写入力矩通道，覆盖该轴上已有的请求（不产生 `suppressed`）。
   *
   * 用途只有一个：**全链 QP**（附录 C.1）。它跑在 `balanceSystem` 末尾，
   * 而 `requestTorque` 是先到先得（`PRIORITY[cur] <= PRIORITY[system]` 就压制后来者），
   * 于是同拍更早的通道（VIP 踝、载荷依赖张力…）会把 QP 的解**静默压掉** ——
   * 实测 QP 残差 0.00N、解出 −0.2…32 N·m，而电机实收恒为 ±0.0。
   *
   * ⚠ 只给"最终修正"用。若拿它当普通通道，就等于取消了仲裁。
   */
  forceTorque(joint: number, axis: number, tau: number, system: SystemId, label: string): void {
    const i = joint * 3 + axis;
    if (i < 0 || i >= this.nAxes) { this.badRequests++; return; }
    this.torqueRequestCount++;
    this.treq[i] = { value: tau, system, label };
  }

  /**
   * ★ **累加**到该轴已有的力矩请求（不替换、不产生 `suppressed`）。
   *
   * ⚠⚠ 这是全链 QP 唯一正确的接线方式，两个原因都是实测出来的：
   *
   *  ① 用 `forceTorque`（顶替）会把同一通道里的 `hipStiff` / VIP 踝等
   *     **静力矩直接抹掉**。而力矩通道与位置环是在 `driveMotors` 里**相加**的，
   *     位置环（`sagSupport`）不受影响 —— 但力矩通道内的贡献会被删光。
   *
   *  ② 用 `requestTorque`（先到先得）则会被同拍更早的通道全部压制，
   *     实测 QP 解出 −0.2…32 N·m 而电机实收恒 ±0.0。
   *
   *  ⇒ 累加是唯一同时满足"不被压制"与"不删他人"的写法。
   *  ⚠ 它**不改变** `system`/`label`（保留原写者的归属，便于回读是谁在出力）；
   *    所以若原轴无人写，`ownerLabel` 不会变成 QP —— 需要靠 `qpTick` 回读。
   */
  addTorque(joint: number, axis: number, tau: number, system: SystemId, label: string): void {
    const i = joint * 3 + axis;
    if (i < 0 || i >= this.nAxes) { this.badRequests++; return; }
    this.torqueRequestCount++;
    const cur = this.treq[i];
    if (!cur) { this.treq[i] = { value: tau, system, label }; return; }
    cur.value += tau;
  }

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
    this.dtCtrl = dt > 1e-6 ? dt : 1 / 60;
    // ⚠ 不在这里 resetVip()：延迟环形缓冲必须**跨拍连续**，否则 δ 永远取不到历史。
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
    this.tgtOut.set(out);      // ★ 见 `tgtOut` 的注释：送达值由仲裁器自己存
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
      cmdShiftPushTau: this.shiftPushTau, shiftErrZ: this.shiftErrZ,
      shiftDemandF: this.shiftDemandF, shiftDriveSide: this.shiftDriveSide,
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
      state: this.state, stateT: this.stateT,
      verified: this.verified, violations: this.violations.map((v) => ({ ...v })),
      safe: this.safe, lastSwing: this.lastSwing, cycleCount: this.cycleCount,
      lastMove: this.lastMove ? { ...this.lastMove } : null,
      stateStats: { ...this.stateStats },
      telemetry: { ...this.telemetry },
      loadBearer: this.loadBearer, supportLeg: this.supportLeg(), swingLeg: this.swingLeg(),
      locked: { ...this.locked }, authority: this.authority,
      com: { ...this.com }, dcm: { ...this.dcm }, support: { ...this.support },
      qVip: this.qVip, ankleTauVip: this.ankleTauVip, ankleTauSat: this.ankleTauSat,
      hipTauStiff: this.hipTauStiff,
      vipOn: this.vipOn, vipGamma: this.vipGamma, vipTCross: this.vipTCross,
      vipOmega: this.vipOmega, vipSwitches: this.vipSwitches,
      vipOffShrink: this.vipOffShrink, vipOffGrow: this.vipOffGrow,
      mos: this.mos, grf: { ...this.grf }, grfCmd: { ...this.grfCmd }, pelvicLift: this.pelvicLift,
      frontLegSide: this.frontLegSide, rearLegSide: this.rearLegSide,
      captureX: this.captureX, captureZ: this.captureZ, omega0Val: this.omega0Val,
      swingClearance: this.swingClearance,
      waistTrim: this.waistTrim, waistGapM: this.waistGapM, waistErrLat: this.waistErrLat, hipLatTau: this.hipLatTau,
      shiftDemandF: this.shiftDemandF, shiftDriveSide: this.shiftDriveSide,
      shiftPushTau: this.shiftPushTau, shiftErrZ: this.shiftErrZ,
      keyPose: this.keyPose, gaitKey: this.gaitKey, strideRatio: this.strideRatio,
      supportEntryZ: this.supportEntryZ,
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
      channels: { motorTarget: this.tgtOut.slice(), torqueOut: this.tauOut.slice() },
      qp: this.qpTick ? {
        feasible: this.qpTick.feasible, residual: this.qpTick.residual,
        fDesX: this.qpTick.fDesX, fDesZ: this.qpTick.fDesZ,
        xiX: this.qpTick.xiX, xiZ: this.qpTick.xiZ, grfSat: this.qpTick.grfSat,
        names: this.qpTick.names.slice(), tau: this.qpTick.tau.slice(),
      } : null,
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