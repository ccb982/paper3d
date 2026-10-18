/**
 * world.ts —— 世界：骨架 → Rapier + Body + Drive + Executor 的唯一组装与步进循环
 *
 * 每物理步顺序（有物理含义，不要改）：
 *   1. `body.updateDofState()`   读关节角/角速度 + 有效惯量
 *   2. `executor.beginStep()`    清账本（无跨步状态 ⇒ 不存在积分饱和）
 *   3. `onStep`（可选）          外部通道：直接 addTorque 参与本步
 *   4. `drive.step(dt)`          被动/主动/伺服/前馈 全部写入 Executor
 *   5. `executor.applyAll(dt)`   ★ 每自由度恰好施加一次（饱和 → 力偶冲量）
 *   6. `world.step()`            引擎推进（角度限位由引擎 revolute 承担）
 *
 * 与 v1 的区别：**没有 step 之后的自研限位冲量**。每个自由度都是引擎铰链，
 * 限位由求解器直接管（v1 的自研限位既是能量泵、又和引擎限位打架）。
 */

import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG, type Skeleton } from './skeleton';
import { Body, DEFAULT_BODY_OPTIONS, type BodyOptions } from './body';
import { setBaseState, baseJoints } from './servo/baseTable';
import { supportCleanReset } from './servo/supportClean';
import { Drive, DEFAULT_DRIVE_OPTIONS, type DriveOptions } from './drive';
import { applySpineCurve } from './spineCurve';
import type { Executor } from './executor';

export interface WorldOptions {
  physicsHz: number;
  gravityY: number;
  body: BodyOptions;
  drive: DriveOptions;
}

export const DEFAULT_WORLD_OPTIONS: WorldOptions = {
  physicsHz: 480,
  gravityY: -9.81,
  body: { ...DEFAULT_BODY_OPTIONS },
  drive: { ...DEFAULT_DRIVE_OPTIONS },
};

export class World {
  readonly sk: Skeleton;
  readonly opt: WorldOptions;
  readonly world: RAPIER.World;
  readonly body: Body;
  readonly drive: Drive;
  readonly dt: number;
  steps = 0;
  clock = 0;
  /** 关掉驱动（T1 静息测试） */
  driveEnabled = true;
  /** ★ 各自由度原始限位快照（状态化限位的恢复基准） */
  private readonly dofLimits0 = new Map<number, { min: number; max: number; tauMax: number; velMax: number }>();
  /**
   * 外部控制器（`StabilityWarner` 等）：在 Drive 之前 step。
   * 控制器直接经 Executor 记账写入（重力补偿 / CoM 控制 / 手动通道）。
   */
  controller: { step(dt: number): void } | null = null;

  constructor(opt: Partial<WorldOptions> = {}) {
    this.opt = {
      ...DEFAULT_WORLD_OPTIONS,
      ...opt,
      body: { ...DEFAULT_WORLD_OPTIONS.body, ...(opt.body ?? {}) },
      drive: { ...DEFAULT_WORLD_OPTIONS.drive, ...(opt.drive ?? {}) },
    };
    this.dt = 1 / this.opt.physicsHz;
    this.sk = buildSkeleton(DEFAULT_CONFIG);

    const w = new RAPIER.World({ x: 0, y: this.opt.gravityY, z: 0 });
    w.timestep = this.dt;
    w.numSolverIterations = this.opt.body.solverIterations;
    w.numAdditionalFrictionIterations = this.opt.body.frictionIterations;
    // ★ 2026-10-16 振动专项：接触软度（CNF 越低越软越耗散）
    {
      const e0 = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
      const cnf = Number(e0.CNF ?? 0);
      if (cnf > 0) w.integrationParameters.contact_natural_frequency = cnf;
    }
    // （§2.280 接触柔化试验：真取值后失稳（髋节±21）已撤，保留默认 30/5）
    this.world = w;
    this.body = new Body(w, this.sk, this.opt.body);
    this.drive = new Drive(this.sk, this.body, this.executor, this.opt.drive);
    this.body.reset();
  }

  get executor(): Executor {
    return this.body.executor;
  }

  // ──────────────── 渲染层兼容面（viewer.ts 只用到这些）
  get bodies(): RAPIER.RigidBody[] {
    return this.body.bodies;
  }
  get jointCount(): number {
    return this.body.jointCount;
  }
  get jointBodies(): Int32Array {
    return this.body.jointBodies;
  }
  get indexByKey(): Map<string, number> {
    return this.body.indexByKey;
  }
  torso(): RAPIER.RigidBody {
    return this.body.torso();
  }

