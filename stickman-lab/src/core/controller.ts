/**
 * ══════════════════════════════════════════════════════════════════
 * ⑥  controller.ts —— 编排 + **唯一快照产出点**
 * ══════════════════════════════════════════════════════════════════
 *
 * 每一拍的固定顺序（顺序很重要，不能改）：
 *   1. rigState.beginTick(dt)          清空需求与仲裁痕迹
 *   2. 从物理回读 → 写进 rigState     （承重/锁定/相的判据读这些）
 *   3. gaitState.update(dt)            迁移状态、授予承重、解锁、算 α(t)
 *   4. balanceHold(rs)                 提需求（支撑腿 + 腰）
 *   5. stepSystem(rs)                  提需求（摆动腿 + 腰受限槽）
 *   6. rigState.arbitrate(dt)          ★ 合并成唯一 target
 *   7. rigState.snapshot()             ★ 产出不可变快照（UI/探针唯一出口）
 *
 * ★ 7 产出的快照是 UI 与冒烟测试**共同消费**的对象 —— 这就是"你看到的
 *   和我回读的必须一致"的机械保证。
 */

import { omegaAt, dcm, readCom, readSupport } from './posture';
import { assertRigInvariants, auditJoints, rigSummary, type RigReport } from './rig';
import { RigState, DEFAULT_RIGSTATE_CONFIG, type RigSnapshot, type RigStateConfig, type Side } from './rigState';
import { GaitState, DEFAULT_GAIT_CONFIG, type GaitConfig } from './gaitState';
import { balanceSystem, DEFAULT_BALANCE_PARAMS, type BalanceParams } from './systems/balance';
import { stepSystem, DEFAULT_STEP_PARAMS, type StepParams } from './systems/step';
import type { Sim } from './sim';
import type { Skeleton } from './skeleton';

export interface ControllerConfig {
  rig: RigStateConfig;
  gait: GaitConfig;
  balance: BalanceParams;
  step: StepParams;
}

export const DEFAULT_CONTROLLER: ControllerConfig = {
  rig: DEFAULT_RIGSTATE_CONFIG,
  gait: DEFAULT_GAIT_CONFIG,
  balance: DEFAULT_BALANCE_PARAMS,
  step: DEFAULT_STEP_PARAMS,
};

export class Controller {
  readonly rs: RigState;
  readonly gait: GaitState;
  cfg: ControllerConfig;
  /** ★ 每拍整体替换的不可变快照。UI / 探针 / 冒烟测试只读它 */
  snapshot: RigSnapshot;
  readonly rigReport: RigReport;
  /** 载荷比的低通状态（τ=60 ms）。理由见 `step()` 里赋值处的注释。 */
  private readonly loadFilt = { l: 0.5, r: 0.5 };
  /** 接触去抖：上一拍的原始接地事实（用来判"翻转"） */
  private gndPrev = { l: false, r: false };
  /** 接触去抖：原始标志已连续保持多久（s） */
  private gndRawT = { l: 0, r: 0 };
  /** 接触去抖时长（s）。取 3 拍（60Hz）—— 实测翻转间隔约 1~2 拍，3 拍能把它们吃掉 */
  private readonly groundedHoldSec = 3 / 60;
  /** 本拍接触翻转次数（诊断用，累加后交给 `rs.contactFlips`） */
  private contactFlips = 0;
  /** ★ 本拍的鞋底力剖面缓存（`loadFrac` 与力链**共用同一份**，杜绝两套口径） */
  private soleCache: { l: import('./rigState').FootForce | null; r: import('./rigState').FootForce | null } = { l: null, r: null };
  /** 本拍载荷读数是否可信（两脚有效载荷之和过阈） */
  private soleValid = false;

