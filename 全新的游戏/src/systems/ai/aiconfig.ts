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

// ============================================================
// ★ 三杂兵 AI（数据驱动，按主流敌人模板派生不同参数）
//   加新敌人 = 加配置条目，不改代码。
// ============================================================

/**
 * 主流杂兵 AI 模板：巡逻 → 索敌 → 追击 → 近战 → 回巡逻。
 * 仅在 mobAI 一次、之后按需派生变体。
 */
export interface MobAIParams {
  /** 游走速度 */
  wanderSpeed?: number;
  /** 追击速度 */
  chaseSpeed?: number;
  /** 索敌半径 */
  aggroRadius?: number;
  /** 攻击距离 */
  attackRadius?: number;
  /** 脱离索敌半径 */
  loseRadius?: number;
  /** 攻击时长（秒） */
  meleeDuration?: number;
  /** 单次挥击伤害预留给伤害管线，此处仅注记 */
  meleeDamage?: number;
}

export function mobAI(p: MobAIParams = {}): AIConfig {
  const wander = p.wanderSpeed ?? 2;
  const chase = p.chaseSpeed ?? 2.5;
  const aggro = p.aggroRadius ?? 8;
  const attack = p.attackRadius ?? 1.5;
  const lose = p.loseRadius ?? 12;
  const melee = p.meleeDuration ?? 0.6;
  return {
    states: {
      patrol: {
        behaviors: [{ name: 'wander', params: { speed: wander, turnRate: 0.5, turnInterval: 0.4, targetBias: 0.04, biasCamp: 'player' } }],
        transitions: [
          { cond: 'seePlayer', params: { radius: aggro, camp: 'player' }, to: 'chase' },
        ],
        minStay: 3,
      },
      chase: {
        behaviors: [{ name: 'moveToTarget', params: { speed: chase } }],
        transitions: [
          { cond: 'inRange', params: { radius: attack }, to: 'attack' },
          { cond: 'loseTarget', params: { radius: lose }, to: 'patrol' },
        ],
      },
      attack: {
        behaviors: [{ name: 'meleeSwing', params: { duration: melee } }],
        transitions: [
          { cond: 'attackFinished', to: 'patrol' },
          { cond: 'outOfRange', params: { radius: attack + 0.5 }, to: 'patrol' },
        ],
      },
    },
    initial: 'patrol',
  };
}

/** 原石虫：最基础杂兵，慢速、贴脸短索敌、低血 */
export const ROCK_BUG_AI: AIConfig = mobAI({ wanderSpeed: 1.4, chaseSpeed: 1.8, aggroRadius: 5, attackRadius: 1.2, loseRadius: 9, meleeDuration: 0.5 });

/** 整合运动人员：标准杂兵，中速、中索敌、中血 */
export const REUNION_AI: AIConfig = mobAI({ wanderSpeed: 2, chaseSpeed: 2.5, aggroRadius: 8, attackRadius: 1.5, loseRadius: 12, meleeDuration: 0.6 });

/** 牢杰：强力杂兵，高速、大索敌、高血 */
export const LAOJIE_AI: AIConfig = mobAI({ wanderSpeed: 2.6, chaseSpeed: 3.2, aggroRadius: 11, attackRadius: 1.8, loseRadius: 16, meleeDuration: 0.7 });
