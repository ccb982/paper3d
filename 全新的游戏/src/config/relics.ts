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

  zuzong_launcher: {
    id: 'zuzong_launcher',
    name: '祖宗发射器',
    rarity: 5,
    description: '开局背包中自动获得一个祖宗（每多抽到一件多带一个）',
    texture: '/fx/祖宗发射器.ftx3.gz',
    effects: [
      { type: 'start_items', items: [{ itemId: 'zuzong', count: 1 }] },
    ],
  },

  // 新增遗物只需在这里加配置（效果类型在 RelicEffects 注册表），代码零改动
};