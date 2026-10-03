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
import type { Ragdoll } from '../ragdoll';
import type { RigState, Side } from '../rigState';

export interface BalanceParams {
  /** 矢状面：髋策略比例增益（rad/s per m） */
  kSagP: number;
  /** 矢状面：髋策略阻尼。★ 实测纯 P 已足够，加 D 会共振 */
  kSagD: number;
  /** 矢状面：躯干对齐 GRF 力线的增益 */
  kTorsoAlign: number;
  /** 额状面：躯干（唯一通道 spine1/0）比例增益 */
  kLatP: number;
  kLatD: number;
  /**
   * 膝的**屈曲限位**（deg）—— 超过就顶回来。
   * ★ 不是目标角：站立时膝角近似恒定（Li & Levine 2010），零输出时 PD 已保持绑定角。
   *   实测把它当目标用 ⇒ 只留膝这一条就把存活从"站满 8s"打成 2.6s。
   */
  kneeHoldDeg: number;
  kKnee: number;
  kHipUpright: number;
  maxHip: number;
  maxKnee: number;
  maxTorso: number;
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
  /** 横向 GRF 限幅（N）。文献单腿静态需求约 49 N（52 N·m / 1.06 m），留 ~10 倍裕度 */
  maxGrfX: number;
  /** 支撑髋的**屈曲上限**（rad）。超过就顶回来（防单支撑时整体下蹲） */
  hipExtendLimit: number;
  /** 支撑腿伸展刚度（0~1）：1 = 完全顶回原位。臀肌+股四头肌共同收缩的等效刚度 */
  kStanceExt: number;
  /** 支撑膝的目标屈曲角（deg）。Li & Levine 2010：站立时膝角近似恒定 */
  kneeStanceDeg: number;
  /**
   * ★ 通道消融（诊断用）：要**关掉**的通道名逗号分隔。
   *   空 = 全开。`probe-balsweep` 用它回答"是哪一条在 destabilize"。
   *   ⚠ 关掉之后其余通道照旧，所以这是"逐条摘除"而不是"单条测试"。
   */
  ablate?: string;
}

