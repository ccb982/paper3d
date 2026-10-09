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
import { Drive, DEFAULT_DRIVE_OPTIONS, type DriveOptions } from './drive';
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
    // 接触刚度/阻尼（可选）：软接触 + 硬姿势伺服会形成 ~76Hz 稳态振铃（实测）
    const chz = (this.opt.body as { contactHz?: number }).contactHz ?? 0;
    if (chz > 0) {
      const ip = w.integrationParameters as unknown as {
        contact_natural_frequency?: number;
        contact_damping_ratio?: number;
      };
      ip.contact_natural_frequency = chz;
      ip.contact_damping_ratio = (this.opt.body as { contactDamping?: number }).contactDamping ?? 0.9;
    }
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
  }

  setGravityZero(): void {
    this.world.gravity = { x: 0, y: 0, z: 0 };
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
