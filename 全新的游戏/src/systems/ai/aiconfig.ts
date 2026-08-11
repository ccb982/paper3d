// ============================================================
// aiconfig —— AI 配置（状态机结构，数据驱动）
// ============================================================
// 加新敌人 = 加配置条目，不改代码（架构 4.3/4.3a）

export interface AIBehaviorDef {
  /** 行为名（behaviorTable 查表） */
  name: string;
  /** 行为参数 */
  params?: Record<string, number>;
}

export interface AITransitionDef {
  /** 条件名（conditionTable 查表） */
  cond: string;
  params?: Record<string, number>;
  /** 转移目标状态 */
  to: string;
}

export interface AIStateDef {
  behaviors: AIBehaviorDef[];
  transitions: AITransitionDef[];
}

export interface AIConfig {
  states: Record<string, AIStateDef>;
  initial: string;
}

/** ★ 普瑞赛斯（基准敌人）：巡逻 → 索敌 → 追击 → 近战 → 脱战回追/游走 */
export const PRESERVER_AI: AIConfig = {
  states: {
    patrol: {
      behaviors: [{ name: 'wander', params: { speed: 1.2 } }],
      transitions: [
        { cond: 'seePlayer', params: { radius: 8 }, to: 'chase' },
      ],
    },
    chase: {
      behaviors: [{ name: 'moveToTarget', params: { speed: 2.5 } }],
      transitions: [
        { cond: 'inRange', params: { radius: 1.5 }, to: 'attack' },
        { cond: 'loseTarget', params: { radius: 12 }, to: 'patrol' },
      ],
    },
    attack: {
      behaviors: [{ name: 'meleeSwing', params: { duration: 0.6 } }],
      transitions: [
        { cond: 'outOfRange', params: { radius: 2 }, to: 'chase' },
      ],
    },
  },
  initial: 'patrol',
};
