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

export interface BalanceParams {
  /**
   * 膝的**屈曲限位**（deg）—— 超过就顶回来。
   * ★ 不是目标角：站立时膝角近似恒定（Li & Levine 2010），零输出时 PD 已保持绑定角。
   *   实测把它当目标用 ⇒ 只留膝这一条就把存活从"站满 8s"打成 2.6s。
   */
  kneeHoldDeg: number;
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
  torqueControl: false,
  lateralEnabled: false,
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

export function balanceSystem(
  rs: RigState, p: BalanceParams = DEFAULT_BALANCE_PARAMS, doll?: Ragdoll,
): void {
  const sk = rs.sk;
  const sup: Side = rs.supportLeg();
  // ★ 支撑腿是否已确定：**唯一判定在 `wantedForce.stanceResolved()`**
  //   （此前 `latArmed` 在本文件算一遍、相位机在 gaitState 再算一遍 ⇒ 边界不清）
  const latArmed = stanceResolved(rs);
  const jHip = jointIndexByName(sk, sup === 'l' ? 'hip_l' : 'hip_r');
  const jKnee = jointIndexByName(sk, sup === 'l' ? 'knee_l' : 'knee_r');
  const jSp1 = jointIndexByName(sk, 'spine1');
  const jSp2 = jointIndexByName(sk, 'spine2');
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

  // ══════════════════════════════════════════════════════════════
  // ★ 支撑腿是否已确定：**唯一判定在 `wantedForce.stanceResolved()`**
  //   （此前 `latArmed` 在本文件算一遍、相位机在 gaitState 再算一遍 ⇒ 边界不清）
  // ══════════════════════════════════════════════════════════════
  // ① 矢状面：**不再有手写 P 控制器**
  //   原式 `hipTgt = -kSagP·ex - kSagD·vx`（直接给目标角）已删除 ——
  //   它与 `τ = JᵀF` 是**两套控制哲学并存**，而且符号只能靠实测猜
  //   （已猜反过一次：髋 **正**才是屈曲）。
  //   现在矢状面与额状面、垂直支撑走**同一条** `τ = JᵀF`：
  //   区别只在 `F_desired` 的哪个分量非零。
  //
  //   位置伺服在此轴**让位**（只留阻尼），定量支撑全部由力矩通道给。
  if (jHip >= 0) rs.requestHold(jHip, 2, 'balance', '支撑髋让位给τ=JᵀF');
  if (jKnee >= 0) rs.requestHold(jKnee, 2, 'balance', '支撑膝让位给τ=JᵀF');

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
      maxTrunkLeanRad: p.maxTrunkLean,
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
    // 累加后**一次性**请求：同优先级下 `requestTorque()` 只保留第一次
    for (const i2 of chain) {
      for (let k2 = 0; k2 < 3; k2++) {
        const v = TMP_TAU[i2 * 3 + k2]!;
        if (Math.abs(v) > 0.5) rs.requestTorque(i2, k2, v, 'balance', `τ=JᵀF·${rs.sk.joints[i2]!.name}/${k2}`);
      }
    }

    // ④a ★★ 骨盆抬升（pelvic hike）—— 平衡与迈腿留空间**共用**支撑髋外展
    //   机理（Saunders 1953, "The classic index of gait"）：摆动侧骨盆抬高
    //   2~5 cm 是最小足净空的决定因素，由**支撑侧髋外展**产生（Trendelenburg 的反向）。
    //   ⚠ 与上面的 `τ=JᵀF` **同轴**（髋/1）。所以它是**偏置**：走位置通道，
    //     形成"抬起来并保持"的刚度；`τ=JᵀF` 走力矩通道做定量平衡。二者并联叠加。
    //   ⚠ 且该轴已在上面 `requestHold` 让位 ⇒ 位置环只剩阻尼，不会产生刚度。
    //     ⇒ 所以抬升必须作为**独立的 JᵀF 分量**或走常规模型，不能靠让位后的位置环。
    //     这里保留为显式的位置请求（把让位排除在该轴之外）：
    if (on('pelvicLift') && (p.kPelvicLift > 0 || p.targetClearance > 0) && jHip >= 0) {
      const sw = rs.swingLeg();
      const clr = rs.soleY[sw] ?? 0;
      rs.swingClearance = clr;
      const pelv = clamp(
        p.pelvicLiftSign * (p.kPelvicLift + p.kClearance * (p.targetClearance - clr)),
        p.maxPelvicLift,
      );
      rs.pelvicLift = pelv;
      // 该轴交回给位置伺服（抬升是位置/刚度效应，不是定量力矩）
      rs.clearHold(jHip, 1);
      rs.requestAngle(jHip, 1, pelv, 'balance', '骨盆抬升(给迈腿留空间)');
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
  if (jAnk >= 0) {
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