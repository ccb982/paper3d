// ============================================================
// RandomRelic.ts —— 随机遗物抽取（对话 / 事件奖励用）
// ============================================================
// 池子唯一真源 = `config/gachaPool.json` 的 outOfRunItems
//   → 与抽卡**同一份名单**，"能抽到的遗物"和"能奖励到的遗物"永远一致，
//     不会各写一套、更不会出现奖励发了个没登记的 id。
// 权重口径也与抽卡一致：按 `weight` 加权（当前 5★ 各 72 = 档内均等）。
//
// ★ 遗物语义就是**可叠加**（重复获取 = 效果叠加），所以不做"未拥有优先"。
// ============================================================

import gachaPool from '../config/gachaPool.json';
import { RELIC_ITEM_CONFIG } from '../config/relics';

export interface RandomRelicEntry {
  id: string;
  rarity: number;
  weight: number;
}

/** 奖励用遗物池（顺序 = 配置顺序；配置缺失的条目直接剔除） */
export function randomRelicPool(): RandomRelicEntry[] {
  const out: RandomRelicEntry[] = [];
  for (const e of (gachaPool.outOfRunItems ?? [])) {
    if (!e || typeof e.id !== 'string') continue;
    // ★ 剔除 relics.ts 里没登记的 id：宁可少发，也不要发一个没有名字/效果的幽灵遗物
    if (RELIC_ITEM_CONFIG[e.id] == null) continue;
    out.push({ id: e.id, rarity: e.rarity, weight: e.weight });
  }
  return out;
}

/**
 * 按权重抽一件遗物。
 * @param rand 随机源（可注入，便于测试）
 * @returns 遗物 id；池子为空返回 null
 */
export function rollRandomRelic(rand: () => number = Math.random): string | null {
  const pool = randomRelicPool();
  if (pool.length === 0) return null;

  let total = 0;
  for (const e of pool) total += Math.max(0, e.weight);
  // 权重全为 0（异常配置）：退化成等概率，别把奖励吞掉
  if (total <= 0) return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))].id;

  let roll = rand() * total;
  for (const e of pool) {
    roll -= Math.max(0, e.weight);
    if (roll < 0) return e.id;
  }
  return pool[pool.length - 1].id;   // 浮点兜底
}
