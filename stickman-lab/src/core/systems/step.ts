/**
 * ══════════════════════════════════════════════════════════════════
 * ⑤  stepSystem.ts —— **迈步系统**（重构版，用户要求"做个大概，只要抬腿"）
 *     作用对象：另一条腿（摆动腿）+ 腰的受限修正槽
 * ══════════════════════════════════════════════════════════════════
 *
 * 与旧版的区别：
 *   · 不再自己判断"该不该抬"——**由状态机的 P1..P4 许可决定**
 *   · 不再自己持有一份数据快照——全部从 `rigState` 读
 *   · 不再直接设 target——只**提需求**
 *   · 抬腿需求走 `requestSwingLeg(..., isLift=true)` ⇒ **锁定闸门能否决它**
 *   · 腰的修正走 `requestWaistSlot()` ⇒ 自动被 ±6° 与 α(t) 夹住
 *
 * ── 文献 ────────────────────────────────────────────────────
 *   · 抬升高度：Oberg / Perry，髋屈峰 ~30°、膝屈峰 ~63°
 *   · 最小离地净空 MFC = 5 cm
 *   · 摆动轨迹两端速度为零（sin(πs) 钟形）
 *   · 躯干反相旋转（Takemura 2007）：幅度按骨盆横断面旋转 6°（Mann 1975）
 *   · 交接必须落在双支撑相（Lee et al.：缺 DSP 会产生不连续力矩）
 */

import { jointIndexByName } from '../skeleton';
import { lerpKeyPose, KEY_POSES, STATE_TO_GAIT, type GaitKey } from '../keyframe';
import type { RigState, Side } from '../rigState';

/** 摆动相膝屈峰值（deg）—— Oberg / Perry */
export const KNEE_FLEX_PEAK = 63;

export interface StepParams {
  /**
   * ★★★ 本系统那一份**借力增益**（2026-10-06 重构，用户定调「两个系统都走腰部借力才对」）。
   *   最终倾角 = `(kStep + kBal) · GRF_水平 / (m·g)`，由 `waistSystem` 统一算。
   *   默认 0 = 未标定（先让 balance 单独借，避免两边互相抵消）。
   */
  waistBorrowK?: number;
  /** 摆动相时长的一半（s） */
  halfPeriod: number;
  /** 抬升峰值高度（m） */
  lift: number;
  /** 髋屈峰值（deg）—— Oberg/Perry 30° */
  hipFlexPeakDeg: number;
  /** 膝屈峰值（deg）—— Oberg/Perry 63° */
  kneeFlexPeakDeg: number;
  /** 单腿模式下摆动腿保持高度（m） */
  liftHold: number;
  /**
   * ★ 单支撑保持角（deg）：进 SINGLE 相后 `sin(πs)=0` 会把摆动腿的钟形项清零，
   *   不加这一项摆动脚就贴地站着（实测单支撑占比 0%、摆动脚 0mm）。
   *   取值按"髋 30° + 膝 65° ⇒ 足跟着地、小腿抬起"，保证足底净空 >100mm。
   */
  hipHoldDeg: number;
  kneeHoldDeg: number;
  /**
   * ★ 末端摆动**髋伸展**峰值（deg，正值 = 伸展）。这是**步长**的来源。
   *   正常步态 terminal swing 把小腿送出去，足跟着地落在身体**前方**；
   *   缺了它（历史实现）脚只落在原地/身后 ⇒ 实测 Δx −644mm、躯干 x 恒为 0。
   *   允许为负（= 仍在屈曲）以便做对照消融。
   */
  hipExtendDeg: number;
  /** 末端伸展的起始相位（0~1），约 0.55~0.7（摆动后半程） */
  reachFrom: number;

  // ── 重心主动侧移（**本系统拥有这个意图**，balance 只做保护伺服）──────────
  /**
   * ★ 横向驱动固有频率 `ω₀`（rad/s）。本 rig 实测倒立摆 ≈2.0。
   *   线性倒立摆：`z̈ = ω₀²(z_ref − z) − 2ζω₀ ż`。
   */
  shiftOmega: number;
  /** 横向驱动阻尼比 ζ（1 = 临界阻尼，不振荡） */
  shiftZeta: number;
  /** 横向驱动**力**上限（N）。50mm 误差 @ω₀=2 ⇒ 70×4×0.05 ≈ 14N */
  shiftFMax: number;
  /** 驱动渐入渐出时长（s），避免阶跃力把 CoP 打出支撑面 */
  shiftRamp: number;

  /**
   * ★★ 摆动腿**用关键帧表**（Perry 8 相）还是用本文件自己那套 `hipFlexPeakDeg`
   *   /`kneeFlexPeakDeg`/`bell` 钟形。默认 **true**。
   *
   * 用户 2026-10-05：「两套系统根据状态机就分别往这几个关键帧状态去靠拢」。
   * ⇒ 摆动腿的角度律不再是"钟形 + 峰值常数"这种手调量，而是沿
   *   **Perry 的角-时间曲线**走过去：`PSw → ISw → MSw → TSw`。
   *
   * ⚠ 消融意义：关掉它就退回旧律，两者可直接对照 —— 这是"关键帧表是否
   *   真的更好"的唯一判据，不能因为新方案更好就删掉旧路径。
   */
  useKeyFrame: boolean;
  /** ★ "点到为止"的达标线（= 状态机同一个 `loadAcceptFrac` 的口径） */
  loadAcceptFrac?: number;

  /**
   * ★ 消融通道名单（逗号分隔）。唯一被本系统消费的名字是 **`stepKeyframe`**
   *   （= 整个迈步系统的总闸，见 `stepSystem()` 顶部的注释）。
   *   ⚠ 由 `Controller` 把 `cfg.balance.ablate` **同一个字符串**传进来 ——
   *     「全消融」必须只由一个开关定义，否则两个系统的消融实验互相对不上。
   */
  ablate?: string;
}

