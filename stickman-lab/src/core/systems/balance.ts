/**
 * ══════════════════════════════════════════════════════════════════
 * ④  systems/balance.ts —— **平衡维持系统**（重构版）
 *     作用对象：一条支撑腿 + 腰
 * ══════════════════════════════════════════════════════════════════
 *
 * 纯函数 + 无状态。输入来自 `rigState`（唯一真源），输出是**对 rigState 的需求**，
 * 不直接设 target。合并由 `rigState.arbitrate()` 负责。
 *
 * ── ⚠⚠ 本 rig 的通道权限（`tools/probe-authority.ts` 实测，1 s 开环恒定目标角）
 *   **没有踝关节**（`ankleEnabled=false`）⇒ **没有 CoP 通道**。
 *     矢状面 ΔCoM_x：hip/2 = 363 mm（强）、spine1/2 = 98 mm、knee/2 = 55 mm、肩 = 66 mm
 *     额状面 ΔCoM_z：**只有 spine1/0 = 35 mm**；hip/1（外展）= **0**
 *   ⇒ 矢状面走**髋策略**；额状面只能走**躯干**。
 *   ⇒ **本文件不写踝**。写了也是空转，而且会掩盖"额状面没通道"这个事实。
 *
 *   为什么 hip/1 外展在双脚支撑下 Δz = 0：脚着地时腿横向蹬不动地。
 *   单支撑时摆动腿变成配重，髋外展才可能有权限 —— 但那条腿归迈步系统管，本文件不越界。
 *
 * ── 文献 ────────────────────────────────────────────────────
 *   · 矢状面髋策略：Morasso, Front Comput Neurosci 2022，K_crit = m·g·h，
 *     踝欠临界时由髋（>K_crit 被动刚度）接管。
 *   · 额状面：Liu, J Biomech 2012（髋外展由踝内/外翻平衡；本 rig 无踝 ⇒ 只剩躯干）；
 *     Herr, J Exp Biol 2008：全身角动量靠段间抵消，额状 ~95%、矢状 ~70%。
 *   · 优先级栈：Focchi, Front Robot AI 2020 —— Contact(1) → **Trunk(2)** → Posture(3)。
 *   · 膝近似刚性：Li & Levine, ICRA 2010（小扰动下膝角近似恒定）。
 *   · 单腿保持目标余量：MoS 侧向 −0.025 m、捕获点出域 0.09 s/3.3 s（arXiv:2608.00500）。
 */

import { jointIndexByName } from '../skeleton';
import { computeWantedForce, stanceResolved, DEFAULT_WANTED_FORCE } from './wantedForce';
import type { Ragdoll } from '../ragdoll';
import type { RigState, Side } from '../rigState';

// ══════════════════════════════════════════════════════════════════
// ★★★ **轴归属表（AXIS_OWNERSHIP）—— 平衡系统的唯一真源**
// ══════════════════════════════════════════════════════════════════
//
//  为什么需要它：这轮重构前，同一根轴上有**多个写者**，靠 `priority`
//  参数 + 代码执行顺序决定谁赢。三次实测故障都源于此：
//   ① `hip/1` 同时被 `τ=JᵀF`、手写 `kLatHip` 律、`pelvicLift` 三个写者写
//      ⇒ 后者盖掉前者 ⇒ `maxLateral` 变成**死参数**（80→500N 结果逐位相同）；
//   ② `requestHold(hip/2)`+`requestHold(knee/2)` 有**两份逐字相同的副本**、
//      门控不同 ⇒ 任一份都能单独让位掉唯一撑体重的轴 ⇒ 站 2.35s/2.45s 塌；
//   ③ 「平衡全消融」仍发出 τ[hip/1]=29 N·m ⇒ **消融工具本身在说谎**，
//      当时所有"是哪一条在搞破坏"的判断都不可信。
//
//  规则（由 `tools/probe-axisown.ts` 门禁强制）：
//   · 每个 (关节, 轴) 在表里**恰好一行**；
//   · `mode` 决定该轴走**位置伺服**还是**力矩通道**，二者**互斥**；
//   · 一个轴上出现第二个不同模式的请求 = **冲突**，
//     `rigState` 会拒收并计入 `axisConflicts`（不是静默吞掉）。
export type AxisRole =
  | 'sagSupport'      // 垂直 + 矢状支撑：已验证站满 20s，**位置伺服**
  | 'latTransfer'     // 侧向重心转移：**力矩通道**（唯一写者 = τ=Jᵀ(F_lat)）
  | 'pelvicLift'      // 骨盆抬升：从属于 latTransfer（侧向无需求时才占轴）
  | 'postureSag'      // 腰矢状姿态 PD
  | 'postureLat'      // 腰额状精调（死区 + 限幅）
  | 'ankleCop';       // 踝 CoP 调节

export interface AxisSpec {
  joint: string;
  axis: number;
  role: AxisRole;
  mode: 'pos' | 'tau';
  /** 该轴允许的消融通道名（`ablate`）—— 保证「全关 == 零输出」 */
  channel: string;
  /** 从属轴：有主轴需求时必须让位（`role==='pelvicLift'` 依赖 `latTransfer`） */
  subordinateTo?: AxisRole;
}

/** ★ 髋外展轴的索引 —— **必须是 0**。
 *
 *  骨架三轴口径（`skeleton.ts:405`，唯一真源）：
 *      索引 0 = 绕 X = **外展/侧摆**
 *      索引 1 = 绕 Y = 扭转（绕肢体自身长轴）
 *      索引 2 = 绕 Z = 屈伸
 *
 *  ⚠⚠ 本重构查出：侧向通道一直写在 `axis 1` = **扭转**轴上。
 *    代价（三处症状全由此来）：
 *      ① 侧向力矩几乎为 0 —— 实测 `Fz=100N` 时 `hip/1` 只有 −1.15 N·m
 *         （力臂 11.5mm），而 `hip/0` 有 −11.88 N·m（力臂 119mm），**差 10 倍**；
 *      ② 重心横移几乎不动（148→129mm，且那点改善是 JᵀF 泄漏，不是外展在做功）；
 *      ③ `pelvicLift` 也写 axis 1 ⇒ 它在**拧腿**而不是抬骨盆，
 *         这才是"开 pelvicLift 只活 2.33s"的真因（不是它"抢轴"）。
 *    ⇒ 轴索引错位是这个 rig 的**第二次**同类故障（第一次是脊柱正负号），
 *      所以现在把它写成常量并在轴归属表里显式声明，不再散落字面量。
 */
export const HIP_ABD_AXIS = 0;

export const AXIS_OWNERSHIP: readonly AxisSpec[] = Object.freeze([
  { joint: 'hip', axis: 2, role: 'sagSupport', mode: 'pos', channel: 'hip' },
  { joint: 'knee', axis: 2, role: 'sagSupport', mode: 'pos', channel: 'knee' },
  { joint: 'hip', axis: HIP_ABD_AXIS, role: 'latTransfer', mode: 'tau', channel: 'lat' },
  { joint: 'hip', axis: HIP_ABD_AXIS, role: 'pelvicLift', mode: 'pos', channel: 'pelvicLift', subordinateTo: 'latTransfer' },
  // ⚠ 关节名必须与 `skeleton` 里的**真实名字**逐字一致（`spine1/2/3`）。
  //   曾图省事写 `joint: 'spine'`，而 `axisRole()` 是精确匹配 ⇒ 永远查不到
  //   ⇒ 门禁 E（"每根被写过的轴必须已登记"）直接把这 6 根轴报成未登记。
  //   ⇒ **表看着权威、实际没接上**，这比没有表更坏。
  { joint: 'spine1', axis: 2, role: 'postureSag', mode: 'pos', channel: 'torso' },
  { joint: 'spine2', axis: 2, role: 'postureSag', mode: 'pos', channel: 'torso' },
  { joint: 'spine3', axis: 2, role: 'postureSag', mode: 'pos', channel: 'torso' },
  { joint: 'spine1', axis: 0, role: 'postureLat', mode: 'pos', channel: 'latwaist' },
  { joint: 'spine2', axis: 0, role: 'postureLat', mode: 'pos', channel: 'latwaist' },
  { joint: 'spine3', axis: 0, role: 'postureLat', mode: 'pos', channel: 'latwaist' },
]);

/** 本 rig **没有**踝关节（`skeleton` 的关节表里不存在 `ankle_*`）。
 *  踝 CoP 通道因此恒不执行（`jAnk = jointIndexByName('ankle_l') = -1`）。
 *  保留这条说明是为了让"额状面没有踝通道"这个事实显式可见 ——
 *  `AXIS_OWNERSHIP` 里**故意不列踝**，门禁 E 会因为踝没被写过而通过。
 *  一旦骨架真的加了踝，必须同时在此登记，否则门禁 E 会报未登记。 */
export const ANKLE_ABSENT = true;