  constructor(sk: Skeleton, private sim: Sim, cfg: ControllerConfig = DEFAULT_CONTROLLER) {
    this.cfg = cfg;
    // ★ 启动硬断言：不满足直接抛，不降级
    this.rigReport = assertRigInvariants(sk, sim.shape);
    this.rs = new RigState(sk, cfg.rig);
    this.gait = new GaitState(this.rs, cfg.gait);
    // ★★ 让 `Sim` 的 reward 与控制**共用同一个状态机**（架构收敛，2026-10-04）。
    //   `sim.ts` 此前自持 `GaitPhaseMachine` + `GaitCommander` + `ModuleSet`
    //   + `PelvisFirstTracker` 四套并行状态，逐拍推进 ⇒ 摆动腿、相位门禁、
    //   循环信用全都不来自 `gaitState`。注入后 reward 的相位/摆动腿只有一个来源。
    sim.attachRigState(this.rs);
    this.installForceSource();
    this.snapshot = this.rs.snapshot();
  }

  /**
   * ★★ 安装**力链原始读数源**（用户 2026-10-06：力链分析放状态机，供平衡系统使用）。
   *
   *   与 `gaitState.installJointQuery()` 同一模式：**读的权限在状态机**，
   *   这里只提供"怎么从 `Ragdoll` 读"，组装与解释全在状态机（`forceChain.ts`）。
   */
  private installForceSource(): void {
    const sk = this.rs.sk;
    const doll = this.sim.doll;
    const tmp = new Float64Array(3);
    const massKg = sk.bodies.reduce((a, b) => a + (b.mass ?? 0), 0);
    // 踝关节索引（力臂原点用）。`foot_l`/`foot_r` 就是踝。
    const ankleIdx: Record<'l' | 'r', number> = {
      l: sk.joints.findIndex((j) => j.name === 'foot_l'),
      r: sk.joints.findIndex((j) => j.name === 'foot_r'),
    };
    // 踝可用力矩：矢状 = 绕 z（axis 2），额状 = 绕 x（axis 0）
    const ankleTau = (ax: 0 | 2): number => {
      let m = 0;
      for (const gi of [ankleIdx.l, ankleIdx.r]) {
        const j = sk.joints[gi];
        if (j) m = Math.max(m, Math.abs(j.maxTorque[ax] ?? 0));
      }
      return m;
    };
    // 足长：足部 cuboid 的 x 向全宽（`hx` 是半长）。保底 0.22 m（成人足长量级）。
    const footBody = sk.bodies.find((b) => b.key === 'foot_l');
    const fc = footBody?.colliders.find((c) => c.shape === 'cuboid');
    const footLen = Math.max(0.18, Math.abs(fc?.hx ?? 0.11) * 2);

    // ⚠ `soleForceProfile` 里的 `contactImpulse` 是**上一个物理步**的冲量
    //   （物理 120Hz，控制 60Hz）⇒ 必须按**物理步长**换算成力，
    //   否则载荷被低估 2 倍（实测 135N vs 体重 687N）。
    const physDt = 1 / (this.sim.cfg?.physicsHz ?? 120);
    this.rs.forceSrc = {
      sole: (side) => {
        // 缓存为空（理论上不该发生：传感器块在 gait.update 之前跑）时兜底现读一次
        const cached = side === 0 ? this.soleCache.l : this.soleCache.r;
        return cached ?? doll.soleForceProfile(side, physDt);
      },
      ankle: (side) => {
        const gi = ankleIdx[side === 0 ? 'l' : 'r'];
        if (gi < 0) return { x: 0, z: 0 };
        doll.jointWorld(gi, tmp);
        return { x: tmp[0]!, z: tmp[2]! };
      },
      massKg: () => massKg,
      tauMax: () => ({ sag: ankleTau(2), lat: ankleTau(0) }),
      footLen: () => footLen,
    };
  }

  get summary(): string { return rigSummary(this.rigReport); }

