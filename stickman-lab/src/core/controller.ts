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
    this.snapshot = this.rs.snapshot();
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
    const [fl, fr] = sim.doll.footLoadFrac(dt);
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
    rs.grounded.l = sim.doll.footGrounded(0);
    rs.grounded.r = sim.doll.footGrounded(1);
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

    // ── 4/5. 两系统**并发**提需求 ──────────────────────────
    balanceSystem(rs, this.cfg.balance, this.sim.doll);
    stepSystem(rs, this.cfg.step);

    // ── 6. 仲裁 → 唯一 target ──────────────────────────────
    const out = rs.arbitrate(dt);
    // ★ 力矩通道（`τ = JᵀF` 的产物）与角度通道**并联**送进马达。
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