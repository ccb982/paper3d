// ============================================================
// outOfRunItems.ts —— 局外道具配置表
// 语义：只可抽取、不可合成、不占背包、无需携带 → 拥有即全局永久生效。
// 完全配置驱动，无硬编码。新增局外道具 = 加一条配置，不改代码。
// ============================================================

import type { OutOfRunItemConfig } from '../core/Session';

export const OUT_OF_RUN_ITEM_CONFIG: Record<string, OutOfRunItemConfig> = {
  gravel_love: {
    id: 'gravel_love',
    name: '砾小姐的爱',
    rarity: 5,
    description: '角色每次死亡，生命/攻击/防御全属性 +5%（永久）',
    texture: '/fx/砾小姐的爱.ftx3.gz',
    effect: { perDeathMultiplier: 1.05 },
  },

  // 新增局外道具只需在这里加配置，代码零改动
};