export const DEFAULT_STEP_PARAMS: StepParams = {
  halfPeriod: 1.10,
  lift: 0.32,
  hipFlexPeakDeg: 30,
  kneeFlexPeakDeg: KNEE_FLEX_PEAK,
  liftHold: 0.25,
  hipHoldDeg: 32,
  kneeHoldDeg: 68,
  // 末端髋伸展：Perry 正常步态 terminal swing 约 10~20°。
  //   实测（扫 0/10/18/28°，判据 = Δx(摆动−支撑) 与存活）：
  //     0°  → Δx 最小 −529mm（脚落在支撑脚**后方** 529mm）  存活 2.38s
  //     10° → Δx 最小 −106mm、净空 405mm                    存活 2.43s
  //     18° → Δx 最小 −401mm（不单调）                      存活 2.77s
  //     28° → Δx 最小 −14mm、最多 +335mm（落在身前）         但净空飙到 1107mm、存活仅 0.75s
  //   ⇒ 取 10°：把脚从"身后 529mm"救回到"身前可放"，且不把腿甩飞。
  //   ⚠ 18°/28° 的 Δx 不单调 ⇒ 幅度一大就变成"甩腿"而不是"送腿"，
  //     末端伸展必须与摆动髋屈曲峰值一起限，不能单独加大。
  hipExtendDeg: 10,
  reachFrom: 0.6,
  shiftOmega: 2.0,
  shiftZeta: 1.0,
  shiftFMax: (() => {
    const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    const v = Number(env.SHIFTFMAX ?? '');
    return Number.isFinite(v) && v > 0 ? v : 60;
  })(),
  shiftRamp: 0.25,
  useKeyFrame: true,
  // ⚠ 实测 0.8 会把真倒从 8.47 打到 4.97s（转移的驱动一直追到 80% ⇒ 过冲扰动）。
  //   "80% 左右"在**执行侧**用 `0.6 停手`（更早收）反而稳；目标由状态机口径表达。
  loadAcceptFrac: 0.6,
};

/**
 * ★ 迈步系统。**并发**每拍跑一次，只提需求。
 *
 * 权限完全由状态机给：
 *   · 能不能抬 = `rs.stepPermit.all`
 *   · 能不能抬**这条**腿 = 它没被锁定（否则 `requestSwingLeg` 直接丢弃）
 *   · 腰的修正份额 = `rs.authority`（α(t)）
 */
