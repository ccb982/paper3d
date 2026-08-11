// ============================================================
// aiconfig —— AI 配置（状态机结构，数据驱动）
// ============================================================
// 加新敌人 = 加配置条目，不改代码（架构 4.3/4.3a）

export interface AIBehaviorDef {
  /** 行为名（behaviorTable 查表） */
  name: string;
  /** 行为参数（数值/字符串，如 speed/targetBias/camp） */
  params?: Record<string, string | number>;
}

export interface AITransitionDef {
  /** 条件名（conditionTable 查表） */
  cond: string;
  params?: Record<string, string | number>;
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
      // speed 游走速度 / turnRate 转向幅度 / turnInterval 转向间隔
      // targetBias 游走略微偏向目标的强度(0=纯随机,0.04≈轻微) / biasCamp 偏谁('player'/'ally'/''=不偏)
      behaviors: [{ name: 'wander', params: { speed: 2, turnRate: 0.5, turnInterval: 0.4, targetBias: 0.04, biasCamp: 'player' } }],
      transitions: [
        // radius 索敌半径 / camp 索敌阵营('player'/'ally'/'player,ally')
        { cond: 'seePlayer', params: { radius: 8, camp: 'player' }, to: 'chase' },
      ],
      // ★ 最短停留时间（秒）：进入该状态后至少停留这么久才允许转移（防状态抖动）
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
      // ★ 一次性近战挥击：播完（duration 秒）→ attackFinished 自动退出
      behaviors: [{ name: 'meleeSwing', params: { duration: 0.6 } }],
      transitions: [
        { cond: 'attackFinished', to: 'patrol' },
        { cond: 'outOfRange', params: { radius: 2 }, to: 'patrol' },
      ],
    },
  },
  initial: 'patrol',
};
