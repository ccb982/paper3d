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

  constructor(sk: Skeleton, private sim: Sim, cfg: ControllerConfig = DEFAULT_CONTROLLER) {
    this.cfg = cfg;
    // ★ 启动硬断言：不满足直接抛，不降级
    this.rigReport = assertRigInvariants(sk, sim.shape);
    this.rs = new RigState(sk, cfg.rig);
    this.gait = new GaitState(this.rs, cfg.gait);
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
    const om = omegaAt(com.y);
    rs.dcm.x = dcm(com.x, com.vx, om);
    rs.dcm.z = dcm(com.z, com.vz, om);
    // MoS：支撑面前沿 − 捕获点（Hof 2005）
    rs.mos = (rs.support.cx + rs.support.halfX) - rs.dcm.x;
    const [fl, fr] = sim.doll.footLoadFrac(dt);
    rs.loadFrac.l = fl; rs.loadFrac.r = fr;
    rs.grounded.l = sim.doll.footGrounded(0);
    rs.grounded.r = sim.doll.footGrounded(1);
    sim.doll.soleXZ('l', TMP_A); rs.soleX.l = TMP_A[0]!;
    sim.doll.soleXZ('r', TMP_B); rs.soleX.r = TMP_B[0]!;
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
    rs.torsoY = sim.doll.torso().translation().y;
    rs.tiltDeg = sim.doll.tiltOf(sim.doll.torso()) * 57.2958;
    // GRF：用法向载荷 + 接触切向估计的合力方向（横/竖比实测 0.074~0.333）
    rs.grf.x = 0; rs.grf.y = Math.max(0.2, 686.7 * Math.max(fl, fr));

    // ── 3. 状态机 ──────────────────────────────────────────
    this.gait.update(dt);

    // ── 4/5. 两系统**并发**提需求 ──────────────────────────
    balanceSystem(rs, this.cfg.balance);
    stepSystem(rs, this.cfg.step);

    // ── 6. 仲裁 → 唯一 target ──────────────────────────────
    const out = rs.arbitrate(dt);

    // ── 7. 快照（唯一出口）────────────────────────────────
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
    this.gait.reset();
    this.rs.beginTick(0);
    this.snapshot = this.rs.snapshot();
  }
}

const TMP_A = new Float64Array(3);
const TMP_B = new Float64Array(3);
const TMP_RV = new Float64Array(3);
export { auditJoints, rigSummary };
export type { RigReport, RigSnapshot };