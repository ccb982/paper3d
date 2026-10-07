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
 * ★★ 力链的**原始传感器读数**提供者（由 `Controller` 安装，**状态机调用**）。
 *
 *   分工（用户 2026-10-06：「力链的分析放在状态机里」）：
 *     · `ForceSource` 只负责**读**（鞋底冲量、踝关节世界坐标、质量、力矩上限）；
 *     · **分析**（组装 CoP/GRF/力臂/倾覆力矩/τ 余量、逐态解释、可信度判定）
 *       全部在状态机这一层（`forceChain.ts` 的 `buildGroundChain`）。
 *   与 `JointQuery` 同一模式：读的权限在状态机手里，别人只能读状态机的结论。
 */
export interface ForceSource {
  /** 单脚逐块法向力 + CoP（`Ragdoll.soleForceProfile`，已按**物理步长**换算成力） */
  sole(side: 0 | 1): FootForce;
  /** 踝关节世界 x/z（力臂原点；`Ragdoll.jointWorld`） */
  ankle(side: 0 | 1): { x: number; z: number };
  /** 全身体质量（kg） */
  massKg(): number;
  /** 踝关节可用力矩上限（N·m，矢状 / 额状） */
  tauMax(): { sag: number; lat: number };
  /** 足长（m，CoP 合理性检查用） */
  footLen(): number;
  /**
   * ★ 重心的**水平加速度**（m/s²，已低通；x = 矢状，z = 额状）。
   *   用途：`m·a_com = ΣF_水平`（牛顿第二定律）⇒ 这是**唯一**能拿到真实水平地面
   *   反力的路子。Rapier 的 `contactTangentImpulseX/Y` 实测**恒 0/NaN**
   *   （`probe-footlat` Q1：138 拍 Σ|f_t| = 0.0）⇒ 切向冲量路线已证死。
   */
  comAccel(): { x: number; z: number };
  /**
   * ★★ **侧向支撑多边形**（世界 z，m）：两只脚鞋底包围盒的并集。
   *   这是柔性足侧向能力的**真边界** —— CoM 投影越出它才真的会倒。
   *   （旧实现拿 `tauMax.lat = ankleTau(0)` 去比倾覆力矩是**幻觉**：
   *     踝是 revolute [0,0,1]，轴 0 根本不会动，那个 τmax 背后没有执行器。）
   */
  supportLat(): {
    /** 两脚并集（侧向支撑多边形总边界） */
    min: number; max: number;
    /** 左/右脚各自的鞋底 z 边界（单脚 CoP 权限占用要用自己的半宽） */
    lMin: number; lMax: number; rMin: number; rMax: number;
  };
}

/**
 * ★★★ 平衡系统的**完整修正向量**（一拍一份；用户 2026-10-06 要求）。
 *
 *   「平衡系统是**一次给一个完整的各个关节的修正**」「UI 也要绘制平衡系统给出的修正量」。
 *
 *   实现方式：**在请求入口自动记录**（`requestAngle(..., 'balance', ...)`），
 *   而不是在 `balance.ts` 里手工维护副本 —— 后者会与真实输出漂移。
 *   ⇒ 这份向量**就是**平衡系统本拍实际提出的东西，不多不少。
 */
export interface BalanceCorrection {
  /** 本拍 balance 请求过的轴（未涉及的轴不出现） */
  axes: {
    /** flat 轴下标 = joint*3 + axis */
    axis: number;
    /** 修正量 = 请求目标 − 当前角（rad；正 = 想往正方向转） */
    dTheta: number;
    /** 发起这条修正的标签（`requestAngle` 的 label，直接可读） */
    label: string;
  }[];
  /** 硬目标余量（N·m；< 0 = 该方向必然倒），来自力链 */
  tauMarginSag: number;
  tauMarginLat: number;
  /** 对迈步系统搬运的限幅：0 = 未限幅，1 = 已否决/挡住 */
  transferClamp: number;
  /** 力链是否可信（false 时上面的余量不可信） */
  trustable: boolean;
  trustNote: string;
}

/** 单个鞋底块的接触力（力链的最小分布单元） */
export interface SolePatch {
  /** 块序号 0..6 */
  block: number;
  /** 法向力（N，正值） */
  ny: number;
  /**
   * 切向力**幅值**（N）。
   * ⚠ 只给幅值，不给方向：Rapier 的 `contactTangentImpulseX/Y` 是**接触局部系**
   *   分量，且实测**经常返回 NaN**（`ragdoll.ts:1416` 有记录）⇒ 世界系方向不可靠。
   *   侧向发力的**方向**由 CoP 横移（`copZ − ankleZ`）表达，不由这里表达。
   */
  t: number;
  /** 该块受力点（世界 x / z，m） */
  cx: number;
  cz: number;
}

/** 单脚：CoP + 合力 + 逐块分布。`copValid=false` 时**所有数值为 0**（不兜底）。 */
export interface FootForce {
  /** 有效接触块数 */
  contactN: number;
  /** 竖向合力（N） */
  fz: number;
  /** ★ 力链低通后的**原始（未滤波）标量**，与 `patches` 同源（`Σpatches[].ny === fzRaw`）。
   *  `soleForceProfile` 的原始返回里它们与 `fz/copX` 相同；力链包装后才有差别。 */
  fzRaw?: number;
  copXRaw?: number;
  copZRaw?: number;
  /** 切向合力（N，沿 x） */
  fx: number;
  /** 切向合力（N，沿 z） */
  fzTan: number;
  /** 该脚压力中心 CoP（世界坐标，m） */
  copX: number;
  copZ: number;
  /** ★ 合力太小时 CoP 噪声被放大 ⇒ 标为不可信，**不做兜底** */
  copValid: boolean;
  /** 逐块分布（柔性足 §15 侧向发力要用） */
  patches: SolePatch[];
  // ── ★ 柔性足专用（§15.5：力链必须暴露这四个量）──
  /** **内侧柱**法向合力（N）。分组规则与 `Ragdoll.soleColumnLoad` **完全一致**
   *  （接触点 z ≥ 鞋底包围盒的中位 z = 内侧）—— 不许另立一套口径 */
  colIn: number;
  /** **外侧柱**法向合力（N） */
  colOut: number;
  /**
   * ★ 2026-10-06 **切向合力幅值（世界系幅值，N）**——`fx/fzTan` 是桩字段、
   *   方向不可靠（Rapier 接触局部系 + 常见 NaN），但**幅值** Σ|f_t| 是可信的。
   *   用于：摩擦锥检查（`frictionUse`）、滑移预警；**方向**走 CoP/踝 x 漂移。
   */
  ftMag: number;
  /** ★ 该脚接触点的**滑移速度**（世界系水平速度，m/s，取接触块平均；NaN=无接触） */
  slipV: number;
  /** 摩擦占用 = Σ|f_t| / (μ·Σf_n)；`NaN` = 切向冲量不可用（Rapier 的已知问题） */
  frictionUse: number;
  /** 切向冲量本拍是否有效（false 时 `frictionUse`/`t` 都不可信） */
  tangentValid: boolean;
}

/**
 * ★★★ **单个身体段的运动趋势**（用户 2026-10-06：
 *   「状态机我觉得还得捕捉各个身体的**运动趋势**」）。
 *
 *   为什么必须**逐段**、而不是只看一个 `tiltDeg`：
 *     · 躯干前折 和 整体侧倒 的合成倾角可能一样，但**救法完全不同**
 *       （前折要踝/髋矢状发力；侧倒要髋外展 + 足部旋前/旋后）；
 *     · 趋势还要给**方位**：只知道"歪了 20°"没用，得知道"往哪边歪、还在不在加速歪"。
 *
 *   轴约定（与全局一致）：x = 矢状(前)、y = 竖直、z = 额状(左)。
 */
export interface BodyTrend {
  /** 段名（head/torso/thigh_l/…） */
  name: string;
  /** 相对竖直的倾角大小（deg，0 = 正立） */
  tiltDeg: number;
  /** 倾角速率（deg/s，**正 = 越歪越狠**，负 = 正在回正） */
  rateDeg: number;
  /** 倾斜方位（deg；0 = 朝 +x（前），+90 = 朝 +z（左），−90 = 朝 −z（右）） */
  azimDeg: number;
  /** 是否**正在发散**（倾角在增大且超过判读噪声）⇒ 这一段需要救 */
  diverging: boolean;
}

/**
 * ★★★ **上身发力状态**（用户 2026-10-06：
 *   「先迈步系统给出，然后平衡系统再综合这个给一个最终的上身发力状态」）。
 *
 *   接口形状刻意做成「**姿态 + 由姿态导出的力**」：
 *     · `step`/`bal` 都是**姿态**量（rad）—— 因为"上身要往哪边倾"是两个系统
 *       都能表达、且物理上可加的；
 *     · `final` = `step ⊕ bal`（逐轴夹在 `maxLean` 内）；
 *     · `force` = `m_u·g·(tan(pitch), 1, tan(roll))` —— 上身要"发"的力，
 *       在**上身 CoM** 处作用，脊柱力矩由 `τ=JᵀF` 唯一确定。
 */
