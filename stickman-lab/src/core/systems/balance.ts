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
import { wholeBodyBalanceTick, type QpTick } from './wholeBodyQp';
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
//  ★★★ 2026-10-06 表的**模型换了**（之前那版 `subordinateTo` 是错的模型）
//
//  旧模型：每根轴**恰好一个主人**，第二个写者用 `subordinateTo:'主人'` 挂上去。
//  实测这条规则被自己破坏了三次（全部是「表在说谎」而不是代码写错）：
//    ① `foot/2` 写 `subordinateTo:'sagSupport'` —— 而 `sagSupport` 只占
//       `hip/2`、`knee/2`，**不占 `foot/2`**（那里真主人是 `ankleCop`）
//       ⇒ 让位给了空气；
//    ② `knee/0` 挂 `subordinateTo:'sagSupport'` —— `knee/0` **一个主人都没有**；
//    ③ 腰的 `postureSag`/`postureLat` 两行写着 `mode:'pos'`，而那两条位置 PD
//       已在同一天删除 ⇒ 表声称有主人，运行时没有写者；
//       同时真正的写者（`τ=JᵀF` 经脊柱链）在 `mode:'tau'` 上**没登记**。
//  根源：`subordinateTo` 想表达的是「同一根轴上 pos 与 tau **并联**」，
//  但把它绑成「主人/从属」就必然要求从属者 mode 不同（门禁 A 就这么查的），
//  于是**同模式的第二个写者**（QP、`τ=JᵀF`、踝 VIP 都往 `hip/2` 写 tau）
//  在表里无处安放 —— 只能硬塞成从属，或者干脆不登记。
//
//  ⇒ 现在的模型：**每个 (关节, 轴, 模式) 恰好一行**。
//    · 同一 (轴, 模式) 的多个写者 = 同一个通道的并列实现（同一 `SystemId`），
//      在 `request()` 里由优先级/顺序仲裁 ⇒ 合并成**一行**，用
//      `channel` + `extraGates` 把它们的消融门全部写出来；
//    · 同一轴上 `pos` 与 `tau` 两行 = **并联**（`driveMotors` 里相加后按 τmax 饱和，
//      不存在谁覆盖谁）⇒ 这才是「并联」的正确含义，也不再需要 `subordinateTo`。
export type AxisRole =
  | 'sagSupport'      // 垂直 + 矢状支撑：已验证站满 20s，**位置伺服**
  | 'latTransfer'     // 侧向重心转移：**力矩通道**（唯一写者 = τ=Jᵀ(F_lat)）
  | 'pelvicLift'      // 骨盆抬升：与 `latTransfer` 同轴、另一模式（位置伺服）
  | 'ankleCop'        // 矢状踝：**VIP 刚度力矩**（τ = K_a·q_vip + C_a·q̇_vip）
  | 'ankleLat'        // 额状 CoP：**中足**旋前/旋后（踝的额状轴被引擎锁死，做不到）
  | 'hipStiff'        // ★ DIP 髋侧**被动刚度**（τ = K_h·q_hip + B_h·q̇_hip）
  // ★★ `grfJacobian` = **唯一的地面反力映射** `τ = JᵀF`（Yin & Zhou 2004 /
  //   Reitsma 2013）以及全链 QP（附录 C.1）—— 两者都是「先算 F，再按几何分配」。
  //   ⚠ 2026-10-06 **腰的三轴已移出 QP**（Winter 1996/1998，见 `wholeBodyQp.ts`），
  //     但脊柱仍然被 `τ=JᵀF` 的链条写着（块④/⑤ 的 chain 含 `spine1..3`）。
  | 'grfJacobian'
  // ★★ 迈步系统的**关键帧位置伺服**（附录 D.3）：`stepSystem` 用
  //   `requestSwingLegAngle` / `requestWaistSlot` 把摆动腿与腰推向 Perry 帧域。
  //   它与 balance 的 pos 记录同模式（同一根轴上都是"要这个角"）⇒ 由
  //   `request()` 的优先级仲裁；与 balance 的 **tau** 记录才是跨模式并联，
  //   而那一条**必须由 balance 让位**（附录 D.4），当前**尚未实现** ⇒
  //   门禁 C 会把 `step` × `balance` 的同轴异模式报成未声明冲突。
  | 'keyframeStep';

export interface AxisSpec {
  joint: string;
  axis: number;
  role: AxisRole;
  mode: 'pos' | 'tau';
  /** 该轴上这个模式的**主**消融通道（`ablate`）—— 保证「全关 == 零输出」 */
  channel: string;
  /**
   * 同一 (轴, 模式) 上**其它**并列实现的消融门。
   *   为什么需要它：`hip/2` 的 tau 上同时有 `hipStiff`（被动刚度）、`qp`
   *   （全链 QP）、`lat/sag/weight`（`τ=JᵀF` 的矢状/额状/竖向分量）。
   *   它们是**同一个 writer 的并列实现**（同一 `SystemId='balance'`），
   *   在 `requestTorque` 里按优先级仲裁 ⇒ 表里必须是**一行**把门全写出来，
   *   否则「全消融」名单就漏门 ⇒ 门禁 B 测的是假故障（本项目已栽 4 次）。
   */
  extraGates?: readonly string[];
}

/**
 * ★ **不申领任何轴**的通道（门禁 A2 用它区分「表漏登记」与「本来就不是轴」）。
 *
 *   载荷依赖姿势张力（Horak & Nashner 1986；J Ab 2021 承重侧 GMED +58%）：
 *   它只改 `sagSupport` 位置环的 `kP/kD` 缩放，**不产生第二个 target**。
 *   ⇒ 它是**增益调制**，不是轴的主人；写进 `AXIS_OWNERSHIP` 就是表在说谎。
 */
export const NON_AXIS_CHANNELS: readonly { channel: string; why: string }[] = Object.freeze([
  { channel: 'postureLoad', why: '只缩放 sagSupport 位置环的 kP/kD，不写 target、不申领轴' },
]);

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
  // ── 矢状链：位置伺服（`sagSupport`）──────────────────────────────
  { joint: 'hip', axis: 2, role: 'sagSupport', mode: 'pos', channel: 'hip', extraGates: ['stepKeyframe'] },
  { joint: 'knee', axis: 2, role: 'sagSupport', mode: 'pos', channel: 'knee',
    extraGates: ['stanceExt', 'stepKeyframe'] },

  // ── 矢状链：力矩通道（DIP 被动刚度 / 全链 QP / τ=JᵀF）─────────────
  { joint: 'hip', axis: 2, role: 'hipStiff', mode: 'tau', channel: 'hipStiff',
    extraGates: ['qp', 'lat', 'sag', 'weight', 'trunkLean'] },
  // ★ 这行是 2026-10-06 门禁查出来的**漏登记**：QP 与 `τ=JᵀF` 都写 `knee/2`
  //   的力矩，旧表却只登记了 `knee/0` ⇒ 运行时 `knee_l/2 tau<-balance vs step`
  //   被算成「未声明的同轴异模式」。
  { joint: 'knee', axis: 2, role: 'grfJacobian', mode: 'tau', channel: 'qp',
    extraGates: ['lat', 'sag', 'weight', 'trunkLean'] },

  // ── 额状链 ────────────────────────────────────────────────────────
  { joint: 'hip', axis: HIP_ABD_AXIS, role: 'latTransfer', mode: 'tau', channel: 'lat',
    extraGates: ['sag', 'weight', 'trunkLean'] },
  // 骨盆抬升与 `latTransfer` **同轴、另一模式** ⇒ 并联（相加，不是覆盖）。
  //   旧表把它写成 `subordinateTo:'latTransfer'`，语义是"让位给不占这根轴的角色"。
  { joint: 'hip', axis: HIP_ABD_AXIS, role: 'pelvicLift', mode: 'pos', channel: 'pelvicLift' },

  // ── 踝：矢状 VIP 刚度（τ）+ QP + τ=JᵀF ──────────────────────────
  { joint: 'foot', axis: 2, role: 'ankleCop', mode: 'tau', channel: 'ankleCop',
    extraGates: ['qp', 'lat', 'sag', 'weight', 'trunkLean'] },
  // ★ 额状 CoP 权限归**中足**：踝建成的是绕足横轴的 revolute，轴 0/1 被
  //   引擎锁死 ⇒ 给轴 0 下角度伺服在物理上不可能产生运动（见本文件末的
  //   `midfoot_*` 驱动块）。
  { joint: 'midfoot', axis: 0, role: 'ankleLat', mode: 'pos', channel: 'ankleLat' },

  // ── 迈步系统独占的**位置**写入（Perry 关键帧，附录 D.3）──────────
  //   `foot/2` 摆动踝、`hip/1` 摆动外展让开、脊柱腰槽（trunkPitch / trunkLat）。
  //   这几根轴上 balance 只有 **tau** 写入 ⇒ 属跨模式并联，需要 balance 让位。
  { joint: 'foot', axis: 2, role: 'keyframeStep', mode: 'pos', channel: 'stepKeyframe' },
  { joint: 'hip', axis: 1, role: 'keyframeStep', mode: 'pos', channel: 'stepKeyframe' },
  { joint: 'spine1', axis: 2, role: 'keyframeStep', mode: 'pos', channel: 'stepKeyframe' },
  { joint: 'spine1', axis: 0, role: 'keyframeStep', mode: 'pos', channel: 'stepKeyframe' },

  // ── 全链 QP 与 τ=JᵀF 在**其余**承重腿轴上的写入 ──────────────────
  //   QP 的轴集合由 `wholeBodyQp.QP_AXIS_SPEC` 定义（那里是唯一真源），
  //   这里逐根登记，便于门禁 E2 双向对账（表 ⊆ 代码 且 代码 ⊆ 表）。
  //   ⚠ `hip/0`（外展轴）**不进 QP**：它的 tau 主人是 `latTransfer`（已登记）。
  { joint: 'hip', axis: 1, role: 'grfJacobian', mode: 'tau', channel: 'qp',
    extraGates: ['lat', 'sag', 'weight', 'trunkLean'] },
  { joint: 'knee', axis: 0, role: 'grfJacobian', mode: 'tau', channel: 'qp',
    extraGates: ['lat', 'sag', 'weight', 'trunkLean'] },
  { joint: 'knee', axis: 1, role: 'grfJacobian', mode: 'tau', channel: 'qp',
    extraGates: ['lat', 'sag', 'weight', 'trunkLean'] },
  { joint: 'foot', axis: 0, role: 'grfJacobian', mode: 'tau', channel: 'qp',
    extraGates: ['lat', 'sag', 'weight', 'trunkLean'] },
  { joint: 'foot', axis: 1, role: 'grfJacobian', mode: 'tau', channel: 'qp',
    extraGates: ['lat', 'sag', 'weight', 'trunkLean'] },

  // ── 脊柱：躯干姿态已并入 `τ=JᵀF` 的脊柱链（块④/⑤）───────────────
  //   ⚠ 2026-10-06：`postureSag`/`postureLat` 两条腰位置 PD **已删除**
  //     （腰矢状阻尼量纲不平衡单独饱和 ⇒ 折腰）。表里原来那 6 行
  //     `mode:'pos'` 是**在说谎**（运行时没有 pos 写者），
  //     而真正的写者（脊柱链上的 τ）没登记 ⇒ 门禁 E 报「未登记」。
  //   ⇒ 现在只登记真实存在的 tau 写入，位置行全部删除。
  //     ⚠ 代价（必须知道）：腰**不再有位置伺服**，`spine*/0` 与 `spine*/2`
  //     在块⑤ 的 |τ|>0.05 过滤之下多数时候拿不到指令；腰的姿态保持
  //     完全依赖块⑤ 的 `τ=JᵀF` + `enforceLimits`。
  { joint: 'spine1', axis: 0, role: 'grfJacobian', mode: 'tau', channel: 'lat',
    extraGates: ['sag', 'weight', 'trunkLean'] },
  { joint: 'spine1', axis: 1, role: 'grfJacobian', mode: 'tau', channel: 'lat',
    extraGates: ['sag', 'weight', 'trunkLean'] },
  { joint: 'spine1', axis: 2, role: 'grfJacobian', mode: 'tau', channel: 'lat',
    extraGates: ['sag', 'weight', 'trunkLean'] },
  { joint: 'spine2', axis: 0, role: 'grfJacobian', mode: 'tau', channel: 'lat',
    extraGates: ['sag', 'weight', 'trunkLean'] },
  { joint: 'spine2', axis: 1, role: 'grfJacobian', mode: 'tau', channel: 'lat',
    extraGates: ['sag', 'weight', 'trunkLean'] },
  { joint: 'spine2', axis: 2, role: 'grfJacobian', mode: 'tau', channel: 'lat',
    extraGates: ['sag', 'weight', 'trunkLean'] },
  { joint: 'spine3', axis: 0, role: 'grfJacobian', mode: 'tau', channel: 'lat',
    extraGates: ['sag', 'weight', 'trunkLean'] },
  { joint: 'spine3', axis: 1, role: 'grfJacobian', mode: 'tau', channel: 'lat',
    extraGates: ['sag', 'weight', 'trunkLean'] },
  { joint: 'spine3', axis: 2, role: 'grfJacobian', mode: 'tau', channel: 'lat',
    extraGates: ['sag', 'weight', 'trunkLean'] },
]);

