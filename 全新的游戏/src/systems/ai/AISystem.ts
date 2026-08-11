// ============================================================
// AISystem —— AI 管理器（统一驱动所有 AI 实体）
// ============================================================
// 注册/注销 AI 实体，每帧 updateAll(dt, ctx) 驱动状态机。
// 上下文（ctx）由模式层注入（地图/物理/索敌回调）。

import type { EnemyBase } from '../../entity/EnemyBase';
import type { BehaviorContext } from './behaviors';

export class AISystem {
  private entities = new Set<EnemyBase>();

  register(entity: EnemyBase): void {
    this.entities.add(entity);
  }

  unregister(entity: EnemyBase): void {
    this.entities.delete(entity);
  }

  /** 每帧驱动所有 AI 实体 */
  updateAll(dt: number, ctx: BehaviorContext): void {
    for (const e of this.entities) {
      e.updateAI(dt, ctx);
    }
  }

  clear(): void {
    this.entities.clear();
  }

  get count(): number {
    return this.entities.size;
  }
}

/** 全局单例（敌人构造注册，模式层每帧驱动） */
export const aiSystem = new AISystem();
