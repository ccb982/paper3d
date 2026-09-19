// ============================================================
// relics.ts —— 遗物配置表（原"藏品/局外道具"统一归类 ★ 2026-09-11）
// 遗物 = 永久生效、不入背包、只可抽取、重复抽取叠加。
// 完全配置驱动，无硬编码。新增遗物 = 加一条配置，不改代码。
// ============================================================

import type { RelicItemConfig } from '../core/Session';

export const RELIC_ITEM_CONFIG: Record<string, RelicItemConfig> = {
  black_crown: {
    id: 'black_crown',
    name: '魔王的黑冠',
    rarity: 5,
    description: '每日全属性 +5%（开局即拥）；每多抽到一件再 +1%',
    texture: '/fx/魔王的黑冠.ftx3.gz',
    effects: [
      { type: 'stat_multiplier', perDay: 1.05, perDayStep: 0.01, scope: 'all' },
    ],
  },

  gravel_love: {
    id: 'gravel_love',
    name: '砾小姐的爱',
    rarity: 5,
    description: '角色每次死亡，攻击力 +0.5%（永久）；每多抽到一件再 +0.1%；死亡复活等待 -30%，每多一件再 -1%',
    texture: '/fx/砾小姐的爱.ftx3.gz',
    /** ★ 单件显示帧1、≥2 件显示帧2 */
    iconFrame: (count) => (count >= 2 ? 1 : 0),
    effects: [
      { type: 'stat_multiplier', perDeath: 1.005, perDeathStep: 0.001, scope: 'attack' },
      // ★ 复活等待缩减：首件 -30%，每多一件再 -1%
      { type: 'respawn_time', base: 0.3, perCopy: 0.01 },
    ],
  },

  priestess: {
    id: 'priestess',
    name: '普瑞赛斯',
    rarity: 6,
    /** ★ 她不是遗物，是 Boss（抽卡结果标「BOSS」，不计入遗物数量/列表） */
    kind: 'boss',
    description: '唯一的 6★（明日方舟 6★ 规则：基础 2%，50 抽未出后每抽 +2%，99 抽必出）。抽到她之后，下一次出击将进入「四维空间」——击败她，这一切就结束了。',
    effects: [],
  },

  zuzong_launcher: {
    id: 'zuzong_launcher',
    name: '祖宗发射器',
    rarity: 5,
    description: '进入战场立即获得一个祖宗（每多获得一件多带一个）；之后每分钟恢复一个，多件再缩短补充间隔',
    texture: '/fx/祖宗发射器.ftx3.gz',
    effects: [
      // ★ 进入战场：立即授予（数量 = 1 × 拥有件数）
      { type: 'start_items', items: [{ itemId: 'zuzong', count: 1 }] },
      // ★ 后续恢复：每分钟 1 个；每多一件 ×0.8（下限 15s）
      { type: 'timed_item', itemId: 'zuzong', interval: 60, perCopyMul: 0.8, minInterval: 15 },
    ],
  },

  /**
   * ★ 死仇时代的恨意（2026-09-19）
   * 获取：与访客「不许笑」对话（所有分支都给）。
   * 贴图：不许笑的脸（图标在 ItemIconRegistry.FTX_ICON_SOURCES 注册）。
   * 效果：与「祖宗发射器」同口径 —— 入场立即获得「掩体」×件数；
   *       之后定时恢复（每多一件再缩短间隔）。
   */
  grudge_hatred: {
    id: 'grudge_hatred',
    name: '死仇时代的恨意',
    rarity: 5,
    description: '不许笑的脸。进入战场立即获得掩体（每多一件 +1）；之后定时恢复掩体（多件再缩短间隔）',
    texture: '/characters/protagonist/不许笑.ftx3.gz',
    effects: [
      { type: 'start_items', items: [{ itemId: 'cover', count: 1 }] },
      { type: 'timed_item', itemId: 'cover', interval: 60, perCopyMul: 0.8, minInterval: 15 },
    ],
  },

  /**
   * ★ 衣服（2026-09-15）
   * 设计口径：凯尔希 = 罗得岛医疗主管。她给你的不是武器，是"活着回来"这件事本身。
   *   ① regen      —— 每秒回复生命（多件递增）：医生的持续照料，最贴合她的职业
   *   ② start_items —— 出击时额外携带「古米的蜂蜜糖」：她顺手塞进你口袋的补给
   * 两条管线都是**独立效果类型**，核心（Session/WorldMode）零改动。
   */
  kaltsit_coat: {
    id: 'kaltsit_coat',
    name: '衣服',
    rarity: 5,
    description: '凯尔希的外套。她替你理了理领口：「活着回来，这是命令。」\n'
      + '每秒回复 1 点生命（每多一件再 +0.5）；出击时额外携带 1 块古米的蜂蜜糖（每多一件再 +1）',
    texture: '/fx/衣服.ftx3.gz',
    effects: [
      // ① 持续治疗：首件 1/s，每多一件 +0.5/s
      { type: 'regen', base: 1, perCopy: 0.5 },
      // ② 出击补给：1 块蜂蜜糖 × 拥有件数
      { type: 'start_items', items: [{ itemId: 'gummy_honey_candy', count: 1 }] },
    ],
  },

  /**
   * ★ 喜羊羊（2026-09-16）
   * 设定：闪灵 —— 罗得岛使徒，医疗干员。玩家喊她「喜羊羊」（角与发型的梗）。
   * 定位：**治疗 / 守护系**（与「衣服」的凯尔希路线呼应，但更偏"战地救护站"）。
   *   ① regen         —— 每秒回血（医疗本职，最贴合她的职业）
   *   ② stat_multiplier(scope:'defense') —— 每日防御复利（她的庇护：使徒的剑不出鞘时是盾）
   *   ③ respawn_time  —— 复活等待缩减（你倒下时她把你拉回来）
   * 三条都是**现有管线**，核心（Session/WorldMode/main）零改动。
   * ★ scope:'defense' 是本次为它新开的 stat_multiplier 分支（见 RelicEffects.ts）。
   */
  xiyangyang: {
    id: 'xiyangyang',
    name: '喜羊羊',
    rarity: 5,
    description: '闪灵的角与发。她说自己只是来送药的，可你倒下时，总是她先到。\n'
      + '每秒回复 1.2 点生命（每多一件再 +0.6）；'
      + '防御每日 +8%（每多一件再 +1%，复利）；'
      + '复活等待 -20%（每多一件再 -2%，下限 -90%）',
    texture: '/fx/喜羊羊.ftx3.gz',
    effects: [
      // ① 持续治疗：首件 1.2/s，每多一件 +0.6/s
      { type: 'regen', base: 1.2, perCopy: 0.6 },
      // ② 防御每日复利：首件 1.08/天，每多一件步长 +0.01
      { type: 'stat_multiplier', perDay: 1.08, perDayStep: 0.01, scope: 'defense' },
      // ③ 复活加速：首件 -20%，每多一件再 -2%
      { type: 'respawn_time', base: 0.2, perCopy: 0.02 },
    ],
  },

  // 新增遗物只需在这里加配置（效果类型在 RelicEffects 注册表），代码零改动
};

// ============================================================
// ★ 局外条目分类工具（2026-09-15）
// 背景：outOfRun.owned 里混着「遗物」和「BOSS」（普瑞赛斯），但两者 UI 牌子不同。
// 统一从这里取分类，避免 UI 各处散落 `RELIC_ITEM_CONFIG[id]?.kind ?? 'relic'`。
// ============================================================

/** 局外条目分类（缺省 = 遗物） */
export function relicKindOf(id: string): 'relic' | 'boss' {
  return RELIC_ITEM_CONFIG[id]?.kind ?? 'relic';
}

/** 已拥有的**遗物** id（排除 BOSS）：供"遗物 N 种"计数与遗物面板列表 */
export function ownedRelicIds(owned: Record<string, number> | undefined): string[] {
  return Object.keys(owned ?? {}).filter((id) => !!RELIC_ITEM_CONFIG[id] && relicKindOf(id) === 'relic');
}

/** 已拥有的 **BOSS** id（普瑞赛斯等）：抽卡结果与面板单独标识 */
export function ownedBossIds(owned: Record<string, number> | undefined): string[] {
  return Object.keys(owned ?? {}).filter((id) => !!RELIC_ITEM_CONFIG[id] && relicKindOf(id) === 'boss');
}