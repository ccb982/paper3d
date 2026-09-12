// ============================================================
// Healing —— 治疗统一入口
// ============================================================
// 所有"回复生命"都走这里（治疗道具 heal / 效果队列 hpRegen …），统一：
//   · 死亡等待复活中不可治疗
//   · 上限截断（不溢出 maxHp）
//   · healBuffer 累积（"治疗转伤害"proc 的燃料）
// 复活（revive 设置固定血量）与舰船存档数值治疗不走这里。

import type { EntityBase } from '../../entity/EntityBase';

/** ★ 回复生命（返回实际回复量；死亡/满血/负数返回 0） */
export function applyHeal(e: EntityBase, amount: number): number {
  if (e.dead || amount <= 0) return 0;
  const healed = Math.min(e.maxHp - e.hp, amount);
  if (healed <= 0) return 0;
  e.hp += healed;
  e.healBuffer += healed;
  return healed;
}