/**
 * 本 rig **有**踝与中足（`skeleton` 的 `DEFAULT_CONFIG.ankleEnabled = true`）。
 *
 * ★ 2026-10-04 改：原来是 `true`，注释写着"一旦骨架真的加了踝，必须同时在此登记"。
 *   骨架**真的**加了踝，但这行没改 ⇒ 门禁 E 里那句"强制登记"的断言
 *   匹配的是 `w.startsWith('ankle')`，而踝的关节名其实叫 **`foot_l/foot_r`**
 *   ⇒ **断言从来没生效过**（实测门禁 E 报「foot_l/0, foot_r/0 未登记」却仍然判绿）。
 *   两处都已修：这里置 `false`，门禁 E 改成按 `foot_*` 匹配。
 */
export const ANKLE_ABSENT = false;

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
  // ── VIP 踝刚度（《平衡态设计.md》§4.1②）─────────────────────────
  /**
   * ★★ 矢状踝刚度 `K_a`，单位 **N·m/rad**（不是无量纲比例 —— 直接给物理量，
   *   免得「比例×ω₀²」在姿态下沉时悄悄变形）。
   *
   *   物理含义（Morasso2019, PLOS ONE 14:e0213870）：
   *     重力倾覆力矩 `τ_g = m·g·h·sin(q) ≈ m·g·h·q` ⇒ **临界刚度 `K_crit = m·g·h`**。
   *   本 rig 实测（tools 探针，1s 站姿）：
   *     `m = 70.0 kg`、`h_ankle = CoM.y − 踝 = 0.959 − 0.046 = 0.913 m`
   *     ⇒ `K_crit = 70.0 × 9.81 × 0.913 =` **627 N·m/rad**
   *
   *   取 **0.88 × K_crit = 552 N·m/rad**（欠临界 12%），依据是人体实测：
   *     Loram & Lakie 2002, *J Physiol* 545:1041-1053 —— 安静站立时踝固有机械刚度
   *     实测 `5.2 ± 1.2 N·m/deg`（= 298 N·m/rad），折合 **91 ± 23%** 的临界刚度，
   *     原文结论「**insufficient to stabilise**」⇒ **刻意欠临界，最后一段交给反馈**。
   *
   *   ⚠ 为什么「刚度」比「位置伺服」对：位置环的有效刚度是 `kP/量程`，
   *     随护栏 `α` 和量程漂移，无法保证落在临界的 88%。
   *     而 `τ = K_a·q` **直接就是 CoP 权限**（CoP 位移 = τ/F_z，F_z = m·g`）。
   *   ⚠ 上限校验：`τmax(foot/2) = 120 N·m` ⇒ 饱和角 = 120/552 = **0.217 rad (12.5°)**。
   *     实测 `com.x` 偏 24 mm 时 `q_vip = atan2(−0.024, 0.913) = −0.026 rad`
   *     ⇒ `τ = −14.5 N·m`，与「把 24 mm 拉回所需的 m·g·Δx = 16.5 N·m」同量级 ✓
   */
  // ── 全链 QP（附录 C.1）────────────────────────────────────────────
  /**
   * ★ 是否启用**全链 QP**（附录 C.1）。
   *
   * ★★ 默认 **false** —— QP 的机制已实现并通过离线验收（`probe-qp` 四项全过），
   *   但**尚未在真实状态验证过**。逐关节 PD 仍是当前唯一被实测过的路径。
   *   所以默认关着，用 `ablate` 反过来开：`ablate` 里**不含** `'qp'` 就启用。
   *   ⚠ 反过来是刻意的：`ablate` 的语义是"关掉某通道"，列进来的通道被关。
   *     如果 QP 默认开，那么"想测纯 PD"就得专门写 `qp` 进 ablate —— 更符合直觉。
   *   ⚠ 不要因为"默认关着看着像没做完"就翻过来。翻之前先看 `probe-qp` 的
   *     真实状态读数（见 `架构设计.md` C.4 第一条）。
   */
  qpEnable?: boolean;
  /** QP 的踝权重倍数（Kim 2022：踝取髋的 3~5 倍；0 = 完全排除踝） */
  qpAnkleMul?: number;
  /** ξ → F_des 的额外增益（1 = 按物理量；>1 更激进） */
  qpGain?: number;
  /** QP 迭代上限 */
  qpIters?: number;

  kVipAnkle: number;
  /** VIP 阻尼 `C_a`（N·m·s/rad）。按 `C_a = 2ζ√(K_a·I)` 由 `vipZeta` 算出 */
  vipZeta: number;
  /**
   * ══════════════════════════════════════════════════════════════════
   * ★★★ DIP 的**髋侧被动刚度** `K_h`（N·m/rad）—— Morasso 2019/2022 的另一半。
   * ══════════════════════════════════════════════════════════════════
   *
   * 原文（Morasso, Cherif, Zenzeri 2019, PLOS ONE 14(3):e0213870）：
   *   > "As regards the hip joint we suggest a stiffness strategy [...]
   *    the critical stiffness value is strongly smaller for the hip than for
   *    the ankle case for purely biomechanical reasons, thus requiring a very
   *    small amount of co-contraction of the hip muscles for achieving a
   *    working level of hip stiffness."
   *
   *   推导（同文）：`τ_g = m·g·h·sin(q) ≈ m·g·h·q` ⇒ **`K_crit = m·g·h`**。
   *     绕踝：全身 `m=70 kg`、`h=0.913 m` ⇒ `K_crit,ankle = 627 N·m/rad`
   *     绕髋：**上身** `m₂ = 47.5 kg`（HAT）、`r₂ = 0.392 m` ⇒ `K_crit,hip = 183 N·m/rad`
   *     ⇒ 只有踝的 **29%**。这就是"髋策略比踝策略省力"的力学根源。
   *
   *   取值：原文默认 **2× K_crit**（"twice the critical hip stiffness"），
   *   并实测「只要 ≥ 1.2× K_crit 就能稳定」（`Table 5`）。
   *   ⇒ 本 rig 取 `kVipHip = 366 N·m/rad = 2 × 183`。
   *
   * ★ 为什么这一项是**当前站不住的最后一块拼图**：
   *   之前只有踝的 VIP 刚度（`kVipAnkle`）而**髋侧完全没有被动刚度**。
   *   按原文，踝刚度**刻意欠临界**（实测人体 60~91% of K_crit，
   *   原文明确「insufficient to stabilise」）⇒ 单靠它只有**边缘稳定**，
   *   必须靠髋的过临界被动刚度兜住上身 —— 这正是 DIP 而非 SIP 的意义。
   *   缺了它，踝力矩在 `|q_vip| > 120/552 = 0.217 rad` 处饱和
   *   （实测 t=1.5 s 就撞上 −120 N·m 且踝角到 −12° 限位），而倾角继续长 ⇒ 必倒。
   *
   * ★ 与 `hip/2` 的 `sagSupport`（位置伺服）的关系：
   *   两者是**并联**的两条通道（位置伺服给目标姿态、刚度给被动稳定），
   *   与踝上 `τ_ankle` 与位置 PD 并联是同一套结构。
   *   `AXIS_OWNERSHIP` 里以 `subordinateTo: 'sagSupport'` 登记，语义是
   *   「刚度是支撑角色的下属实现」，不是第二个主人。
   */
  kVipHip: number;
  /** 髋侧阻尼比 ζ_h（`B_h = 2ζ_h√(K_h·I_hip)`）。原文取阻尼比 ≈ 0.7 */
  vipZetaHip: number;
  /** 髋侧刚度的力矩上限（rad，超过即退化成"髋策略"的大幅摆动）。默认用 hip τmax */
  maxHipStiffDeg: number;

  // ══════════════════════════════════════════════════════════════════
  // ★★ 踝的**间歇延迟反馈**（S3）—— Bottaro 2008 / Asai 2009 / Suzuki 2012
  //    / Morasso 2019 (PLOS ONE 14:e0213870) / Morasso 2022。
  //    这是欠临界踝刚度**唯一**能站住的前提。
  // ══════════════════════════════════════════════════════════════════
  /**
   * ON 相的比例增益 `P_θ`（N·m/rad）。
   *
   * 原文明确它可以**远小于**连续 PD：
   *   > "the intermittent controller can use feedback parameters that are much
   *      smaller than the standard model"（Bottaro 2008, PLOS ONE 3:e6169）
   * 原因：反馈不是要把状态拉回原点，而是把状态赶回**稳定流形**（见 `vipDelaySec`）。
   * 连续 PD 要压住发散必须给很大的 P（于是延迟引起不稳定）；
   * 间歇控制靠 on/off 切换承担绝大部分稳定性，PD 只做"温和推一把"。
   */
  vipP: number;
  /**
   * ON 相的速度增益 `D_ω`（N·m·s/rad）。**默认 0，这是文献结论不是省事**：
   *   > "stability is very little sensitive to the value of D [...]
   *      the inverted pendulum can be stabilized even by the zero value of D"
   *      （同上；其图 6 的稳定带几乎垂直）
   * 连续模型必须给 D 才能压住延迟诱导的振荡；间歇模型不需要。
   */
  vipD: number;
  /**
   * 感觉反馈延迟 `δ`（s）。**判据必须作用在延迟样本上**，这是整个机制的关键：
   *   原文：> "the switching rule is not applied to the current state vector
   *      but to the corresponding delayed sample [...] thus the off-phase will
   *      be terminated not at the time of crossing the border [...] but
   *      δ milliseconds later: t_on = t_c + δ."
   *
   * 取值：人体多感觉通路 ~0.2 s（Milton 2016）。
   *   ⚠ 但 2019 年的定量结论是：标准间歇策略只在 **δ < 100 ms** 时成立
   *     （CIP 杆长 >50 cm、δ<100 ms；Yoshikawa 2016）。δ=230 ms 需要 2019 年的
   *     改进版（内模型 + 相位重置），本实现**不含**那部分。
   *   ⇒ 默认取 **0.10 s**（文献里标准策略的成立域上界），不要设成 0.2。
   */
  vipDelaySec: number;
  /**
   * 切换参数 `a`（rad/s），判据是 `q_δ·(q̇_δ − a·q_δ) < 0` ⇒ ON。
   *
   * 论文里 `a` 是"切换边界的斜率"，`a = 0` 时切换边界就是坐标轴（第一、三象限为 ON）；
   * `a = −∞` 时 off 区消失、退化成连续 PD。
   * **`a = −ω₀` 时切换边界正好是稳定流形本身**（`θ̇ = −ω₀θ`），
   * 于是"关反馈"= "放它沿流形自由收缩"，这才是 `affordance` 的字面含义。
   * ⇒ 用 `vipOmegaFrac = a/ω₀`，默认 **−1**（= −ω₀）。
   */
  vipOmegaFrac: number;
  /** 矢状 P 增益 / ω₀²（无量纲）。与 VIP 踝刚度并联时此项只做残余修正 */
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
  /** 矢状髋目标角限幅（rad）。仅 `dipSagittal=false`（旧伺服挡）时用 */
  maxHipDeg: number;
  /**
   * ★★ 矢状面走哪一套（2026-10-04，默认 `true` = 论文的 DIP）
   * ══════════════════════════════════════════════════════════════════
   *
   * `true` = **Morasso 2019/2022 的 DIP/VIP**，矢状面只有三个环节：
   *   · 踝：**欠临界**被动刚度 `K_a = 0.88·K_crit = 552 N·m/rad`（常开）
   *         + **间歇延迟反馈**（`vipP/vipD/vipDelaySec`）
   *   · 髋：**过临界**被动刚度 `K_h ≥ 1.2·K_crit,hip`，**纯被动、无主动控制**
   *     （原文："the hip joint is stabilized by a passive stiffness mechanism"）
   *   · 腰：保持躯干自身刚性（DIP 的第二条连杆要求它是一根刚杆）
   *
   * `false` = 旧的**连续捕获点位置伺服**（髋上 `τ = kP(ξ−stance) − kD·ẋ`）。
   *
   * ★★ 为什么默认必须是 `true`（实测，不是偏好）：
   *   间歇反馈的**前提**是"off 相里被控对象是裸的欠临界摆"，这样才有
   *   affordance（状态沿稳定流形自由收缩）。而旧的连续伺服等效刚度
   *   `kP·τmax/ωmax = 48×200/9 ≈ 1067 N·m/rad`，是踝刚度 552 的**两倍**
   *   ⇒ off 相里有一个比被测对象本身强得多的控制器在撑，
   *   状态永远进不了安全区。
   *   实测（tools/probe-midfoot.ts F 段）：带旧伺服时
   *     平均 γoff = **−0.76 ~ −1.01（全程为负）**、off 相 **0 收缩 / 1 扩张**
   *   ⇒ VIP 摆角从第一拍就单调变大、沿**不稳定流形**发散，
   *      间歇机制**一次都没被触发过**（γoff<0 = q̇ 与 q 同号）。
   *   扫描 P = 30/60/120 全都无效（γoff 不变）⇒ 不是增益问题。
   */
  dipSagittal: boolean;
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
   * ★ 腰额状 **PD 比例增益**（rad 每米横向误差）。
   *   142mm 误差 ⇒ 0.14 rad = 8°（正好用满 `maxWaistTrim`）。
   *   实测依据：腰 8° 时 `com.z` 差只剩 **8mm** ⇒ 腰是这个 rig 唯一有权限
   *   把重心送到支撑脚上方的执行器（限到 1.7° 时差 161mm，完全到不了）。
   */
  waistKp: number;
  /**
   * ★ 腰额状 **PD 阻尼增益**（rad 每 m/s）。**这一项决定能不能停住**。
   *   旧式 `-sign(err)·frac·max` 是纯 P + 饱和、无阻尼 ⇒ 实测
   *   `com.vz` 峰值 **871 mm/s**、冲过头 **349mm**、X3 驻留仅 0.08s（需 1.00s）。
   *   Batenie 2014（Gait & Posture）用 PD 拟合 75 人侧向体重移动，
   *   平均速度误差 0.35% —— 侧向控制**本来就该是 PD**。
   */
  waistKd: number;
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
  /**
   * 推相位允许消耗的 CoP 侧缘余量（米，从 CoP 到鞋底内侧边缘）。
   * 压力中心被推出支撑面就不可救 ⇒ 推之前必须留够。
   */
  latShiftCopMargin: number;
  /**
   * ★★ 髋外展的**横向阻尼**（N·m 每 m/s）。
   *
   * ⚠⚠ 逐帧实测（锁定承诺修好之后）：`hip/0` 的力矩**全程顶在 −120 = τmax 饱和**，
   *   而 `com.z` 在 0.5s 内从 −161mm 摆到 +195mm（横向速度峰值 432~920 mm/s）。
   *   原因：`τ = m·g·(com.z − hip.z)` 是**纯刚度、零阻尼**。线性倒立摆
   *   `z̈ = ω₀²(z_ref − z)` 在**无阻尼**时是等幅振荡 —— 加刚度只会
   *   提高振荡频率，不会让它停下来（这与矢状面 VIP 的经验完全一致）。
   *
   *   文献：横向倒立摆同样需要阻尼才能定位。Batenie 2014（Gait & Posture）
   *   正是用 **PD** 拟合 75 人的侧向体重移动（速度误差 0.35%）。
   *
   *   量级：`vz = 0.4 m/s` 时 D 项要给几十 N·m 才压得住 ⇒ 0.4×80 ≈ 32 N·m，
   *   与静态项同量级但不同相位（静态项看位置、阻尼项看速度）。
   */
  latDamp: number;
  /**
   * ★★★ 额状面**刚度**增益（`a·m·ω₀²`，N·m 每米）。默认 33。
   *
   * 文献：**Winter 1998, J Neurophysiology 80:1211**「Stiffness Control of
   * Balance in Quiet Standing」——
   *   · "muscles act as **springs** to cause the COP to move **in phase** with
   *     the COM"（实测 COP 仅滞后 COM **4 ms**）；
   *   · "In the sagittal plane this stiffness control exists at the ankle
   *     plantarflexors, **in the frontal plane by the hip abductors/adductors**"
   *     ⇒ 额状刚度在**髋**，不在腰；
   *   · 刚度按 `Ke = I·ω₀²` 定，摇摆幅度 `∝ Ke^−0.55`。
   *   · 2025 J Neurophysiol：稳定力矩来自**前馈肌张力**调节短程刚度，提供
   *     **即时机械反馈**；髋/膝有前馈分量，踝只有反馈（跟腱顺应削弱）。
   *
   * ⚠⚠ 这一项之前**根本不存在**，是重心转移推不动的直接原因：
   *   旧律 `τ = m·g·(com.z − hip.z)` 的**零点在髋**（hip.z≈125mm），
   *   **不在目标脚**（soleZ≈161mm）⇒ 重心推到髋附近这项就归零，
   *   再也不往前推 ⇒ X3 恒停在 142mm。
   *
   * 定量（实测力臂 a=0.119m、m=70kg、ω₀=2rad/s、ζ=1）：
   *   `K_lat = a·m·ω₀² = 33 N·m/m`，`D_lat = a·m·2ζω₀ = 33 N·m·s/m`
   *   —— `D_lat` 与实测扫出的最优 `latDamp=40` 吻合，说明阻尼对了、刚度漏了。
   */
  latStiff: number;
  /**
   * 额状驱动的**阻尼比 ζ**（1 = 临界阻尼）。冻结系数 ζω₀ 走 `dLatBase`。
   * 教材值 1；实测最优点反推 ζ≈1.2。
   */
  latZeta: number;
  /**
   * ★★ **载荷依赖姿势张力**增益：承重侧位置环增益放大到 `(1 + gain·loadFrac)`。
   *
   * ⚠ 位置伺服原来只有固定 `kP=48`，是纯"关节刹车"，**对载荷毫无反应**。
   *   逐帧实测后果：`spine1/0` 目标 −2.7°（腰 8°/三段）却被**扭到 −35°**
   *   ⇒ 伺服被打输、躯干在转移中先塌；`hip/0` 力矩**全程饱和 −120**、无余量。
   *
   * 文献：Horak & Nashner 1986（CoP 移向哪只脚，那条腿张力上升）；
   *   J Ab 2021（PMC8628027）单侧负重步行：承重侧 GMED **+58%**、TFL **+65%**，
   *   非承重侧**无变化** ⇒ 张力**按腿不对称**且由**载荷**驱动。
   *
   * ⚠ 张力只加在**承重侧/锁定腿**与**脊柱额状轴**：加在摆动腿上等于给它撑腰，
   *   与"解锁后腿才有资格被抬"直接矛盾。
   */
  postureLoadGain: number;
  /** 脊柱三段是否也吃这份张力（躯干被外力扭到 35° 的主要受害者） */
  postureLoadSpine: boolean;
  /**
   * ★★ 脊柱的**前馈肌张力**倍率（乘在 `kP` 上，与载荷无关的那一份）。
   *
   * ⚠ 逐帧实测：脊柱角度被限位压在 ±15° 内，但在 **±17° 之间来回甩**
   *   （0.52s: −17.1° → 1.02s: +14.2° → 1.12s: +7.3°），**停不住** ⇒ 用户说的
   *   「脊柱还是软的」。它软不是因为限位坏，而是因为**只有比例伺服在追一个
   *   逐帧抖动的指令**（腰 PD 的目标在 ±2.7° 内每帧变号）。
   *
   * 文献：2025 J Neurophysiol「Center of mass states render multijoint torques
   *   throughout standing balance recovery」——
   *   · "Stabilizing joint torques arise from neurally-mediated **feedforward
   *     tonic muscle activation that modulates muscle short-range stiffness**,
   *     which provides **instantaneous mechanical feedback**"；
   *   · 髋/膝**同时**有前馈与反馈分量，**踝只有反馈**（跟腱顺应性削弱短程刚度）。
   *   ⇒ 前馈张力是与反馈**并联**的一条独立通路，缺失它 ⇒ 只有延迟反馈
   *     ⇒ 必然抖动。这正是"软"的机制。
   *
   * 所以脊柱需要一份**与载荷无关的基线张力**，否则只有延迟反馈在起作用。
   */
  postureSpineTonic: number;
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
  // ★★ 2026-10-05 改 552 → **270**（= 0.43·K_crit）——按 Loram 同一篇的实测值重定。
  //
  //   原值 552 的注释写「Loram 实测 5.2 N·m/deg 折合 91±23% 的临界刚度」——
  //   **这个 91% 的分母算错了**：5.2 N·m/deg 是与**同一篇的倾倒力矩梯度 12 N·m/deg**
  //   直接相除，得 **43%**；对照 Morasso PLOS Eq.（K_crit=823 N·m/rad）则只有 298/823 = **36%**。
  //   91% 是“双踝合计 ÷ 单腿梯度”的比值，不是 K/K_crit。
  //
  //   实测扫参（probe-sagittal，每次站立到倾角 25°）：
  //     K=552 (0.88 crit)  → ξx = 0.182   权限 50%
  //     K=376 (0.60 crit)  → ξx = 0.128   权限 58%
  //     K=270 (0.43 crit)  → ξx =−0.022  权限 55%   ★ 最优
  //     K=226 (0.36 crit)  → ξx = 0.001   权限 32%
  //   ★ **K=270 正好落在 Loram 的实测比值上**，不是调出来的。
  //
  //   为什么小 K 对：**饱和角** = τmax/K = 120/K → K=552 时仅 **12.5°**，
  //   而实测 q_vip 会走到 **23°** ⇒ 被动项 K·q 在 12.5° 就顶满并**独吞饱和额度**，
  //   间歇反馈项（vipP·qδ）挤不进去。K=270 → 饱和角 **25.5°** 覆盖实测区间。
  kVipAnkle: 270,
  qpEnable: false,
  qpAnkleMul: 4,
  qpGain: 1,
  qpIters: 40,
  vipZeta: 0.9,
  // ★ DIP 髋侧被动刚度。**实测标定**（tools/probe-midfoot.ts G 段，6 s 静置站立）：
  //   K_h      关踝基线    开踝
  //     0      6.00s      2.22s
  //     50     6.00s      2.25s
  //    120     6.00s      2.23s   ← 取这个
  //    366     3.50s ✗    2.23s   ← 文献的 2×K_crit 会**打断已有的髋位置伺服**
  //   ⚠ 为什么不能直接用文献的 366：本 rig 的髋**已经有主动位置伺服**
  //     （`sagSupport`，等效刚度 `kP·τmax/ωmax = 48×200/9 ≈ 1067 N·m/rad`，
  //     已是 366 的 3 倍）。再叠一层 366 的被动弹簧 = 与自己的伺服对着干
  //     ⇒ 实测关踝基线从 6.00 s 掉到 3.50 s。
  //     文献里髋是**纯被动**（没有主动髋控制），本 rig 不是 ⇒ 只能取"不打架"的量级。
  //   ⚠ 开踝时 K_h 几乎不影响结果（2.22~2.25 s）⇒ 踝开着的瓶颈**不在髋**。
  // ★ DIP 的髋侧被动刚度：按 Morasso 2019 取 **2 × K_crit,hip**
  //   （K_crit,hip = m₂gr₂ = 47.5 × 9.81 × 0.392 ≈ 183 N·m/rad ⇒ 366）。
  //   原文："we used over-critical values [...] the default value for most
  //   simulation was twice the critical hip stiffness"，且「≥1.2× 即可稳定」。
  kVipHip: 366,
  // ★ 间歇延迟反馈（S3）：文献起点，不是标定值 ⇒ 扫参见 tools/probe-midfoot.ts F 段
  vipP: 60,
  vipD: 0,
  vipDelaySec: 0.10,
  vipOmegaFrac: -1,   // a = −ω₀（切换边界 = 稳定流形）
  vipZetaHip: 0.7,
  maxHipStiffDeg: 22,
  // ★ 默认 true：矢状面按论文的 DIP，撤掉髋上的连续位置伺服（见 `dipSagittal`）
  dipSagittal: true,
  ksagRatio: 0.2,
  ksagZeta: 0.9,
  // 腰姿态保持：pitch 20° 时给约 −10°（实测 d(pitch)/d(spine) ≈ 1.9）
  kTorsoHold: 0.02,
  kTorsoHoldD: 0.02,
  maxTorsoDeg: 0.26,
  // 腰额状精调：~0.06 rad/m => 100mm 误差给 5.4 deg，限幅 8 deg，死区 50mm
  kWaistTrim: 0.06,
  maxWaistTrim: 0.14,
  // 142mm 误差 → 8°（= maxWaistTrim）。阻尼 0.9 ⇒ vz 871mm/s 时给 0.78rad（顶到限幅）
  waistKp: 1.0,
  waistKd: 0.9,
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
  // 横向阻尼：vz=0.4m/s 时给 32N·m（与静态项同量级、不同相位）
  // ★ 1.0 = 教科书值（K=a·m·ω₀²、D=a·m·2ζω₀，按 ω₀=√(g/h) 运行时推导）
  // ★ 20 档扫描（刚度 0.4~1.3× × 阻尼 0.8~1.8×）里**唯一**驻留 >0 的档：
  //   刚度 0.4×、阻尼 0.8× ⇒ 最小 X3 = **39mm**、驻留 **0.08s**、存活 1.52s
  //   （教科书基线 a·m·ω₀²≈85 ⇒ 刚度 ≈34 N·m/m，比教科书值**软 2.5 倍**）
  // ⚠⚠ **0.42s 的驻留（最小 X3 = 2mm）在本轮无法复现** —— 20 档全部 0.00s。
  //   期间新增了 `step.useKeyFrame`（默认 true，摆动腿改走 Perry 曲线），
  //   嫌疑最大，但未逐项排除。**在能稳定复现之前，不宣称已达成 0.42s。**
  latStiff: 0.4,
  latDamp: 0.8,
  latZeta: 1.0,
  // 承重腿位置环增益放大：loadFrac 0.5 ⇒ ×(1+0.5·gain)；默认 ×1.5
  // 实测：0.5 最优（驻留 0.33s）；1.0/2.0/4.0 全部更差
  postureLoadGain: 0.5,
  postureLoadSpine: true,
  // 脊柱前馈基线张力倍率（2025 J Neurophysiol 的前馈通路）。
  // ⚠ 实测是**单调权衡**，默认取 1.0（不额外加）：
  //   1.0× → 脊柱轴0 峰值 69°、X3=83mm、存活 2.98s
  //   1.5× → 54°、145mm、2.28s
  //   2.0× → 26°、141mm、**0.73s**
  //   2.5× → 14°、161mm、**0.67s**
  //   ⇒ 脊柱一硬，腰就不动、重心也不动（腰侧倾是本 rig 搬运重心的执行器）。
  //   这个权衡的解法不是调张力，而是**调站距**（见 架构设计.md 附录 A.6）。
  postureSpineTonic: 1.0,
  // 保护伺服护栏：迈步系统申报的转移意图在 CoP 侧缘余量不足时一律不加。
  latShiftCopMargin: 0.04,
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
const TMP_COP = new Float64Array(4);
const TMP_BB = new Float64Array(4);

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
  //
  // ★★ 2026-10-06 **加 `on('lat')`** —— 与块⑤ 同一类漏网，
  //   `probe:axisown` 门禁 B 实测抓到：「全消融（14 通道全关）」时
  //   `hip/0`、`hip_r/0` 仍在发 τ（τmax = 120，两根都打满）。
  //   根因同块⑤：`latOwnsAbduction` 只看 `latArmed`（姿态没倒）与
  //   `p.lateralEnabled`（默认 true），**两个都不查 `ablate`**。
  //   而 `AXIS_OWNERSHIP` 里 `latTransfer` 声明的正是 `channel: 'lat'`
  //   ⇒ 表说它是额状通道、可消融，代码却关不掉。
  //   代价实测：全消融存活 1.41 s < 零输出 4.48 s（差 3.1 s），
  //   其中这 120 N·m×2 的髋外展就是剩下的漏源。
  // ★ 消融开关。**必须声明在 `latOwnsAbduction` 之前**（2026-10-06）：
  //   给 `latOwnsAbduction` 补 `on('lat')` 门时发现它在下面 20 行才声明 ⇒
  //   TS2448「used before its declaration」。放到这里，因为它现在被
  //   `latOwnsAbduction`（额状归属的第一道判据）用到。
  const OFF = new Set((p.ablate ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  const on = (ch: string): boolean => !OFF.has(ch);

  const latOwnsAbduction = latArmed && p.lateralEnabled && on('lat');
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

  // ══════════════════════════════════════════════════════════════
  // ★★★ **全链 QP**（附录 C.1）—— 静态伺服平衡的机制本体
  // ══════════════════════════════════════════════════════════════
  //
  //  放在**所有其它通道之后**：QP 与它们**并联**在同一批轴上（轴归属表里
  //  登记为从属实现），执行顺序决定谁覆盖谁。让 QP 最后跑 ⇒ 它的解是本拍的
  //  最终值，语义上它就是"整条链的最终修正"。
  //
  //  ★ 开关语义：`ablate` **不含** `'qp'` 时才启用（见 `qpEnable` 的注释）。
  //    这样"想测纯逐关节 PD"只需要 `ablate: 'qp'`，符合 `ablate` 的直觉。
  // 启用条件：`qpEnable` 为 true，或 `ablate` 里**没有** `'qp'`（= 默认启用）
  if (doll && (p.qpEnable || on('qp'))) {
    const qp = wholeBodyBalanceTick(rs, doll, sup, {
      ankleMul: p.qpAnkleMul ?? 4,
      gain: p.qpGain ?? 1,
      iters: p.qpIters ?? 40,
    });
    rs.qpTick = qp;
    // ★ 可行性必须回读：QP 不可行时它给的是"尽力而为"的盒内点，
    //   此时必须让下游知道，否则会当成有效修正（又是静默失效）。
    rs.qpFeasible = qp.feasible;
    rs.qpResidual = qp.residual;
    // · 碰到摩擦锥上限 ⇒ 控制理论的前提不成立，下游必须知道
    rs.qpGrfSat = qp.grfSat;
  }

  // ★★ 载荷依赖姿势张力：每拍重算（漏算会把上一拍带进来）。
  if (doll && on('postureLoad')) {
    doll.resetToneScale();
    const supL = rs.supportLeg();
    const supLoad = supL === 'l' ? rs.loadFrac.l : rs.loadFrac.r;
    const gain = p.postureLoadGain;
    // 承重侧整条支撑链的矢状轴（髋屈伸/膝屈伸）+ 踝矢状
    for (const nm of [`hip_${supL}`, `knee_${supL}`, `foot_${supL}`]) {
      const j = jointIndexByName(rs.sk, nm);
      if (j < 0) continue;
      doll.setToneScale(j, 2, 1 + gain * supLoad);
    }
    // 髋外展轴：载荷越大越僵（它本来就是"托住"的通道，饱和时更需要刚度）
    const jh = jointIndexByName(rs.sk, `hip_${supL}`);
    if (jh >= 0) doll.setToneScale(jh, HIP_ABD_AXIS, 1 + gain * supLoad);
    // 脊柱额状轴：躯干是被外力扭到 35° 的主要受害者，必须吃这份张力
    if (p.postureLoadSpine) {
      for (const nm of ['spine1', 'spine2', 'spine3']) {
        const j = jointIndexByName(rs.sk, nm);
        // ★ 前馈基线张力（与载荷无关的那一份）+ 载荷依赖的那一份，两者相乘
        if (j >= 0) doll.setToneScale(j, 0, p.postureSpineTonic * (1 + gain * supLoad));
        // 矢状轴也吃前馈张力：躯干前后倾同样只有延迟反馈时会甩
        if (j >= 0) doll.setToneScale(j, 2, p.postureSpineTonic * (1 + gain * supLoad));
      }
    }
  } else if (doll) {
    doll.resetToneScale();
  }

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
    // ★ 只有旧伺服挡才上这条；DIP 挡下髋**只**有 `hipStiff` 被动刚度。
    //   论文里髋是纯被动的（Morasso 2019：「stabilized by a passive stiffness
    //   mechanism」），而 K_h 必须**过临界**才稳得住上身。
    if (!p.dipSagittal && on('hip') && jHip >= 0) {
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
    //
    // ══════════════════════════════════════════════════════════════
    // ★★★ 2026-10-06 **腰矢状主动 PD 整体删除**（`requestAngle(spine*/2)` 那条）。
    //
    // 依据（人类文献，两篇互相独立）：
    //   Winter 1996, *J Neurophysiol* 75(6):2334 — 静立时两个平衡机构
    //     **完全分离**，且**都不在腰上**：
    //       双脚并行站姿：矢状(A/P) = **踝**跖屈/背屈；额状(M/L) = **髋**外展/内收
    //       *"A straight line joining the individual COPs under each foot is the
    //         load/unload line controlled by the **hip** mechanism. At right
    //         angles to this load/unload line ... is the independent control
    //         line by the **ankle** muscles."*
    //       —— 腰在两张表里都**不出现**。
    //   Winter 1998, *J Neurophysiol* 80(3):1211 — 定量：
    //       矢状刚度在踝跖屈肌，`Ke ≈ 850 N·m/rad ≈ 15 N·m/deg`
    //       **COP 是控制量、COM 是被控量**；`Ma = R·px`（踝力矩 ∝ CoP 偏移）
    //       COP 与 COM **同相**（滞后 4 ms）
    //       额状靠**髋换载荷**："the hip moments change in phase with the sway,
    //       causing the **unloading of one limb and instantaneous loading of
    //       the other**"
    //   Horak & Nashner 1986 — 踝策略的肌肉激活是**远端→近端**
    //     （ankle → thigh → trunk），躯干肌肉**最后被动参与**，不是发起者。
    //
    // ⇒ 腰**不参与平衡**。它唯一的作用是抵抗自重下的折叠（Jeffs / Shirazi-Adl：
    //   静立时腰多裂肌仅 **3% MVC**，>5% 即疲劳不可行）。
    // ⇒ 矢状平衡交给**踝**（`kVipAnkle` 那套 VIP），额状交给**髋外展**（`latTransfer`）。
    //
    // ⚠ 这条 PD 之前的问题（实测 `tools/dbg-pitch`）：
    //     `kTorsoHoldD == kTorsoHold`，但 `rate`(°/s) 量级是 `pitch`(°) 的 10~20 倍
    //     ⇒ 阻尼项单独饱和到 ±14.9°。躯干只在轻轻晃（pitch < 3°），腰输出已打满。
    //   而且同一目标角发给 3 个串联脊柱关节 ⇒ 累计 3× = 45° > 单段限位 25°。
    //
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
    // ★★ 腰额状 = **PD 伺服**（不是饱和 bang-bang）。
    //
    //   实测（锁定修好、翻转=0 之后）：腰 8° 时 `com.z` 差只剩 **8mm**（门限 50mm）
    //   ⇒ **腰是唯一有权限把重心送到支撑脚上方的执行器**。但旧式
    //   `-sign(err)·shortFrac·max` 是**纯 P + 饱和**，没有任何阻尼：
    //   实测 `vz` 峰值 **871 mm/s**、`com.z` 冲过头 **349mm**，
    //   X3 驻留只有 0.08s（需要 1.00s）—— 到位了但停不住。
    //
    //   加 D 项直接对 `com.vz` 制动。文献依据：Batenie 2014（Gait & Posture）
    //   用 **PD**（不是 P/ bang-bang）拟合 75 人的侧向体重移动，
    //   平均速度误差 0.35%。
    //
    //   ⚠ 目标仍是 `soleZ[支撑腿]`（见上面长注释），符号与旧式同向。
    const waistErr = rs.com.z - (rs.soleZ[sup] ?? 0);   // >0 = 重心还在支撑脚外侧
    const waistCmd = -(p.waistKp * waistErr + p.waistKd * rs.com.vz);
    // `shortFrac` 仍参与：余量充足时不需要满幅腰倾（省能量、避免代偿姿态）
    const gate = 0.35 + 0.65 * shortFrac;
    rs.waistTrim = clamp(waistCmd * gate, p.maxWaistTrim);
    rs.waistErrLat = capErrLat;
    // ── ★ 躯干侧倾：本通道的**主力**，精调退化为附加小量 ──────────────
    //   `rs.shiftLeanDemand` 由 **stepSystem** 在转移相申报（见 step.ts ⓪）。
    //   平衡系统对它只做一件事：**限幅**（`shiftLeanMax` 与 `maxWaistTrim`
    //   取小），保证不撞脊柱关节限位、不进入 Inman 表里那个靠"力臂变长"
    //   才能把外展肌活动归零的代偿档位。
    //   意图为 0 时本系统仍然是纯保护伺服（只有静态保持 + 阻尼）。
    //
    // ⚠⚠ 2026-10-06：**这条 `requestAngle` 通道整个删除**（连同上面的 `waistTrim`
    //   伺服），依据是 Winter 1996 / 1998 的两个机构表 —— 额状平衡由
    //   **髋外展换载荷**（`latTransfer`，`τ = m·g·Δz`）负责，**不在腰上**。
    //
    //   实测它为什么有害（`tools/dbg-who`，腰/额状）：
    //     目标 0.160（归一化）→ 折 15°，三段累计 → 折到 +17.5°，
    //     且 `ownerLabel` 恒为「腰额状精调/卸载髋」而关节继续滑到 +36.1°
    //     （限位 ±15°）⇒ **目标被设了、但没有执行力**（因为同时有 `requestHold`）。
    //
    //   ⇒ 额状搬运唯一正确的载体是**髋外展**（换载荷），腰不承担。
    //     `waistTrim` 保留为**诊断量**（UI 回读「还差多少到支撑脚」）。
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
  // ★ 走关节回读网关（文档 §18 R1）。网关只做 **单位**换算（rad→deg），
  //   **不换符号** —— 本 rig 髋/膝限位「负 = 屈」这个事实由本行自己负责。
  const jq = rs.jointRead();                     // §18：唯一读关节的入口
  const kneeNow = jq.angleDeg(jKnee, 2) / D2R;   // 网关给 deg，除回 rad 保持下游不变
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
  const hipNow2 = jq.angleDeg(jHip, 2) / D2R;
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
      // ★★ Winter 1998 的额状**刚度伺服**：对**参考点**（支撑脚上方）的误差，
      //   而不是对髋。`τ = a·m·(ω₀²·(z_ref − z) + 2ζω₀·(−ż))`。
      //   旧律 `m·g·(com.z − hip.z)` 只负责**静态重力平衡**（零点在髋），
      //   它**不搬运**重心；搬运靠下面这两项。
      const zRefLat = rs.soleZ[sup] ?? rs.com.z;
      // ★ 刚度/阻尼**按倒立摆固有频率运行时推导**，不写死魔数：
      //     ω₀ = √(g/h)（h = CoM 高出支撑面）  →  Winter 1998: Ke = I·ω₀²
      //     K_lat = a·m·ω₀²      D_lat = a·m·2ζω₀
      //   实测（rigState.omega0()）：h≈0.965 ⇒ ω₀≈3.19 rad/s
      //   a=0.119m、m=70kg ⇒ K≈85 N·m/m、D≈53 N·m·s/m（ζ=1）
      //   独立扫参的最优点 (K=100, D=66) ⇒ 反推 ω₀=3.46、ζ≈1.2，**与理论一致**。
      //   ⇒ `latStiff`/`latDamp` 只作为**相对倍率**（默认 1 = 教科书值）。
      const w0Lat = rs.omega0();
      const armLat = 0.119;          // 实测：髋锚点离整机 CoM 的水平力臂
      const mLat = sk.cfg.mass;
      const kLatBase = armLat * mLat * w0Lat * w0Lat;
      const dLatBase = armLat * mLat * 2 * p.latZeta * w0Lat;
      const tauStiff = p.latStiff * kLatBase * (zRefLat - rs.com.z);
      const tauDamp = -p.latDamp * dLatBase * rs.com.vz;
      const tauRaw = tauStatic + tauDyn + tauStiff + tauDamp;
      // ★ 驱动**不在这里**。髋外展回到它的文献职责：**托住**重心（Pandy 2010：
      //   abductors 把 CoM 加速向内 = 保持/承重），不是搬运重心。
      //   搬运由「摆动侧腿蹬地横向 GRF」做，见本文件末尾的 `τ=JᵀF` 驱动段。
      const tauAdj = Math.abs(tauRaw) <= p.latHipDead ? 0 : tauRaw;
      const tmax = rs.sk.joints[jHip]!.maxTorque[HIP_ABD_AXIS]!;
      rs.hipLatTau = clamp(tauAdj, tmax);
      if (Math.abs(rs.hipLatTau) > 0.5) {
        rs.requestTorque(jHip, HIP_ABD_AXIS, rs.hipLatTau, 'balance',
          `髋外展(静${tauStatic.toFixed(0)}+刚${tauStiff.toFixed(0)}+阻${tauDamp.toFixed(0)})`);
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

  // ══════════════════════════════════════════════════════════════
  // ⑤ ★ 横向重心**驱动**：`τ = JᵀF`，链 = **摆动侧（轻）腿** + 脊柱
  // ══════════════════════════════════════════════════════════════
  //   文献：
  //   · **Pandy 2010**（JB Biomech）：把 CoM 加速向外的是**髋内收肌**，
  //     髋外展肌是加速向内的 —— 所以驱动通道必须在**内收方向**，
  //     且力矩走 `hip/0`（内收/外展同轴，见 `HIP_ABD_AXIS`）。
  //   · **Batenie 2014**（Gait & Posture）：横向 GRF 来自**反向腿**（轻腿）蹬地。
  //
  //   ★ 职责边界（保持干净）：
  //     · step 决定「**要多大力**」（`rs.shiftDemandF`，N）—— 已含 ω₀/ζ 控制律；
  //     · balance 只做「**能不能给**」：三条护栏 + `τ=JᵀF` 映射。
  //       `rs.shiftDemandF === 0` 时本系统**完全不驱动** = 纯保护伺服。
  //   护栏（任一不过 ⇒ 本拍不驱动）：
  //     ① **驱动脚** CoP 侧缘余量：蹬地会把压力中心推出支撑面，跑出去救不回；
  //     ② **支撑脚** CoP 侧缘余量：横向力改变载荷分配，支撑脚先到边就翻；
  //     ③ 力矩由各轴 τmax 物理夹住（`arbitrate` 里），这里不重复限。
  //
  // ★★ 2026-10-06 **加 `on('lat')` 门** —— 这是「消融工具说谎」的**第四次**复发，
  //   也是第一次被探针**当场定量抓到**（前三次都只有事后归因）：
  //
  //   原条件 `rs.shiftDemandF !== 0 && rs.shiftDriveSide && doll` 里**没有一个
  //   能被 `ablate` 关掉**：`shiftDemandF` 由 `stepSystem` 直接写（step.ts:180），
  //   只看相位（`SHIFT`/`DOUBLE` 且交接未成），**根本不查 ablate**。
  //   ⇒ 跑「全消融」时本块照发 `τ=JᵀF`。
  //
  //   实测代价（`npm run probe:axisown` 门禁 B，14 个通道全关）：
  //     零输出（完全不经过 Controller）  存活 **8.97 s**
  //     全消融（仍经过 Controller）      存活 **2.22 s**，且在 **27 根轴**发 τ
  //   27 根轴逐位对得上本块的写入集合：hip_l/r 0-2、knee_l/r 0-2、
  //   foot_l/r 0-2、spine1-3 的 0 与 2（本块 `for ax in 0..2` 无差别写，
  //   逐帧按 `|τ| > 0.05` 过滤 ⇒ 某些轴偶尔不过阈值，所以 spine1/1、spine2/1
  //   没进名单，但**它们同样在被请求**）。
  //
  //   ⇒ 结论：**控制器"什么都不做"比"什么都不经过 Controller"早死 6.7 秒**。
  //     杀死角色的是这条通路本身，不是任何一条控制律的调参问题。
  //
  //   为什么门是 `on('lat')` 而不是别的：本块是**额状**驱动（作用点 CoM、
  //   沿 +Z 推），`AXIS_OWNERSHIP` 里额状通道 `latTransfer` 声明的正是
  //   `channel: 'lat'`（balance.ts:127）⇒ 表与接线在此处必须一致。
  if (on('lat') && rs.shiftDemandF !== 0 && rs.shiftDriveSide && doll) {
    const drive: Side = rs.shiftDriveSide;
    // ★★ 2026-10-06 **口径收敛**（`架构_v2_三模块协作.md` §20.3）：
    //   CoP 不再自己 `readCoP`，改读状态机发布的力链 `rs.groundChain`。
    //   理由：这两处此前各有一套口径（`readCoP` 用 `numSolverContacts`，
    //   而 `footLoadFrac` 用 `numContacts`）⇒ 实测出现「力链说左脚接触块 0、
    //   载荷读 0.53」同时成立，平衡系统按假载荷去控一条没着地的腿。
    //   `footSoleBounds` 是**纯几何**（脚自己的包围盒），不是接触读数，保留。
    const gc = rs.groundChain;
    const copZOf = (d: Side): number | null => {
      if (!gc) return null;
      const ff = d === 'l' ? gc.l : gc.r;
      return ff.copValid ? ff.copZ : null;
    };
    const copDrive = copZOf(drive);
    const copSup = copZOf(sup);
    // 护栏①/②：任一 CoP 不可信 ⇒ **不许驱动**（保守：宁可不搬，也不拿假 CoP 搬）
    // ⚠ CoP 不可信时**不能直接拒绝驱动**：起步阶段只有一脚吃重、另一脚 CoP 无效，
    //   若拒绝 ⇒ 侧向搬运永不发生 ⇒ 重心回不到双脚 ⇒ 死锁（实测 DOUBLE 卡 127 拍）。
    //   ⇒ 退回"用能拿到的那只脚"的老行为，并把不可信**显式记进 violations**（不静默）。
    const bound = (d: Side): number => {
      doll.footSoleBounds(d === 'l' ? 0 : 1, TMP_BB);
      return TMP_BB[2]!;
    };
    const driveMed = copDrive === null ? 0 : copDrive - bound(drive);
    const supMed = copSup === null ? 0 : copSup - bound(sup);
    if (driveMed >= p.latShiftCopMargin && supMed >= p.latShiftCopMargin) {
      const chain: number[] = [];
      for (const nm of [`hip_${drive}`, `knee_${drive}`, `foot_${drive}`, 'spine1', 'spine2', 'spine3']) {
        const i2 = jointIndexByName(rs.sk, nm);
        if (i2 >= 0) chain.push(i2);
      }
      // 作用点 = CoM；`fz` 就是横向力（正 = 把重心推向 +Z）
      doll.jacobianTorque(0, 0, rs.shiftDemandF, rs.com.x, rs.com.y, rs.com.z, chain, TMP_TAU);
      const dHip = jointIndexByName(rs.sk, `hip_${drive}`);
      let applied = 0;
      for (let i2 = 0; i2 < chain.length; i2++) {
        const jj = chain[i2]!;
        for (let ax = 0; ax < 3; ax++) {
          const t = TMP_TAU[jj * 3 + ax]!;
          if (Math.abs(t) > 0.05) {
            rs.requestTorque(jj, ax, t, 'balance', `横向驱动·${drive}腿(JᵀF)`);
            applied += Math.abs(t);
          }
        }
      }
      rs.shiftPushTau = applied;
      if (dHip >= 0) rs.clearHold(dHip, HIP_ABD_AXIS);
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
    // ══════════════════════════════════════════════════════════════════
    // ★★★ 矢状踝：**VIP 刚度**（力矩输出），2026-10-04 按《平衡态设计.md》§4.1②
    //
    //   改的是什么：原来是「位置伺服追一个 CoP 目标角」
    //       θ_ref = −kCopSag·(ξ−CoP) − kCopSagD·vx
    //   —— 它把「要多少 CoP 位移」翻译成「要多少踝角」，中间多了一层间接映射，
    //   而且有效刚度 = `kP/量程`，随护栏 `α` 与量程漂移，**无法保证落在临界的 88%**。
    //
    //   换成文献的结构（Morasso2019, PLOS ONE 14:e0213870）：
    //       q_vip = atan2(com.x − ankle.x , com.y − ankle.y)   ← VIP 摆角
    //       τ_ankle = K_a · q_vip  +  C_a · q̇_vip
    //   依据：`τ_g = m·g·h·sin(q) ≈ m·g·h·q` ⇒ **K_crit = m·g·h**。
    //   本 rig 实测 `m=70.0 kg`、`h = CoM.y − 踝 = 0.913 m`
    //   ⇒ `K_crit = 627 N·m/rad`；取 **K_a = 552 = 0.88·K_crit**（欠临界 12%）。
    //   人体实测依据：Loram & Lakie 2002 实测踝刚度 = 临界的 **91 ± 23%**，
    //   原文「insufficient to stabilise」⇒ **刻意欠临界**。
    //
    //   ★ 为什么这层映射是对的（关键）：
    //     静力平衡时 CoP 必须落在重力垂线上，而 `τ_ankle` 恰好把 CoP 移到 `q_vip`
    //     （CoP 位移 = τ/F_z，F_z = m·g）⇒ **`τ = K_a·q_vip` 直接就是 CoP 权限**，
    //     不经过「目标角 → 位置环 → 力矩」这条会失准的路。
    //   ★ 量级自洽：实测 `com.x` 偏 24 mm 时 `q_vip = −0.026 rad`
    //     ⇒ `τ = 552 × −0.026 = −14.5 N·m`，与「m·g·Δx = 16.5 N·m」同量级 ✓
    //
    //   ★ `mode: 'tau'`（见 `AXIS_OWNERSHIP`）：与位置伺服**互斥**，同轴双计= 门禁冲突。
    //   ★ S1 只上**刚度**（不加延迟反馈）：按文献 12% 的欠临界，
    //     纯被动刚度只能给**边缘稳定**，预期仍会缓慢发散 —— S3 再补间歇反馈。
    //     这次的验收看的是「刚度有没有把发散速率压下来」，不是「能不能站住」。
    // ══════════════════════════════════════════════════════════════════
    if (doll) {
      const ankW = new Float64Array(3);
      doll.jointWorld(jAnk, ankW);
      const dxv = rs.com.x - ankW[0];
      const hv = Math.max(0.2, rs.com.y - ankW[1]);
      // VIP 摆角：从踝指向全身 CoM 的倒立摆角
      const qVip = Math.atan2(dxv, hv);
      // q̇_vip：解析求导 `q = atan2(dx, h)` ⇒ `q̇ = (h·ẋ − dx·ḣ)/(dx²+h²)`
      //   （标准 LIPM 假设：把踝当固定支点 ⇒ ẋ=com.vx、ḣ=com.vy）
      const qVipRate = (hv * rs.com.vx - dxv * rs.com.vy) / (dxv * dxv + hv * hv);
      // 阻尼 `C_a = 2ζ√(K_a·I)`，I = **全身绕踝**的转动惯量。
      //   ★ 2026-10-04 修：原来写的是 `doll.jointIeff[jAnk * 3 + 2]` ——
      //   `jointIeff` 的长度是**关节数**（按关节索引，不是按轴），`jAnk*3+2` 必然越界
      //   ⇒ 永远取 `?? 8.77e-3` 那个 2D 时代的兜底常数。
      //   于是 `C_a = 2×0.9×√(552×0.00877) = 4.0 N·m·s/rad`，
      //   而正确值（`I = m·h² = 70×0.913² = 58.3 kg·m²`）是 **323 N·m·s/rad**
      //   ⇒ **阻尼小了 80 倍**，等效阻尼比 ≈ 0.01 ⇒ 踝实质无阻尼 ⇒ 必然发散。
      //   `inertiaAboutJoint` 按平行轴定理 `Σ(mᵢrᵢ² + I_com,ᵢ)` 正经算，且可回读。
      const iAnk = Math.max(1e-4, doll.inertiaAboutJoint(jAnk));
      const cVip = 2 * p.vipZeta * Math.sqrt(p.kVipAnkle * iAnk);
      let tauAnk = p.kVipAnkle * qVip - cVip * qVipRate;

      // ══════════════════════════════════════════════════════════════
      // ★★ S3：踝的**间歇延迟反馈**（Bottaro 2008 / Asai 2009 / Morasso 2019）
      // ══════════════════════════════════════════════════════════════
      //   被动刚度 `K_a·q_vip` 是**常开**的（它就是"踝肌肉的本征刚度"，
      //   刻意欠临界：Loram & Lakie 2002 实测踝刚度只有临界的 60~91%，
      //   Morasso 原文明确 *insufficient to stabilise*）。
      //   欠临界刚度单独只能给**边缘稳定** —— 必须再叠这个间歇反馈才站得住。
      //   实测依据（tools/probe-midfoot.ts E5）：没有它时 CoM.x 单调漂到 +207mm、
      //   τ踝 饱和 −120 N·m、2.37s 倒地。
      if (on('ankleCop')) {
        const dtC = rs.dtCtrl > 1e-6 ? rs.dtCtrl : 1 / 60;
        // ω₀ = √(K_crit / I) = √(m·g·h / I)（K_crit = mgh，见 params 注释）
        // ★ 2026-10-04 修：**漏了质量 m**（写成 √(g·h/I)）⇒ ω₀ 小了 √70 ≈ 8.4 倍
        //   （实测 0.26 而不是 3.28 rad/s）⇒ `a = −ω₀ ≈ 0` ⇒ 切换边界退化成
        //   坐标轴（论文里 a=0 的"象限版"）⇒ γoff 读出 51~91、开关只有 4 次，
        //   整个间歇机制等于常开。
        const omega0 = Math.sqrt(Math.max(1e-6,
          sk.massTotal * 9.81 * Math.max(0.05, rs.com.y - ankW[1])
          / Math.max(1e-4, doll.inertiaAboutJoint(jAnk))));
        const a = p.vipOmegaFrac * omega0;
        rs.vipOmega = omega0;
        // 推入本拍状态，判据用 `delayTicks` 拍之前的样本
        rs.pushVip(qVip, qVipRate);
        rs.vipDelayed(p.vipDelaySec / dtC, rs.vipD1);
        const qD = rs.vipD1[0]!, qdD = rs.vipD1[1]!;
        // ★ 切换：ON ⟺ q_δ·(q̇_δ − a·q_δ) < 0（离开稳定流形才需要主动推）
        // ★★ 切换判据的符号修正（2026-10-05，实测定位）
        //
        //   原写 `q_δ·(q̄_δ − a·q_δ) < 0 ⇒ ON`，代入 `a = −ω₀` 后等价于
        //   `q̄_δ + ω₀·q_δ < 0`。
        //   实测结果（箭慎站立）：`q_δ=+23.2°`、`q̄_δ=+60.3°/s`
        //   → `60.3 + 2.77×23.2 = +124 > 0` ⇒ 判据不成立 ⇒ **反馈永远不启动**。
        //
        //   论文的正确形式（Morasso / Suzuki, J Theor Biol 2012）：
        //       ON  ⇔ q_δ·(q̄_δ + α·q_δ) > 0
        //       OFF ⇔ q_δ·(q̄_δ + α·q_δ) < 0
        //   ON 区是**第一、三象限**（`q` 与 `q̄` **同号**）——正是“正在离远、该推回来”
        //   的区域。原判据把第一、三象限误判为 OFF ⇒
        //   形成**单向门**（能刹车、不能起步）。
        //
        //   人体实测支持这一机制真实在用：Loram 2011, Proc R Soc B 278:2440–2446
        //   静立时每 1 次单向 CoM 摆动配 **2.8 次**“投—接”式踝力矩脉冲，
        //   肉长调整幅度仅 30–300µm。不是连续比例控制。
        //
        //   ⇑ 保留 `a` 的形式与默认值（a = −ω₀ 仍对应稳定流形），
        //   只把判据改成 `> 0`（就是 `q̄_δ − a·q_δ > 0`，因 `a<0` 等价于 `+ ω₀q`）。
        const wantOn = qD * (qdD - a * qD) > 0;
        // ★ 诊断回读：判据的四项全部可读，否则“vipOn 为 false”无从分辨。
        rs.vipDiag = { qD, qdD, a, prod: qD * (qdD - a * qD),
          delayTicks: p.vipDelaySec / dtC, omega0, q: qVip, qVipRate };
        if (wantOn !== rs.vipOn) { rs.vipOn = wantOn; rs.vipSwitches++; }
        // ★ 诊断 γoff：**带符号**，这样才能区分稳定/不稳定流形。
        //   γoff = −q̇/(ω₀·q)：稳定流形 q̇ = −ω₀q ⇒ **+1**；不稳定流形 ⇒ **−1**。
        //   ⚠ 2026-10-04 修：原来用 (q̇/ω₀)²/q²（无符号）⇒ 在**两条流形上都等于 1**，
        //     于是读出 γ≈0.7~1.2 看起来"贴流形"，其实分不清正在收缩还是在发散 ——
        //     实测正是这样：γ≈0.8、ON占比 0%，而 CoM.x 仍冲到 600mm（**沿不稳定流形跑**）。
        const qAbs = Math.abs(qD);
        rs.vipGamma = qAbs > 1e-5 ? -qdD / (omega0 * qD) : Infinity;
        // off 相过零时间（论文式 9）：γ>1 才谈得上"还要多久过零"
        const g = rs.vipGamma;
        rs.vipTCross = g > 1 ? p.vipDelaySec * Math.log((1 + g) / Math.abs(1 - g)) : 0;
        if (rs.vipOn) {
          tauAnk += p.vipP * qD + p.vipD * qdD;
        }
        rs.settleOffPhase(qVip);
      }
      // 蹬离相：跖屈把地面反力斜向前 ⇒ 这是**前进的唯一来源**
      if (rs.state === 'PUSH') tauAnk += DEFAULT_WANTED_FORCE.weight * Math.abs(p.pushDeg) * D2R;
      // ── 安全钳位：**必须**把请求值限在马达力矩上限内 ──────────────
      //   实测（无钳位）：末端 `q_vip = −77°` ⇒ 请求 **−757 N·m**，
      //   而 `τmax(foot/2) = 120 N·m` ⇒ **超出 6.3 倍**。
      //   冲量级通道（`requestTorque` → `applyTorqueImpulse`）**不经过马达限幅**
      //   （《架构设计.md》`enforceLimits` 修复记录第 2 条），所以请求值必须自己钳。
      //   文献上这正是 **flat-foot 约束**：CoP 走到脚掌边缘后踝力矩**自动饱和**
      //   （Michaels & Ting 2025：「limited ankle torque coupled with
      //   increased hip joint kinematics」）⇒ 饱和不是 bug，是策略的切换点。
      const tauMaxAnk = sk.joints[jAnk]?.maxTorque?.[2] ?? 120;
      rs.ankleTauVip = clamp(tauAnk, tauMaxAnk);   // 本文件 clamp 是对称两参版
      rs.ankleTauSat = Math.abs(tauAnk) > tauMaxAnk;   // 饱和标志（切髋策略用）
      rs.qVip = qVip;
      rs.requestTorque(jAnk, 2, rs.ankleTauVip, 'balance', '踝VIP刚度');
    }

    // ── 额状面 CoP：**踝做不到，改由中足（距下关节）承担** ────────────
    //   ⚠ 2026-10-04 修（原来这里是 `requestAngle(jAnk, 0, ...)`，一个**物理上不存在**
    //   的通道）：踝建成的是**绕足横轴的 revolute**（`revoluteAxis = [0,0,1]`），
    //   轴 0/1 被 `JointData.revolute` 在**引擎级锁死**（`ragdoll.createJoints` 里
    //   `setLimits` 只对 revoluteAxis 对应的那一轴生效）⇒ 给轴 0 下角度伺服
    //   在物理上**不可能产生任何运动**，只是让门禁看到一根"被写过但没登记"的轴
    //   （实测 `probe-axisown` E 段报 `foot_l/0, foot_r/0` 未登记）。
    //   ⇒ 额状面 CoP 权限归**中足**（`midfoot_*`，绕足长轴的旋前/旋后）——
    //   这正是柔性足存在的意义（内侧弓/外侧柱两条载荷路径，见 createJoints 注释）。
    const jMid = jointIndexByName(sk, sup === 'l' ? 'midfoot_l' : 'midfoot_r');
    // ★★ 2026-10-06 加 `on('ankleLat')` 门 —— 门禁 A2 查出来的**第五次**
    //   「消融工具说谎」：表里 `midfoot/0` 登记 `channel:'ankleLat'`，
    //   而这里**根本没有 `on(…)`** ⇒ `ablate:'ankleLat'` 关不掉它。
    //   ⇒ 「全消融」里这条位置伺服仍在发指令（门禁 B 的存活秒数因此不可信）。
    if (jMid >= 0 && on('ankleLat')) {
      const latErr = rs.dcm.z - rs.support.cz;
      // 中足旋前/旋后 → 前足内/外侧缘一抬一压 ⇒ 载荷在两柱之间转移（侧向 CoP）
      rs.requestAngle(jMid, 0, clamp(p.kCopLat * latErr, p.maxAnkleLat), 'balance', '中足额状CoP');
    }
  }

  // ══════════════════════════════════════════════════════════════════
  // ★★★ DIP 的**髋侧被动刚度**（Morasso 2019/2022）—— 支撑腿的髋
  // ══════════════════════════════════════════════════════════════════
  //   `τ_hip = K_h·q_hip + B_h·q̇_hip`，纯被动，**不需要主动反馈**。
  //
  //   为什么要它（这是"踝刚度刻意欠临界"的直接后果）：
  //     原文实测踝刚度只有临界的 60~91%，明确「insufficient to stabilise」
  //     ⇒ 欠临界的踝只能给**边缘稳定**，兜住上身要靠**过临界的髋被动刚度**。
  //     之前本 rig 只有踝那半边 ⇒ 踝力矩在 ±0.217 rad 处饱和（τmax=120/552）
  //     而倾角继续长 ⇒ 2 s 内必倒（实测 trace：t=1.5 s τ=−120 N·m 已饱和）。
  //
  //   `I_hip` 用**该侧上身**（HAT）绕髋的惯量：`inertiaAboutJoint(jHip, side)`
  //   ⇒ 自动满足 DIP 的"分段"定义（踝管全身、髋只管上身）。
if (doll && on('hipStiff')) {
    const jHipS = jointIndexByName(sk, sup === 'l' ? 'hip_l' : 'hip_r');
    if (jHipS >= 0) {
      const side: 'l' | 'r' = sup === 'l' ? 'l' : 'r';
      const iHip = Math.max(1e-4, doll.inertiaAboutJoint(jHipS, side, true));
      const bHip = 2 * p.vipZetaHip * Math.sqrt(p.kVipHip * iHip);
      // 髋矢状角：关节角已减去 restRad（零位 = 素材姿势），直接可用
      // ★ 走网关（§18 R1）。⚠ 网关给的是 **deg** ⇒ 必须除回 `D2R`，
      //   否则刚度 `K_h·q` 的量纲差 57 倍（这个坑与"单位混用"同类）。
      const jq2 = rs.jointRead();
      const qHip = jq2.angleDeg(jHipS, 2) / D2R;
      const qHipRate = jq2.velDegPerSec(jHipS, 2) / D2R;
      const tauMaxHip = sk.joints[jHipS]?.maxTorque?.[2] ?? 200;
      const qLim = p.maxHipStiffDeg * D2R;
      // ★ 弹簧项：`−K_h·q`（回复到 0 rad），**限的是"送进弹簧的角度"不是"两项之差"**。
      //   写成 `K_h·(clamp(q) − q)` 的话，在限位内恒等于 **0** —— 刚度整个消失
      //   （这是第一版的 bug，实测关踝基线 6.00 s → 3.23 s）。
      //   ⚠ 本文件的 `clamp` 是**对称两参版** `clamp(v, max)` = 限到 ±max。
      const qEff = clamp(qHip, qLim);
      // ★ 阻尼项：**负号**。力矩必须**反抗**角速度。
      //   写成 `+B·q̇` 是正反馈（越晃越加力）⇒ 等效阻尼比变负 ⇒ 必然发散。
      //   参照 `ragdoll.driveMotors` 的 `err = kP·(θ_ref−θ) − kD·ω_rel`：阻尼恒带负号。
      let tauHip = -p.kVipHip * qEff - bHip * qHipRate;
      tauHip = clamp(tauHip, tauMaxHip);
      rs.hipTauStiff = tauHip;
rs.requestTorque(jHipS, 2, tauHip, 'balance', '髋被动刚度');
    }
  }
}