export interface UpperBody {
  /** 迈步系统的提案（rad）：矢状俯仰 / 额状侧倾 / 扭转 */
  step: { pitch: number; roll: number; yaw: number };
  /** 平衡系统的需求（rad）：为救平衡要**额外**倾的角 */
  bal: { pitch: number; roll: number };
  /** ★ 最终发布 = step ⊕ bal（逐轴夹紧） */
  final: { pitch: number; roll: number; yaw: number };
  /** 谁最终定的（诊断：'none' | 'step' | 'balance'） */
  decidedBy: string;
  /** balance 对 step 提案的修正量（rad） */
  corrPitch: number; corrRoll: number;
  /** 由 `final` 导出的上身力（世界系 N）：`(m_u·g·tan(pitch), m_u·g, m_u·g·tan(roll))` */
  force: { fx: number; fy: number; fz: number };
  /** 上身质量（kg，来自 `forceChain` 的 spine1 子树）与作用点（上身 CoM，世界 m） */
  mass: number; comX: number; comY: number; comZ: number;
}

/**
 * ★★★ **运动趋势快照**（状态机每拍写；平衡系统只读）。
 *
 *   「在歪倒一定角度之前都可以尝试救回来；歪倒角度过大确实是没救了」
 *   ⇒ `rescueable` 就是这条线；`worstTiltDeg` 是与门槛比较的量。
 */
export interface BodyTrends {
  /** 逐段趋势（head/torso/thigh_l/thigh_r/shin_l/shin_r） */
  segs: BodyTrend[];
  /** 最歪那一段的倾角（deg） */
  worstTiltDeg: number;
  /** 最歪那一段的名字 */
  worstSeg: string;
  /** **还能不能救**：`worstTiltDeg < rescueMaxTiltDeg`。false ⇒ 放弃救、记录死因 */
  rescueable: boolean;
  /** 综合判读（人话，UI 直接渲染） */
  note: string;
}

/** Winter 1996（J Neurophysiol 75:2334）的两条独立控制线 */
export interface ControlLines {
  /** load/unload 线：两脚 CoP 连线（**髋机制**：在两脚间搬运重量） */
  luX0: number; luZ0: number; luX1: number; luZ1: number;
  /** 踝控制线：与 load/unload 线垂直的单位向量（**踝机制**：前后倾） */
  ankleNx: number; ankleNz: number;
}

/** ★ 状态机每拍发布的力链快照（`架构_v2_三模块协作.md` §20.3） */
export interface ForceChain {
  l: FootForce;
  r: FootForce;
  /** 全局 CoP（两脚按法向力加权）—— M/L 平衡的总判据 */
  copX: number; copZ: number; copValid: boolean;
  /** 全局地面反力：**大小与方向**（用户要的"力度和方向"） */
  grfX: number; grfY: number; grfZ: number;
  /** GRF 相对竖直的倾角（deg）——"方向"的可读形式 */
  grfAngleDeg: number;
  lines: ControlLines;
  /** 相对承重脚的踝力臂（**踝力矩的唯一来源**，Usherwood 2012） */
  armSag: number; armLat: number;
  /** 重力倾覆力矩（N·m，矢状 / 额状） */
  toppleSag: number; toppleLat: number;
  /** 踝需求力矩（N·m） */
  tauReqSag: number; tauReqLat: number;
  /** 踝余量（N·m；**负 = 必然倒**） */
  tauMarginSag: number; tauMarginLat: number;
  // ── ★★ 侧向边界（柔性足的真实能力，2026-10-06）──
  //   踝是 revolute [0,0,1] ⇒ **没有额状执行器**；侧向能力来自**足部几何**：
  //   鞋底包围盒的并集就是支撑多边形，CoM 投影越出它才真的会倒。
  //   旧口径 `tauMax.lat = ankleTau(0)` 是幻觉（那个轴不会动）。
  /** 侧向支撑多边形（世界 z，m） */
  latMin: number; latMax: number;
  /** CoM 投影到最近侧向边缘的距离（m；**负 = 已出界 ⇒ 必然倒**） */
  distEdgeZ: number;
  /**
   * ★★★ **脚能给出的最大倾覆力矩**（N·m，几何上限）—— 用户 2026-10-06：
   *   「腰部也要主动发力…**是腿部发力，然后腰部借力才对**」、以及
   *   「收敛到文献中的强度」。
   *
   *   物理：踝/足想移 CoP，但 **CoP 只能在支撑多边形内**（脚只有 ±90mm 宽）
   *   ⇒ 能给的力矩上限 = `Fz × CoP 到边缘的距离`。
   *   实测（`probe-footpush`）：踝力矩 ±120 N·m 时，实际给到 CoM 的**平均**
   *   力矩撞在 **62 N·m** 上 —— 正好 = `687 N × 0.09 m`。
   *   ⇒ 这是**踝策略的天花板**（文献同口径：踝外翻 28 N·m；ML 稳定主要靠落足，
   *     Hof/Vlutters：落足补偿约 10× 于踝策略）。
   *   `momentMaxSag/Lat` 是**当前姿态下还能给多少**（随 CoM 位置变，不是常数）。
   */
  momentMaxSag: number; momentMaxLat: number;
  /** 本拍力链是否经过低通（诊断：false = 原始逐拍值） */
  chainFiltered: boolean;
  /** 单脚 CoP 对侧向权限的占用（±1 = 压到鞋底边缘） */
  copFracLat: { l: number; r: number };
  /** L0 是否可信 */
  trustable: boolean;
  /** 不可信的原因（人话，直接给 UI） */
  trustNote: string;
}

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
  /** ★ 本态的**腿角色 + 锁定声明**（来自 `STATE_LEGS`，UI 只渲染） */
  legPlan: string;
  /** ★ 本态**平衡系统的目标契约**（来自 `STATE_BALANCE_TARGET`；状态机给，UI 只渲染） */
  balanceTarget: string;
  /** ★★ 各身体段的运动趋势逐行读数（状态机生成，UI 只渲染） */
  trends: string[];
  /** ★ **具体是哪条腿**（状态机锁存的角色，UI 的腿卡直接用它，不许自己推断） */
  roleRecv: 'l' | 'r';
  roleSup: 'l' | 'r';
  /** 锁存角色的自由度（`locked` / `grounded-unlocked` / `free`） */
  roleRecvFree: string;
  roleRearFree: string;
  /** 迈步许可（`stepPermit.all`） */
  stepPermit: string;
  /**
   * ★ 当前态的**验收项逐条读数**（已格式化，如 `✓ 承接踝跖屈(足底着平) 7.20`、
   *   `✗ 后脚未离地 0.00/1.00`、`· 承接腿承重(辅助) 0.51/0.60`）。
   *   标记：`✓` 通过　`✗` 未通过（**拦迁移**）　`·` 未通过但**只报告**。
   *   这是"为什么还没进下一态"的完整答案，由状态机生成，UI 不推导。
   */
  sigs: string[];
  /** ★ 力链逐行读数（CoP/GRF/力臂/倾覆/余量/可信度；状态机生成，UI 只渲染） */
  force: string[];
  /** ★ 平衡系统的修正向量逐行读数（本拍 balance 在动哪些关节、动多少；状态机生成） */
  balanceFix: string[];
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

/** ★ τ 通道出口低通的时间常数（s）。`TAUF=0` 关闭（A/B）。 */
const TAU_F = (() => {
  const v = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).TAUF ?? '');
  if (String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).TAUF ?? '') === '') return 0;
  return Number.isFinite(v) && v >= 0 ? v : 0;
})();

/** ★ 前/后腿判定的**迟滞带**（m）：3mm 死区在跌倒期会逐拍翻（门禁 0.033s<0.15s） */
// ★ 2026-10-06 **25→60mm 定稿**：S1 转正后跌段两脚掠过更快（|Δx| 峰值 500mm），
//   25mm 带内仍翻（最短驻留 0.117s < 门限 0.15s）⇒ 60mm：
//   前腿切换 6→2 次、最短驻留 **3.02s** ✓；正常步态落脚差 ≥100mm（Perry）不会误锁。
const FRONT_HYST = (() => {
  const v = Number(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).FRONTHYST ?? '');
  return Number.isFinite(v) && v > 0 ? v : 0.06;
})();

