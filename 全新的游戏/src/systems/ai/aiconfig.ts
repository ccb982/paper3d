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

// （2026-09-18 体检删除：原 `PRESERVER_AI` 基准敌人配置全仓零引用 ——
//   敌人 AI 已统一走下面的 `mobAI` 数据驱动模板。原文备份在
//   `.workbuddy/deadcode/2026-09-18.txt`，项目无 git，需要时可整段取回。）

/** ★ Boss（普瑞赛斯·四维空间决战）：大仇恨圈、更快追击、重击挥砍 */
export const BOSS_AI: AIConfig = {
  states: {
    patrol: {
      behaviors: [{ name: 'wander', params: { speed: 2.5, turnRate: 0.6, turnInterval: 0.4, targetBias: 0.08, biasCamp: 'player' } }],
      transitions: [
        { cond: 'seePlayer', params: { radius: 60, camp: 'player' }, to: 'chase' },
      ],
      minStay: 1,
    },
    chase: {
      behaviors: [{ name: 'moveToTarget', params: { speed: 4.2 } }],
      transitions: [
        { cond: 'retarget', to: 'chase' },
        { cond: 'inRange', params: { radius: 3.0 }, to: 'attack' },
        { cond: 'loseTarget', params: { radius: 90 }, to: 'patrol' },
      ],
    },
    attack: {
      behaviors: [{ name: 'meleeSwing', params: { duration: 0.9, range: 3.4, damage: 22 } }],
      transitions: [
        { cond: 'retarget', to: 'chase' },
        { cond: 'attackFinished', to: 'chase' },
        { cond: 'outOfRange', params: { radius: 4.5 }, to: 'chase' },
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
  /** 攻击距离（= 追击时"何时停下开打"的刹车距离） */
  attackRadius?: number;
  /** ★ 攻击判定半径（= 挥击/射击真正打得到多远）
   *  ★ 必须与 attackRadius 分开：远程兵种若只放大 attackRadius，
   *    会停在 13m 外但挥击判定仍是默认 1.8m → **站远处一直打空**（2026-09-18 踩点）。
   *  缺省保持 1.8（既有三兵种手感不变）。 */
  attackRange?: number;
  /** 脱离索敌半径 */
  loseRadius?: number;
  /** 攻击时长（秒） */
  meleeDuration?: number;
  /** 单次挥击伤害预留给伤害管线，此处仅注记 */
  meleeDamage?: number;
  /** ★ 真弹道（2026-09-18）：填了 → attack 状态改用 `rangedShot` 发射**可见弹道**
   *  （飞行 → 接触命中），且攻击播完回 `chase` 而非 `patrol`（持续开火）。
   *  不填 = 原 `meleeSwing`（范围瞬时判定，有 attackRange 却无弹道视觉）。 */
  ranged?: MobRangedParams;
  /** ★ 自爆档（2026-09-19）：填了 → attack 状态改用 `selfDestruct`
   *  （范围爆炸 + 自身死亡）；优先级高于 ranged/melee。 */
  suicide?: { radius?: number; damage?: number; fuse?: number };
}

/** ★ 远程弹道参数（mobAI 的 `ranged` 档） */
export interface MobRangedParams {
  /** 弹速（m/s） */
  speed?: number;
  /** 弹寿命（秒） */
  lifetime?: number;
  /** 瞄准点相对【目标受击锚点（胸口）】的纵向偏移（m），缺省 0 */
  aimHeight?: number;
  /** 发射点相对【自身受击锚点（胸口）】的纵向偏移（m），缺省 0 */
  muzzleHeight?: number;
  /** 散布半角（弧度）——弹道不精确，命中取决于站位 */
  spread?: number;
  /** 单发伤害（缺省 = meleeDamage） */
  damage?: number;
  /** ★ 弹种标签：'arrow'（缺省，箭矢）/ 'fireball'（术士法球）。
   *  模式层按它选子弹池；行为层只透传。 */
  skin?: string;
}

/** ★ 无命令自主交战保底半径（米；与《实体架构.md》§5.12 同口径）：
 *  实体无指令时视野不低于此值（各兵种 aggro 只能更大）——防“贴脸也不打” */
export const ENEMY_ENGAGE_FLOOR = 16;

export function mobAI(p: MobAIParams = {}): AIConfig {
  const wander = p.wanderSpeed ?? 2;
  const chase = p.chaseSpeed ?? 2.5;
  const aggro = p.aggroRadius ?? 8;
  const attack = p.attackRadius ?? 1.5;
  const lose = p.loseRadius ?? 12;
  const melee = p.meleeDuration ?? 0.6;
  const dmg = p.meleeDamage ?? 8;
  // ★ 判定半径缺省 1.8（既有三兵种原样）；远程兵种显式给 attackRange
  const range = p.attackRange ?? 1.8;
  // ★ 真弹道档：attack 状态换行为 + 攻击完回 chase（持续开火，而不是回 patrol 晾 3 秒）
  const sui = p.suicide;
  const rng = p.ranged;
  const attackBehavior: AIBehaviorDef = sui
    ? {
        name: 'selfDestruct',
        params: {
          radius: sui.radius ?? 3,
          damage: sui.damage ?? dmg,
          fuse: sui.fuse ?? 0.25,
        },
      }
    : rng
    ? {
        name: 'rangedShot',
        params: {
          duration: melee,
          damage: rng.damage ?? dmg,
          speed: rng.speed ?? 26,
          lifetime: rng.lifetime ?? 2.4,
          aimHeight: rng.aimHeight ?? 0,
          muzzleHeight: rng.muzzleHeight ?? 0,
          spread: rng.spread ?? 0.05,
          skin: rng.skin ?? 'arrow',
        },
      }
    : { name: 'meleeSwing', params: { duration: melee, damage: dmg, range } };
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
          { cond: 'retarget', to: 'chase' },
          { cond: 'inRange', params: { radius: attack }, to: 'attack' },
          { cond: 'loseTarget', params: { radius: lose }, to: 'patrol' },
        ],
      },
      attack: {
        behaviors: [attackBehavior],
        transitions: [
          { cond: 'retarget', to: 'chase' },
          // ★ 近战：打一下回巡逻；远程：回追击 → 立刻再次进射程 → 持续开火
          { cond: 'attackFinished', to: rng ? 'chase' : 'patrol' },
          { cond: 'outOfRange', params: { radius: attack + 0.5 }, to: rng ? 'chase' : 'patrol' },
        ],
      },
    },
    initial: 'patrol',
  };
}

