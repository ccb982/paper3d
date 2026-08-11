// ============================================================
// AIStateMachine —— 状态机解释器（配置驱动，敌人/友军共用）
// ============================================================
// 每帧：执行当前状态行为 → 检查转移条件 → 满足则切状态。

import type { AIConfig } from './aiconfig';
import type { BehaviorContext } from './behaviors';
import { behaviorTable } from './behaviors';
import { conditionTable } from './conditions';
import type { EnemyBase } from '../../entity/EnemyBase';

export class AIStateMachine {
  currentState: string;
  /** 当前状态已停留时间（minStay 判定） */
  private stayTimer = 0;

  constructor(private config: AIConfig) {
    this.currentState = config.initial;
  }

  /** 每帧驱动：行为 → 条件 → 转移 */
  update(entity: EnemyBase, ctx: BehaviorContext): void {
    const state = this.config.states[this.currentState];
    if (!state) return;

    this.stayTimer += ctx.dt;

    // 行为（顺序执行）
    for (const b of state.behaviors) {
      const fn = behaviorTable[b.name];
      fn?.(entity, ctx, b.params ?? {});
    }

    // ★ 转移条件：满足 minStay 才允许转移（防状态抖动/保证游走可见）
    const minStay = state.minStay ?? 0;
    if (this.stayTimer < minStay) return;

    // 转移条件（按顺序，满足第一个就切）
    for (const t of state.transitions) {
      const fn = conditionTable[t.cond];
      if (fn?.(entity, ctx, t.params ?? {})) {
        this.currentState = t.to;
        this.stayTimer = 0;
        break;
      }
    }
  }

  reset(): void {
    this.currentState = this.config.initial;
    this.stayTimer = 0;
  }

  get stateName(): string {
    return this.currentState;
  }
}