/** 取某轴的角色（供门禁与 UI 回读）。找不到 = 未登记 ⇒ 属于架构错误。 */
export function axisRole(jointName: string, axis: number): AxisSpec | undefined {
  const norm = jointName.replace(/_\w+$/, '');   // hip_l → hip、spine1 → spine1
  return AXIS_OWNERSHIP.find((a) => a.joint === jointName)
    ?? AXIS_OWNERSHIP.find((a) => a.joint === norm);
}

export interface BalanceParams {
  /**
   * 膝的**屈曲限位**（deg）—— 超过就顶回来。
   * ★ 不是目标角：站立时膝角近似恒定（Li & Levine 2010），零输出时 PD 已保持绑定角。
   *   实测把它当目标用 ⇒ 只留膝这一条就把存活从"站满 8s"打成 2.6s。
   */
  kneeHoldDeg: number;
  // ── Gear I (position servo): sagittal hip position controller ──────
  /** 矢状髋比例增益（rad/m）。com 前 ⇒ 发负角 = 髋伸 ⇒ 把躯干拉回支撑脚上方 */
  /**
   * ★ 矢状 P 增益，以**自然频率归一化**：`kp = ksagRatio·ω₀²`。
   *   与 `wantedForce` 的 `kXRatio` 同一套约定 —— 姿态下沉时 ω₀ 自动变小，
   *   增益跟着变小，不会变欠阻尼。
   */
  ksagRatio: number;
  /**
   * ★ 矢状阻尼比 ζ：`kd = 2ζω₀`。⇒ 阻尼/位置比 = 2ζ/ω₀ ≈ **0.56**（ζ=0.9）。
   *
   *   ⚠ 原先是手调 `ksagP=1.2 / ksagD=0.1`，比值仅 **0.083**，比正确值小 **6.7 倍**
   *     ⇒ 捕获点前馈形同没有、纯 P 正反馈原样保留。实测 `com.x` 单调发散
   *     到 −0.0415、`com.vx` 递增到 −0.13 m/s；`capX = −0.081 m` 只换来 **3.3°**
   *     髋角，而阻尼项仅 0.75°（P 的 13%）⇒ 压不住。
   */
  ksagZeta: number;
  /** 矢状髋目标角限幅（rad） */
  maxHipDeg: number;
  // -- Gear I (position servo): waist sagittal posture hold --------------
  /**
   * 腰（脊柱）矢状**姿态保持**增益（rad per degree of trunk pitch）。
   *   判据是躯干自己的俯仰角 `rs.pitchDeg`，**不是** CoM 偏差 ——
   *   矢状安静站立里躯干不负责追 CoM（那是踝策略的职责，踝在本 rig 是关的），
   *   躯干这一段唯一该做的就是**保持刚性**。
   *   缺失后果：腰完全无控制 ⇒ 躯干（占体重 49.7%）在自重下前折
   *   （实测 pitch 2.7° → 91.6°，用户 2026-10-03「前后折腰」）。
   */
  kTorsoHold: number;
  /** 腰姿态保持的阻尼（rad per m/s） */
  kTorsoHoldD: number;
  /** 腰矢状目标角限幅（rad）。spine 限位 ±15~25°，超过会顶到软限位 */
  maxTorsoDeg: number;
  // ── Gear I (position servo): waist lateral trim (see long comment) ──
  /**
   * 腰**额状精调**增益（rad/m 横向误差）。
   *   实测：腰把重心推向支撑腿的速率只有 ~1.2mm/度，而需要的横移是 141mm
   *   ⇒ 腰**搬不动**重心（要 118°），只能做精调。
   *   真正搬重心的是地面侧的 `τ=JᵀF`（CoP/GRF 方向），腰负责收尾与卸载髋。
   */
  kWaistTrim: number;
  /** 腰额状精调限幅（rad）。文献步态躯干侧倾 ~5~10°，取 8° */
  maxWaistTrim: number;
  /**
   * 腰额状精调的**死区**（m）：|com.z − stanceZ| ≤ 此值就不推。
   *   这是「**不能太过**」的实现 —— 交接只需 MoS ≥ 0，不需要把重心推到脚心；
   *   没有死区它会一直往里推、撞上 `τ=JᵀF` 限幅把人掀翻。
   */
  waistTrimDead: number;
  // ── 踝（CoP 策略）─────────────────────────────────────────
  /** 矢状面：踝 CoP 比例增益（rad per m）。目标量是**捕获点**，不是躯干角 */
  kCopSag: number;
  kCopSagD: number;
  /** 额状面：踝内/外翻的 CoP 增益（实测权限很弱，只作微调） */
  kCopLat: number;
  /** 蹬离（PUSH 相）跖屈幅度（deg）—— 前 Neurorob 2022 预摆动跖屈 17.2° */
  pushDeg: number;
  maxAnkleSag: number;
  maxAnkleLat: number;
  /** 躯干向支撑腿侧倾的增益（rad/m）：用重力力矩卸载髋（省 15~30%） */
  kTrunkLean: number;
  maxTrunkLean: number;
  /**
   * `τ = JᵀF` 上层的比例增益，**以 ω₀² 为单位**（kX = kXRatio·ω₀²）。
   * 为什么要归一化：ω₀ = √(g/h) 随姿态变（1.0 m 时 3.13 rad/s，0.5 m 时 4.4），
   * 固定 1/s² 的增益在身体下沉时会悄悄变成欠阻尼或不稳定。
   * 1.0 = 临界阻尼的自然选择；实测 2.5（即固定 25）会把人掀翻 tilt 133°。
   */
  kXRatio: number;
  /** 额状水平力限幅（N）。文献静态需求约 49N（Neumann 2010） */
  maxLateral: number;
  /**
   * ★★ **支撑链控制方式** —— 两条路径**彻底互斥**，不允许中间态。
   *
   *   `false`（默认）= **纯位置伺服**：`τ = kP·(θ_ref−θ)·τmax/ωmax`，
   *     力矩通道**完全关闭**。
   *   `true` = **逆动力学**：支撑链让位（`requestHold`，位置环只剩阻尼），
   *     定量支撑全部由 `τ = JᵀF` 给出（**必须**同时含 `weight`=mg）。
   *
   *   ⚠ 半吊子状态（只做一半）会直接软掉，且两次把我引到错误结论：
   *     · 让位了但 mg 没开 ⇒ 既无位置刚度也无定量支撑 ⇒ 腿塌（实测 1.05 s）
   *     · 位置伺服还在、却注入水平 `Fx` ⇒ **水平方向也双计**
   *       （θ_ref 本来就随位移变化、已在抵抗外力）⇒ 实测 2.58 s
   *   ⇒ 所以这不是"两个可叠加的通道"，而是**换挡**。
   */
  torqueControl: boolean;
  /**
   * ★★ 额状面主通道总开关（**只在 `torqueControl=true` 时有意义**），默认关。
   *   架构开关真实接线后的实测：`maxLateral` ∈ {30,60,120,200,500} N ×
   *   `kXRatio` ∈ {0.15,0.4} —— 全部在 1.07~1.48 s 倒，`lat` 关掉则站满。
   *   方向和量级都对（横向偏差 158 → 90 mm）但**伤害身体**，且**与力的大小无关**
   *   ⇒ 是 `τ=JᵀF` 的**力矩分配位置**问题，不是限幅问题。查清前默认关闭。
   */
  lateralEnabled: boolean;
  /**
   * ★★ 额状面**主力 = 支撑髋外展**（走力矩通道、只驱动髋 axis 1）
   *
   *   文献：Horak & Nashner 1986 / Runge 1999 —— 双脚并立时额状面
   *   「a separate **hip load/unload strategy by the hip abd/adductors is the
   *   totally dominant defence**」，踝内外翻肌作用 insignificant。
   *   静态需求 ≈52 N·m（Neumann 2010 / Inman 1947），rig 上限 70 N·m。
   *
   *   为什么只驱动髋：此前 `τ=JᵀF` 分到髋+膝+踝+脊柱，实测**任何限幅**
   *   （30~500 N）都在 1.1~1.5 s 倒，且 30N 与 500N 结果几乎一样
   *   ⇒ 与力的大小无关，是**分配位置**的问题。文献的主力就是髋。
   *
   *   为什么在挡位 I 不算双计：位置伺服在挡位 I 只驱动髋的**矢状轴 axis 2**，
   *   **额状轴 HIP_ABD_AXIS 是空的** ⇒ 在这一轴上用力矩通道不与位置环重复。
   *
   * 📌 **已删除的手写侧向 P 律参数**（重构时清掉，留档以免再犯）：
   *   `kLatHip`(500) / `latHipDamp`(60) / `latHipArm`(0.5) / `maxLatHipTau`(60)。
   *   它们与 `τ = Jᵀ(F_lat)` 在**同一根轴**上并行 ⇒ 后者被完全盖掉，
   *   `maxLateral` 因此变成**死参数**（80N→500N 结果逐位相同、τ 恒 30 N·m）。
   *   现在侧向只有一条路：量级由 `maxLateral` 唯一决定、限幅由该轴 τmax 唯一决定。
   *
   * 髋外展力矩死区（**N·m**，直接是力矩门限）。
   *  ⚠ 原注释写的是「死区（m）」，但它被当力矩用 ⇒ 单位与语义不符。
   *  「不能太过」= 进死区就不推：交接只需 MoS ≥ 0，不需要把重心精确推到脚心。 */
  latHipDead: number;
  /** 支撑髋的**屈曲上限**（rad）。超过就顶回来（防单支撑时整体下蹲） */
  hipExtendLimit: number;
  /** 支撑膝的目标屈曲角（deg）。Li & Levine 2010：站立时膝角近似恒定 */
  kneeStanceDeg: number;
  // ── 骨盆抬升（pelvic hike）────────────────────────────────────────
  /**
   * ★★ 骨盆抬升**固定偏置**（rad，支撑髋外展）。
   *
   *   用户（2026-10-03）：「腰、胯腰在平衡的状态下向上抬一抬，给迈腿留空间」。
   *
   *   机理（Saunders et al. 1953, "The classic index of gait"）：
   *     正常步态**摆动侧骨盆抬高 2~5 cm**，是最小足净空的决定因素之一；
   *     抬高由**支撑侧髋外展**产生 —— 支撑腿外展使支撑侧骨盆下沉、
   *     **对侧（摆动侧）骨盆升高**（Trendelenburg 的反向）。
   *   ⇒ **平衡与迈腿留空间共用同一个执行器**（支撑髋外展）；
   *     不需要另加"提腰"动作：抬骨盆的就是支撑髋。
   */
  kPelvicLift: number;
  /** 骨盆抬升上限（rad）。Saunders 的 2~5cm 对应 ≈2~4°，留到 6° */
  maxPelvicLift: number;
  /**
   * ★ 骨盆抬升的**外环**：目标净空（m）。
   *   判据用**摆动脚净空**这个可直接观测的物理量：不足就往上顶，够了就回落
   *   （不白抬骨盆、不白占额状面权限）。用外环而非固定偏置，是因为所需偏置
   *   随姿态/负载/摆动相位变，开环给不准。
   */
  targetClearance: number;
  /** 净空外环比例增益（rad/m 净空） */
  kClearance: number;
  /**
   * ★ 骨盆抬升的整体符号（+1/−1）。**实测标定**，判据是摆动脚净空：
   *   sign=+1 ⇒ 净空均值 46→72→91 mm、单支撑 3→7→17%、存活 2.47/2.65/2.38 s
   *   sign=−1 ⇒ 净空也高（105~160mm）但**存活明显更差**（1.08~1.97 s）
   *            ⇒ 反号把骨盆抬成了 Trendelenburg（支撑侧下沉）而非对侧抬高。
   */
  pelvicLiftSign: number;
  /**
   * ★ 通道消融（诊断用）：要**关掉**的通道名逗号分隔。
   *   空 = 全开。`probe-balsweep` 用它回答"是哪一条在 destabilize"。
   *   ⚠ 关掉之后其余通道照旧，所以这是"逐条摘除"而不是"单条测试"。
   */
  ablate?: string;
}