/** ★ 原石虫：集群虫（成群刷出）。慢速、低攻、极低血——靠数量取胜 */
export const ROCK_BUG_AI: AIConfig = mobAI({
  wanderSpeed: 1.4, chaseSpeed: 1.8, aggroRadius: 5,
  attackRadius: 1.2, loseRadius: 9, meleeDuration: 0.5, meleeDamage: 4,
});

/** ★ 整合运动人员：重装杂兵（单独配置里给高防高血）。中速、中索敌、中攻 */
export const REUNION_AI: AIConfig = mobAI({
  wanderSpeed: 2, chaseSpeed: 2.5, aggroRadius: 8,
  attackRadius: 1.5, loseRadius: 12, meleeDuration: 0.6, meleeDamage: 9,
});

/** ★ 牢杰/杰斯顿：突击精英。高速、大索敌、高攻、低血 */
export const LAOJIE_AI: AIConfig = mobAI({
  wanderSpeed: 3, chaseSpeed: 3.8, aggroRadius: 12,
  attackRadius: 1.8, loseRadius: 18, meleeDuration: 0.65, meleeDamage: 14,
});

// ============================================================
// ★ 2026-09-18 新增兵种 AI（名册见 `config/enemyRoster.ts`）
//   分五档：近战主力 / 重装 / 快速自爆 / 远程（弩手＜术士＜重火力）/ 小 boss
// ============================================================

