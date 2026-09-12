// ============================================================
// ShipState —— 舰船状态单入口（伤害 / 毁灭判定 / 复活）
// ============================================================
// 舰船数值住在 session.ship（持久）；世界内 ShipEntity 受击、油尽惩罚
// 一律经 applyShipDamage 结算：护盾吸收 → 装甲减伤 → 扣 HP。
// 伤害来源（当前）：敌人攻击（ShipEntity.onTakeDamage）、油尽惩罚（WorldMode）。
// ship.hp <= 0 = 真结局（结算/复活由 WorldMode 弹层接管）。

import type { GameSession } from '../../core/Session';

/** ★ 结算舰船伤害（返回实际扣血量；护盾→装甲→HP，截断到 0） */
export function applyShipDamage(session: GameSession, amount: number): number {
  const s = session.ship;
  if (!s || amount <= 0 || s.hp <= 0) return 0;
  let d = amount;
  if (s.shield > 0) {
    const absorbed = Math.min(s.shield, d);
    s.shield -= absorbed;
    d -= absorbed;
  }
  if (d > 0) d = Math.max(1, d - s.armor);
  s.hp = Math.max(0, s.hp - d);
  return d;
}

/** 舰船是否已毁（真结局条件） */
export function isShipDestroyed(session: GameSession): boolean {
  return !!session.ship && session.ship.hp <= 0;
}

/** ★ 复活：舰船回满血满油（结算页"复活"暂时直接调用；惩罚机制后续再加） */
export function reviveShip(session: GameSession): void {
  const s = session.ship;
  if (!s) return;
  s.hp = s.maxHp;
  s.fuel = s.fuelMax;
}