export const DEFAULT_BALANCE_PARAMS: BalanceParams = {
  // ★ 旧额状面律（走 spine1/0）保留但**默认不用**：它权限 35mm、需求 100mm ⇒ 发散。
  //   见 §17：主通道已换成支撑髋外展（kHipAbd）。留这个字段是为了可对照消融。
  kneeHoldDeg: 15,
  // Gear I sagittal hip: com forward => negative angle (hip extension)
  maxHipDeg: 0.52,
  ksagRatio: 0.2,
  ksagZeta: 0.9,
  // 腰姿态保持：pitch 20° 时给约 −10°（实测 d(pitch)/d(spine) ≈ 1.9）
  kTorsoHold: 0.02,
  kTorsoHoldD: 0.02,
  maxTorsoDeg: 0.26,
  // 腰额状精调：~0.06 rad/m => 100mm 误差给 5.4 deg，限幅 8 deg，死区 50mm
  kWaistTrim: 0.06,
  maxWaistTrim: 0.14,
  waistTrimDead: 0.05,
  // ★ 符号由实测定（tools/probe-authority.ts，ANKLE=1）：
  //   foot_l/2 目标角 +7.2° ⇒ ΔCoM_x = +22 mm
  //   ⇒ **正角（跖屈，脚尖下压）把 CoP / CoM 往前推**
  //   LIPM：CoP 在 CoM **前方** ⇒ 力矩把 CoM 往**后**拉
  //   ⇒ 要把 ξ 拉回 0（ζ 超前）就要 CoP 前移 ⇒ 踝角 = +k·ξ
  // 闭环在 CoP 上：单位是 m/m = 无量纲 ⇒ 增益就是"角度/误差"
  kCopSag: 6,
  kCopSagD: 0.0,
  kCopLat: 2.0,
  pushDeg: 12,
  maxAnkleSag: 0.20,
  maxAnkleLat: 0.12,
  // 躯干侧倾卸载：朝支撑腿，幅度 ≤8°
  kTrunkLean: 0.35,
  maxTrunkLean: 0.14,
  // 捕获点 → 支撑脚的二阶比例增益（×ω₀²）
  kXRatio: 0.4,
  /**
   * ★★ 额状面主通道总开关。**默认关** —— 架构开关已真实接线后的实测结论：
   *   `maxLateral` ∈ {30, 60, 120, 200, 500} N × `kXRatio` ∈ {0.15, 0.4}
   *   —— **全部**在 1.07~1.48 s 倒；`lat` 关掉则站满。
   *   额状力**方向和量级都对**（重心横向偏差 158 → 90 mm），
   *   但 `τ = JᵀF` 把它分配到支撑链的方式**在伤害身体**，且**与力的大小无关**
   *   （限幅从 30N 到 500N 结果几乎一样）⇒ 不是限幅问题，是**力矩分配位置**问题。
   *   在查清之前默认关闭，不让已知有害的通道进默认路径。
   *   开它请显式设 `lateralEnabled: true`（`ablate: 'lat'` 仍然是可用的消融名）。
   */
  // ★★ 2026-10-04：**打开**逆动力学挡位（地面反力通道）。
  //
  //   动机（实测，tools/_api）：矢状面站不住时**踝在出力但权限不够**——
  //     · 踝 `τ需求 = τ实际`（30~57 N·m，未被削），但踝角只走到 −3°（负向还剩 −10°）
  //     · 捕获点已漂到 −49mm（脚半长 140mm ⇒ **仍在支撑面内、理论上可救**）
  //     · 脚几乎不滑（0.0008~0.008 m/s，摩擦容量约 76N）⇒ **静摩擦在锁住脚**
  //   ⇒ 缺的不是摩擦，是「把 CoP 推到需要的位置」所需的踝力矩。
  //
  //   而 `wantedForce` **早就算出了** `comp.sagittal = 84~141N`
  //   （LIPM 需求同期只要 4→30N，够用），此前因 `torqueControl=false`
  //   ⇒ `shouldTorque()` 直接 return false ⇒ 这 84~141N **从未变成关节力矩**。
  //   现在打开 ⇒ `τ = JᵀF`（Yin & Zhou 2004 / Reitsma 2013）生效，
  //   作用点 CoM、链 = 支撑腿 + 脊柱链。
  //
  //   ⚠ 垂直分量必须同时有效（`comp.weight` 默认已是开的，687 N）——
  //     位置环让位给 τ 通道后，腿不再有位置刚度；若少了 mg 会直接软掉。
  //   ⚠ 这是**平衡系统内部**的事：不新增系统、不碰状态机、不碰迈步系统。
  // ⚠ 2026-10-04 实测：**打开它对矢状面零影响**（`tc=true/false` 逐位相同，
  //   存活 2.2s / |com.x| 959mm / |vx| 1.471 完全一致）。
  //   原因不是漏了开关，而是**轴归属把它排除了**：`τ = JᵀF` 的结果只写
  //   `hip/0`（外展轴）；矢状的 `hip/2`·`knee/2`·`foot/2` 归位置伺服管。
  //   那条 `if (p.torqueControl)` 让位分支是**被有意删掉的**（保留会同轴双计，
  //   轴归属门禁实测 3 处冲突）⇒ `comp.sagittal = 84~141N` 在架构上
  //   **到不了矢状关节**。
  //   ⇒ 矢状面的唯一执行器是位置伺服；它的瓶颈是踝 CoP 权限（见下）。
  torqueControl: true,
  // ★ 额状面主通道**常开**（2026-10-04，按文献 Winter 1995 [H] + Delp 1996 [H]）。
  //   之前默认关着 ⇒ `wantedForce` 里 `comp.lateral ≡ 0` ⇒ 额状面 `τ=JᵀF`
  //   分量恒为 0 ⇒ `motorTarget` 恒定、`com.z` 单调漂到 0.87 m 而无人纠正。
  //
  //   文献依据：
  //     · Winter 1995 [H]：并立站位时 M/L 平衡**完全由髋内/外展肌主导**，
  //       踝内/外翻肌"negligible involvement"（只有并脚站位才反过来）。
  //     · Delp et al. 1996 [H]：髋外展肌力臂 5.6 cm，平衡躯干需 **51 N·m**，
  //       平均能出 **88 N·m**（余量 73%）⇒ 额状面主动力在髋是有余量的，
  //       而踝的横向 τmax 只有 72 N·m 而需求高达 mg×站距半宽。
  //     · Harter et al. 2024 [JRSI]：`τ_align = k_x·(x_fp − x_hp)`，
  //       k_x = 395.7 N，等效于把有效脚点移向髋 44.65%（虚拟 CoP 权限）。
  //
  //   ⚠ 配套约束（代码里已有，不重写）：
  //     · `torqueControl` 仍为 false ⇒ 走**纯位置伺服**，不注入 τ=JᵀF 的定量分量
  //       （`F_desired` 只决定 `θ_ref`）。这避免与位置环双计
  //       （Feng et al. 2014：把 ID 的 q̈ 积分成 q_d 会"rapidly leads to
  //        constraint violation and instability"）。
  //     · 髋额状轴归属唯一：`AXIS_OWNERSHIP` 里 `hip/HIP_ABD_AXIS` 的
  //       `latTransfer`（mode='tau'），腰的 `latwaist` 是**派生精调**通道。
  lateralEnabled: true,
  latHipDead: 8,
  /**
   * 额状水平力限幅（N）。**唯一需要的量级旋钮**。
   *   500N（曾用）= 文献静态需求的 10 倍 ⇒ 把身体掀翻（lat 关 8.47s / 开 1.10s）。
   *   交接只需把重心横移半个站距 ≈164mm ⇒ 静态力 ≈49N（Neumann 2010：
   *   单支撑骨盆水平 52 N·m ÷ 1.06 m 摆高）。所以限幅应贴着需求，不是需求的 10 倍。
   */
  maxLateral: 500,
  // 骨盆抬升：初始偏置 0（由外环自己找到），上限 6°（Saunders 1953 的 2~5cm 对应 ≈2~4°）
  kPelvicLift: 5 * Math.PI / 180,
  maxPelvicLift: 0.105,
  // 净空外环：目标 50mm，实测不足就顶（Saunders 1953 的最小足净空）
  targetClearance: 0.05,
  kClearance: 0.4,
  // ★ 符号**实测标定**（判据 = 摆动脚净空，不是端点扫描猜）：
  //   sign=+1 ⇒ 净空均值 46→72→91 mm、单支撑 3→7→17%、存活 2.47/2.65/2.38 s
  //   sign=−1 ⇒ 净空虽也高（105~160mm）但**存活明显更差**（1.08~1.97 s），
  //            说明反号把骨盆抬成了 Trendelenburg（支撑侧下沉）而不是对侧抬高。
  pelvicLiftSign: 1,
  // 横向 GRF 限幅 500 N（≈0.7 倍体重；静态需求只要 49 N）
  // 髋允许的屈曲上限：绑姿态 ≈0，单支撑时超过就会整体下蹲
  hipExtendLimit: 0.12,
  // 支撑腿伸展刚度与膝目标角
  kneeStanceDeg: 5,
};