export function stepSystem(
  rs: RigState,
  p: StepParams = DEFAULT_STEP_PARAMS,
  doll?: { jointWorld: (i: number, out: Float64Array) => void; ankleW?: (s: 0 | 1) => { x: number; z: number } },
): void {
  // ★★ 2026-10-06 加**总闸**：整个迈步系统一个 `ablate` 门（`stepKeyframe`）。
  //
  //   为什么必须有：门禁 B 要求「平衡全消融 ⇒ 与完全不经过 Controller 等价」，
  //   而在此之前**本系统一个 `ablate` 门都没有** ⇒ 「全消融」里它照发位置指令，
  //   ragdoll 的位置环仍在出力（力矩通道 τ≡0 但让位也 ≡0 ⇒ 位置环是活的）
  //   ⇒ 实测全消融只活 **1.30s**，而真正零输出活 **4.48s**。
  //   ⇒ 那个 3.2 秒的差**全部是本系统的位置指令**，不是平衡的残留。
  //
  //   ⚠ 门选 `stepKeyframe` 而不是 per-channel：本系统的语义就是「把关节往关键帧
  //     区间推」，拆成多个门会让「全消融」又变成半消融（老问题）。
  //   ⚠ 提前 return 也顺带把 `rs.shiftDemand*` 归零 —— 那是**故意的**：
  //     `balance` 的横向驱动块以 `shiftDemandF !== 0` 为前提，
  //     全消融时它必须一起消失，否则力通道又活了。
  const OFF = new Set((p.ablate ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  /** 与 `balance.ts` 同名同义的消融门（门禁 A2 靠 `on('…')` 这个写法对账） */
  const on = (ch: string): boolean => !OFF.has(ch);
  if (!on('stepKeyframe')) return;

  const sk = rs.sk;
  const swing: Side = rs.swingLeg();
  const jHip = jointIndexByName(sk, swing === 'l' ? 'hip_l' : 'hip_r');
  const jKnee = jointIndexByName(sk, swing === 'l' ? 'knee_l' : 'knee_r');
  const jSp1 = jointIndexByName(sk, 'spine1');
  const jSp2 = jointIndexByName(sk, 'spine2');
  const jSp3 = jointIndexByName(sk, 'spine3');
  if (jHip < 0 || jKnee < 0) return;

  /** 限到 ±m。⚠ m 必须为正 —— 传负值会让 `v > m` 恒真而恒返回 m（已踩过）。 */
  const clamp = (v: number, m: number): number => (v > m ? m : v < -m ? -m : v);
  const D2R = Math.PI / 180;

  // ══════════════════════════════════════════════════════════════
  // ⓪ 重心**主动侧移** —— 本系统的核心意图，**先于抬腿**
  // ══════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════
  // ⓪ 横向重心驱动 —— **摆动侧腿蹬地产生横向地面反力**（唯一驱动通道）
  // ══════════════════════════════════════════════════════════════
  //   ★ 这段是**按文献重做**的结果。两次被实测证伪的旧实现已删除：
  //     ① 支撑侧髋外展加"推相位"偏置（帮倒忙：存活 3.25s→1.87s、X3 更差）
  //     ② 躯干侧倾转移通道（单调扣存活、零收益：3.25s→1.25s、X3 不变）
  //
  //   文献依据：
  //   · **Pandy 2010**（JB Biomech，10 段 23 自由度 54 肌肉力分解）：
  //     "The hip abductors ... actively controlled balance by accelerating the
  //     CoM **medially**"；把重心加速向外的是 **hip adductors**。
  //     ⇒ **髋外展是"托住"，内收才是"搬运"** —— 旧实现方向完全反了。
  //   · **Batenie 2014**（Gait & Posture，倒立摆+PD 拟合 75 人）：
  //     "the leg **OPPOSITE** the shift direction generates an increased GRF
  //     with a lateral component that accelerates the CoM toward the target"
  //     ⇒ 驱动来自**摆动侧（轻）腿蹬地**，不是支撑侧髋把身体拽过去。
  //
  //   控制律：线性倒立摆 `z̈ = ω₀²(z_ref − z) − 2ζω₀·ż`（Batenie 用 PD 拟合
  //   75 人，平均速度误差 0.35%）⇒ **反解成力**：
  //       F = m·(ω₀²·(z_ref − z) + 2ζω₀·(ż_ref − ż))
  //   ⚠ **申报的是力（N），不是力矩**：`τ = JᵀF` 的映射、以及该轴的 τmax 和
  //     CoP 护栏，全部留在 balance（保护伺服）。职责边界与旧实现一致、干净。
  //
  //   ★ `z_ref = soleZ[支撑腿]`（重心目标 = 支撑脚正上方），`ż_ref = 0`。
  //   142mm 误差 @ω₀=2、ζ=1 ⇒ F ≈ 70×4×0.142 ≈ **40N**（`shiftFMax=60` 内），
  //   经 `JᵀF`（髋力臂约 0.10m）⇒ 髋力矩约 **4 N·m**，远在 τmax=120 之内 ——
  //   这才是文献量级；旧的"外展推"要 98N·m（τmax 的 82%）才推得动一点点。
  const sup: Side = rs.supportLeg();
  rs.shiftDemandF = 0;                   // 默认：本系统不发意图 ⇒ 平衡系统纯保护
  rs.shiftDriveSide = null;
  // ⚠ 相位门必须含 **DOUBLE**：`GaitState.migrate` 里 `DOUBLE` 是**直接跳
  //   `SINGLE`**（gaitState.ts:443-448），`SHIFT` 只能从 `STEP` 触地进入
  //   ⇒ **第一次交接根本没有 SHIFT 相**（只判 SHIFT 的通道永不触发）。
  //   `handoverOk === false` = 交接还没成 = 本系统还有活要干；一旦达成自动撤力。
  // ★ 2026-10-06：`SHIFT` 已改名 `LOAD`（重量交接）。侧向搬运意图只在交接期发 ——
  //   这与附录 §5.2 的 `shift` 子任务一致：交接由承重腿完成，摆动腿不许动。
  // ★ 实验开关 `NOSHIFT=1`：只关**侧向重心驱动**（保留步态其余部分），
  //   用于确认前 0.1s 的泵是否由 `shiftDemandF`（→ balance 的髋外展 τ）引起。
  const NO_SHIFT = ['1', 'true', 'on'].includes(String(
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.NOSHIFT ?? '').toLowerCase());
  // ★★★★★ 2026-10-06 **"点到为止"**（用户：「**重心转移就点到为止就行了**。
  //   再优化各个状态下的关节驱动算法，我觉得可以**分段发力 + 检测，符合要求就停**」）
  //   本系统是**离散动作原语**（发力 → 检测 → 达标 → 停），不是连续 PD：
  //   转移的停止判据用**状态机同一个** `loadAcceptFrac`（承重达标线），不另立标准。
  //   达标即把 `shiftDemandF` 归零 —— 而不是"一直追到 soleZ"（那会过冲）。
  const recvSide: Side = rs.roleRecv ?? sup;
  const recvLoad = recvSide === 'l' ? rs.loadFrac.l : rs.loadFrac.r;
  // ★★★★★ 2026-10-06 **锁存**（用户：「**只要承重符合要求，迈步系统就一定要停止施力
  //   侧向转移**，平衡系统全力工作就行」）：
  //   实测病灶（`probe-lat`）：单阈值让转移**在阈值上打摆子**——
  //     0.68（停）→0.57（又推 60N）→0.62（停）→0.55（又推）… 每 0.2 s 一轮。
  //   ⇒ 达标即**锁存**：同一轮交接内**永不再推**（`shiftDoneLatch`）；
  //     离相/交接完成才解锁。语义 = 用户要的"**一定要停止**"。
  // ★★★★★ 2026-10-06 **锁存实测两形态都更差**（4.51 / 3.92 s vs 8.47 s）——
  //   用户要求「只要承重符合要求，迈步系统就**一定要停止**施力侧向转移，
  //   **平衡系统全力工作**就行」⇒ **这是两个半句**：
  //     · 前半句（迈步停）✓ 已实现（锁存代码保留在 `SHIFT_LATCH=1` 后面）；
  //     · 后半句（**平衡全力接管**）**未实现** —— 转移一关，载荷回落 ⇒ 摆子重启
  //       ⇒ 所以单独加锁存必亏。**两句要一起做**（下一步）。
  //   现状：默认走单阈值（实测最优 8.47 s）。
  const inHandover = (rs.state === 'LOAD' || rs.state === 'DOUBLE') && !rs.handoverOk;
  const LATCH = ['1', 'true', 'on'].includes(String(
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SHIFT_LATCH ?? '').toLowerCase());
  if (LATCH) {
    if (!inHandover || rs.shiftLatchSide !== recvSide) {
      rs.shiftDoneLatch = false;
      rs.shiftLatchSide = recvSide;
    }
    if (inHandover && recvLoad >= (p.loadAcceptFrac ?? 0.6)) rs.shiftDoneLatch = true;
  } else {
    rs.shiftDoneLatch = false;
  }
  const transferDone = LATCH ? (rs.shiftDoneLatch === true) : (recvLoad >= (p.loadAcceptFrac ?? 0.6));
  if (!NO_SHIFT && !transferDone && inHandover) {
    const zRef = rs.soleZ[sup];
    const w0 = p.shiftOmega > 0 ? p.shiftOmega : 1;
    // 体重真源在 `sk.cfg.mass`（骨架唯一真源，`skeleton.ts:335`）
    const mTot = sk.cfg.mass;
    // ★★★★★ 2026-10-06 **用户定调：每个状态一个动作 + 状态机显式给方向**
    //   （「每个迈步状态**迈步系统就工作一次**。而且**状态机显式指定方向**就行」）
    //   ⇒ `ONESHOT=1` 时不再用 PD 追 `zRef`，而是：**方向 = 显式朝向承接脚**、
    //     **幅值恒定**（`shiftFMax` 的 `SHIFT_FRAC`），达标即停（`transferDone` 锁存）。
    //     PD 的"持续追"正是"阈值打摆子"的另一个来源（§22.53）。
    // ⚠⚠ **实测：ONESHOT 也净负**（5.72/4.60/4.61 vs PD 的 8.47 s）。
    //   ⇒ 三形态对照（PD 连续追 / 锁存 / 一次性恒定力）里 **PD 最优** ——
    //     读法：PD 的"连续修正"在**替平衡系统的接管不足兜底**；
    //     理想的离散形态要成立，**先决条件是"平衡系统全力接管"**（用户的后半句）。
    //   ⇒ 默认关（`SHIFTONESHOT=1` 可开），与 `SHIFT_LATCH` 同一处境。
    const ONESHOT = ['1', 'true', 'on'].includes(String(
      (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SHIFTONESHOT ?? '').trim().toLowerCase());
    const dirZ = Math.sign(zRef - rs.com.z) || 1;      // 显式方向：朝承接脚
    const raw = ONESHOT
      ? dirZ * p.shiftFMax * (() => {
        const v = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SHIFT_FRAC ?? '');
        return Number.isFinite(v) && v > 0 ? v : 0.25;   // 恒定幅值 = 25% 的 Fmax
      })()
      : mTot * (w0 * w0 * (zRef - rs.com.z)
        + 2 * p.shiftZeta * w0 * (0 - rs.com.vz));
    const lim = raw > p.shiftFMax ? p.shiftFMax : raw < -p.shiftFMax ? -p.shiftFMax : raw;
    // 渐入渐出：阶跃力会把 CoP 直接推出支撑面
    const ramp = p.shiftRamp > 0 ? Math.min(1, rs.stateT / p.shiftRamp) : 1;
    const smooth = ramp * ramp * (3 - 2 * ramp);
    rs.shiftDemandF = lim * smooth;
    // ★★★ 2026-10-06 **锁存驱动侧**（修"重心侧移不完成"的直接原因）：
    //   原先每拍 `rs.swingLeg()` 现算，而它来自瞬时载荷 ⇒ 驱动侧每 0.1~0.3s 翻
    //   ⇒ 横向推力左右互相抵消 ⇒ `CoM.z` 恒 ≈ 0（实测 |≤10mm|，目标 142mm）。
    //   按 B1「角色必须锁存」：进入交接时**定一次**，交接完成/离相才解除。
    if (!rs.shiftSideLatch) rs.shiftSideLatch = rs.swingLeg();
    rs.shiftDriveSide = rs.shiftSideLatch;   // ★ 对侧（轻）腿蹬地
  } else {
    rs.shiftSideLatch = null;                // 交接完成 / 离相 ⇒ 解除锁存
  }

  // ══════════════════════════════════════════════════════════════
  // ① 抬腿许可 —— **双钥匙**：状态机许可 AND 摆动腿确实未锁定
  //   R1（Kuindersma）：感知接触与计划接触**都成立**才能离地。
  // ══════════════════════════════════════════════════════════════
  const permit = rs.stepPermit.all;
  // 相内进度 s ∈ [0,1]：**`SWING` 相才推进**（摆动到落地）；其它相不动摆动腿。
  // ⚠ `LIFT` 相**必须能抬腿**（它是「离地」这一态，见文档 §3.2），所以给固定抬升量。
  const jwT = new Float64Array(3);
  const s = rs.state === 'SWING'
    ? Math.max(0, Math.min(1, rs.stateT / Math.max(1e-6, p.halfPeriod)))
    : 0;
  const inSwing = rs.state === 'LIFT' || rs.state === 'SWING';

  // 抬升量：钟形，两端速度为零（sin(πs)）
  const bell = rs.state === 'SWING' ? Math.sin(Math.PI * s) : 0;
  const lift = permit && inSwing
    ? (rs.state === 'LIFT' ? p.lift : p.lift * bell + (s >= 1 ? p.liftHold : 0))
    : 0;

  // ══════════════════════════════════════════════════════════════
  // ★★ ② 摆动腿：**沿 Perry 关键帧曲线走**（`keyframe.ts` 唯一真源）
  // ══════════════════════════════════════════════════════════════
  //   相内进度 s 的映射（Perry GC%）：摆动相跨 ISw(62-75) → MSw(75-87) → TSw(87-100)
  //     s=0    → PSw 末（膝 40°、踝 20°跖屈）
  //     s=0.33 → ISw（膝 60° 峰、髋 20°）
  //     s=0.70 → MSw（髋 30°、膝 30°、胫骨垂直）
  //     s=1    → TSw（膝 0-5°、踝中立、髋 25°）= **准备触地**
  //   与旧律的差别：旧律是"钟形 + 峰值常数 + 末端伸展手工项"，
  //   新律是**规范角-时间曲线**，膝屈峰、胫骨垂直时刻、末端准备都是数据给的。
  const KF_SWING_SEG: readonly (readonly [number, GaitKey])[] = [
    [0.00, 'PSw'], [0.33, 'ISw'], [0.70, 'MSw'], [1.00, 'TSw'],
  ];
  function keySwing(sIn: number) {
    const u = sIn < 0 ? 0 : sIn > 1 ? 1 : sIn;
    for (let i = 0; i + 1 < KF_SWING_SEG.length; i++) {
      const [s0, k0] = KF_SWING_SEG[i]!, [s1, k1] = KF_SWING_SEG[i + 1]!;
      if (u <= s1) {
        const w = (u - s0) / Math.max(1e-6, s1 - s0);
        return lerpKeyPose(k0, k1, w);
      }
    }
    return rs.keyPose;
  }
  // ★★★★★ 2026-10-06 **发现（`probe-t0` 消融定位）**：
  //   非摆动相（DOUBLE/LOAD/PUSH/THRUST）里 `s ≡ 0` ⇒ `keySwing(0)` 返回 **`PSw`**
  //   （摆动腿的"蹬离前"姿势：膝屈 20°、踝背屈 20°），而这三条写入**不受
  //   `inSwing`/`lift` 门控、每拍都发** ⇒ **开局双脚还在地上时，步态系统就在
  //   命令摆动腿膝屈 20°、踝背屈 20°**（= 硬把那只脚往起抬）⇒ 单支撑瞬间丢给
  //   对侧腿而重心还在中间 ⇒ "一上来就倒"。
  //   实测（`probe-t0`）：关整个步态（`stepKeyframe`）前 0.067s 的 KE 减半
  //   （0.377→0.189 J），再关 QP 到 0.0896（≈ `nocontrol` 0.0766）。
  //   ⇒ 本门 `SWGATE=1` 只允许**摆动相**写摆动腿关键帧。
  // ★★ 2026-10-06 **转正为默认**（门禁实测：默认 1.13→1.18s ★、关发力门禁 0.54→1.40s ★、
  //   钉死 DOUBLE 0.88→0.97s；"迈步停手"不变 1.34s ⇒ 门只动步态的写入，符合预期）。
  //   要回到旧行为（非摆动相也写 PSw）用 `SWGATE=0`。
  // ★ W6 开关（`KFSTATE=0` 关）：非摆动相的关键帧取自状态（见下方长注释）
  const KF_STATE = !['0', 'false', 'off'].includes(String(
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.KFSTATE ?? '').toLowerCase());
  const swingGateOff = ['0', 'false', 'off'].includes(String(
    (globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SWGATE ?? '').toLowerCase());
  if (p.useKeyFrame && (!swingGateOff ? inSwing : true)) {
    // ★★★★★ 2026-10-06 **W6 修复：非摆动相用"状态自己的关键帧"**
    //   （用户：「踝被定死是什么现象」——查实：非摆动相 `s≡0` ⇒ `keySwing(0)=PSw`
    //     （蹬离前姿势，`swAnkle=−20°`）而踝的机械限位是 **[−12°,+18°]**
    //     ⇒ 目标顶在限位上 ⇒ **钉死在 −12°** ⇒ LOAD 的"承接脚放平 `|踝|≤12`"
    //       测到的 12.001 正是这个钉子（**刀锋条件的真相**）。
    //   而 `STATE_TO_GAIT[LOAD] = 'LR'`（承载响应：`swAnkle=−5°`、膝屈 18° 吸振）
    //   —— 状态自己的关键帧本来就是对的，只是**没人用它**。
    //   ⇒ LIFT/SWING 用摆动曲线 `keySwing(s)`；其余相用 `KEY_POSES[STATE_TO_GAIT]`。
    //   `KFSTATE=0` 可回退（A/B）。
    // ★★★★★ 2026-10-06 **W3：应急落足**（用户：「应急的最重要作用是**调整脚位置**，
    //   需要**迅速把脚调整到可支撑的位置**。这是最关键的」）
    //   感知层已给出 `copPlan.{stepX,stepZ,stepUrgent}`（= ξ 截断到可及范围的落足点）。
    //   执行：① 落足点 → 髋的屈伸（矢状）/外展（额状）偏移；
    //        ② 紧迫度 → **摆动加速**（相内进度 s 按 (1+2·urg) 推进 ⇒ 迅速落足）。
    const planS = rs.copPlan;
    const emer = !!(planS && planS.valid && (planS.fallNeeded || planS.stepUrgent > 0.5));
    const sUse = emer ? Math.min(1, s * (1 + 2 * (planS?.stepUrgent ?? 0))) : s;
    const kp = (KF_STATE && rs.state !== 'SWING' && rs.state !== 'LIFT')
      ? KEY_POSES[STATE_TO_GAIT[rs.state]]
      : keySwing(sUse);
    // 落足点 → 角度偏移（髋正=屈=脚前；L≈0.9 m ⇒ deg/m ≈ 64）
    const L_LEG = 0.9;
    // ★★★★★ 2026-10-06 **边4后半接线**（架构_v4.md §4.6.3）：
    //   落足点（stepX/stepZ）必须驱动**所有摆动**（不只应急）。
    //   常规摆动按相内进度 bell 加权（落地时到位）；应急则全量+加速。
    const bellW = rs.state === 'SWING' ? Math.sin(Math.PI * Math.min(1, sUse)) : 0;
    const placeW = emer ? 1 : bellW;
    // ★ 用户令："不得大幅度下移动命令" ⇒ 落足偏移的**速率限制**（逐拍平滑）
    const sle = (() => {
      const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
      const v = Number(env.STEP_SLEW ?? '');
      return Number.isFinite(v) && v > 0 ? v : 0.15;   // rad/s 上限
    })();
    const dtS = rs.dtCtrl > 1e-6 ? rs.dtCtrl : 1 / 60;
    const rawHip = planS && planS.valid ? (planS.stepX / L_LEG) * placeW : 0;
    const rawAb = planS && planS.valid ? (planS.stepZ / L_LEG) * placeW : 0;
    rs.stepSlewHip = (rs.stepSlewHip ?? 0) + Math.max(-sle * dtS, Math.min(sle * dtS, rawHip - (rs.stepSlewHip ?? 0)));
    rs.stepSlewAb = (rs.stepSlewAb ?? 0) + Math.max(-sle * dtS, Math.min(sle * dtS, rawAb - (rs.stepSlewAb ?? 0)));
    const emerHip = rs.stepSlewHip;   // rad
    const emerAb = rs.stepSlewAb;     // rad（髋外展=轴0）
    // ★★★★★ 2026-10-06 **救援脚=贴地找落点**（用户令）：足端低弧线 + 两连杆 IK
    //   旧形态（关键帧+偏移）实测把腿卷成"抱膝"（髋 115°/膝 173°）——
    //   正确的救援步是脚**贴着地**滑到落足点。
    const useIK = String(((globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {}).SWINGIK ?? '') !== '0';
    if (useIK && (rs.state === 'SWING' || rs.state === 'LIFT')) {
      // 髋位置（力臂原点）、足端当前位置
      let hipW = { x: rs.com.x, y: 0.85 };
      if (doll) { doll.jointWorld(jHip, jwT); hipW = { x: jwT[0]!, y: jwT[1]! }; }
      const ank = { x: rs.soleX[swing], z: rs.soleZ[swing] };   // 踝的水平位置（soleX/Z 即踝口径）
      const sProg = Math.min(1, sUse);
      // 足端目标：从当前踝位 → (踝位+stepX, 踝位+stepZ)，离地小弧线（贴地 3cm 峰值）
      const fx = ank.x + (planS?.stepX ?? 0) * sProg;
      const fz2 = ank.z + (planS?.stepZ ?? 0) * sProg;
      const fy = 0.03 * Math.sin(Math.PI * sProg);   // 贴地弧
      // 两连杆 IK（在矢状面内：d = 髋→足的长度）
      const L1 = 0.47, L2 = 0.39;   // 大腿/小腿（近似；可从 sk 量）
      const dx2 = fx - hipW.x, dy2 = fy + 0.07 - hipW.y;   // 足端相对髋（+0.07=踝到地）
      const dLen = Math.min(L1 + L2 - 1e-3, Math.max(0.15, Math.hypot(dx2, dy2)));
      const cosK = Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - dLen * dLen) / (2 * L1 * L2)));
      const kneeIk = Math.PI - Math.acos(cosK);            // 膝屈角（正=屈）
      const cosA = Math.max(-1, Math.min(1, (L1 * L1 + dLen * dLen - L2 * L2) / (2 * L1 * dLen)));
      const aA = Math.acos(cosA);
      const aT = Math.atan2(dx2, -dy2);                    // 髋→足相对竖直（正=足在前）
      const hipIk = aT + aA;                               // 髋矢状目标（正=屈=足前，本 rig 约定）
      (globalThis as { __ikHits?: number }).__ikHits = ((globalThis as { __ikHits?: number }).__ikHits ?? 0) + 1;
      rs.requestSwingLegAngle(swing, jHip, 2, clamp(hipIk, 1.05), '摆动髋·IK贴地', true);
      rs.requestSwingLegAngle(swing, jKnee, 2, clamp(-kneeIk, 1.45), '摆动膝·IK', true);
      if (Math.abs(emerAb) > 1e-3) {
        rs.requestSwingLegAngle(swing, jHip, 0, clamp(emerAb, 0.6), '落足点·侧向', false);
      }
    } else {
    // 髋：正 = 屈曲（本 rig 约定），膝：正 = 屈曲
    rs.requestSwingLegAngle(swing, jHip, 2, clamp(kp.swHipFlex + emerHip, 1.05), '摆动髋·关键帧', lift > 0.01);
    // ★ 应急侧向落足：直接给**外展轴（0）**（髋外展=轴0，见 skeleton 的 AXIS 约定；
    //   ⚠ 下面"摆动外展·让开"写的是轴 1 —— 那是历史遗留，语义存疑，不动它）
    if (Math.abs(emerAb) > 1e-3) {
      rs.requestSwingLegAngle(swing, jHip, 0, clamp(emerAb, 0.6), emer ? '应急·侧向落足' : '落足点·侧向', false);
    }
    rs.requestSwingLegAngle(swing, jKnee, 2, clamp(-kp.swKneeFlex, 1.2), '摆动膝·关键帧', lift > 0.01);
    // 踝：正 = 跖屈（本 rig 约定）
    const jFt = jointIndexByName(sk, swing === 'l' ? 'foot_l' : 'foot_r');
    if (jFt >= 0) rs.requestSwingLegAngle(swing, jFt, 2, clamp(kp.swAnkle, 0.5), '摆动踝·关键帧', false);
    }   // ← SWINGIK 的 else 闭合
    // ★★★ 上身：**提案**而不是直写腰角（用户 2026-10-06 定调的**第一步**：
    //   「**先迈步系统给出，然后平衡系统再综合这个给一个最终的上身发力状态**」）。
    //   躯干矢状倾（Perry：IC 前倾 4°、摆动相后倾）+ 腰的代偿侧倾
    //   （Mann 1975 只有 5~10°，绝不当主执行器）—— 两者都进 `upperBody.step`，
    //   由 balance 统一合成后**发布最终值**（见 `balance.ts` 块⑧）。
    if (on('upForce')) {
      // ★★★ 2026-10-06（用户定调：「**迈步系统带着目标调整关节**」）：
      //   目标**由 step 直接落地**到脊柱三轴的关节角上；
      //   balance 只往 `acorr`（修正增量）写，两者在 `arbitrate` 里**相加**。
      //   符号 = 摆动侧（表里存幅度）：正 = 倒向摆动腿那一侧 / 扭转与骨盆同向。
      //   文献依据见 `keyframe.ts` 的 `TRUNK_TARGET_SRC`（骨盆倾 5°、骨盆旋转 8°）。
      const swS = swing === 'l' ? 1 : -1;
      const nSp = 3;
      for (const jj of [jSp1, jSp2, jSp3]) {
        if (jj < 0) continue;
        void jj; void nSp;
        // ★★★ 2026-10-06 重构：**不再直写脊柱**（用户：「两个系统都走腰部借力」）
        //   本系统只填**意图**（名义倾角 + 自己那一份借力增益），由 `waistSystem` 统一发布。
        //   理由（`§22.12.2`）：脊柱原先的目标只存在于本分支 ⇒ 迈步一停手就 `bind`、腰自由折。
        rs.waist.step.pitch += kp.trunkPitch;
        rs.waist.step.roll += swS * kp.trunkLat;
        rs.waist.step.yaw += swS * kp.trunkYaw;
        rs.waist.step.authority = rs.authority;
        // ⚠ 轴1（扭转）**暂不驱动**：实测新写这根轴会把「默认（迈步开）」从 6.05s
        //   打到 1.21s（该轴此前从无位置写入 ⇒ 位置范围/摩擦/惯量都没标定过）。
        //   扭转目标仍记在 `upperBody.step.yaw` 里（诊断），标定后再接管。
      }
      // ★★★ **迈步系统也走"腰部借力"**（用户：「平衡系统和迈步系统都走腰部借力才对」）
      //   step 只设**增益**（按相位 `authority`），方向由**腿的力**决定
      //   ⇒ 不在本文件里算方向，统一由 `RigState.applyUpperBorrow` 落地。
      rs.waist.step.gain = rs.authority * (p.waistBorrowK ?? 0.0);
      // 诊断备份（`probe-upforce`/UI 用；控制不依赖它）
      rs.proposeUpperBody(kp.trunkPitch, swS * kp.trunkLat, swS * kp.trunkYaw);
    } else {
      // 消融退回旧路径（直写腰角），保证 A/B 可测
      if (jSp1 >= 0) rs.requestWaistSlot(jSp1, 2, kp.trunkPitch, '躯干矢状·关键帧');
      if (jSp1 >= 0) rs.requestWaistSlot(jSp1, 0, kp.trunkLat, '躯干额状代偿');
    }
    // 摆动腿髋外展只做"让开"，不参与重心搬运（Winter 1998：搬运归支撑侧髋外展）
    if (lift > 0.01) rs.requestSwingLegAngle(swing, jHip, 1, 0.12, '摆动外展·让开', false);
    return;   // 关键帧分支已完整覆盖摆动腿，旧律不再执行
  }

  // ── 旧律（消融用）：钟形 + 峰值常数 + 手工末端伸展 ──
  // ══════════════════════════════════════════════════════════════
  // ② 摆动腿髋屈（Oberg/Perry 30°）
  //   ⚠ 髋限位不对称（[−95°, +100°]），膝限位 [−145°, +2°] ⇒ **负 = 屈**
  // ══════════════════════════════════════════════════════════════
  // ★★ 单支撑必须**保持抬腿**，否则整段 SINGLE 相等于双脚站着。
  //   `bell = sin(πs)` 在 s=1 时为 0，所以进 SINGLE 相后钟形项归零
  //   ⇒ 髋/膝命令回到 0°（绑姿态）⇒ 摆动脚贴地
  //   ⇒ 实测「站满 12s、倾 3°、但单支撑占比 0%、摆动脚 0mm」——
  //   **相位进了 SINGLE，脚还在地上，等于没抬**（用户："双脚同时站地面毫无意义"）。
  //   修法：s≥1（SINGLE 与 STEP 末段）时把保持角**加到角度上**，不只是加到标量 lift。
  // ★★ 保持角**必须受 `permit` 门控**。
  //   真实单腿站立要求先完成重心转移（APA，约 0.3~0.5 s）再抬腿 ——
  //   腿一抬，支撑腿立刻承全部体重，此时重心若还没到支撑脚上，
  //   倒立摆已经过了不可恢复点，任何水平力都救不回来
  //   （实测不门控：0.85 s 倒、倾 50~83°、`com.z` 离支撑脚仍有 350~400 mm）。
  const holdHip = (s >= 1 && permit) ? p.hipHoldDeg : 0;
  const holdKnee = (s >= 1 && permit) ? p.kneeHoldDeg : 0;
  // ★★ 末端摆动**髋伸展**（terminal swing extension）—— 决定落脚点在身前还是身后。
  //   实测（tools/_sx，2026-10-03，用户报"前脚向后迈"）：
  //     STEP 期间 Δx(摆动脚−支撑脚) = **−644 ~ −1 mm**，躯干 x **恒为 0**。
  //   病根：髋目标全程是 `−hipDeg`（**屈曲**），而**髋屈曲把脚往身后摆**；
  //   `bell = sin(πs)` 只负责抬起和落回**原处**，**没有任何落脚位置控制**。
  //   正常步态（Perry & Burnfield / Winter）：摆动早期屈髋抬高足，
  //   **末端伸展**把小腿送出去 ⇒ 足跟着地落在**身体前方** —— 这才是步长的来源。
  //   缺了这一段，脚只会落在原地或身后，重心永远传不到前脚。
  //   形状：s ∈ [reachFrom, 1] 的平滑上升（0→1），s=1 时最大伸展。
  const sReach = s <= p.reachFrom ? 0
    : (s >= 1 ? 1 : (() => { const u = (s - p.reachFrom) / Math.max(1e-6, 1 - p.reachFrom); return u * u * (3 - 2 * u); })());
  const hipDeg = p.hipFlexPeakDeg * bell + holdHip
    - p.hipExtendDeg * sReach * (permit || rs.state === 'SWING' ? 1 : 0);
  //   ↑ 末端伸展是**减去**伸展量（往 −x 收回）—— 与髋"正=屈"的约定一致。
  // ⚠⚠⚠ **髋与膝的屈伸符号约定相反**，别再照抄：
  //   实测（tools/_fs，腿自由摆 1.5 s，人物朝 +x）：
  //     髋 +20° → 脚 **+76mm 前** ／ 髋 −20° → 脚 **−100mm 后**
  //     髋 +40° → 脚 **+313mm 前** ／ 髋 −40° → 脚 **−309mm 后**
  //   ⇒ **髋：正 = 屈曲 = 脚往前**
  //   膝限位 [−145°, +2°] ⇒ **膝：负 = 屈曲**（膝不能反屈）
  //   历史实现把膝的 `-` 符号照抄给了髋，注释写着"摆动髋屈"而实际发的是**伸**，
  //   于是摆动脚往身后走 —— 用户报"前脚向后迈"（实测 Δx −644mm、躯干 x 恒为 0）。
  rs.requestSwingLegAngle(swing, jHip, 2, clamp(hipDeg * D2R, 1.05), '摆动髋屈', lift > 0.01);

  // ══════════════════════════════════════════════════════════════
  // ③ 摆动腿膝屈（Oberg/Perry 63°，峰值在摆动中段）
  //   膝的符号与髋相反约定：膝"屈" = 目标角更负
  // ══════════════════════════════════════════════════════════════
  const kneeDeg = p.kneeFlexPeakDeg * bell + holdKnee;
  // ⚠⚠ `clamp(v, m)` 的第二个参数是**上限幅值**（限到 ±m），必须为正。
  //   这里曾写成 `clamp(..., -1.2)` ⇒ `v > -1.2` 恒真 ⇒ **恒返回 −1.2**
  //   ⇒ 摆动腿膝被永久命令到 −69°，与相位无关 ⇒ 开局就塌，存活 0.98s。
  //   而且它在**迈步系统**里，所以把平衡系统的通道全部消融也照样触发。
  rs.requestSwingLegAngle(swing, jKnee, 2, clamp(-kneeDeg * D2R, 1.2), '摆动膝屈', lift > 0.01);

  // ══════════════════════════════════════════════════════════════
  // ④ 摆动相髋外展（让开支撑腿；注意：单支撑时这也是搬 CoM 的配重）
  // ══════════════════════════════════════════════════════════════
  if (lift > 0.01) rs.requestSwingLegAngle(swing, jHip, 1, 0.12 + (s >= 1 ? 0.10 : 0), '摆动外展', false);

  // ══════════════════════════════════════════════════════════════
  // ⑤ 腰的**受限修正槽**（用户 2026-10-03：迈步系统也控腰，但只做一点修正）
  //   · 幅度由 `rigState.requestWaistSlot` 夹在 ±6°（Mann 1975）
  //   · 且乘 α(t)（只��单支撑/摆动相非零）
  //   · 落回地面（s→1）时修正归零，避免残留
  // ══════════════════════════════════════════════════════════════
  // ★ 上身反相：同样走**提案**（累加到 `roll`）。
  //   ⚠ 旧实现把反相**分发到 spine1/2/3 三根轴各自的角**（链的"形状"）；
  //     新模型把上身当一个整体（一个倾角 ⇒ 一个力），**形状由 balance 的
  //     `τ=JᵀF` 按几何分配**。这是一次**建模简化**，用 A/B 验证（消融 `upForce`）。
  // ★★★ 2026-10-06：**反相不再是硬编码的 6°/3°/2°，改由目标表给**
  //   （旧值是本项目自己拍的；现在表值有文献锚点：骨盆旋转 8° 总程、胸廓反相）。
  //   `rs.authority`（相位强度）仍作为缩放 —— 它表达"这个相位该不该出力"。
  const swSign = swing === 'l' ? 1 : -1;
  //   ⚠ 这里没有"相内进度"，只有状态对应的**主关键帧** ⇒ 直接取该相位的表值
  //     （关键帧分支那条路才有 `lerpKeyPose` 的插值）。
  const kp2 = KEY_POSES[STATE_TO_GAIT[rs.state]];
  const yawT = swSign * kp2.trunkYaw * rs.authority;
  const latT = swSign * kp2.trunkLat * rs.authority;
  if (on('upForce')) {
    // ★ 同关键帧分支：目标由 step 直写脊柱（balance 只加修正）
    const nSp2 = 3;
    for (const jj of [jSp1, jSp2, jSp3]) {
      if (jj < 0) continue;
      void jj; void nSp2;
      rs.waist.step.roll += latT;
      rs.waist.step.authority = rs.authority;
      // ⚠ 轴1（扭转）暂不驱动，理由见上
    }
    rs.waist.step.gain = rs.authority * (p.waistBorrowK ?? 0.0);
    rs.proposeUpperBody(0, latT, yawT);
  } else {
    if (jSp1 >= 0) rs.requestWaistSlot(jSp1, 0, latT, '迈步反相');
    if (jSp2 >= 0) rs.requestWaistSlot(jSp2, 0, yawT * 0.5, '迈步反相');
    if (jSp3 >= 0) rs.requestWaistSlot(jSp3, 0, yawT * 0.5, '迈步反相');
  }
}