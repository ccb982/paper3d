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
    description: '每日全属性 ×1.01（开局即拥，卡池可重复抽到叠加）',
    texture: '/fx/魔王的黑冠.ftx3.gz',
    effect: { perDayMultiplier: 1.01 },
  },

  gravel_love: {
    id: 'gravel_love',
    name: '砾小姐的爱',
    rarity: 5,
    description: '角色每次死亡，生命/攻击/防御全属性 +5%（永久）',
    texture: '/fx/砾小姐的爱.ftx3.gz',
    /** ★ 单件显示帧1、≥2 件显示帧2 */
    iconFrame: (count) => (count >= 2 ? 1 : 0),
    effect: { perDeathMultiplier: 1.05 },
  },

  // 新增遗物只需在这里加配置，代码零改动
};