// ============================================================
// relics.ts —— 藏品配置表
// 完全配置驱动，无硬编码。新增藏品 = 加一条配置，不改代码
// ============================================================

import type { RelicConfigEntry } from '../core/Session';

export const RELIC_CONFIG: Record<string, RelicConfigEntry> = {
  // ---- 永久型藏品（局外全局加成） ----

  black_crown: {
    id: 'black_crown',
    name: '黑冠',
    type: 'permanent',
    description: '每日全属性 ×1.01',
    effect: { multiplier: 1.01 },
  },

  ancient_tome: {
    id: 'ancient_tome',
    name: '源石技艺古卷',
    type: 'permanent',
    description: '每日全属性 ×1.005，且攻击力 +2',
    effect: {
      multiplier: 1.005,
      flatBonus: { attackBonus: 2 },
    },
  },

  // ---- 携带型藏品（需占背包格，持有即生效） ----

  relic_001: {
    id: 'relic_001',
    name: '能天使的祝福',
    type: 'carry',
    description: '攻击力 +5',
    effect: { attackBonus: 5 },
  },

  relic_002: {
    id: 'relic_002',
    name: '塞雷娅的护盾',
    type: 'carry',
    description: '防御力 +3，生命上限 +10',
    effect: { defenseBonus: 3, hpBonus: 10 },
  },

  relic_003: {
    id: 'relic_003',
    name: '银灰的战术指挥',
    type: 'carry',
    description: '攻击力 +3，防御力 +2',
    effect: { attackBonus: 3, defenseBonus: 2 },
  },

  // 新增藏品只需在这里加配置，代码零改动
};