export const DEFAULT_BALANCE_PARAMS: BalanceParams = {
  kSagP: 2.2,
  kSagD: 0.0,
  kTorsoAlign: 1.0,
  // ★ 旧额状面律（走 spine1/0）保留但**默认不用**：它权限 35mm、需求 100mm ⇒ 发散。
  //   见 §17：主通道已换成支撑髋外展（kHipAbd）。留这个字段是为了可对照消融。
  kLatP: 0.0,
  kLatD: 0.0,
  kneeHoldDeg: 15,
  kKnee: 0.6,
  kHipUpright: 0.8,
  maxHip: 0.52,
  maxKnee: 0.35,
  maxTorso: 0.14,
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
  // 横向 GRF 限幅 500 N（≈0.7 倍体重；静态需求只要 49 N）
  maxGrfX: 500,
  // 髋允许的屈曲上限：绑姿态 ≈0，单支撑时超过就会整体下蹲
  hipExtendLimit: 0.12,
  // 支撑腿伸展刚度与膝目标角
  kStanceExt: 0.5,
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
  // ① 矢状面：髋策略。x_com > 0 ⇒ 髋伸，把躯干往回拉。
  // ══════════════════════════════════════════════════════════════
  // ★ 命令的是**目标角**（不是 PD 输出）——`requestAngle` 内部按该轴量程归一化。
  //   髋：偏前 ⇒ 往髋伸方向顶（把躯干拉回支撑脚上方）
  const ex = rs.com.x;
  let hipTgt = -p.kSagP * ex - p.kSagD * rs.com.vx;
  // ★★ 单支撑时叠加**支撑腿伸展**（臀大肌等效刚度）。
  //   必须**合并进同一个请求**，不能另发一条：同系统同优先级时
  //   `request()` 只保留**第一次**（后来的记入 suppressed）——
  //   实测另发一条时 `kStanceExt` 扫 0.3/0.6/0.9 三行结果**逐位相同**，通道根本没执行。
  //   文献：Neumann 2010 / Inman 1947（骨盆水平需 ≈52 N·m）、
  //        Li & Levine 2010（站立时膝角近似恒定，刚度来自共同收缩）。
  //   证据：横向已经收准（com.z −81mm vs 支撑脚 +10mm）时躯干仍从 1.427 塌到 0.34m
  //        ⇒ 缺的是**垂直支撑刚度**，不是额状面控制。
  const singleSupNow = rs.phase === 'SINGLE' || rs.phase === 'PUSH' || rs.phase === 'STEP';
  if (singleSupNow && on('stanceExt') && hipTgt < 0) {
    hipTgt = hipTgt * (1 - p.kStanceExt);
  }
  hipTgt = clamp(hipTgt, p.maxHip);
  if (on('hip')) rs.requestAngle(jHip, 2, hipTgt, 'balance', '髋策略');

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
  if (on('knee') && singleSupNow && on('stanceExt')) {
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
  // ③ 躯干姿态（平衡维持独占，优先级 1）
  //   ③a 对齐 GRF 力线 ⇒ 髋的力臂归零，不必扛全部屈曲力矩
  // ══════════════════════════════════════════════════════════════
  const grfAng = Math.atan2(rs.grf.x, Math.max(0.2, rs.grf.y));
  const sp1Sag = clamp(-grfAng * p.kTorsoAlign - ex * 0.8, p.maxTorso);
  if (on('torso')) rs.requestAngle(jSp1, 2, sp1Sag, 'balance', '躯干力线');

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
  const latArmed = rs.loadBearer !== null || rs.phase === 'SINGLE'
    || rs.phase === 'PUSH' || rs.phase === 'STEP'
    || ((rs.phase === 'SHIFT') && Math.max(rs.loadFrac.l, rs.loadFrac.r) > 0.62);

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
    const sup = rs.supportLeg();
    const stanceZ = sup === 'l' ? rs.soleZ.l : rs.soleZ.r;
    const h = Math.max(0.3, rs.com.y - (rs.soleY[sup] ?? 0) - 0.05);
    const om0 = Math.sqrt(9.81 / h);
    // 捕获点（Houska）：ξ = z + vz/ω₀。目标是"捕获点回到支撑脚上方"
    const xi = rs.com.z + rs.com.vz / om0;
    const e = xi - stanceZ;
    // 期望的 CoM 横向加速度（二阶，阻尼比 0.9）
    const kp = p.kXRatio * om0 * om0, kd = 2 * 0.9 * om0;
    const aDes = -kp * e - kd * rs.com.vz;
    // ★ 干净的捕获点形式：`F_y = m·h·a_des`
    //   （Houska balance point 的完整式是 `m(z_c·a_des − x_c·a)`，那个 `−x_c·a`
    //     项是给"摆动点自身在动"的工况用的；本 rig 支撑脚是**不动**的，
    //     而 CoM 加速度恰恰就是我们要控的量 —— 把它当扰动前馈等于重复计入，
    //     实测直接把 F_y 推到 ±996 N（1.4 倍体重的横向力）把人掀翻。）
    const mTot = 70, zc = h;
    // ⚠⚠ 轴约定：`rs.grf.y = 686.7×载荷` 说明 **y = 竖直**，
    //   x = 矢状（前），**z = 额状（侧）**。
    //   额状面要的水平力必须沿 **z**，之前错传给了 jacobianTorque 的第 1 个参数
    //   （= fx，矢状）⇒ 横向力在推人前后，额状面根本没人管
    //   ⇒ 实测 `com.z` 一路跑到 −387~−665 mm（支撑脚在 +164 mm）。
    const FLat = clamp(mTot * zc * aDes, p.maxGrfX);
    rs.grfCmd.x = 0; rs.grfCmd.y = mTot * 9.81; rs.grfCmd.z = FLat;
    // 分配：支撑链（髋/膝/踝）+ 脊柱链（躯干姿态）
    const chain: number[] = [];
    for (const nm of [`hip_${sup}`, `knee_${sup}`, `foot_${sup}`, 'spine1', 'spine2', 'spine3']) {
      const i2 = jointIndexByName(rs.sk, nm);
      if (i2 >= 0) chain.push(i2);
    }
    // ★★★ `F_z` **必须传 0**：位置环已经在撑体重（θ_ref≠θ 就一直有力矩），
    //   再把 mg 通过 τ=JᵀF 注入 = **重力被算两遍** ⇒ 关节被灌爆
    //   （实测 F_y 在任何增益下都钉在 ±500 N 限幅、髋/1 钉在 ±70 N·m，0.4~0.8 s 就倒）。
    //   额状面真正缺的信息只有**水平分量** —— 位置环的轴由腿的几何决定，给不了它。
    //   横向沿 z ⇒ `τ = Jᵀ(F_lat ẑ)`
    doll.jacobianTorque(0, 0, FLat, rs.com.x, rs.com.y, rs.com.z, chain, TMP_TAU);
    for (const i2 of chain) {
      for (let k2 = 0; k2 < 3; k2++) {
        const v = TMP_TAU[i2 * 3 + k2]!;
        if (Math.abs(v) > 0.5) rs.requestTorque(i2, k2, v, 'balance', `JᵀF·${rs.sk.joints[i2]!.name}/${k2}`);
      }
    }

    // ④c ★★ 支撑腿**伸展执行器**（单支撑专用）
  //   文献：单腿站立时躯干/骨盆的重量会把髋压向屈曲、膝压向屈曲，
  //   靠**臀大肌 + 股四头肌共同收缩**产生的**刚度**顶住（不是"驱向某个目标角"）。
  //     · Neumann 2010 / Inman 1947：单支撑骨盆水平所需 ≈52 N·m 静态髋力矩
  //     · Li & Levine 2010：站立时"膝角近似恒定"，刚度来自共同收缩
  //   只靠"膝守卫"（越界才顶回）不够：实测单支撑躯干从 1.427 塌到 0.34~0.97 m
  //   ——`com.z` 已经收准（−81 mm vs 支撑脚 +10 mm）但人还是往下坐。
  // ④b 躯干**向支撑腿侧倾**（Xu & Sher / Costume & Wattenhofer / Horak 2006）
    //   这不是"为了平衡"，是**用重力力矩卸载髋**：单支撑时躯干侧倾能降低 CoM 高度、
    //   把一部分髋力矩转成重力力矩（文献报告省 15~30%）。同时腰侧屈把骨盆摆平。
    if (on('latwaist') && p.kTrunkLean !== 0) {
      const dir = sup === 'l' ? 1 : -1;   // 朝支撑腿倾
      const lean = clamp(-dir * p.kTrunkLean * (rs.com.z - stanceZ), p.maxTrunkLean);
      rs.requestAngle(jSp1, 0, lean, 'balance', '躯干侧倾卸载');
    }
  }


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