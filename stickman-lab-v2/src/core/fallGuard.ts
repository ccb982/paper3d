/**
 * fallGuard.ts —— 跌倒全权处理（执行方）
 *
 * 用户定调：通用反射先只写"执行方"，提案方后置；优先保证每个保护动作**单独测对**。
 * 快跌倒时的保护动作：**绷直身子 / 转移重心 / 跪下脚撑地**。
 * 触发后**全权接管**（可中断迈步/动作提案），处理完 `release()` 恢复之前的任务。
 *
 * 纪律：
 *   · 全权期间平衡/垫脚/动作提案让位（不并行），保护反射独占；
 *   · 每个动作可单独调用（brace() / weightShiftTo() / kneel()），便于逐个验收；
 *   · 只写目标/刚度（经 bal.manual / bal.setComTarget），不直接写关节力矩。
 */

import type { World } from './world';
import type { Sensors } from './sensors';
import type { StabilityWarner } from './stability';

export type FallAction = 'none' | 'brace' | 'weightShift' | 'kneel';

export interface FallGuardOptions {
  /** 绷直刚度倍数（× Drive 默认刚度） */
  braceKpScale: number;
  /** 从站姿降到跪姿的时长（s） */
  kneelTime: number;
  kneelHip: number;
  kneelKnee: number;
  kneelAnkle: number;
}

export const DEFAULT_FALL_OPTIONS: FallGuardOptions = {
  braceKpScale: 3,
  kneelTime: 0.7,
  kneelHip: 1.1,
  kneelKnee: -2.0,
  kneelAnkle: 0.35,
};

export class FallGuard {
  readonly opt: FallGuardOptions;
  action: FallAction = 'none';
  /** 全权模式（接管后 balance/垫脚/提案让位） */
  authority = false;
  /** 接管原因（回读） */
  reason = '';
  /** 是否处于跌倒急救（落地保护）状态 */
  firstAid = false;
  private savedCom = { x: 0, z: 0 };
  private kneelT = 0;
  private shiftSide: 'l' | 'r' = 'l';

  constructor(
    private readonly world: World,
    private readonly sensors: Sensors,
    private readonly bal: StabilityWarner,
    opt: Partial<FallGuardOptions> = {},
  ) {
    this.opt = { ...DEFAULT_FALL_OPTIONS, ...opt };
  }

  /** 全权接管：保存任务上下文（CoM 目标等） */
  takeOver(reason = 'fall'): void {
    if (this.authority) return;
    this.authority = true;
    this.reason = reason;
    this.savedCom = this.bal.getComTarget();
  }

  /**
   * ★ 摔倒**开始后**的急救入口（用户定调：绷直是跌落已不可避免时的急救，
   * 不是平衡恢复手段）。由 giveup 判定或外部跌落检测触发。
   * 当前序列：绷直（非踝高刚度）→ 保持到落地结束。跪下/重量转移后续接入。
   */
  startFirstAid(reason = '跌落急救'): void {
    this.takeOver(reason);
    this.firstAid = true;
    this.brace();
  }

  /** 处理完，恢复任务上下文 */
  release(): void {
    this.authority = false;
    this.action = 'none';
    this.firstAid = false;
    this.bal.setComTarget(this.savedCom.x, this.savedCom.z);
  }

  // ──────────────────────────── 执行方（可单独调用）
  /** 绷直身子：**非踝**关节锁在当前角 + 高刚度（共收缩）。
   *  ★ 踝不锁：CoP 仍由垫脚管——把踝也锁死等于刚性倒立摆（实测 0.25m/s 推就倒）。 */
  brace(): void {
    this.action = 'brace';
    const body = this.world.body;
    for (const d of body.dofs) {
      if (d.engineMotor) continue;
      if (/^foot_/.test(d.name)) continue;      // 踝留给垫脚
      const lim = Math.max(Math.abs(d.min), Math.abs(d.max), 0.3);
      const kp = this.opt.braceKpScale * 0.5 * d.tauMax / lim;
      this.bal.manual.setAngle(d.name, d.axis, d.angle, kp);
    }
  }

  /** 转移重心：把 CoM 目标移到指定脚上方（配合垫脚） */
  weightShiftTo(side: 'l' | 'r'): void {
    this.action = 'weightShift';
    this.shiftSide = side;
  }

  /** 跪下脚撑地：髋/膝/踝协同降到跪姿 */
  kneel(): void {
    this.action = 'kneel';
    this.kneelT = 0;
  }

  /** 每步（全权期间调用；在 beginStep 之后、applyAll 之前） */
  step(dt: number): void {
    if (!this.authority) return;
    switch (this.action) {
      case 'brace':
        this.brace();                       // 每步刷新（姿态在变）
        break;
      case 'weightShift':
        this.bal.setComTarget(0, this.sensors.feet[this.shiftSide === 'l' ? 0 : 1]!.z);
        break;
      case 'kneel': {
        this.kneelT += dt;
        const u = Math.min(1, this.kneelT / this.opt.kneelTime);
        const s = u * u * (3 - 2 * u);
        for (const side of ['l', 'r'] as const) {
          this.bal.manual.setAngle(`hip_${side}`, 2, this.opt.kneelHip * s);
          this.bal.manual.setAngle(`knee_${side}`, 2, this.opt.kneelKnee * s);
          this.bal.manual.setAngle(`foot_${side}`, 2, this.opt.kneelAnkle * s);
        }
        this.bal.setComTarget(-0.03, 0);
        break;
      }
      case 'none':
        break;
    }
  }
}
