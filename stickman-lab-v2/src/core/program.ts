/**
 * program.ts —— 相位节目（M5 核心）
 *
 * 这里放的是"动作提案的执行侧"：把被裁定采纳的提案展开成**相位**。
 * 与旧版关键帧的本质区别：相位结束由**事件**决定（触地/离地/重心到位/超时），
 * 绝不允许"时间到了就假装动作完成"——单腿站立的落腿必须真的触地。
 *
 * 纪律：
 *   · 相位只写"目标/参数"（经 bal.manual / bal.setComTarget），不直接写关节力矩；
 *   · 每个相位有**超时**兜底；超时仍不满足事件时调用 `onTimeout`（安全出口）；
 *   · abort 不允许停在半空：调用方用 `playSafeExit(落地相位)`。
 */

import type { Sensors } from './sensors';
import type { StabilityWarner } from './stability';
import type { Body } from './body';

export interface PhaseCtx {
  sensors: Sensors;
  bal: StabilityWarner;
  body: Body;
}

export interface Phase {
  name: string;
  /** 超时（秒）；到时强制结束并调用 onTimeout */
  timeout: number;
  enter?(ctx: PhaseCtx): void;
  update?(ctx: PhaseCtx, dt: number): void;
  /** 事件完成条件（不依赖时间） */
  done(ctx: PhaseCtx): boolean;
  /** 超时的安全出口（例如"还没触地就继续压低"） */
  onTimeout?(ctx: PhaseCtx): void;
}

export class ProgramRunner {
  private phases: Phase[] = [];
  private idx = -1;
  private phaseT = 0;
  private totalT = 0;
  private finished = true;
  /** 相位切换回调（日志/UI） */
  onPhase: ((name: string, ctx: PhaseCtx) => void) | null = null;

  constructor(private readonly ctx: PhaseCtx) {}

  play(phases: Phase[]): void {
    this.phases = phases;
    this.idx = 0;
    this.phaseT = 0;
    this.totalT = 0;
    this.finished = phases.length === 0;
    if (!this.finished) {
      this.onPhase?.(phases[0]!.name, this.ctx);
      phases[0]!.enter?.(this.ctx);
    }
  }

  step(dt: number): void {
    if (this.finished || this.idx < 0 || this.idx >= this.phases.length) return;
    const p = this.phases[this.idx]!;
    p.update?.(this.ctx, dt);
    this.phaseT += dt;
    this.totalT += dt;
    const done = p.done(this.ctx);
    const timeout = this.phaseT >= p.timeout;
    if (!done && !timeout) return;
    if (timeout && !done) p.onTimeout?.(this.ctx);
    this.idx++;
    this.phaseT = 0;
    if (this.idx >= this.phases.length) {
      this.finished = true;
      return;
    }
    const nx = this.phases[this.idx]!;
    this.onPhase?.(nx.name, this.ctx);
    nx.enter?.(this.ctx);
  }

  /** 安全退出：播放"保证落地"的相位序列（不允许停在半空） */
  playSafeExit(phases: Phase[]): void {
    this.play(phases);
  }

  /** 立即停止（不播放落地相位——仅在调用方另有落地保证时使用） */
  stop(): void {
    this.phases = [];
    this.idx = -1;
    this.finished = true;
  }

  get active(): boolean {
    return !this.finished && this.idx >= 0 && this.idx < this.phases.length;
  }

  get current(): { name: string; phaseT: number; totalT: number } | null {
    if (!this.active) return null;
    return { name: this.phases[this.idx]!.name, phaseT: this.phaseT, totalT: this.totalT };
  }
}