/**
 * ★ 平衡维持系统。**并发**每拍跑一次，只提需求。
 * @param rs 唯一状态（读判据/读数，写需求）
 */
const TMP_TAU = new Float32Array(256);
/** `jointWorld` 的接收缓冲（髋外展策略要读髋的世界 z/y 才知道力臂） */
const TMP_JOINT = new Float64Array(3);

export function balanceSystem(
  rs: RigState, p: BalanceParams = DEFAULT_BALANCE_PARAMS, doll?: Ragdoll,
): void {
  const sk = rs.sk;
  const sup: Side = rs.supportLeg();
  // ★ 支撑腿是否已确定：**唯一判定在 `wantedForce.stanceResolved()`**
  //   （此前 `latArmed` 在本文件算一遍、相位机在 gaitState 再算一遍 ⇒ 边界不清）
  const latArmed = stanceResolved(rs);
  // ★ `hip/0`（髋外展轴）本拍的**唯一归属判据**。
  //   侧向转移（τ 通道）与骨盆抬升（位置通道）共用这根轴，必须共用同一个判据，
  //   否则同一 tick 内会出现两种模式 —— 轴归属门禁会报
  //   `hip_r/0 pos←balance vs balance`。
  //   ⚠ 只能看"装不 armed"，**不能**看 |F.fz| 之类量值：重心掠过支撑脚时
  //     F.fz 过零会让归属每拍翻转。
  const latOwnsAbduction = latArmed && p.lateralEnabled;
  const jHip = jointIndexByName(sk, sup === 'l' ? 'hip_l' : 'hip_r');
  const jKnee = jointIndexByName(sk, sup === 'l' ? 'knee_l' : 'knee_r');
  const jSp1 = jointIndexByName(sk, 'spine1');
  const jSp2 = jointIndexByName(sk, 'spine2');
  const jSp3 = jointIndexByName(sk, 'spine3');
  // ★ 踝（`ankleEnabled=false` 时 jointIndexByName 返回 -1 ⇒ 自然跳过，不静默假装在控制）
  const jAnk = jointIndexByName(sk, sup === 'l' ? 'foot_l' : 'foot_r');
  // ★ 不静默失败：这几个关节由 rig.ts 的启动断言保证存在
  if (jHip < 0 || jKnee < 0 || jSp1 < 0) {
    rs.request(-1, 0, 0, 'balance', '骨架缺支撑腿/腰关节');
    return;
  }

  /** 对称限幅。⚠ 只有 2 个参数 —— 用 3 参调用（传 `-m, m`）会把 m 变成负数，
   *  于是一律返回那个负值。曾因此把横向 GRF 恒定钉死在 −500 N（同一个坑当天第二次）。 */
  const clamp = (v: number, m: number): number => (v > m ? m : v < -m ? -m : v);
  const D2R = Math.PI / 180;
  const OFF = new Set((p.ablate ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  const on = (ch: string): boolean => !OFF.has(ch);

  // ★ 支撑腿是否已确定：**唯一判定在 `wantedForce.stanceResolved()`**
  //   （此前 `latArmed` 在本文件算一遍、相位机在 gaitState 再算一遍 ⇒ 边界不清）
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  // 挡位 I：纯位置伺服 —— **矢状与垂直永远走这里**（无条件执行）
  //
  //   ⚠ 这里原来包着一个 `if (p.torqueControl)`：挡位 II 会让位 hip/2、knee/2
  //     把支撑交给 `τ = JᵀF`。该分支**已删除**，因为按 `AXIS_OWNERSHIP`：
  //     τ 通道现在**只驱动 `hip/1`（外展）**，而垂直/矢状归 `hip/2`、`knee/2`
  //     的位置伺服 —— 两者在**不同的轴**上，本来就不需要让位。
  //     保留让位反而制造同轴双计（门禁实测 3 处冲突）。
  //   ⇒ `torqueControl` 现在的唯一含义 = **侧向外展轴的 τ 通道开关**。
  {
    // `τ = JᵀF` 在非侧向分量上完全关闭（见下面那个 lambda），
    // 矢状面**必须**由位置目标提供。
    //   ⚠ 这段控制器我一度删掉过（理由是"两套哲学并存"），结果默认挡位直接丢了
    //     矢状控制 ⇒ 实测腰**向前折** 80.6°、2.45 s 倒（用户 2026-10-03 亲眼所见）。
    //   ⇒ 正确结论不是"删掉位置环控制器"，而是**它们属于另一挡**：
    //     位置伺服挡用位置控制器，逆动力学挡用 `τ = JᵀF`，**两挡互斥不叠加**。
    //   符号（实测标定，tools/_fs）：**髋正 = 屈曲 = 脚往前**；膝负 = 屈曲。
    // ★★★ 矢状髋改用**捕获点**，不再是裸 `com.x`（2026-10-04）。
    //
    //   实测的崩掉机制（tools/_s，2.5s 逐拍）：
    //     · `pitch` 全程只有 3.3° ⇒ 「pitch 74° 饱和」是**倒完之后**的现象，
    //       不是原因（我先前把它当根因是错的）
    //     · `hipTgt = -ksagP·com.x` 是**纯 P**：误差 ∝ 位移、位移 ∝ 速度
    //       ⇒ 构成「位移–速度正反馈」。实测 `com.x` −0.0012 → −0.0683 单调发散，
    //       `com.vx` −0.015 → **−0.197 m/s** 递增
    //     · `ksagD = 0.1` 对 `ksagP = 1.2`（1:12）⇒ 阻尼项太小，压不住
    //
    //   修正：和额状面**同一套律**（`wantedForce.ts` 已在用）：
    //       ξ_x = com.x + com.vx/ω₀     （MacKinnon & Winter 1993 / Houska 1995）
    //       反馈对**捕获点**做 PD ⇒ 速度项变成真正的阻尼（相位提前 90°），
    //       纯 P 的正反馈被消除。
    //   `ω₀ = sqrt(g/h)`，h = CoM 高 − 脚底，与 `wantedForce` 同源。
    //   摆高 h = CoM 高 − 脚底（实测 0.964 m）。LIPM 标准取 `com.y − soleY`，
    //   原代码多减 0.05 m 使 ω₀ 偏小 2.7%（次要，但顺手改对）。
    const om0Sag = Math.sqrt(9.81 / Math.max(0.3, rs.com.y - (rs.soleY[sup] ?? 0)));
    const capXSag = rs.com.x + rs.com.vx / om0Sag;
    const stanceXSag = sup === 'l' ? rs.soleX.l : rs.soleX.r;
    //   ★ 增益按**自然频率归一化**，与 `wantedForce` 的 `kp = kXRatio·ω₀²`
    //     同一套约定（姿态下沉时不会变欠阻尼）：
    //       kp = ksagRatio·ω₀²      kd = 2·ksagZeta·ω₀
    //     ⇒ 阻尼/位置比 = 2ζ/ω₀ ≈ 2×0.9/3.19 ≈ **0.56**（临界阻尼附近）
    //
    //   ⚠ 原来的 `ksagP=1.2 / ksagD=0.1` 比值仅 **0.083**，比正确值小 **6.7 倍**
    //     ⇒ 捕获点前馈形同没有、纯 P 正反馈原样保留。
    //     实测（tools/_s2，`com.x` 走 −0.0026 → −0.0415、`com.vx` 递增到 −0.13）：
    //     `capX = −0.081 m` 只换来 **3.3°** 髋角，而阻尼项仅 0.75°（P 的 13%）。
    const kpSag = p.ksagRatio * om0Sag * om0Sag;
    const kdSag = 2 * p.ksagZeta * om0Sag;
    const hipTgt = clamp(
      -kpSag * (capXSag - stanceXSag) - kdSag * rs.com.vx,
      p.maxHipDeg);
    if (on('hip') && jHip >= 0) {
      rs.requestAngle(jHip, 2, hipTgt, 'balance', '矢状髋(位置挡)');
    }
    // ── 腰（脊柱）矢状**姿态保持** ────────────────────────────
    //   ⚠ 这段控制器我重构时当"手写 P 控制器"删掉了，**没有替代物** ⇒
    //     腰在挡位 I 里**完全无控制**，躯干（占体重 49.7% 的长体）
    //     在自重下前折 —— 用户 2026-10-03 亲眼所见「前后折腰」，
    //     实测 pitch 2.7° → 91.6° 单调增长。
    //   （同一个错误我在髋上犯了又修，这次是腰。）
    //
    //   ★ 判据用**躯干自己的俯仰角** `rs.pitchDeg`，**不是** CoM 偏差：
    //     矢状安静站立里躯干不该去追 CoM —— 那是踝策略的职责
    //     （Horak & Nashner 1986：踝策略 = 身体整体绕踝的倒立摆，
    //       躯干不参与）。踝关着 ⇒ 躯干这一段唯一该做的就是**保持刚性**。
    //
    //   符号（实测，tools/_sp：腿自由、人在空中、只给 spine1 矢状角）：
    //     spine1 +10.2° ⇒ 躯干 pitch +21.3°   ⇒ **脊柱正 = 躯干前倾**
    //     spine1 −11.1° ⇒ 躯干 pitch −25.1°
    //     spine1 ±20° ⇒ 实际只到 ±14°（**τmax=120 N·m 处饱和**）⇒ 俯仰权限约 ±45°
    //   ⇒ 前倾（pitch>0）用**负**脊柱角去顶。
    // ★★ 腰矢状姿态保持：**PD**，阻尼项用**俯仰角速度**而不是 CoM 速度。
    //   之前用 `-kTorsoHoldD * rs.com.vx` 是量纲错的（CoM 速度 ≠ 躯干俯仰角速度），
    //   等于没有阻尼 ⇒ 纯 P ⇒ 指令打到 spine 限幅饱和 ⇒ 过冲 ⇒ 折向翻转
    //   （实测峰 |pitch| 在所有增益下都是 80~86°：+80° 前折、−79° 后折）。
    //   符号（tools/_sp 实测）：**脊柱正 = 躯干前倾** ⇒ 前倾用负角顶。
    //   单位换算：pitchDeg 是度、pitchRate 是度/秒 ⇒ 增益按 度/(度/秒) 理解。
    //  ⚠ 试过 `kTorsoHold 0.02 → 0.10` / `maxTorsoDeg 0.26 → 0.44`：**更糟**。
    //    pitch 只到 3.3° 时腰请求就到 **−52°**，超 spine 限位（±25°）**2 倍**
    //    ⇒ `enforceLimits` 每帧硬拉回，净效果比饱和更差，且与髋反向。
    //    ⇒ 腰矢状保持 `0.02 / 15°`（= 关节限位内、请求不越界）。
    //    矢状稳定交给**矢状髋的捕获点律**（下面 `ksagRatio/ksagZeta`）。
    const spineTgt = clamp(
      -p.kTorsoHold * rs.pitchDeg - p.kTorsoHoldD * rs.pitchRate,
      p.maxTorsoDeg,
    );
    for (const j of [jSp1, jSp2, jSp3]) {
      if (j !== undefined && j >= 0 && on('torso')) {
        rs.requestAngle(j, 2, spineTgt, 'balance', '腰矢状姿态保持');
      }
    }

    // ── 腰（额状）精调 + 骨盆载荷转移 ───────────────────────────
    //   用户 2026-10-04：「查腰和盆骨的发力情况…腰和盆骨在平衡保持的
    //   情况下，还要尽可能把重心移到支撑腿上，**而且不能太过**」。
    //
    //   ★ 实测定量结论（tools/_sg2，腿自由、人悬空、开环给角）：
    //       腰 spine1/0：+4°→CoM.z +5mm、+8°→+9mm、+14°→+199mm（失控）
    //       髋 hip_l/1 ：+4°→0mm、+8°→0mm、+14°→+8mm
    //     ⇒ 符号：**腰正 = 把重心推向 +Z**（左脚在 +Z，符号由此标定）
    //     ⇒ **腰搬不动重心**：要把重心从 z=+23mm 搬到支撑脚 z=+164mm（141mm），
    //       按腰的 1.2mm/度需要 **118°**，远超脊柱 ±15~25° 限位；髋外展更弱（0.6mm/度）。
    //     ⇒ 原因是物理的：**脚踩在地上时腰侧倾推不动重心** —— 躯干倾、髋膝代偿，
    //       重心几乎不动（刚性体估算 10° 应给 170mm，实测只给 9mm，差 20 倍）。
    //     ⇒ 那 141mm 必须来自**地面**（CoP 偏移 / 摩擦 / GRF 方向改变）：
    //       0.5 s 移 141mm 只需 a=1.13 m/s²、F≈79 N —— 力很小，但通道是 `τ=JᵀF`。
    //
    //   ⇒ 所以腰/盆骨在这里的职责是三件事（不是搬重心）：
    //       ① **精调**：把残余横向误差收掉（度数小、力矩小，安全）
    //       ② **卸载髋**：朝支撑腿侧倾，把一部分髋力矩转成重力力矩
    //          （Xu & Sher / Horak 2006，报告省 15~30%）
    //       ③ **骨盆抬升**：给迈腿留空间（Saunders 1953，见 `pelvicLift`）
    //
    //   ★「不能太过」的实现 = **死区 + 限幅**：
    //       重心进了容差带（`waistTrimDead`，默认 50mm，与 `handoverTolZ` 同量级）
    //       就**不再推** —— 交接只需要 MoS ≥ 0，不需要把重心精确推到脚心。
    //       再加硬限幅 `maxWaistTrim`（默认 8°，文献步态躯干侧倾 ~5~10°）。
    //       没有死区的话它会一直往里推，撞上 `τ=JᵀF` 的限幅，把人掀翻
    //       （实测额状力开到 500N 时 1.10 s 倒，而关掉能站满）。
    //   ★★★ 目标改成**捕获点余量驱动**，不再是「位置误差 × 手调增益」
    //   （2026-10-04）。理由是实测出来的**系统级矛盾**：
    //     · 额状主通道（`wantedForce`）已经用捕获点 `capZ = com.z + vz/ω₀`，
    //       带死区 50mm、带「到支撑边余量」限幅 ⇒ 三重约束；
    //     · 而腰通道原来只看 `com.z - stanceZ`，**捕获点余量完全不参与**
    //       ⇒ 捕获点已经居中（该停）时腰仍在按位置误差推。
    //     实测：开局捕获点 0.0029（几乎居中）腰就顶到 **−9.2°**（限幅 8°）
    //     ⇒ **腰在和额状通道对着干**，这是「侧移幅度过大」的主因，
    //        不是额状通道的增益。
    //
    //   改法：腰的目标 = f(捕获点离支撑边的余量)，逻辑上与额状通道**同源**：
    //     · 余量充足 ⇒ 目标 0（腰不动，让踝/髋处理）
    //     · 余量不足 ⇒ 腰按差多少推，推到捕获点回中为止
    //   幅度仍受 `maxWaistTrim`（8°，文献步态躯干侧倾 5~10°）硬限幅。
    const stanceZLat = sup === 'l' ? rs.soleZ.l : rs.soleZ.r;
    const dzLat = rs.com.z - stanceZLat;
    const dead = p.waistTrimDead;
    const errLat = Math.abs(dzLat) <= dead ? 0 : (dzLat - Math.sign(dzLat) * dead);
    // 捕获点（与 `wantedForce` 同一套：ξ = z + vz/ω₀）
    const om0Lat = Math.sqrt(9.81 / Math.max(0.3, rs.com.y - (rs.soleY[sup] ?? 0) - 0.05));
    const capZLat = rs.com.z + rs.com.vz / om0Lat;
    //
    // ★★ 基准必须和 `support` 一致，否则整条公式的量纲错位（实测踩过）：
    //   · `rs.support.halfZ` = **并立时各脚足迹宽度平均 / 2**（双脚 ⇒ 75mm）
    //   · `rs.soleZ[sup]`   = **单脚自己的 z**（≈164mm）
    //   ⇒ 拿 75mm 配 164mm 会出现 `dzLat = −161mm` 那种量级错位，
    //     且 `support.cz`（双脚中心）与 `soleZ[sup]`（单脚）**不同基准**。
    //
    //   正确做法：捕获点相对**支撑面包围盒中心**算，用**单脚净半宽**做余量。
    //   · 中心取 `rs.support.cz`（与 `halfZ` 同源，见 `posture.ts:190-206`）
    //   · 单脚净半宽从 collider 拿（足宽 100mm ⇒ 半宽 50mm），退化时用 `halfZ`
    //
    // ★★★ 目标基准 = **承重腿自己的脚心** `soleZ[sup]`，**不是** `support.cz`
    //   （用户 2026-10-04 明确：「这就是我的设计目标，承重腿的目标」；
    //    用户原话：「我不要双脚着地均匀受力的情况，我只想要尽可能重心向一只脚移动」）。
    //
    //   为什么 `support.cz` 是错的：双脚都着地时它是**双脚中点**（实测恒为 0.000），
    //   于是「重心回到支撑面中心」这个目标**恰好就是"双脚均匀承重"**，
    //   控制器会主动把重心推回中点、阻止任何交接。实测后果：
    //     · `com.z` 只走到 −45mm，而 `soleZ.l = +164mm` ⇒ **差 133mm 根本没走过去**
    //     · `MoS` 反而从 84mm 涨到 314mm（脚已倒，但重心回到"双脚中点"，
    //       在**双脚并立**的包围盒里算出来余量"很足"）⇒ MoS 虚高，掩盖了倾倒
    //   ⇒ 换成 `soleZ[sup]`：捕获点必须回到**承重腿正上方**才算出余量充足，
    //     这就是"把重心压到一只脚上"的字面实现。
    //
    //   半宽同样用**单脚净半宽**（足宽 100mm ⇒ 50mm），不是双脚平均值 75mm。
    const supCz = stanceZLat;
    const supHalf = Math.max(0.02, Math.min(rs.support.halfZ, 0.05));
    const capErrLat = capZLat - supCz;
    // 到支撑边的余量（同 `wantedForce` 的 ρ=0.6）
    const marginLat = supHalf * 0.6 - Math.abs(capErrLat);
    // 余量不足的份额 [0,1]：1 = 完全靠腰
    const shortFrac = Math.max(0, Math.min(1, -marginLat / Math.max(1e-3, supHalf * 0.6)));
    // 符号：腰侧倾把**躯干质量**推向它倒的方向 ⇒ 腰角符号 = CoM 要走的方向。
    //   要 `com.z → +soleZ`（左脚）就得腰往 **+Z** 倒（正）。
    //   ⚠ 原精调用的是 `sign(dzLat)`（把 CoM **拉回**原处，符号相反）。
    //     那在"居中即目标"的语义下是对的；换成承重腿目标后它是**反的**
    //     —— 实测腰顶死 −8° 限幅、CoM 一路往 −Z 走到 −45mm，
    //        偏差从 161mm 涨到 208mm，离目标越来越远。
    //   ⇒ 这里是"**移动到**承重腿上方"，不是"拉回中心"，符号必须同向。
    rs.waistTrim = clamp(
      -Math.sign(capErrLat || 1) * shortFrac * p.maxWaistTrim,
      p.maxWaistTrim);
    if (on('latwaist') && jSp1 >= 0 && rs.waistTrim !== 0) {
      // 正 = 推向 +Z（实测标定）。脊柱三段均分 ⇒ 得到自然的弧度而非单段折角
      for (const j of [jSp1, jSp2, jSp3]) {
        if (j !== undefined && j >= 0) rs.requestAngle(j, 0, rs.waistTrim / 3, 'balance', '腰额状精调/卸载髋');
      }
    }
  }
// ══════════════════════════════════════════════════════════════
  //   ⚠ 这里原来**又抄了一份** `requestHold(hip/2)`+`requestHold(knee/2)`
  //     （与上面 L308 那份逐字相同、门控却不同）。两份都能独立触发"让位"，
  //     于是「平衡全消融」仍然让位了唯一撑体重的两个轴 ⇒ 站 2.35s 就塌。
  //     ⇒ 已删除。**让位只有一个地方能做**：L308，按 `AXIS_OWNERSHIP` 判定。

  // ══════════════════════════════════════════════════════════════
  // ② 膝：锁在轻微屈曲。⚠ 本 rig 膝限位 [-145°, +2°] ⇒ **负 = 屈**
  // ══════════════════════════════════════════════════════════════
  // 膝：直接命令到轻微屈曲的**目标角**。kKnee 现在是"偏离目标时往回顶的比例"
  //   ⚠⚠ **膝是单侧守卫，不是"驱向屈曲目标"**（消融实测：只留膝 ⇒ 2.6s 倒；
  //      零输出/只留髋/只留躯干 ⇒ 站满 8s、倾角 0.5°）。
  //   Li & Levine 2010：站立时"膝角近似恒定"；股四头肌**共同收缩**提供腿部刚性
  //   ——那是**刚度**，不是目标角。
  //   而零输出时关节 PD 已经把膝保持在绑定角（本 rig ≈0°），**本来就不需要管**。
  //   ⇒ 只需在**超过屈曲限位**时顶回来，绝不主动命令弯曲。
  const kneeNow = rs.angle(jKnee, 2);
  const kneeLimit = -Math.abs(p.kneeHoldDeg) * D2R;
  // ★ 单支撑时膝要有**主动刚度**（命令到轻微屈曲的目标角），不是只靠越界守卫。
  //   同样必须合并进这一次请求，否则被守卫分支或优先级吞掉。
  if (on('knee') && latArmed && on('stanceExt')) {
    rs.requestAngle(jKnee, 2, -Math.abs(p.kneeStanceDeg) * D2R, 'balance', '支撑膝伸展');
  }
  if (on('knee') && kneeNow < kneeLimit) {
    // ⚠⚠ 必须**直接顶回限位**，不能插值。
    //   原式 `kneeLimit + (kneeNow-kneeLimit)*(1-kk)`：膝屈到 −57°（kneeNow=−1.0）时
    //   算出的目标是 −32° —— **仍然是屈的**，等于自己在命令"保持弯曲"。
    //   实测：躯干从 1.429 塌到 0.512 m（−0.92 m）、`hit=torso`、`tiltDeg=0`
    //   ⇒ 不是侧翻，是**整个蹲下去**。
    rs.requestAngle(jKnee, 2, kneeLimit, 'balance', '膝守卫');
  }
  // ★ 另加**髋伸展守卫**：单支撑时全身体重压在一条腿上，髋若跟着屈就整体下蹲。
  //   髋的矢状面目标本来是 `hipTgt`（随 com.x 修正），这里额外保证它不屈太多。
  //  ⚠ 符号：本 rig 髋/膝限位都是 `负 = 屈`（膝 [-145°,+2°]、髋 [-95°,+100°]），
  //    所以"屈太多"是 **< −limit**，不是 `> +limit`（原式反了，从没生效过）。
  const hipNow2 = rs.angle(jHip, 2);
  if (on('hip') && hipNow2 < -p.hipExtendLimit) {
    rs.requestAngle(jHip, 2, -p.hipExtendLimit, 'balance', '髋屈守卫');
  }

  // ══════════════════════════════════════════════════════════════
  // ③ 躯干矢状姿态：**已并入 `τ = JᵀF` 的脊柱链**
  //   原来这里是手写 P 控制 `sp1Sag = -grfAng·kTorsoAlign - ex·0.8`，
  //   直接给 spine1/2 的目标角，与力矩通道在同一根脊柱上重复控制。
  //   ⚠ 而且它依赖 `rs.grf.x`，而那个值一直**硬编码为 0**
  //     （只有 `grf.y = 686.7×载荷` 是真的）⇒ 这一项一直是"拿 0 当力线角"。
  //   ⇒ 现在躯干姿态由 `τ=JᵀF` 经脊柱链产生，位置伺服在该链让位。
  //   （`grfCmd` 里有真实的命令力向量可回读，见 `grfCmd.x/y/z`。）

  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  // ④ 额状面：**唯一通道 spine1/0**（实测 Δz = 35 mm；髋外展 = 0）
  //   z_com > 支撑域中心 ⇒ 躯干往支撑脚侧倾，把重心搬回来
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  // ④ ★★★ 额状面**主通道 = 支撑髋外展**（重构方案 §17）
  //
  //   文献（MacKinnon & Winter 1993 / Kuo 1999 / Pandy 2010 / John 2012）：
  //     单支撑下重力把 CoM 向内加速，**必须靠支撑髋的外展力矩制止**；
  //     「mediolateral balance cannot be maintained without active control at
  //     the stance-leg hip」；肌肉贡献额状面 GRF 的 >92%（没有被动项）。
  //   静态需求 Neumann 2010 / Inman 1947：M ≈ 58.7kg × 9.81 × 0.09 ≈ **52 N·m**；
  //   本 rig `hip/1` 上限 **70 N·m** ⇒ 硬件够。
  //   机制（van Mierlo 2022/2024）：不是挪 CoP，而是**改 GRF 方向**
  //   ——「CMP 可以合法地跑到支撑面外」。平底刚性脚仍可用：
  //   需要 CoP 偏移 = F_y/F_z，F_y = M/z_com = 52/1.06 = 49 N ⇒ 71 mm < 脚半宽 100 mm。
  //
  //   ⚠ 旧实现把额状面交给 `spine1/0`（实测权限仅 **35 mm**，而单腿站立要横移
  //     约 **100 mm** ⇒ 需求是权限的 3 倍）⇒ 回路必然发散（实测 com.z → ±800 mm）。
  //     而且 van den Bogaart 2023 / Sci Rep 2023 表明**额状面基本不发生段间抵消**，
  //     躯干反向旋转只能贡献 19~31% ⇒ 只能当**修边**，不能当主通道。
  //
  //   ★ 目标必须取**支撑脚自己**（两脚在 z ≈ ±0.10 分开，左右载荷由 CoM.z 决定）。
  //     取支撑域中心（两脚中点 ≈0）时误差只有 0.003 m ⇒ 一条指令都不发。
  // ★★ **门控**：额状面主通道只在**支撑侧已确定**时启用。
  //   理由：髋外展要改变 GRF 方向，必须有一条明确的支撑腿。
  //     双脚支撑且承重未授予时，支撑腿是"两脚中点"，此时外展**无权限却仍在出力**
  //     ⇒ 实测把双脚支撑从"站满 8 s"打成 **1.75 s**（消融全表退化）。
  //   启用条件：已授予承重标识，或已处于单支撑/重心转移相。
  // ★★ 门控：额状面主通道只在**支撑腿已确定**时启用。
  //   `SHIFT` **不算** —— 那是"准备转移重心"的过渡相，此时支撑腿本身还在变，
  //   打开主通道等于在一个还没稳定的构型上施加定量前馈。
  //   实测（未滤波载荷时）：SHIFT 一出现 `τ=JᵀF` 就把支撑髋打到 ±15°，
  //   把双脚支撑从"站满 8 s"打成 1.68 s。
  //   附加条件：载荷必须真的**占优**（>0.55），否则"支撑腿"是噪声挑出来的。

  // ══════════════════════════════════════════════════════════════
  // ④ ★★★ 额状面 = `τ = JᵀF`（重构方案 §18）
  //
  //   ★ 律的来源（这是文献里的平衡律，**不是**"关节角 P 控制"）：
  //     上层只决定**需要的地面反力矢量 F**，关节力矩由虚功唯一确定：
  //         τ_i = û_i · [ (a_i − p) × F ]        （即 τ = JᵀF）
  //     · F 的来源：倒立摆 / Houska balance point（MacKinnon & Winter 1993）
  //         F_y = m·( z_c·a_des − x_c·a )，其中 x_c 是捕获点、z_c 是摆高
  //     · 关节分配：Yin & Zhou 2004 / Horak 2006 / Reitsma 2013 / van Mierlo 2022
  //       —— 按**力臂几何自动分配**，没有可调的符号旋钮
  //     · CoP 不是被"调"的量：给定 F_y，CoP 偏移 = (z_c−CoP_z)·F_y/F_z
  //       （van Mierlo 2022/2024：改的是 GRF 方向，CMP 可以合法出支撑面）
  //
  //   ★ 为什么必须换掉旧的"关节角 = P·ΔCoM.z"：
  //     那条律的符号与增益完全由被控对象决定，护栏一改就翻面
  //     （实测：髋权限 0.52 时 sign=−1 收敛，权限 1.00 时 sign=+1 才收敛）。
  //     `hipAbdSign` 这个旋钮在新律里**不存在** —— 已删除。
  if (latArmed && doll) {
    // ★★ 上层：算 `F_desired`。矢状/额状/垂直/躯干侧倾全部走这一个对象，
    //   消融开关（`sag` / `lat` / `weight` / `trunkLean`）**每一个都真实接线**
    //   到下面的求和 —— 此前 `lat`/`invDyn`/`ankleSag`/`ankleLat` 是死开关，
    //   导致所有"额状面有没有害"的对照实验作废。
    const F = computeWantedForce(rs, {
      ...DEFAULT_WANTED_FORCE,
      kXRatio: p.kXRatio,
      kTrunkLean: p.kTrunkLean,

      maxLateral: p.maxLateral,
    }, (ch: string) => {
      // ★★★ 两条控制路径**彻底互斥**，不允许半吊子状态：
      //
      //   `torqueControl = false`（默认）⇒ **纯位置伺服**。
      //     位置伺服的 `θ_ref` 本来就随位移变化、已经在抵抗外力
      //     （`τ = kP·(θ_ref−θ)·τmax/ωmax`）。此时再注入 `τ = JᵀF` 的
      //     **任何**分量都是**双计** —— 水平方向同样如此。
      //     实测：注入 `Fx=196N` 时单腿只活 2.58s，关掉才恢复。
      //   `torqueControl = true` ⇒ **逆动力学**。
      //     支撑链让位给 `τ = JᵀF`（`requestHold`，位置环只剩阻尼），
      //     定量支撑**全部**由虚投影给出，因此 `weight`(=mg) 必须同时开
      //     —— 否则既无位置刚度也无定量支撑，腿直接软掉（实测 1.05 s）。
      if (!p.torqueControl) return false;
      if (ch === 'lat') return p.lateralEnabled && on('lat');
      return on(ch);
    });
    rs.grfCmd.x = F.fx; rs.grfCmd.y = F.fy; rs.grfCmd.z = F.fz;
    rs.captureX = F.captureX; rs.captureZ = F.captureZ; rs.omega0Val = F.omega0;

    // 下层：唯一的分配规则 `τ = JᵀF`（Yin & Zhou 2004 / Reitsma 2013）。
    //   作用点 = CoM；链 = 支撑腿（髋/膝/踝）+ 脊柱链（躯干姿态）。
    //   ⚠ 脊柱链必须在链里：额状面的力矩要靠躯干/骨盆姿态才能产生净效应，
    //     少了它 `τ=JᵀF` 只会去拧腿（实测髋/1 钉在 ±70 N·m 而 com.z 不动）。
    const chain: number[] = [];
    for (const nm of [`hip_${sup}`, `knee_${sup}`, `foot_${sup}`, 'spine1', 'spine2', 'spine3']) {
      const i2 = jointIndexByName(rs.sk, nm);
      if (i2 >= 0) chain.push(i2);
    }
    doll.jacobianTorque(F.fx, F.fy, F.fz, rs.com.x, rs.com.y, rs.com.z, chain, TMP_TAU);
// ★★★ 单腿**髋外展策略**（Horak & Nashner 1986「separate hip load/unload
    //   strategy ... the totally dominant defence」；定量见 Neumann 2010 /
    //   Inman 1947 / Pandy 2010），作用在 `hip_${sup}/${HIP_ABD_AXIS}`。
    //
    //   ⚠⚠⚠ **不要用 `τ = JᵀF`（横向力）做这件事。** 实测本 rig 髋锚点与整机
    //     CoM 只差 **12 cm**（CoM.y=0.965、髋≈0.85，力臂 0.119 m）：
    //         要凑出文献的 52 N·m 需要 **433 N** 的横向力，力通道根本给不出
    //         （实测 `maxLateral` 500N 时 τ 恒为 8.1 N·m，`errLat` 148→148mm）。
    //     力臂太短是**几何事实**，不是增益问题 —— 再怎么调 `kXRatio` 也没用。
    //
    //   正确公式：髋外展肌的作用是**托住重心相对该髋的横向偏移**
    //   （单腿站立的经典力学：重力作用在髋内侧 d 处 ⇒ 产生外展需求）
    //
    //       τ_abd = m·g·(z_com − z_hip)   ← 静态项（文献 50~110 N·m）
    //             + m·a_des_z·(y_com − y_hip)  ← 动态项（产生横移加速度）
    //
    //   ⚠ 由此得到一条**硬约束**，必须写进设计余量里：
    //       τmax(hip 外展) = 70 N·m、m·g ≈ 686 N
    //       ⇒ 重心相对该髋的横向偏移**不得超过 70/686 ≈ 102 mm**。
    //     而 X3 要求重心离脚 ≤ `handoverTolZ` = 50 mm、髋离脚约 30 mm
    //     ⇒ 可用余量只有 **~20 mm**。所以这条通道只能**精调**、必须带死区，
    //     绝不能一路推到底（撞 τmax 会把人掀翻）。
    if (jHip >= 0 && latOwnsAbduction) {
      doll.jointWorld(jHip, TMP_JOINT);
      const hipY = TMP_JOINT[1]!;
      const hipZ = TMP_JOINT[2]!;
      const dz = rs.com.z - hipZ;
      const dy = rs.com.y - hipY;
      const m = DEFAULT_WANTED_FORCE.weight / 9.81;   // 体重真源在 wantedForce，不在本文件
      const h = Math.max(0.3, rs.com.y - (rs.soleY[sup] ?? 0) - 0.05);
      const aDes = h > 1e-6 ? F.fz / (m * h) : 0;      // F.fz = m·h·a_des
      const tauStatic = m * 9.81 * dz;
      const tauDyn = m * aDes * dy;
      // 「不能太过」= **死区**（`latHipDead`，单位 N·m，直接就是力矩门限）
      // ⚠ 之前写成 `dead / max(0.05,|dy|)`（把位移门限换算成力矩），
      //   结果 dead=0.05 → 门限 0.43 N·m，而 τ 动辄 100 N·m ⇒ **恒不生效**，
      //   扫 0/0.02/0.05 三档结果逐位相同 —— 又一个"死参数"。
      const tauRaw = tauStatic + tauDyn;
      const tauAdj = Math.abs(tauRaw) <= p.latHipDead ? 0 : tauRaw;
      const tmax = rs.sk.joints[jHip]!.maxTorque[HIP_ABD_AXIS]!;
      rs.hipLatTau = clamp(tauAdj, tmax);
      if (Math.abs(rs.hipLatTau) > 0.5) {
        rs.requestTorque(jHip, HIP_ABD_AXIS, rs.hipLatTau, 'balance',
          `髋外展·单腿策略(τ静=${tauStatic.toFixed(0)}+τ动=${tauDyn.toFixed(0)}N·m)`);
        rs.clearHold(jHip, HIP_ABD_AXIS);
      }
    } else if (jHip >= 0) {
      rs.hipLatTau = 0;
    }
    {
      // ★★ 这里原来写 `rs.waistTrim = rs.com.z - stanceZl`（UI 诊断，单位**米**），
      //   而上面 529 行写的是**控制目标**（单位**弧度**）。同一字段被两处写、
      //   且本处在**后面** ⇒ 覆盖掉控制目标。
      //   后果实测：腰的目标被换成一个米制诊断量（−0.051 m 读成 −9.20°），
      //   控制目标等于没写 ⇒ 捕获点余量驱动形同虚设。
      //   ⇒ 诊断量另起字段（`waistGapM`），`waistTrim` 专供控制。
      const stanceZl = sup === 'l' ? rs.soleZ.l : rs.soleZ.r;
      rs.waistGapM = rs.com.z - stanceZl;   // UI：「还差多少到支撑脚」（米）
    }

// ④a 骨盆抬升（pelvic hike）：摆动侧骨盆抬高 2~5cm 是最小足净空的决定因素
  //   （Saunders 1953），由支撑侧髋外展产生（Trendelenburg 的反向）。
// ⚠⚠ 与侧向转移**同轴**（`hip/0`）⇒ 按 `AXIS_OWNERSHIP` 它是**从属**的：
  //     判据见上面 `latOwnsAbduction`（与外展通道共用，绝不能用 |F.fz| 量值）。
  if (on('pelvicLift') && !latOwnsAbduction && (p.kPelvicLift > 0 || p.targetClearance > 0) && jHip >= 0) {
      const sw = rs.swingLeg();
      const clr = rs.soleY[sw] ?? 0;
      rs.swingClearance = clr;
      const pelv = clamp(
        p.pelvicLiftSign * (p.kPelvicLift + p.kClearance * (p.targetClearance - clr)),
        p.maxPelvicLift,
      );
      rs.pelvicLift = pelv;
      rs.clearHold(jHip, HIP_ABD_AXIS);
      rs.requestAngle(jHip, HIP_ABD_AXIS, pelv, 'balance', '骨盆抬升(侧向无需求时才占轴)');
    } else if (jHip >= 0) {
      rs.pelvicLift = 0;
    }
  }

  // ④b 躯干侧倾：**已并入 `F_desired` 的 `trunkLean` 分量**（wantedForce.ts）
  //   原来这里是独立的位置请求 `requestAngle(spine1/0, lean)`，与 `τ=JᵀF`
  //   在同一根脊柱上争夺控制权 —— 实测**关掉它 + 关掉骨盆抬升才能站满 8s**
  //   （消融：latwaist 2.57s / pelvicLift 2.33s / 两者都关 8.00s）。
  //   按文献（Xu & Sher / Horak 2006「用重力力矩卸载髋」）它确实该产生一个
  //   **附加水平力**，那正是 `F_desired.trunkLean` 的职责，不该再叠一个位置刚度。
  //   ⇒ 现在只保留 `trunkLean` 开关（真实接线在 wantedForce.ts），此处不再发请求。

  // ══════════════════════════════════════════════════════════════
  // ⑥ ★★★ **踝：CoP 策略 —— 整条力链的起点**（用户 2026-10-03：
  //        「力是自下往上传导的」「脚踝关节应该写的，足部还要学会发力」）
  //
  //   力链：地面反力(足底某点) → 踝力矩 τ=F_z×(CoP−踝) → 膝 → 髋 → 骨盆 → 脊柱 → 躯干
  //
  //   这里用的是 **LIPM 捕获点**（Hof 2005 / Prince 1994）：
  //       ξ = x_com + ẋ_com/ω        CoP 放在 ξ 处 ⇒ CoM 恰好停住
  //   符号（实测）：正踝角（跖屈）⇒ CoP 前移 ⇒ CoM 被往**后**拉 ⇒ 用来消 ξ。
  // ══════════════════════════════════════════════════════════════
  if (jAnk >= 0 && on('ankleCop')) {
    // ★★★ **CoP 直接调节器**（不是"猜符号的踝角 PD"）
    //
    //   实测（tools/probe-copauth）：刚性/柔性足上 **正踝角 ⇒ CoP 后移**（−5.2mm @ +12°）。
    //   机理：平底绕踝转 ⇒ 脚尖离地、脚跟吃重 ⇒ 接触形心自然后退。
    //   ⇒ 要让 CoP **前移**必须给**负**角。所以：
    //
    //       目标：CoP → 捕获点 ξ（放 ξ 处 ⇒ CoM 恰好停住，Hof 2005）
    //       律：  θ_ref = −k · (ξ − CoP_实测) − kd·(CoP 移动速度)
    //
    //   ★ 为什么必须闭环在 CoP 上而不是"角度 PD"：
    //     角度 PD 在平衡点自然停下（实测只出 1 N·m ⇒ CoP 只移 1.5mm），
    //     而 CoP 是**力**的直接读数，闭环在它上面才既有的放矢又不用猜符号。
    const cop = rs.cop[sup];
    const copErr = rs.dcm.x - cop.x;
    let ankSag = -p.kCopSag * copErr - p.kCopSagD * rs.com.vx;
    // 蹬离相：跖屈把地面反力斜向前 ⇒ 这是**前进的唯一来源**
    if (rs.phase === 'PUSH') ankSag += Math.abs(p.pushDeg) * D2R;
    // ★ 斜率限制：踝有力矩了（护栏修好后权限 1.0），必须限速否则一帧砸下去
    ankSag = clamp(ankSag, p.maxAnkleSag);
    rs.requestAngle(jAnk, 2, ankSag, 'balance', '踝CoP调节');

    // 额状面同样闭环在实测 CoP 上（目标 = 侧向捕获点）
    const latErr = rs.dcm.z - cop.z;
    rs.requestAngle(jAnk, 0, clamp(p.kCopLat * latErr, p.maxAnkleLat), 'balance', '踝额状CoP');
  }
}