export interface RigStateConfig {
  /** 目标角变化率上限（单位：目标比例/秒）。防止抖。 */
  slewLimit: number;
  /**
   * ★★★★ **启动软斜坡**（用户「读最开始的几帧…是不是用力太狠」的落地）。
   *   实测（`probe-firstframes` 第 0 拍）：角度全 0°、`CoM.y` 0.962 正常，
   *   但 **3 根轴顶 τmax、角速度已 145~436°/s**（`nocontrol` 时只有 1°/s）
   *   ⇒ 那 400°/s 是**第一条控制命令**打出来的（`Δω = τ·dt/I_eff`，一拍就够），
   *     也是 0.22s 重心开跑 / 0.43s 出直立包线的**触发源**。
   *   本项：前 `startupTicks` 个控制拍内，斜率上限与力矩输出都按
   *   `tickNo / startupTicks` 线性放开（0→1）。
   */
  startupTicks?: number;
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
  startupTicks: 30,   // 0.5s @60Hz（开局那一砸发生在头 0.22s）
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
  /** ★ `ANKLE_COP=1` 单主 CoP 律的**上一步 τ**（增量式的状态；N·m）。见 balance.ts 块⑥ */
  ankCopTau: number;
  /** ★ 单主 CoP 律的读数状态：0=未启用 1=正常闭环 2=读数无效(保持上一 τ) */
  ankCopOn: number;
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
  // ══ ★ 信号调理（2026-10-06）═════════════════════════════════════
  //   实测（`probe-readout` ①b②）：**判据要读的信号本身在抖** ——
  //     膝 σ=2.17°（逐拍最大跳 6.04°）、踝 σ=9.35°（跳 21.1°）、
  //     膝角速度 σ=410 deg/s（跳 1069 deg/s）、
  //     `grounded` 逐拍在 `11/01/10` 之间翻转、
  //     载荷读数在**确实有接触**时也常打到「两脚都没受力」的 0.5/0.5 回退值。
  //   而签名门槛只有 6~12° ⇒ **单采样判据在物理上不可能成立**。
  //   下面是给判据用的**调理后**信号 / 诊断量；原始物理量仍然保留。
  /** 接触**去抖后**的接地判定：原始标志连续保持 `groundedHoldSec` 才认（判据专用） */
  gndStable: Record<Side, boolean> = { l: false, r: false };
  /** 本拍接触翻转次数（诊断"接触在抖"；`Controller` 每拍写入） */
  contactFlips = 0;
  /** 关节角**低通后**的值（判据只用它，不用原始 `pos`） */
  angLp: Float64Array = new Float64Array(0);
  /** 原始关节角的逐拍最大跳变（deg）—— 抖动幅度，诊断用 */
  jointNoiseDeg = 0;
  /** 载荷读数落在 0.5/0.5 回退值的占比（0~1）—— 接触模型可信度的代理指标 */
  loadFallbackFrac = 0;

  /**
   * ★ 本周期**到过**的状态（用于画五态环的 `○/✗`）。
   *   只由 `gaitState` 维护；UI 不读它，只读 `telemetry.ring`。
   */
  visited = new Set<WalkState>();
  /** 本周期**验收通过并离开过**的状态（五态环的 `✓`） */
  passed = new Set<WalkState>();
  /**
   * ★ **本周期是否已完成提踵**（踝到过全支撑期最大背屈 +10°）。
   *   Perry 的 `TerminalStance` 起点是「提踵」这个**事件**，而踝角是状态量 ——
   *   光看当前角判不出"有没有提过"。`THRUST` 用它做**顺序约束**：
   *   没提踵就不许进入卸载/蹬离（否则会出现"没提踵就直接蹬"的假推进）。
   *   清零时机：走完一圈（回 `DOUBLE`）时。
   */
  heelRose = false;
  /**
   * ★ **地面反力链快照**（每拍由 `gaitState` 通过 `forceChain.ts` 发布）。
   *   **只有平衡系统读它**；`balance.ts`/`step.ts` 不得自己读接触/CoP
   *   （`probe:readback` 静态门禁强制）。
   *
   *   ⚠ 与 `forceChain()` **方法**（`RigSnapshot.forceChain`）不是一回事：
   *     那个是**关节传递力**（每关节下方子树的力，UI 的"力链"面板用，自下而上）；
   *     这个是**脚底→GRF→力矩**的平衡力学链（CoP / 力臂 / 倾覆力矩 / τ 余量）。
   *     `架构_v2_三模块协作.md` §20.2 的六层指的是这一个。
   */
  groundChain: ForceChain | null = null;

  // ══ ★★ 角色锁存（文档 §3.2：「锁定期内支撑腿**恒定**」）══════════════
  //   用户 2026-10-06：「承重腿、前后腿应不该允许状态机随意切换，仅此而已」。
  //
  //   ⚠ 实测缺陷：`recv/rear/sup` 原来**每拍重算**（`lastSwing ?? frontLeg()` +
  //     载荷迟滞），而判据全部用它们当被测对象 ⇒ **态中途会换腿**。
  //     证据（`probe-domain`，t=0.39→0.40 一拍）：
  //       承接踝跖 −2.44° → **+11.88°**（Δ=14.31°/16ms）、承接膝屈 4.89° → 14.51°、
  //       承接载荷 0.726 → 0.280 ⇒ 三项判据"一瞬间全过"，而**关节根本没动**：
  //       前后两拍都是 ±0.1°/拍 的平线。变的只是"被测的是哪条腿"。
  //
  //   ⇒ 角色在**进态时锁存**，态内恒定；只有迁移到新状态那一拍才重解析。
  //     这也让文档里「`frontLeg()` 只在 t=0 做一次性引导」真正成立
  //     （原实现是每拍都引导，等于每拍都重新掷骰子）。
  /** 角色锁存所属的状态（与 `state` 不同 ⇒ 需要重解析） */
  rolesState: WalkState | null = null;
  /** 锁存的承接腿（= 本周期要成为承重腿的那条；`front` 同义） */
  roleRecv: Side | null = null;
  /** 锁存的承重腿（`VERIFY` 与两个系统取固定目标） */
  roleSup: Side | null = null;
  /**
   * ★ 锁存的**摆动腿**（= 往前迈的那条）。与 `roleSup` **互补**，
   *   交换点固定在「摆动腿落地」（见 `gaitState` 的角色块）。
   *   用户 2026-10-06：「往前迈的是摆动腿。一个承重腿，一个摆动腿。」
   */
  roleSw: Side | null = null;
  /** ★★ 平衡系统的完整修正向量（每拍由 `balanceSystem` 重置并记录） */
  balanceFix: BalanceCorrection = {
    axes: [], tauMarginSag: 0, tauMarginLat: 0, transferClamp: 0,
    trustable: false, trustNote: '未运行',
  };

  /** ★ 力链原始读数源（`Controller` 安装；`gaitState` 每拍调用） */
  forceSrc: ForceSource | null = null;

