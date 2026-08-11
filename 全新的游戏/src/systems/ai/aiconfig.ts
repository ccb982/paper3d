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
  /** ★ 最短停留时间（秒）：进入该状态后至少停留这么久才允许转移（防状态抖动） */
  minStay?: number;
}

export interface AIConfig {
  states: Record<string, AIStateDef>;
  initial: string;
}

/** ★ 普瑞赛斯（基准敌人）：巡逻 → 索敌 → 追击 → 近战 → 脱离回巡逻游走 */
export const PRESERVER_AI: AIConfig = {
  states: {
    patrol: {
      behaviors: [{ name: 'wander', params: { speed: 2 } }],
      transitions: [
        { cond: 'seePlayer', params: { radius: 8 }, to: 'chase' },
      ],
      // ★ 脱离后至少游走 3 秒才重新索敌（否则 patrol 闪一帧就被拉回 chase）
      minStay: 3,
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
        // ★ 挥击播完（一次性）→ 回 patrol 游走；玩家脱离攻击距离也直接走
        { cond: 'attackFinished', to: 'patrol' },
        { cond: 'outOfRange', params: { radius: 2 }, to: 'patrol' },
      ],
    },
  },
  initial: 'patrol',
};