  /** ★ 一个控制拍。返回本拍的动作目标（已仲裁）。 */
  step(dt: number): Float32Array {
    const rs = this.rs;
    const sim = this.sim;
    rs.beginTick(dt);

    // ── 2. 从物理回读 → 写进 rigState ──────────────────────
    const com = readCom(sim.doll, rs.com);
    readSupport(sim.doll, rs.support);
    rs.updateComAccel(dt);
    const om = omegaAt(com.y);
    rs.dcm.x = dcm(com.x, com.vx, om);
    rs.dcm.z = dcm(com.z, com.vz, om);
    // MoS：支撑面前沿 − 捕获点（Hof 2005）
    rs.mos = (rs.support.cx + rs.support.halfX) - rs.dcm.x;
    // ★★ 2026-10-06 **口径收敛**：`loadFrac` 不再自己数接触（`footLoadFrac`），
    //   而是与力链**共用同一份鞋底剖面**。原因（实测）：
    //     旧 `footLoadFrac` 用 `numContacts()`（含**预测性接触**）且不做法线/包围盒过滤，
    //     于是「左脚接触块 0（力链）」与「左脚载荷 0.53（loadFrac）」**同时成立** ——
    //     平衡系统按 0.53 去控一条根本没着地的腿。
    //   现在：只有真正有求解接触（`numSolverContacts`）的脚才算载荷；
    //   两脚都读不到时**保持上一拍并降低可信度**，**不再回退 0.5/0.5**。
    const physDt = 1 / (this.sim.cfg?.physicsHz ?? 120);
    this.soleCache.l = sim.doll.soleForceProfile(0, physDt);
    this.soleCache.r = sim.doll.soleForceProfile(1, physDt);
    const fzL = this.soleCache.l.copValid ? this.soleCache.l.fz : 0;
    const fzR = this.soleCache.r.copValid ? this.soleCache.r.fz : 0;
    const fzSum = fzL + fzR;
    let fl: number; let fr: number;
    if (fzSum > 15) {
      fl = fzL / fzSum; fr = fzR / fzSum;
      this.soleValid = true;
    } else {
      // 两脚都没有有效载荷 ⇒ 沿用上一拍（**不编造 0.5/0.5**），并标记不可信
      fl = this.loadFilt.l; fr = this.loadFilt.r;
      this.soleValid = false;
    }
    // ★★ 载荷分配必须**滤波**，否则 `supportLeg` 会跟着噪声翻转。
    //   实测未滤波时载荷比在 0.1 s 内这样跳：
    //     0.50/0.50 → 0.99/0.01 → 0.49/0.51 → 0.44/0.56 → 0.87/0.13 → …
    //   后果是连锁的：
    //     ① `supportLeg` 抖动 → 相位 DOUBLE↔SHIFT 来回切
    //     ② B4「持续 80 ms」每次翻转都重置 ⇒ **承重标识永远授予不了**（实测 B4 恒为 0）
    //     ③ SHIFT 一出现就打开额状面主通道 `τ = JᵀF`，把髋打到 ±15°（实测）
    //        ⇒ 双脚支撑从"站满 8 s"退化成 1.68 s
    //   物理上载荷不会在 100 ms 内从 50/50 跳到 99/1 —— 这是接触求解噪声，不是真实力。
    //   一阶低通，τ=60 ms：必须**快于** B4 的 80 ms 窗口，否则滤波本身
    //   又会把承重标识的授予推迟到窗口之外（实测 τ=120 ms 时双脚仍只有 2.63 s）。
    const kL = 1 - Math.exp(-dt / 0.06);
    this.loadFilt.l += (fl - this.loadFilt.l) * kL;
    this.loadFilt.r += (fr - this.loadFilt.r) * kL;
    rs.loadFrac.l = this.loadFilt.l; rs.loadFrac.r = this.loadFilt.r;
    // ★★ **接触去抖**（2026-10-06）。实测原始 `footGrounded` 逐拍在
    //   `11 / 01 / 10` 之间翻转（`probe-domain` 的 LOAD 段可见），
    //   而状态机的 `双脚接地` / `后脚未离地` / `承重腿在位` 都是**单采样**判据
    //   ⇒ 会被接触噪声直接判死。
    //   `rs.grounded` 保留**原始事实**（UI 的「接地/离地」要看真的），
    //   另存一份**去抖后**的 `rs.gndStable` 专供判据。
    // ★★ 2026-10-06 **接地口径也收敛到力链**（§3.7-B6「一个量只有一个来源」）。
    //   实测矛盾：`承接载荷 0.5`（力链：有求解接触、有载荷）与
    //   `双脚接地 0/2`（`footGrounded`：按 manifold 法向判，说不着地）**同时成立**
    //   ⇒ 状态机被卡在 DOUBLE 出不去，而脚明明踩着。
    //   `footGrounded` 走的是 `numContacts()` + `|n_y|>0.5`，与力链的
    //   `numSolverContacts()` + 法线对齐是**两条路径**。
    //   ⇒ 接地 = **力链的 copValid**（有求解接触且合力 > 15N）。
    //     语义也更对：`生/熟`单脚悬空时 copValid=false ⇒ grounded=false。
    //   注：`soleCache` 在上面的载荷收敛处已经算好，这里直接复用，不重复查询。
    //   ⚠ 实测教训（2026-10-06）：**不能**用力链的 `contactN`/`copValid` 当接地事实 ——
    //     `soleForceProfile` 用 `numSolverContacts()`，静置接触在求解器里可能是**空的**
    //     （脚确实踩着，但当前步没有需要求解的接触），于是"脚在地上"被判成 false，
    //     整机在 t=0 就开始掉（GRF 仅 58N vs 体重 687N）。
    //   ⇒ 接地事实**仍用 `footGrounded`**（`numContacts` + 法向）；
    //     两者的差异（"有接触无载荷"）留给力链的 `copValid/trustNote` 去**报告**，
    //     不用它去改接地判定。
    const gRawL = sim.doll.footGrounded(0);
    const gRawR = sim.doll.footGrounded(1);
    if (gRawL !== this.gndPrev.l) { this.gndRawT.l = 0; this.contactFlips++; }
    if (gRawR !== this.gndPrev.r) { this.gndRawT.r = 0; this.contactFlips++; }
    if (gRawL === this.gndPrev.l) this.gndRawT.l += dt;
    if (gRawR === this.gndPrev.r) this.gndRawT.r += dt;
    this.gndPrev.l = gRawL; this.gndPrev.r = gRawR;
    if (this.gndRawT.l >= this.groundedHoldSec) rs.gndStable.l = gRawL;
    if (this.gndRawT.r >= this.groundedHoldSec) rs.gndStable.r = gRawR;
    rs.grounded.l = gRawL;
    rs.grounded.r = gRawR;
    // 诊断：接触翻转数与「载荷读数落在 0.5/0.5 回退值」的占比
    //   （后者是接触模型可信度的代理指标 —— 有接触却读到回退值 = 读数不可信）
    rs.contactFlips = this.contactFlips;
    this.contactFlips = 0;
    if (Math.abs(rs.loadFrac.l - 0.5) < 2e-3 && Math.abs(rs.loadFrac.r - 0.5) < 2e-3) {
      rs.loadFallbackFrac = Math.min(1, rs.loadFallbackFrac + 1 / Math.max(1, Math.round(0.5 / dt)));
    } else {
      rs.loadFallbackFrac *= 0.96;
    }
    // ★★ **收敛点**："现在是真单支撑吗"由 `Ragdoll` 的统一判定给出
    //   （接触数 + 净空门槛 + 滞回），控制侧与计分侧读**同一份**。
    //   ⚠ 纯**读取** `stanceSingleNow`。挡位 II 下 `sim.cfg.driver==='controller'`
    //     ⇒ `controlTick` 不跑 ⇒ 那个唯一推进点不被执行 —— 所以这里不能只读，
    //     必须自己推一次（见下一行）。
    //   ⚠ 不直接用裸接触数：计分侧注释实测「88% 的离地不到 3 cm ⇒ 多是接触抖动」。
    // ★ 2026-10-04：`driver` 开关已删除（唯一路径 = Controller）⇒ 无需分支，
    //   一律由本函数自己推一次计分用的单支撑判定。
    {
      // 控制路径：推进 + 读取，保证两条路径的判据同一份、且都在固定拍上推进
      sim.doll.stanceClearancePeak = Math.max(
        Math.max(0, sim.doll.soleY('l')), Math.max(0, sim.doll.soleY('r')),
      );
      sim.doll.advanceStance(dt);
      rs.stanceSingle = sim.doll.stanceSingleNow;
    }
    // ⚠ `rs.grounded` 仍保留**逐脚原始接地**（B1 与 UI 的"接地/离地"要用），
    //   单支撑是**派生**判断，不替代逐脚事实。
    sim.doll.soleXZ('l', TMP_A); rs.soleX.l = TMP_A[0]!; rs.soleZ.l = TMP_A[2]!;
    sim.doll.soleXZ('r', TMP_B); rs.soleX.r = TMP_B[0]!; rs.soleZ.r = TMP_B[2]!;
    // 逐关节读数（两系统共享同一份）
    const n = sim.doll.jointCount;
    for (let j = 0; j < n; j++) {
      for (let a = 0; a < 3; a++) {
        const i = j * 3 + a;
        sim.doll.jointRot(j, TMP_RV);
        rs.pos[i] = TMP_RV[a]!;
        sim.doll.jointRelVel(j, TMP_RV);
        rs.vel[i] = TMP_RV[a]!;
      }
    }
    // ★ 真·压力中心（足部发力的直接测量，见 Ragdoll.readCoP）
    sim.doll.readCoP(0, TMP_COP_L); sim.doll.readCoP(1, TMP_COP_R);
    rs.cop.l.x = TMP_COP_L[0]!; rs.cop.l.z = TMP_COP_L[2]!; rs.cop.l.load = TMP_COP_L[3]!;
    rs.cop.r.x = TMP_COP_R[0]!; rs.cop.r.z = TMP_COP_R[2]!; rs.cop.r.load = TMP_COP_R[3]!;
    rs.torsoY = sim.doll.torso().translation().y;
    rs.tiltDeg = sim.doll.tiltOf(sim.doll.torso()) * 57.2958;
    // ★★ 倾角按平面分解（否则分不出"腰向前折"还是"向侧倒"）。
    //   我的盲区：一直只报合成倾角大小，把前倾误当侧倒排查了很久
    //   （用户 2026-10-03：「之前还是侧向折，现在只是向前折」）。
    //   约定：x=矢状(前) y=竖直 z=额状(左)
    //     pitch 绕 z ⇒ 顶部倒向 ±x ⇒ 前/后倾
    //     roll  绕 x ⇒ 顶部倒向 ±z ⇒ 左/右倾
    {
      const q = sim.doll.torso().rotation();
      const ax = 2 * (q.x * q.y + q.w * q.z);
      const ay = 1 - 2 * (q.y * q.y + q.z * q.z);
      const az = 2 * (q.y * q.z - q.w * q.x);
      const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
      rs.pitchDeg = Math.atan2(ax, ay) * 57.2958;
      rs.rollDeg = Math.atan2(az, uy) * 57.2958;
      // ★ 俯仰/侧倾**角速度**（deg/s）：腰的姿态保持必须是 PD 而不是纯 P。
      //   纯 P 的指令会被 spine 的 ±15~25° 限幅打饱和 ⇒ 过冲 ⇒ 折向翻转
      //   （实测前折 +80°；加腰控制器后变成后折 −79°，就是过冲造成的）。
      const av = sim.doll.torso().angvel();
      rs.pitchRate = av.z * 57.2958;
      rs.rollRate = av.x * 57.2958;
    }
    // GRF：用法向载荷 + 接触切向估计的合力方向（横/竖比实测 0.074~0.333）
    rs.grf.x = 0; rs.grf.y = Math.max(0.2, 686.7 * Math.max(fl, fr));

    // ── 3. 状态机 ──────────────────────────────────────────
    this.gait.update(dt);

    // ── 4/5. 两系统提需求。**顺序不可交换**（用户 2026-10-05 定职责）──────
    //   step 先跑：它申报"要把重心搬过去"的**意图**（`rs.shiftDemandTau`）。
    //   balance 后跑：把它当偏置读进去，再叠 τmax / CoP 余量两道**护栏**。
    //   反过来 ⇒ balance 读到的是上一拍的意图，控制律整整滞后一帧（16.7ms），
    //   而且 SHIFT 相刚进入时推力阶跃会晚一拍才生效。
    // ★ 2026-10-06：消融名单**只有一个来源**（`cfg.balance.ablate`）。
    //   此前 `step` 一个门都没有 ⇒ 「全消融」名不副实（门禁 B 实测差 3.2s）。
    stepSystem(rs, { ...this.cfg.step, ablate: this.cfg.balance.ablate });
    balanceSystem(rs, this.cfg.balance, this.sim.doll);

    // ── 6. 仲裁 → 唯一 target ──────────────────────────────
    const out = rs.arbitrate(dt);
    // ★★★ 角度通道（位置伺服）：`out` 就是它，但**这条线一直缺着**。
    //   实测（tools/probe-motortarget）：480 拍里 `setMotorTargets` 被调用
    //   **0 次**，`motorTarget` 54 项全为 0，而仲裁器明明算出了 10 项非零目标
    //   （最大 |1.0|）—— 算完就丢。⇒ 全部位置 PD（`sagSupport` 的髋/膝）
    //   与步态关键帧**一直是死的**，只有力矩通道在出力。
    //   git 查证：controller.ts 的 12 个历史版本里 `setMotorTargets` 出现次数
    //   **全为 0** ⇒ 不是被改坏的，是从第一天就没接。
    //   这解释了"两种模式 com.y 都塌"：塌的不只是平衡，支撑本身就没在工作。
    this.sim.doll.setMotorTargets(out);
    // ★ 力矩通道（`τ = JᵀF` 与全链 QP 的产物）与角度通道**并联**送进马达。
    //   必须在 arbitrate 之后 —— `tauOut` 是仲裁的结果。
    this.sim.doll.setTorqueTargets(rs.tauOut);
    // ★ 让位掩码：让 `τ=JᵀF` 接管的轴，位置伺服退化为纯阻尼
    this.sim.doll.setHoldMask(rs.holdMask);

    // ── 7. 力链（自下而上的传递力）──────────────────────────
    //   ★ 用户 2026-10-04：「力应该是自脚往上传的，盆骨只是运用了这股力」
    //   ⇒ 顺序是刚性的：**先采样速度 → 再算子树约束力 → 最后打包快照**。
    //     换序会退化成单步差分（实测把落地冲击读成 109 kN）。
    this.sim.doll.primeVelocities();
    this.sim.doll.jointForce(rs.forceBuf, dt);
    rs.forceReady = this.sim.doll.forceChainReady();

    // ── 8. 重心转移诊断 ────────────────────────────────────
    //   ★ 用户 2026-10-04：「我需要看的是**如何把重心转移到单腿中**」。
    //     单腿力链看不到是因为转移做不到（因果反了）⇒ 这里画转移过程本身。
    //     `cmdGrfLat` 回填平衡系统写的 `grfCmd.z`（只读，不让两个系统互写）。
    rs.cmdGrfLat = rs.grfCmd.z;
    rs.updateComTransfer(dt);

    // ── 9. 快照（唯一出口）────────────────────────────────
    this.snapshot = rs.snapshot();
    return out;
  }

  /** 脚底离地高度（UI 显示用；与快照同源 —— 每次调用都回读并写进 rs） */
  soleClearance(side: Side): number {
    const y = this.sim.doll.soleY(side);
    this.rs.soleY[side] = y;
    return y;
  }

  reset(): void {
    this.loadFilt.l = 0.5; this.loadFilt.r = 0.5;
    this.gait.reset();
    this.rs.beginTick(0);
    this.snapshot = this.rs.snapshot();
  }
}

const TMP_A = new Float64Array(3);
const TMP_B = new Float64Array(3);
const TMP_RV = new Float64Array(3);
const TMP_COP_L = new Float64Array(4);
const TMP_COP_R = new Float64Array(4);
export { auditJoints, rigSummary };
export type { RigReport, RigSnapshot };