  /** ★ 状态机遥测（每拍由 `gaitState` 填写；UI 只渲染它） */
  telemetry: StateTelemetry = {
    stateLabel: '—', state: 'DOUBLE', stateT: '0.00', verified: '—',
    support: '—', swing: '—', contact: '—', bearerLoad: '—', loadFrac: '—',
    mos: '—', pitch: '—', roll: '—', alpha: '0.00', clearance: '0',
    sagRecv: '—', recvPeak: '—', domainWorst: '0.0', stepPermit: '—',
    ring: STATE_ORDER.map(() => '○'), next: '—', wait: '0.00s', blocked: '无',
    legPlan: '—',
    balanceTarget: '—',
    trends: [],
    roleRecv: 'l', roleSup: 'l', roleRecvFree: 'locked', roleRearFree: 'locked',
    sigs: [],
    force: [],
    balanceFix: [],
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
  /**
   * ★★★ **上身发力状态**（用户 2026-10-06 定调）：
   *   「迈步系统和平衡系统的**上身发力都需要好好设计**」
   *   「顺序是**先迈步系统给出，然后平衡系统再综合这个给一个最终的上身发力状态**」
   *
   *   ── 为什么做成"一个力"而不是"各轴各写各的" ────────────────────
   *   用户原话：「力是从脚、从腿往上传的，**盲目发力就是会折腰**」。
   *   实测（`probe:upforce`）：迈步只要求躯干 0.0°，而 `spine1/2` 的力矩
   *   被块⑤的**侧向搬运链**顶到 **−120 N·m（= τmax）** —— 那就是"盲目发力"。
   *
   *   ⇒ 上身的输出 = **上身 CoM 处的一个力** `(fx, fy, fz)`，
   *     脊柱各轴力矩由 `τ = JᵀF`（虚功）**唯一确定**，不存在"第二套分配"。
   *     `pitch/roll` 是同一件事的姿态表达：`fx = m_u·g·tan(pitch)`。
   */
  upperBody: UpperBody = {
    step: { pitch: 0, roll: 0, yaw: 0 },
    bal: { pitch: 0, roll: 0 },
    final: { pitch: 0, roll: 0, yaw: 0 },
    decidedBy: 'none',
    corrPitch: 0, corrRoll: 0,
    force: { fx: 0, fy: 0, fz: 0 },
    mass: 0, comX: 0, comY: 0, comZ: 0,
  };
  /**
   * ★★ **救回门槛**（deg）。用户 2026-10-06：
   *   「我觉得在歪倒一定角度之前都可以尝试救回来，歪倒角度过大确实是没救了」。
   *   语义：最歪那一段的倾角 < 它 ⇒ `trends.rescueable = true`，平衡系统**全力救**；
   *        ≥ 它 ⇒ 放弃救（继续挣扎只会让倒地姿态更乱、更难归因）。
   *   取值 25°：人类躯干倾角超过 ~25° 后踝策略已无望、必须迈步（Runge 1999 的
   *   平台速度扫描也是这个量级），而本 rig 的迈步还不成熟 ⇒ 先按"救不回来就算了"。
   */
  rescueMaxTiltDeg = 25;
  /**
   * ★★ 趋势用的**静姿态参考**（每控制器首拍捕获）。
   *   为什么必须相对静姿态：**肢体本来就不竖直**（大腿静姿就 8~17°"歪"着），
   *   拿绝对倾角当"歪倒程度"会永远选中大腿当最歪段（实测前 0.75s 全是"左大腿"）。
   *   ⇒ 趋势量 = 当前"上"向量与**静姿态**"上"向量的夹角 = 真实的姿势偏离。
   */
  trendRest: Float64Array | null = null;
  /** ★★ 各身体段的运动趋势快照（`Controller` 每拍写；平衡系统只读） */
  trends: BodyTrends = {
    segs: [], worstTiltDeg: 0, worstSeg: '—', rescueable: true, note: '未运行',
  };
  dcm = { x: 0, z: 0 };
  /**
   * ★★★★ **摔倒方向预测**（§22.19.4 第①步；`systems/fallGuard.ts` 每拍写、**纯读**）。
   *   用户：「**想后倒的时候脚后跟是需要发更大的力的**」「需要一个**预测摔倒方向
   *   从而在对应方向发力**的模块」。
   *   ⇒ 本对象是那个模块的**唯一回读出口**：方向 / 紧迫度 / 象限 / 该方向的可用权限。
   */
  fall = {
    ran: 0,
    /** 支撑面有效（两侧都没着地 ⇒ false，此时其余字段不可信） */
    valid: false,
    /** 捕获点（XcoM）水平坐标 */
    px: 0, pz: 0,
    /** 支撑面边界（由实测脚中心 ± 脚半尺寸） */
    xMin: 0, xMax: 0, zMin: 0, zMax: 0,
    /** 四个方向的余量（m，正 = 还在支撑面内） */
    mFront: 0, mBack: 0, mLeft: 0, mRight: 0,
    /** 最紧的那个余量（m） */
    margin: 0,
    /** 紧迫度 0..1（0 = 稳；1 = 已到边界） */
    urgency: 0,
    /** 方向单位向量（水平面，支撑中心 → 捕获点） */
    dirX: 0, dirZ: 0,
    /** 方位角（度）：0 = +x（前），+90 = +z（左） */
    dirDeg: 0,
    /** 象限（余量最紧的方向；余量足够时 = 'center'） */
    region: 'center' as 'front' | 'back' | 'left' | 'right' | 'center',
    /** 该方向的**可用权限**（相对前向 = 1.0；见 `DIR_AUTHORITY`） */
    authorityScale: 1,
    /** 人话判读 */
    note: '未运行',
    /** ★★★ 三档模式（用户：「各向摔倒都要有明确的应对机制」） */
    mode: 'normal' as 'normal' | 'warn' | 'emergency',
    /** ★★★ 应急时**解除角色分离**（「别管承重腿摆动腿了，优先稳住身体」） */
    roleSuspended: false,
    /** 连续处于 emergency/warn 的拍数（滞回与回读用） */
    emergencyTicks: 0,
    warnTicks: 0,
  };
  /** ★★★ 摔倒应急响应的本拍状态（`balance` 块⑩ 写；逐帧回读用） */
  /** ★ 显式 CoP 整定的目标/误差（m，逐帧回读） */
  copWantX = 0;
  /** ★ τ 通道出口低通的状态（逐轴）—— 见 `arbitrate` 里的 `TAUF` 说明 */
  tauFilt: Float64Array = new Float64Array(0);
  /** ★ 矢状力一阶低通的状态（N）—— 见 `wantedForce.ts` 的 `SAGF_TAU` */
  sagFilt = 0;
  /** ★ 承重腿模块的遥测（τ 三轴 + 水平/竖向需求力） */
  supLegTau = { hip: 0, knee: 0, ank: 0, Fh: 0, Fv: 0 };
  /** ★ 实测的腰折角（`spine1..3/2` 之和，度；正=前折）——回直项的输入，供回读 */
  waistFoldDeg = 0;
  /** ★ 承重腿模块的"方向 → 足部区域发力"持续偏置（N·m，带速率限幅）——回读 */
  supLegToe = 0;
  /** ★ 转移"点到为止"的**锁存**：同一轮交接内一旦达标就永不再推（`step.ts` ⓪） */
  shiftDoneLatch = false;
  /** ★ 腰·重心调整（CoM 速度 → 上身躯干倾）的命令值（度），供回读 */
  trunkComPitch = 0;
  trunkComRoll = 0;
  /** ★ balance 本拍算出的期望地面反力（供唯一姿势模块读侧向分量；1 拍滞后无妨） */
  wantF: { fx: number; fy: number; fz: number; comp?: { lateral: number; sagittal: number } } | null = null;
  /** ★ 侧向并轨（LATSRC）：由 copPlan 算出的侧向力（N），回读用 */
  latPlanF = 0;
  /** ★ 吊索→tone 并轨因子（TONEMERGE）：spineDefaultTone 的 K 乘子（0=原行为） */
  slingTone = 0;
  /** ★ 陷波器状态 [x1,x2,y1,y2]（环路共振抑制；NOTCH） */
  notchX: number[] | null = null;
  /** ★ 四向响应链：响应比例（[RESP_MIN,1]）与需求（m），回读用 */
  respScale = 1;
  respNeed = 0;
  /** ★ rambling 分解状态：DC 滤波（载荷/目标）+ 逐关节 AC 滤波（0=髋 1=膝 2=踝） */
  rambFv = 600;
  rambCop = 0;
  rambAc: (number | undefined)[] = [];
  /** ★ 间歇控制状态（Bottaro/Gawthrop）：不应期计时 + 触发计数 */
  intTimer = 0;
  intFire = 0;
  /** ★ needX/needZ 规划平滑状态（§10.3 待办#1） */
  needXFilt = 0;
  needZFilt = 0;
  /** ★ 剪力 vx 低通状态（根因修复：有限差分速度去噪） */
  fhVxFilt = 0;
  /** ★ 吊索·后功能线（S3）：输出 τ（回读，带侧号） */
  bflTau = 0;
  /** ★ 吊索·force closure（S2）：驱动量与输出（回读） */
  fcDrive = 0;
  fcTau = 0;
  /** ★ 吊索·表层后线（S1）：驱动量（低频持续）与输出 τ（回读） */
  sblDrive = 0;
  sblTau = 0;
  /** ★ 唯一姿势模块·踝 VIP 弹簧（回读） */
  synVipTau = 0;
  /** ★ 唯一姿势模块·侧向输出（回读） */
  synLatTau: { hip: number; ank: number; Fz: number } | null = null;
  /** ★ 协同库·剪力激活量（§22.62：标量 + 低频持续；`want` 供回读） */
  synFh = 0;
  synFhWant = 0;
  /** ★ 腰·重心调整的**限速积分**状态（§22.49 模板：低频量驱动，不跟每拍噪声） */
  trunkComIntP = 0;
  trunkComIntR = 0;
  /** ★ 承重腿模块的折角历史（预先挺腰用）：{d 矢状, l 侧向, vd/vl 低通速率} */
  supFoldPrev: { d: number; l: number; vd: number; vl: number } | null = null;
  /** ★ 锁存所属的承接侧（换侧 = 新一轮 ⇒ 解锁） */
  shiftLatchSide: 'l' | 'r' | null = null;
  /** ★ W1 溢出剪力（N，世界系；`copPlan.over` → `−m·ω₀²·over`，夹摩擦锥）—— 遥测/回读 */
  spillFx = 0;
  spillFz = 0;
  copErrX = 0;
  /**
   * ★★★★★ **监督层分解结果**（`systems/decompose.ts`，§21.11）。
   *   `need*` = clamp(ξ, 支撑面)；`over*` = ξ−need（溢出）；`err*` = need−CoP_obs；
   *   `k*` = 逐轴权限（方向 × (1+urgency)）；`actionability` = 1−|over|/scale。
   *   ⚠ 纯计算：感知层只读、执行层各自消费各自的轴。
   */
  copPlan: {
    valid: boolean; copOk: boolean;
    xiX: number; xiZ: number;
    needX: number; needZ: number;
    overX: number; overZ: number;
    errX: number; errZ: number;
    kX: number; kZ: number;
    urgency: number; region: string;
    actionability: number; fallNeeded: boolean;
    copX: number; copZ: number;
    // ★★★★★ 2026-10-06 **应急落足目标**（用户：「应急的最重要作用是**调整脚位置**，
    //   需要**迅速把脚调整到可支撑的位置**。这是最关键的」）：
    //   落足点 = 捕获点 ξ 截断到"以当前支撑脚为原点的可及范围"（capture-point 落足，
    //   Hof 2005 / Pratt 2006 / Maki & McIlroy 1997 的补偿性迈步）。
    //   `stepX/stepZ` = 相对**支撑脚**的落足偏移（m）；`stepUrgent` = 0..1 紧迫度。
    stepX: number; stepZ: number; stepUrgent: number;
  } | null = null;

  fallResp = {
    on: 0, s: 0, addPitchDeg: 0, addRollDeg: 0,
    needX: 0, needZ: 0, mode: 'normal' as 'normal' | 'warn' | 'emergency',
  };
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
  /** ★ 低通后的**矢状**加速度（m/s²）。与 `comAz` 同一套差分+低通，供力链用 */
  comAx = 0;
  /**
   * ★★★ **迈步系统的原始提案**（用户 2026-10-06：
   *   「迈步系统把自己的命令交给平衡系统，平衡系统再做修正，
   *     然后发布最终命令并且身体能够平衡」）。
   *
   *   每拍由 `requestAngle(..., 'step', ...)` **自动归档**（不必改 `step.ts` 的
   *   任何调用点）。随后 `disposeStepProposals()` 由 balance 决定最终值并**以
   *   balance 的名义重发布**（balance 优先级更高，`request()` 会覆盖 step 的）。
   */
  stepProps: { i: number; rad: number; label: string }[] = [];
  /** 本拍 balance 对 step 提案的处理统计（供 UI/探针回读） */
  disposeStat = { props: 0, republished: 0, overridden: 0, k: 1 };
  /** balance 本拍给迈步提案算出的**风险因子**（1 = 全权，0 = 冻结姿态） */
  disposeK = 1;
  /** 上身发力（块⑧）本拍在脊柱链上下发的量（修正量的模，rad）—— 0 = 没在出力 */
  ubTau = 0;
  /** 骨盆（树根）本拍角速度模（rad/s）—— 盆骨去噪门的输入 */
  pelvisW = 0;
  /**
   * ★★★ **力链低通的状态**（一阶，τ≈80 ms）—— 用户 2026-10-06：
   *   「都做吧」+ `probe-footpush` 实测：脚部载荷**逐拍在内外侧柱之间翻号**
   *   （±300 N·m 的力矩噪声），而有效的**均值力矩只有 ~60 N·m** ⇒ 信噪比 ≈ 0.2。
   *   纯物理/求解器层面压不住（见 §22.11 的扫描表：接触参数/小步长/求解器迭代/
   *   弓刚度/弓阻尼/脚角阻尼**全部无效**）⇒ 唯一出路是**在信号层低通**。
   *   ⚠ 只滤**原始输入**（fz / colIn / colOut / CoP），派生量（力臂/余量/倾覆）
   *     由滤后的输入重算 —— 否则会出现"力矩与力不一致"。
   */
  ffFlt: { fz: number; colIn: number; colOut: number; copX: number; copZ: number; n: number }[] = [];
  /** 低通是否已初始化（首拍直接把原始值填进去，避免从 0 爬升） */
  ffFltInit = false;
  /** 被盆骨去噪门挡住的拍数（诊断：>0 说明门在咬） */
  ubNoiseBlocked = 0;
  /** 块⑧执行次数（诊断：0 = 没跑） */
  ubRuns = 0;
  /**
   * ★★★ **力矩来源逐轴记录**（诊断；用户 2026-10-06「逐帧回读看腰咋发力的」）。
   *   为什么必须有：`arbitrate` 只在 `ownerLabel === '—'` 时才给 τ 记 label
   *   （否则角度主人盖住它）⇒ 实测出现"脊柱 ω 只有 1~4°/s、角度 2°，
   *   而 τ 顶到 ±120 来回翻"却**查不出是谁写的**。
   *   本表在 `requestTorque` 入口无条件记录（最后写入者）。
   */
  tauSrc: { system: string; label: string; value: number }[] = [];

  /**
   * ★★★★ **腰部借力**（用户 2026-10-06：「**平衡系统和迈步系统都走腰部借力才对**」、
   *   「腰部也要主动发力啊。**是腿部发力，然后腰部借力才对**」）。
   *
   *   ── 物理 ──────────────────────────────────────────────────────
   *   腰**不自己产生力**。腿推地 → 水平 GRF → 上身**顺着这个力倾**，
   *   把腿给的力**用**在重心转移上（而不是另算一个目标去顶）。
   *   ⇒ 输入只有一个：**腿产生的水平 GRF**（`groundChain.grfX/grfZ`，已低通 80ms）。
   *
   *   ── 为什么做成"一个共享通道"而不是两边各写 ──────────────────
   *   两个系统都"借"同一份力：**增益相加**、**由同一处算**、**写同一个 `acorr`**。
   *   若各写各的（step 写目标、balance 写修正），就会出现"两边按各自的相位借，
   *   互相抵消"——这正是此前"重心转移拉不回来"的结构原因。
   */
  /**
   * ★★★★ **腰（脊柱）的状态** —— 2026-10-06 重构（`systems/waist.ts`）。
   *
   *   语义：`step` 与 `balance` 只往这里**填意图**（度、域口径），
   *   **唯一发布者**是 `waistSystem` —— 它把「基准 + 迈步名义 + 借力 + 平衡修正」
   *   合成后逐轴写成脊柱的**目标角**。
   *   ⇒ 脊柱永远有人写目标（`axisOwner` 不再是 `bind`），这是"折腰"的结构解。
   */
  /**
   * ★ 块⑨ 用的**低通后的关节角速度**（长度 = 轴数；由 `balance.ts` 块⑨ 维护）。
   *   为什么必须低通：`probe-pelvis` 实测骨盆 `|ω|` 250~300°/s ⇒
   *   阻尼项 `D·θ̇ = 26×5.2 ≈ 137 N·m` 远超块⑨ 的 55 N·m 门禁 ⇒ 恒被夹到 ±55
   *   ⇒ 退化成 **bang-bang**（逐帧变号，6~12Hz 自激）。
   */
  waistHoldRateF = new Float32Array(0);

  waist = {
    /** 迈步系统的意图（度；`gain` = 它那一份借力增益，按相位 `authority` 调） */
    step: { pitch: 0, roll: 0, yaw: 0, gain: 0, authority: 0 },
    /** 平衡系统的意图（度；`gain` = 它那一份借力增益） */
    bal: { pitch: 0, roll: 0, gain: 0 },
    /** 本拍腿产生的水平 GRF（已低通）—— 借力的**唯一来源** */
    grfX: 0, grfZ: 0,
    /** 本拍借力项（度，诊断） */
    borrow: { pitch: 0, roll: 0 },
    /** 本拍**实际发布**的目标（度） */
    out: { pitch: 0, roll: 0, yaw: 0 },
    /** 增益和（诊断） */
    kSum: 0,
    /** 本拍是否发布过（0 = 消融/关闭 —— 读回端必须能区分"没发布"与"发布了 0"） */
    published: 0,
  };

  /**
   * ★★★ **修正增量通道**（用户 2026-10-06 定调：
   *   「**迈步系统带着目标调整关节；平衡系统只修正，不考虑目标**」）。
   *
   *   为什么必须**独立于 `req[]`**：`req[]` 每轴只有一个槽、按优先级**覆盖**。
   *   若 balance 直接往 `req[]` 写，它写的就是"目标"而不是"修正" ——
   *   与用户的定调相反，而且会**盖掉**迈步的目标。
   *   ⇒ `acorr[]` 是**相加**通道：`最终 = 目标(req) + 修正(acorr)`，职责不重叠。
   */
  acorr: Float64Array = new Float64Array(0);
  /** 本拍被写过的修正轴（诊断/UI：谁加了多少） */
  acorrStat: { axis: number; delta: number; label: string }[] = [];
  /**
   * ★★★ **逐关节发力门禁**（用户 2026-10-06：
   *   「给每个关节发力做一个门禁，不同关节不同，不得超过上限；
   *     巨量的发力 0.5s 就能直接让身体姿态崩溃」）。
   *
   *   `tauCap[flat]` = 该轴允许的**持续发力上限**（N·m）。**0 = 不设上限**。
   *   在 `requestTorque` **入口**夹紧 ⇒ 任何通道（balance/step/QP/踝 VIP/`τ=JᵀF`）
   *   都不得越过；`Ragdoll.driveMotors` 里还有**第二道**（连位置伺服的 PD 也管）。
   *
   *   为什么不能只靠 τmax：`τmax` 是**解剖/工程极限**（瞬时能扛），
   *   而"站住"是**持续任务** —— 拿 τmax 去站，等于让关节一直在极限收缩。
   *   实测（`probe:firstframes`）：开局 8 根轴顶到 τmax，一个物理步就把髋打到
   *   **645°/s**，全身姿态在 0.5s 内崩掉。
   */
  tauCap: Float64Array = new Float64Array(0);
  /** 被发力门禁夹住的次数（请求口 / 马达口分开记，便于归因） */
  capHits = { req: 0, servo: 0 };
  /** 最近一次被夹的轴与幅度（诊断） */
  capLast = { axis: -1, want: 0, cap: 0, label: '' };
  /** 发力门禁本拍是否启用（`ablate` 含 `forceCap` 时为 false） */
  tauCapOn = true;
  /**
   * ★★ **矢状链 `τ=JᵀF` 本拍下发的力矩绝对值之和**（N·m）。
   *
   *   为什么需要这个回读（2026-10-06）：修 ④c 死代码时，`F.fx` 算得对不对
   *   **不能**从 `grfCmd.x` 判断 —— 实测它精确跟踪到 396N，而关节上一动不动。
   *   必须有一个量能证明"力真的落到关节上了"。0 = 又断了。
   */
  sagJfTau = 0;
  /** 矢状链前馈让位的轴数（`requestHold` 的真实生效数） */
  sagJfHeld = 0;
  /** 上一拍的 vx（算 comAx 用） */
  vxPrev2 = 0;
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
  ankCopTau = 0;
  /** ★ `LATPLAN` 额状 CoP 律的**积分项**（不含静态重力补偿；N·m） */
  hipLatInt = 0;
  /**
   * ★★★★★ **原始（未低通）CoP 与 Fz**，[0]=左 [1]=右（世界 x，m / N）。
   *
   *   为什么必须有：力链（`rs.groundChain`）对 CoP 做了 **`FORCE_FLT_TAU=0.08s`**
   *   的一阶低通（≈12 个控制拍的相位滞后）。把滤波后的 CoP 喂给 CoP 定位律
   *   会产生严重滞后 ⇒ 实测"`err<0` 但 τ 仍按限幅全速上涨"（律在追 12 拍前的旧值）。
   *   ⇒ 控制输入必须是**原始读数**；滤波只配"显示/诊断"用。
   */
  soleCopX: [number, number] = [0, 0];
  /** 原始 CoP 的世界 z（m） */
  soleCopZ: [number, number] = [0, 0];
  /** 原始 CoP 有效性（`copValid`） */
  soleCopValid: [boolean, boolean] = [false, false];
  /** 原始竖直力（N） */
  soleCopFz: [number, number] = [0, 0];
  ankCopOn = 0;
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
  /** ★ 预警包的 urgency（感知层写入；状态机的需求门控消费——架构_v4 §4.5.2） */
  warnUrgency = 0;
  /** ★ 落足偏移的速率限制状态（提案包有界化，用户令） */
  stepSlewHip = 0;
  stepSlewAb = 0;
  /** ★ 方案枚举的判级（§4.10；0=垫脚 1=髋 2=迈步） */
  plansLevel: 0 | 1 | 2 = 0;
  plansBestKind: 'pad' | 'padHip' | 'step' = 'pad';
  shiftDriveSide: Side | null = null;
  /**
   * ★★★ **侧向交接的驱动侧锁存**（用户 2026-10-06：
   *   「**是重心无法完成侧移并保持平衡才不能迈步啊**」）。
   *
   *   实测（`probe-lat`）：`shiftDriveSide` 原先每拍由 `rs.swingLeg()` 现算，而
   *   `swingLeg()` 来自瞬时载荷 ⇒ 载荷在 `0.50/0.50 ↔ 0.68/0.32 ↔ 0.28/0.72`
   *   之间跳 ⇒ **驱动侧每 0.1~0.3s 翻一次**，`hipLatτ` 于是 −78 → +83 → −68 …
   *   ⇒ **往左推一下、再往右推一下，净位移为零**（实测 `CoM.z` 全程 |≤10mm|
   *     而目标要 142mm）⇒ 交接永远达不成 ⇒ 状态机卡在 `LOAD` ⇒ 永远不迈步。
   *
   *   ⇒ 按架构**自己的 B1 纪律「角色必须锁存」**：交接期内驱动侧**只定一次**，
   *     交接完成或离相才解除。
   */
  shiftSideLatch: Side | null = null;
  /** ★ 额状躯干修正的本拍输出（度）与误差（度）—— `probe-lat` 逐帧回读用 */
  trunkRollCmd = 0;
  trunkRollErr = 0;
  /** ★ 矢状躯干姿态修正的本拍输出（度）与误差（度） */
  trunkPitchCmd = 0;
  trunkPitchErr = 0;
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
  readonly nAxes: number;
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
    this.tauFilt = new Float64Array(n);
    this.tgtOut = new Float32Array(n);
    this.tauJ = new Float32Array(n);
    this.forceBuf = new Float64Array(sk.joints.length * 5);
    this.acorr = new Float64Array(sk.joints.length * 3);
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
    // ★★★ 2026-10-06 用户定调：「**让状态机显式决定承重腿、摆动腿。
    //   平衡系统决定是非常充满不确定性的**」。
    //
    //   旧实现是**层层回落**：锁定时取锁定腿 → 否则取 `loadBearer`（载荷迟滞）
    //   → 否则取唯一接地腿 → 否则取载荷优势腿 → 都没有则 `'l'`。
    //   那是**让平衡系统（与噪声）去猜**角色 ⇒
    //     · 起步时载荷在 0.5/0.5 附近抖 ⇒ 谁承重由噪声决定；
    //     · 冻结角色又会让"跟随载荷"的补偿逻辑失效 ⇒ 整机从 t=0 就掉。
    //   ⇒ 现在**只有一个来源**：状态机锁存的 `roleSup`（事件驱动，落地交换）。
    //     载荷测量降级为**只读证据**（`loadDominant()` 仍保留给诊断与遥测）。
    return this.roleSup ?? this.loadDominant();
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
    // ★ 矢状同法（力链的 `fx` 要用；两轴必须**同一套**差分与低通，
    //   否则力链的水平合力与合方向会自相矛盾）
    const rawX = (this.com.vx - this.vxPrev2) / dtPhys;
    this.vxPrev2 = this.com.vx;
    this.comAx = this.comAx * 0.75 + rawX * 0.25;
  }
  swingLeg(): Side {
    // ★ 摆动腿同样由状态机显式决定（与 `supportLeg` 互补）
    return this.roleSw ?? (this.supportLeg() === 'l' ? 'r' : 'l');
  }

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
    // ★★★★★ 2026-10-06 **迟滞带**（门禁：最短驻留 0.033s < 0.15s 的修复）：
    //   死区 3mm 对"静止并齐"够用，但**跌倒/踉跄期**两脚 x 会快速相互掠过
    //   （`|Δx|` 最大 578 mm）⇒ 符号每 2 拍翻一次 ⇒ 前腿标签抖 ⇒ 下游换腿。
    //   修法：把 3mm 死区扩成"**保持上一拍**的迟滞带"（`FRONT_HYST = 25mm`）：
    //   只有新证据超过 25mm 才换边；带内保持 `frontPrev`。
    //   25mm 的选取：正常步态的落脚差 ≥ 100mm（Perry 步长），25mm 不会误锁。
    const H = FRONT_HYST;
    if (dz > H) { this.frontPrev = 'l'; return 'l'; }
    if (dz < -H) { this.frontPrev = 'r'; return 'r'; }
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
   * ★★★ **探针注入口**（生产恒 `null`）：`tools/probe-waist.ts` 用它直接测
   *   「给脊柱写目标/写修正 ⇒ 位置伺服出不出力矩、腰动不动」。
   *   `mode='tgt'` 走 `requestAngle`（写目标）；`mode='corr'` 走 `requestAngleCorr`
   *   （只写增量，验证"没人写目标时修正能否单独挺起腰"）。
   */
  waistInject: { mode: string; deg: number } | null = null;

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
    // ★★ 归档 step 的**原始提案**（见 `stepProps` 注释）：balance 稍后据此重发布。
    //   只归档**角度**写入 —— 力矩通道（`τ=JᵀF`）不走"提案"语义。
    if (system === 'step') this.stepProps.push({ i: joint * 3 + axis, rad, label });
    // ★ 记录 balance 的修正（→ `balanceFix.axes`，供 UI 绘制"平衡在动哪些关节"）。
    //   记录的是**物理量**（目标 − 当前角，rad），不是归一化值 ⇒ UI 可直接显示度。
    if (system === 'balance') {
      const i = joint * 3 + axis;
      const d = rad - (this.pos[i] ?? 0);
      this.balanceFix.axes.push({ axis: i, dTheta: d, label });
    }
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

