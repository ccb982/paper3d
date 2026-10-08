/**
 * world.ts —— ★ v2 的世界（组装 Rapier World + Body + 步进循环）
 *
 * 与 v1 的 `sim.ts` 相比，这里**故意极简**：
 *   · 没有 Controller / 神经网络 / 适应度 / 步态状态机 / 池化
 *   · 只有"物理步进 + 执行器 + 限位"
 *
 * 理由：v1 的漂移排查到最后，**分不清是哪一层在写速度**。
 * v2 先把这个最小闭环做对（T1 静置不漂），再往上加东西。
 */

import RAPIER from '@dimforge/rapier3d';
import { buildSkeleton, DEFAULT_CONFIG } from './skeleton';
import type { Skeleton } from './skeleton';
import { Body, DEFAULT_BODY_OPTIONS } from './body';
import type { BodyOptions } from './body';
import { Drive, DEFAULT_DRIVE_OPTIONS } from './drive';
import type { DriveOptions } from './drive';

export interface WorldOptions extends BodyOptions {
  physicsHz: number;
  gravityY: number;
  drive: DriveOptions;
}

export const DEFAULT_WORLD_OPTIONS: WorldOptions = {
  ...DEFAULT_BODY_OPTIONS,
  physicsHz: 240,
  gravityY: -9.81,
  drive: DEFAULT_DRIVE_OPTIONS,
};

export class World {
  readonly sk: Skeleton;
  readonly opt: WorldOptions;
  readonly world: RAPIER.World;
  readonly body: Body;
  /** ★ 驱动层（C1 被动张力 / C2 柔性足弓 / C3 位置目标） */
  readonly drive: Drive;
  readonly dt: number;
  /** 已步进的物理步数 */
  steps = 0;
  /** 累计时钟（秒） */
  clock = 0;
  /** 是否每步调用 drive.step()（T1 静息测试会关掉它） */
  driveEnabled = true;

  constructor(opt: Partial<WorldOptions> = {}) {
    this.opt = { ...DEFAULT_WORLD_OPTIONS, ...opt };
    this.dt = 1 / this.opt.physicsHz;
    this.sk = buildSkeleton(DEFAULT_CONFIG);

    const w = new RAPIER.World({ x: 0, y: this.opt.gravityY, z: 0 });
    w.timestep = this.dt;
    w.numSolverIterations = this.opt.solverIterations;
    w.numAdditionalFrictionIterations = Math.max(1, this.opt.solverIterations >> 1);
    if (this.opt.contactHz > 0) {
      const ip = w.integrationParameters as unknown as {
        contact_natural_frequency?: number; contact_damping_ratio?: number;
      };
      ip.contact_natural_frequency = this.opt.contactHz;
      ip.contact_damping_ratio = this.opt.contactDamping;
    }
    this.world = w;
    this.body = new Body(w, this.sk, this.opt);
    this.drive = new Drive(this.sk, this.body.executor, this.body, this.opt.drive);
  }

  /**
   * ★ 推进 n 个物理步。
   *
   * 每步的顺序（与 v1 相同，这个顺序是有物理含义的）：
   *   1. `executor.beginStep()` —— 清记账
   *   2. `drive.step(dt)` —— 写 C1/C2/C3 力矩（在 step **之前**）
   *   3. `onStep` 回调 —— 外部可再写（会触发 N2 报警，是故意的）
   *   4. `world.step()`
   *   5. `body.enforceLimits()` —— 必须在 step **之后**（要看接触响应）
   *
   * @param n 步数
   * @param onStep 每步开始时的回调（用来施加力矩/控制）。步号从 0 开始。
   */
  advance(n: number, onStep?: (step: number, dt: number) => void): void {
    for (let i = 0; i < n; i++) {
      this.body.executor.beginStep();
      if (this.driveEnabled) this.drive.step(this.dt);
      if (onStep) onStep(i, this.dt);
      this.world.step();
      this.body.enforceLimits(this.dt);
      this.steps++;
      this.clock += this.dt;
    }
  }

  /** 清空全部力矩（"松手"）。⚠ 松手 ≠ 关节回位（v2 无位置环时） */
  clearTorques(): void {
    this.body.executor.clearAll();
  }

  /** 把重力设为 0（T1 静息测试用：隔离外部能量源） */
  setGravityZero(): void {
    this.world.gravity = { x: 0, y: 0, z: 0 };
  }

  setGravity(y: number): void {
    this.world.gravity = { x: 0, y, z: 0 };
  }

  /** 全关节 Σ|相对角速度| —— 静息测试的收敛指标 */
  totalRelVel(): number {
    const rv = new Float64Array(3);
    let s = 0;
    for (let i = 0; i < this.sk.joints.length; i++) {
      this.body.jointRelVel(i, rv);
      s += Math.abs(rv[0]!) + Math.abs(rv[1]!) + Math.abs(rv[2]!);
    }
    return s;
  }
}
