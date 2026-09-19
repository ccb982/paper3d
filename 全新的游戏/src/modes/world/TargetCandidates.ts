// ============================================================
// TargetCandidates —— 敌人索敌候选构建（从 WorldMode 拆出；2026-09-19）
// ============================================================
// 优先级：① 祖宗（TAUNT 半径内，吸仇恨）② 舰船 ③ 玩家 ④ 一般友军（最近无人机）。
// ★ 返回活对象（引用）；slots[0] 带 radius=嘲讽半径，其余 radius 必须 undefined
//   （retarget 用 c.radius === undefined 区分"普通目标"与"吸仇恨目标"）。
// ============================================================

import type { AllyBase } from '../../entity/ally/AllyBase';
import type { EnemyBase } from '../../entity/EnemyBase';
import type { ShipEntity } from '../../entity/ShipEntity';
import type { Player } from '../../entity/player/Player';
import type { TargetCandidate } from '../../systems/ai/behaviors';
import { SENTINEL_TAUNT_RADIUS } from '../../systems/spawn/WorldSpawner';

export interface TargetCandidateHost {
  drones: AllyBase[];
  ship: ShipEntity | null;
  player: Player | null;
  /** 仅探索阶段舰船参与（结算后不再嘲讽） */
  explore: boolean;
}

export function buildEnemyTargetCandidates(
  out: TargetCandidate[],
  slots: TargetCandidate[],
  enemy: EnemyBase,
  host: TargetCandidateHost,
): TargetCandidate[] {
  const ep = enemy.position;
  out.length = 0;
  let sentinel: AllyBase | null = null, sentinelD2 = Infinity;
  let ally: AllyBase | null = null, allyD2 = Infinity;
  for (const d of host.drones) {
    if (d.hp <= 0) continue;
    const dx = d.position.x - ep.x, dz = d.position.z - ep.z;
    const d2 = dx * dx + dz * dz;
    if (d.stationary) {
      if (d2 < sentinelD2) { sentinelD2 = d2; sentinel = d; }
    } else if (d2 < allyD2) {
      allyD2 = d2;
      ally = d;
    }
  }
  // ★ 祖宗最高优先（TAUNT 半径内；吸仇恨）：radius = 自身嘲讽半径，
  //   seePlayer/retarget 用该半径判定，不走敌人通用视野半径
  const taunt2 = SENTINEL_TAUNT_RADIUS * SENTINEL_TAUNT_RADIUS;
  if (sentinel && sentinelD2 <= taunt2) {
    const s = slots[0];
    s.x = sentinel.position.x; s.z = sentinel.position.z;
    out.push(s);
  }
  // ★ 其次舰船（仅探索阶段存在；hp<=0 由结算接管不再嘲讽）
  if (host.explore && host.ship && host.ship.hp > 0) {
    const s = slots[1];
    s.x = host.ship.position.x; s.z = host.ship.position.z;
    out.push(s);
  }
  if (host.player) {
    const s = slots[2];
    s.x = host.player.position.x; s.z = host.player.position.z;
    out.push(s);
  }
  if (ally) {
    const s = slots[3];
    s.x = ally.position.x; s.z = ally.position.z;
    out.push(s);
  }
  return out;
}