  /**
   * @param loadBearing ★ 调用方**显式声明**这条力矩是**承重**（该轴位置伺服已让位、
   *   这条力矩就是唯一的支撑路径）⇒ 不夹到 `tauCap`（用户：「承重无上限」）。
   *   ⚠ 默认 **false = 按发力夹**。第一版把"让位"当成自动豁免，结果**上身力**
   *     （块⑧，同样是主动发力）也豁免了 ⇒ `spine2` 弯到 +33°、τ 到 116（实测）。
   *   "我是不是承重"**只有调用方知道**，不能由 `hold` 自动推断。
   */
  requestTorque(joint: number, axis: number, tau: number, system: SystemId, label: string,
    loadBearing = false): void {
    this.claimAxis(joint, axis, 2, system);
    const i = joint * 3 + axis;
    if (i < 0 || i >= this.nAxes) { this.badRequests++; return; }
    // ★★★ 发力门禁（**唯一**一道：主动命令入口）—— 用户 2026-10-06：
    //   「**承重无上限，但是发力有上限**」。
    //
    //   判据的关键是**这根轴本拍由谁承重**：
    //     · `hold[i]` = 该轴位置伺服已让位（只留阻尼）⇒ **力矩通道就是唯一的
    //       承重路径** ⇒ 此时它是"承重"，**不夹**（放行到 τmax，由 `arbitrate` 末端管）。
    //     · 未让位 ⇒ 位置伺服在承重，这条力矩是**额外的主动发力** ⇒ 夹到 `tauCap`。
    //   ⇒ 语义严格对上用户定调：承重（含让位轴的力矩）无上限，发力（叠加项）有上限。
    //
    //   ⚠ 顺序依赖：调用方必须先 `requestHold` 再 `requestTorque`（本文件块④c 如此），
    //     否则同一拍内 `hold[i]` 还是 false、承重会被误夹。
    let v = tau;
    const cap = loadBearing ? 0 : (this.tauCap[i] ?? 0);
    if (cap > 0 && Math.abs(v) > cap) {
      this.capHits.req++;
      this.capLast = { axis: i, want: v, cap, label };
      v = v > 0 ? cap : -cap;
    }
    const cur = this.treq[i];
    this.torqueRequestCount++;
    // ★★★★ 2026-10-06 **同系统相加，跨系统按优先级**（修一处架构级 bug）。
    //
    //   原写法 `if (cur && PRIORITY[cur.system] <= PRIORITY[system]) return;`
    //   对 `balance`（优先级 0）自己也是一样 ⇒ **同一系统内后来者被全部丢弃**。
    //   力矩是**力**，同一系统内多条分量（块④c 的矢状前馈、块⑤ 的横向驱动、
    //   块⑨ 的持续托腰……）必须**相加**，否则：
    //     · 块⑨「持续托腰」登记成功（`tauSrc` 有 label）却**进不了 `tauApplied`**
    //       （实测：加块⑨前后逐轴 τ 逐位相同）；
    //     · 而且"谁先跑到谁赢"取决于代码顺序 —— 一个纯粹的顺序陷阱。
    //   ⇒ 同系统：**累加**（并保持首次的系统/标签，便于回读"谁在出力"）；
    //     跨系统：**高优先级（小数字）压制低优先级**，语义不变。
    if (cur && cur.system !== system && PRIORITY[cur.system] <= PRIORITY[system]) {
      this.tgt[i]!.suppressed.push({ system, label: `${label}(力矩)` });
      return;
    }
    if (cur && cur.system !== system) {
      this.tgt[i]!.suppressed.push({ system: cur.system, label: `${cur.label}(力矩)` });
      this.treq[i] = { value: v, system, label };
    } else if (cur) {
      // 同系统：相加（**不换标签**，标签仍指"首个出力者"，便于逐帧回读）
      cur.value += v;
    } else {
      this.treq[i] = { value: v, system, label };
    }
    let t = this.tauSrc[i];
    if (!t) { t = { system, label, value: v }; this.tauSrc[i] = t; }
    else { t.system = system; t.label = label; t.value = v; }
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

  /**
   * ★★★ **迈步提案 → balance 修正 → balance 发布最终值**（用户 2026-10-06 定调）。
   *
   *   「迈步系统把自己的命令交给平衡系统，平衡系统再做修正，
   *     然后**发布最终命令**并且身体能够平衡」
   *
   *   ── 怎么做到"不改 step.ts" ──────────────────────────────────
   *   `requestAngle(..., 'step', ...)` 会自动把每次写入归档进 `stepProps`。
   *   本方法在 `stepSystem` **之后**调用，于是：
   *     · 该轴 balance 自己没提过 ⇒ balance **重发布**（`PRIORITY[balance] > PRIORITY[step]`
   *       ⇒ `request()` 覆盖 step 的），`tgt[].owner` 从 `step` 变成 `balance`；
   *     · 该轴 balance 提过 ⇒ 以 balance 为准（`overridden` 计数）。
   *
   *   ── 修正律（v1）────────────────────────────────────────────
   *        final = 当前实测角 + (提案 − 当前实测角) × k
   *     `k` 是 balance 给的**风险因子**（0..1）：
   *       k=1 ⇒ 直立安全，提案**原样发布**（迈步全权）；
   *       k=0 ⇒ 已到救回门槛，冻结在**当前姿态**（不许再把身体推出去）。
   *     ⇒ 这就是"平衡系统有权力修正、但**不改目标方向**、只是不得太过"的
   *       一般化形式：越危险，迈步的**偏离量**被收缩得越多。
   *
   *   ⚠ 已让位给 `τ=JᵀF` 的轴（`hold[i]`）**不重发布**：那里主人是力矩通道，
   *     再写角度只会制造"写了但被让位掩码屏蔽"的假象。
   *
   * @param k 风险因子 ∈ [0,1]（越界自动夹紧）
   */
  disposeStepProposals(k: number): { props: number; republished: number; overridden: number; k: number } {
    const kk = k < 0 ? 0 : k > 1 ? 1 : k;
    let republished = 0, overridden = 0;
    for (const p of this.stepProps) {
      const j = Math.floor(p.i / 3), a = p.i % 3;
      // ★★ 躯干（脊柱）**不参与 `k` 缩放**（用户 2026-10-06 定调：
      //   「**迈步系统带着目标调整关节；平衡系统只修正，不考虑目标**」）。
      //   躯干的目标是"迈步带着的"，balance 对它的意见走 `acorr`（修正增量），
      //   而不是在这里把目标按风险因子**缩掉**（那是"改目标"，与新定调相反）。
      //   实测：把脊柱一起缩放时「默认（迈步开）」只有 0.99s。
      const nm = this.sk.joints[j]?.name ?? '';
      if (nm.startsWith('spine')) continue;
      const cur = this.req[p.i];
      // ① balance 自己已经写过这根轴 ⇒ 以 balance 为准，不重复发布
      // ② 该轴已让位给力矩通道 ⇒ 角度写了也会被屏蔽
      if ((cur && cur.system === 'balance') || this.hold[p.i]) { overridden++; continue; }
      const now = this.pos[p.i] ?? p.rad;
      const final = now + (p.rad - now) * kk;
      this.requestAngle(j, a, final, 'balance',
        kk >= 0.999 ? `step提案·原样发布(${p.label})` : `step提案·限幅${Math.round(kk * 100)}%(${p.label})`);
      republished++;
    }
    this.disposeStat = { props: this.stepProps.length, republished, overridden, k: kk };
    return this.disposeStat;
  }

  /**
   * ★★★ **迈步系统**提出上身姿态（用户定调的第一步）。
   *   ⚠ 只写 `upperBody.step` —— **不直接下发关节角**（那是 balance 综合后的职责）。
   *   消融：由调用方查 `on('upForce')`（表里登记在脊柱行）。
   */
  proposeUpperBody(pitch: number, roll: number, yaw: number): void {
    // ★ **累积**语义：迈步系统在两个分支里各写一次（关键帧躯干俯仰 + 迈步反相），
    //   每拍在 `beginTick` 清零 ⇒ 这里累加，不覆盖。
    const st = this.upperBody.step;
    st.pitch += pitch; st.roll += roll; st.yaw += yaw;
  }

  /**
   * ★★★ **平衡系统**综合并**发布最终上身发力状态**（用户定调的第二步）。
   *
   *   `final = step ⊕ bal`，逐轴夹在 ±`maxLean`。随后由调用方按 `final` 算力
   *   （`m_u·g·tan(θ)`）并用 `τ=JᵀF` 落到脊柱链 —— 见 `balance.ts` 块⑧。
   *
   *   ★ 为什么刻意**四参而非两参**（Stephens 2007 / Hof 2005）：
   *     支架上的"倾斜"看起来是姿态，**实质是力**：倾 θ ⇒ 上身 CoM 横移 `h_u·sin θ`
   *     ⇒ 对全身 CoM 的贡献 `m_u/m · h_u·sin θ`。所以上限要按**力**来定
   *     （`forceCap` 与 `tauCap` 同一套），而不是按角度拍一个魔数。
   *
   * @param maxLean 允许的额外倾角上限（rad，balance 按力上限反解后传入）
   */
  finalizeUpperBody(corrPitch: number, corrRoll: number, maxLean: number): void {
    const ub = this.upperBody;
    ub.bal.pitch = corrPitch;
    ub.bal.roll = corrRoll;
    const cp = Math.max(-maxLean, Math.min(maxLean, ub.step.pitch + corrPitch));
    const cr = Math.max(-maxLean, Math.min(maxLean, ub.step.roll + corrRoll));
    ub.corrPitch = cp - ub.step.pitch;
    ub.corrRoll = cr - ub.step.roll;
    ub.final.pitch = cp;
    ub.final.roll = cr;
    ub.final.yaw = ub.step.yaw;
    ub.force.fx = ub.mass * 9.81 * Math.tan(cp);
    ub.force.fy = ub.mass * 9.81;
    ub.force.fz = ub.mass * 9.81 * Math.tan(cr);
    ub.decidedBy = (Math.abs(corrPitch) + Math.abs(corrRoll) > 1e-4) ? 'balance' : 'step';
  }

  /**
   * ★★★ **修正增量**（弧度）—— 与 `requestAngle` 的目标**相加**，不是覆盖。
   *
   *   用户定调：「平衡系统**只修正，不考虑目标**」。
   *   ⇒ 平衡系统调用本接口时**不需要知道目标是什么**，它只回答"该再补多少"。
   *   ⚠ 量纲：与 `requestAngle` 一样收**弧度**，内部按量程归一化后累加。
   */
  requestAngleCorr(joint: number, axis: number, deltaRad: number, system: SystemId, label: string): void {
    const i = joint * 3 + axis;
    if (i < 0 || i >= this.nAxes) { this.badRequests++; return; }
    if (!(Math.abs(deltaRad) > 1e-9)) return;
    const def = this.sk.joints[joint];
    if (!def) { this.badRequests++; return; }
    const span = Math.max(Math.abs(def.minRad[axis]), Math.abs(def.maxRad[axis]));
    if (span <= 1e-6) { this.badRequests++; return; }
    this.acorr[i] = (this.acorr[i] ?? 0) + (deltaRad * 0.9) / span;
    this.acorrStat.push({ axis: i, delta: deltaRad, label });
    this.requestCount++;
  }


  private ubPrevRoll = 0;
  private ubPrevPitch = 0;
  /** 全身体重（N）—— 借力的归一化基准（由 Controller 安装） */
  massN = 686.7;

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
    // ★★★★ 2026-10-06 **`holdMask` 必须先清零**（修一处**锁存** bug）。
    //   原写法只清 `holdList`、从不清 `holdMask` ⇒ 一旦某轴被让位过一次，
    //   `holdMask[i]` 就**永久保持 1**，而 `setHoldMask` 把它直通
    //   `driveMotors.holdCmd` ⇒ **该轴的位置伺服永久关闭、只剩阻尼**
    //   （"腿没人管"）。
    //   实测证据：`probe-firstframes` 全程 `让位1`；且**关掉让位门 `sagJfHold` 也无效**
    //   （那时早已锁死）。⇒ 这让"支撑腿的位置控制"在开局几拍后**永久失效**。
    this.holdMask.fill(0);
    for (const h of this.holdList) this.holdMask[h.i] = h.system === 'balance' ? 1 : 2;
    this.holdList.length = 0;
    this.torqueRequestCount = 0;
    this.requestCount = 0;
    this.stepProps.length = 0;
    for (const t of this.tauSrc) { if (t) { t.label = '—'; t.value = 0; } }
    this.acorr.fill(0);
    this.acorrStat.length = 0;
    // ★ 上身提案每拍清零（累积语义，见 `proposeUpperBody`）
    this.upperBody.step.pitch = 0; this.upperBody.step.roll = 0; this.upperBody.step.yaw = 0;
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
    const stT = this.cfg.startupTicks ?? 0;
    const ramp = stT > 0 ? Math.min(1, this.tickNo / stT) : 1;
    const maxStep = this.cfg.slewLimit * dt * ramp;
    // ══════════════════════════════════════════════════════════════
    // ★★★ 三轮分离（2026-10-06 重构，修一处**积分 bug**）
    //
    //   语义必须严格区分两个量：
    //     · **目标** `prevTarget[i]`  —— 位置伺服的参考（**不含**修正）
    //     · **送达值** `out[i]`       —— 真正下发给马达的（**含**修正）
    //
    //   原实现把两者混为一谈（`prevTarget[i] = out[i]`，而 `out` 已叠了 `acorr`）
    //   ⇒ `requestAngleCorr` 从"**偏置**"退化成"**斜坡积分器**"：
    //     实测 `probe-waist`：连写 +10°/3 的修正，0.1 s 后脊柱跑到 8.3°
    //     （偏置应为 ≈2.9°），归一化目标 3 拍涨到 0.31（应恒为 0.104）。
    //   ⇒ 后果：**balance 走的每一处修正都在悄悄积分** ——
    //     这几乎可以确定就是"**任何腰部修正都打崩站立**"（§22.12.5）的机理。
    // ══════════════════════════════════════════════════════════════

    // ── 第 1 轮：**目标**（req 有谁写就用谁，含斜率限制；没人写就保持）──
    for (let i = 0; i < this.nAxes; i++) {
      const r = this.req[i];
      const t = this.tgt[i];
      if (!r || !t) {
        // 没被任何系统提的轴：保持上一拍的**目标**（= 绑定姿态附近），owner 记为 bind
        this.prevTarget[i] = this.prevTarget[i] ?? 0;
        const tt = this.tgt[i]!;
        if (tt.owner === 'none') { tt.owner = 'bind'; tt.ownerLabel = '保持'; tt.tag = 'servo'; }
        // ★★★★★ 2026-10-06 **`BINDHOLD=1`：本拍无人请求的轴 = 真 bind ⇒ 让位**
        //   （只留阻尼，卸掉 K=48 的弹簧——泵能量的正是这些"目标=0=静姿态"的
        //    无人轴。语义与 `holdCmd` 完全一致，只是触发条件从"显式请求"
        //    变成"本拍确实没人写"。）
        {
          const raw = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).BINDHOLD ?? '');
          if (raw === '1' || raw === 'on') {
            const j = Math.floor(i / 3), k = i % 3;
            this.requestHold(j, k, 'balance', '无人请求·让位');
          }
        }
        continue;
      }
      t.value = r.value; t.owner = r.system; t.ownerLabel = r.label;
      t.tag = r.system === 'balance' ? 'hold' : 'step';
      const prev = this.prevTarget[i] ?? 0;
      const d = r.value - prev;
      if (Math.abs(d) > maxStep) {
        this.prevTarget[i] = prev + Math.sign(d) * maxStep;
        t.clamped = true;
      } else {
        this.prevTarget[i] = r.value;
      }
    }
    // ── 第 2 轮：**送达值 = 目标 + 修正**（`acorr` 是偏置，**不写回目标**）──
    for (let i = 0; i < out.length; i++) {
      out[i] = (this.prevTarget[i] ?? 0) + (this.acorr[i] ?? 0);
    }
    // ══════════════════════════════════════════════════════════════
    // ── 第 3 轮：**力矩通道仲裁**（⚠⚠ 2026-10-06 恢复被误删的一段）──
    //
    //   `τ=JᵀF` / 踝 VIP / 髋外展 / 块⑨ 全都靠这里落到 `tauOut`。
    //   我在同日的"三轮分离"补丁里把这一段**整段删掉了**（替换区间没包住它），
    //   后果：`tauOut` **恒为 0** ⇒ **整条力矩通道静默失效**，
    //   而表象是"改了参数却逐位不变"（本轮排查被这个坑骗了很久）。
    //   ⇒ 教训：**改 `arbitrate` 必须回读 `tauOut`/`tauSrc`**，不能只看角度。
    // ══════════════════════════════════════════════════════════════
    for (let i = 0; i < this.nAxes; i++) {
      const r = this.treq[i];
      if (!r) { this.tauOut[i] = 0; continue; }
      const j = this.sk.joints[Math.floor(i / 3)];
      const k = i % 3;
      const tmax = j ? (j.maxTorque[k] ?? 0) : 0;
      let v = r.value * ramp;          // ★ 软斜坡（τ 通道不受位置斜率限制，必须单独放）
      if (v > tmax) v = tmax; else if (v < -tmax) v = -tmax;
      // ★★★★★ 2026-10-06 **τ 通道出口的一阶低通**（`TAUF`，默认 0.04 s）：
      //   用户：「无论重心前移后移、左移右移，脚都得**发力及时调整**」；
      //   而实测（`probe-sagchain`）各轴 τ **每 2~3 拍换向、±120~200 打满**、
      //   `τ·ω>0`（泵） ⇒ **时间平均≈0** ⇒ "抖着救、够不着劲"。
      //   ⇒ 在**唯一出口**做低通（一处覆盖 ④c/承重腿/踝/髋外展/腰 全部写者），
      //     把控制频率的振荡压掉，让"同号持续"成为可能。
      //   ⚠ 代价：引入相位滞后（≈1 个时间常数）——用 `probe-sagchain` 的
      //     `hip τ` 序列验收（目标：**连续 ≥0.3 s 同号**）与 `probe-slip` 真倒。
      //   ⚠ **实测默认关（0）**：`TAUF=0.04` 真倒 3.58 s、`0.08` 5.68 s、**关 6.47 s**
//     ⇒ **相位滞后的代价 > 抖动收益**（低通压了抖动但拖慢了响应）⇒ 默认 0。
//   真正的路是**抬相位裕度**（降增益/改结构），不是出口滤波。
      if (TAU_F > 0 && dt > 1e-9) {
        const kk = Math.min(1, dt / TAU_F);
        this.tauFilt[i] = this.tauFilt[i]! + (v - this.tauFilt[i]!) * kk;
        v = this.tauFilt[i]!;
      }
      this.tauOut[i] = v;
      const t = this.tgt[i];
      // ★ 位置与力矩是**两条独立通道**，来源必须分别记账
      //   （原先只在 `ownerLabel === '—'` 时记 ⇒ 腰部位置写会**遮住** τ 来源，
      //    实测 `probe-pelvis` 显示 `τ:—` 而 `tauApplied = +120`）
      const ts = this.tauSrc[i];
      if (ts) { ts.label = r.label; ts.value = v; ts.system = r.system; }
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
      telemetry: {
        ...this.telemetry,
        force: [...this.telemetry.force],
        sigs: [...this.telemetry.sigs],
        ring: [...this.telemetry.ring],
        balanceFix: [...this.telemetry.balanceFix],
      },
      loadBearer: this.loadBearer, supportLeg: this.supportLeg(), swingLeg: this.swingLeg(),
      locked: { ...this.locked }, authority: this.authority,
      com: { ...this.com }, dcm: { ...this.dcm }, support: { ...this.support },
      qVip: this.qVip, ankleTauVip: this.ankleTauVip, ankleTauSat: this.ankleTauSat,
      ankCopTau: this.ankCopTau, ankCopOn: this.ankCopOn,
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
          // ★★★★★ 2026-10-06 **承重标识改由角色决定**（架构单一真源）：
          //   旧实现取遗留的 `loadBearer`（由 B4 判据授予）⇒ 起步/换腿窗口里
          //   它是 `null` ⇒ `probe-axisown` 的"角色一致性"报 211 条
          //   "没有腿被标承重"。而用户定调「**让状态机显式决定承重腿、摆动腿**」
          //   ⇒ 承重 = `roleSup`（`supportLeg()` 的回退链保证非空）。
          isBearer: (this.roleSup ?? this.loadBearer) === 'l', locked: this.locked.l,
        },
        r: {
          side: 'r', grounded: this.grounded.r, loadFrac: this.loadFrac.r, soleY: this.soleY.r,
          footX: this.soleX.r, footZ: this.soleZ.r,
          cop: { ...this.cop.r },
          isFront: front === 'r', isBack: front !== 'r',
          isBearer: (this.roleSup ?? this.loadBearer) === 'r', locked: this.locked.r,
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