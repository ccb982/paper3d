// ============================================================
// ItemDropPipeline.ts —— 物品掉落管线（子弹爆炸触发）
// ============================================================
// 规则层（纯函数，零依赖）：给定爆炸附近环境（地面/水面/装饰实体），
// 逐条件独立掷概率 → 产出掉落 {itemId,count} 列表。
// 环境探测与背包落账都发生在调用方（WorldMode 组合层）：
//   · 环境探测：ImpactReport（命中解析层一次性产出，见 ChunkManager.resolveImpact）
//   · 落账+UI：ItemManager.addItem('player') + WorldUIManager 拾取提示
// 六种基础材料里三种由环境产出（设计定调 2026-09-08）：
//   地面 → 固原岩 | 水面 → 酮凝集 | 耗尽原石晶体 → 异铁
// ============================================================

export interface ItemDropEnvironment {
  /** 命中地块是可站地形（ground/platform）→ 固原岩 */
  hasGround: boolean;
  /** 命中点 4m 地块或贴邻是一格水面（water=hit/edge）→ 酮凝集 */
  hasWater: boolean;
  /** 命中点 ~3m 内存在装饰性实体·耗尽原石晶体 → 异铁 */
  hasCrystal: boolean;
}

export interface DropRoll {
  itemId: string;
  count: number;
}

interface DropRule {
  env: keyof ItemDropEnvironment;
  itemId: string;
  /** 环境 present 时的掉落概率 */
  probability: number;
  countMin: number;
  countMax: number;
}

/** 掉落规则表（每格堆叠上限 99 由 items.json maxStack 约束） */
export const DROP_RULES: DropRule[] = [
  { env: 'hasCrystal', itemId: 'iron_grain', probability: 0.50, countMin: 1, countMax: 3 },
  { env: 'hasWater',   itemId: 'ketone',     probability: 0.40, countMin: 1, countMax: 2 },
  { env: 'hasGround',  itemId: 'raw_rock',   probability: 0.20, countMin: 1, countMax: 2 },
];

/**
 * 掷掉落：对每个 present 的环境独立投掷，返回本次爆炸的全部掉落。
 * ∫预留给测试注入 rng；默认 Math.random。
 */
export function rollDrops(
  env: ItemDropEnvironment,
  rng: () => number = Math.random,
): DropRoll[] {
  if (env.hasGround === false && env.hasWater === false && env.hasCrystal === false) return [];

  const drops: DropRoll[] = [];
  for (const rule of DROP_RULES) {
    if (!env[rule.env]) continue;
    if (rng() >= rule.probability) continue;
    const count = rule.countMin + Math.floor(rng() * (rule.countMax - rule.countMin + 1));
    drops.push({ itemId: rule.itemId, count });
  }
  return drops;
}