  /** 推进 n 个物理步。onStep 在 Drive 之前调用，可直接 addTorque。 */
  advance(n: number, onStep?: (step: number, dt: number) => void): void {
    for (let i = 0; i < n; i++) {
      this.body.updateDofState();
      this.executor.beginStep();
      if (onStep) onStep(i, this.dt);
      if (this.controller) this.controller.step(this.dt);
      if (this.driveEnabled) this.drive.step(this.dt);
      this.executor.applyAll(this.dt);
      this.world.step();
      this.steps++;
      this.clock += this.dt;
    }
  }

  reset(): void {
    this.body.reset();
    applySpineCurve(this.body);   // ★ 脊柱自然 S 形（用户 2026-10-16）
    this.drive.captureRest();     // ★ 被动刚度基准=当前姿态（否则被动弹簧把脊柱拉回竖直="一直往后拉"）
  }

  setGravityZero(): void {
    this.world.gravity = { x: 0, y: 0, z: 0 };
  }

  /**
   * ★★ 2026-10-17 用户（'架构做干净：站着和蹲着所有参数状态都隔离'）：
   *   **原子状态切换**——一次切完全部泄漏点（当前实现；State 对象化=后续重构）：
   *   ① baseTable 状态（基础力表+目标角表）
   *   ② 被动刚度基准重捕（captureRest——姿态须已到位）
   *   ③ 回正力缓存清（supportCleanReset——_ref/_lp/CoP 全清重捕）
   *   ④ 回正力目标缓存同步（syncRefState 由 baseState 变化自动触发）
   *   ⑤ CoM 目标归零
   *   ⚠ 调用前提：身体姿态已是目标状态姿势（先摆姿势→再切换）。
   */
  switchPoseState(state: string): void {
    setBaseState(state);
    // ★★★ 2026-10-18 用户（'关节限位放进状态伺服分区/架构干净/为蹲下专门一套关节伺服参数'）：
    //   **数据驱动**——τmax + 屈伸限位全部来自 baseTable 各状态的 joints 配置；
    //   先恢复骨架原始值（快照），再按当前状态覆盖。站立无 joints 配置=原始值。
    const DEGW = Math.PI / 180;
    if (this.dofLimits0.size === 0) {
      for (const d of this.body.dofs) this.dofLimits0.set(d.dofIndex, { min: d.min, max: d.max, tauMax: d.tauMax, velMax: d.velMax });
    }
    const jcfg = baseJoints();
    for (const d of this.body.dofs) {
      const o = this.dofLimits0.get(d.dofIndex);
      if (!o) continue;
      d.min = o.min; d.max = o.max; d.tauMax = o.tauMax; d.velMax = o.velMax;
      if (!jcfg) continue;
      for (const [re, v] of jcfg.tauMax ?? []) { if (new RegExp(re).test(d.name)) { d.tauMax = v; break; } }
      for (const [re, ax, mn, mx] of jcfg.limits ?? []) { if (d.axis === ax && new RegExp(re).test(d.name)) { d.min = mn * DEGW; d.max = mx * DEGW; break; } }
      for (const [re, ax, v] of jcfg.velMax ?? []) { if ((ax < 0 || d.axis === ax) && new RegExp(re).test(d.name)) { d.velMax = v; break; } }
    }
    this.drive.captureRest();          // ② 被动基准=当前姿态
    supportCleanReset();               // ③ 回正力缓存全清
    this.body.mirrorSymmetric = state === 'squat';   // ★ 蹲姿左右镜像（消不对称力——用户'受力让上身不居中'）
    this.body.groundUp = false;                      // ★ 互补子树在蹲姿乱振（正反馈）——暂关（用户：'基础力怎么可能往下'）
    this.body.flipUpper = state === 'squat' && String((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.SPINE_FLIP ?? '1') === '1';   // SPINE_FLIP=0 可关

  }

  setGravity(y: number): void {
    this.world.gravity = { x: 0, y, z: 0 };
  }

  /** 全自由度 Σ|ω|（静息/收敛指标） */
  totalRelVel(): number {
    let s = 0;
    for (const d of this.body.dofs) s += Math.abs(d.vel);
    return s;
  }

  /** 全自由度 Σ|Δθ| 相对静姿态（静息指标，单位度） */
  totalAngleDeg(): number {
    let s = 0;
    for (const d of this.body.dofs) s += Math.abs(d.angle) * 180 / Math.PI;
    return s;
  }
}