/** ★ 海怪：中血中速小兵（两只一组）。比整合凶一点、比牢杰稳 */
export const SEA_MONSTER_AI: AIConfig = mobAI({
  wanderSpeed: 1.8, chaseSpeed: 2.2, aggroRadius: 9,
  attackRadius: 1.8, loseRadius: 14, meleeDuration: 0.7, meleeDamage: 12,
});

/** ★ 萨卡兹大剑手：近战主力（"较强的杂兵"）。挥击慢、单发高 */
export const SARKAZ_SWORDSMAN_AI: AIConfig = mobAI({
  wanderSpeed: 2.4, chaseSpeed: 3.2, aggroRadius: 11,
  attackRadius: 2.2, attackRange: 2.2, loseRadius: 18,
  meleeDuration: 0.7, meleeDamage: 18,
});

/** ★ 盾卫：重装。极慢、小索敌、低攻高防 —— 拦路石，不是威胁源 */
export const SHIELD_GUARD_AI: AIConfig = mobAI({
  wanderSpeed: 1.2, chaseSpeed: 1.6, aggroRadius: 10,
  attackRadius: 2.0, attackRange: 2.2, loseRadius: 16,
  meleeDuration: 0.8, meleeDamage: 10,
});

/** ★ 爆炸飞行怪：快速自爆型。全兵种最快 + 最脆 + 单发最痛 */
export const BOMBER_AI: AIConfig = mobAI({
  wanderSpeed: 3, chaseSpeed: 4.2, aggroRadius: 14,
  attackRadius: 2.0, attackRange: 2.0, loseRadius: 22,
  meleeDuration: 0.45, meleeDamage: 22,
  // ★ 自爆：冲到近身 → 短引信 → 范围爆炸 + 自身死亡（用户定调）
  suicide: { radius: 3.2, damage: 22, fuse: 0.25 },
});

/** ★ 远程·轻档：弩手。射程 9m、射速最快、单发最低
 *  ★ 2026-09-18：改真弹道（`ranged`）—— 此前是"大 attackRange 的瞬时空打"，
 *    攻击没有任何可见效果；现在射程序化箭矢（飞行 → 接触命中）。 */
export const CROSSBOW_AI: AIConfig = mobAI({
  wanderSpeed: 2.2, chaseSpeed: 2.8, aggroRadius: 14,
  attackRadius: 9, attackRange: 9, loseRadius: 24,
  meleeDuration: 0.5, meleeDamage: 8,
  ranged: { speed: 30, lifetime: 1.6, damage: 8, spread: 0.045 },
});

/** ★ 远程·中档：扩音术士。射程 10m、伤害与节奏居中
 *  ★ 2026-09-18：改真弹道（法球 `skin:'fireball'`）—— 术士放法球，不再是瞬时空打 */
export const AMP_CASTER_AI: AIConfig = mobAI({
  wanderSpeed: 2, chaseSpeed: 2.4, aggroRadius: 16,
  attackRadius: 10, attackRange: 10, loseRadius: 26,
  meleeDuration: 0.8, meleeDamage: 10,
  ranged: { speed: 22, lifetime: 1.4, damage: 10, spread: 0.035, skin: 'fireball' },
});

/** ★ 远程·重档：战争术士。射程最远 13m + 单发最高，代价是慢与脆
 *  ★ 2026-09-18：改真弹道（大火球：更慢、更大、更痛） */
export const WAR_CASTER_AI: AIConfig = mobAI({
  wanderSpeed: 1.6, chaseSpeed: 2.0, aggroRadius: 22,
  attackRadius: 13, attackRange: 13, loseRadius: 34,
  meleeDuration: 1.2, meleeDamage: 20,
  ranged: { speed: 18, lifetime: 1.6, damage: 20, spread: 0.03, skin: 'fireball' },
});

/** ★ 原石虫巨人：小 boss。大仇恨圈 + 3.4m 挥击圈 + 高单发（整体慢） */
export const ROCK_GIANT_AI: AIConfig = mobAI({
  wanderSpeed: 1.8, chaseSpeed: 2.6, aggroRadius: 16,
  attackRadius: 3.4, attackRange: 3.4, loseRadius: 30,
  meleeDuration: 1.0, meleeDamage: 26,
});
