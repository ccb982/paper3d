// ============================================================
// FastLane —— "快车道"结算（用户定 2026-09-25）：
//   屏幕外/批量伤害不走实体+弹道，直接结算：
//     · 代理（L2）：swarm.nearestAgentIndex 查询 + swarm.damageAgent 直扣池血
//     · 实体（L3）：走伤害管线（有受击/死亡表现；玩家看得见）
//   用途：玩家范围技/友军离屏攻击/后续 AOE 的廉价结算口
// ============================================================
import type { SwarmSystem } from '../systems/swarm/SwarmSystem';
import type { EnemyBase } from '../entity/EnemyBase';
import { applyDamage } from '../services/combat/DamagePipeline';
import { AGENT_SOURCE } from '../systems/spawn/WorldSpawner';

export class FastLane {
  constructor(
    private readonly swarm: SwarmSystem,
    private readonly enemies: EnemyBase[],
  ) {}

  /** 最近代理下标（-1 = 半径内无）——快车道查询口 */
  nearestAgent(x: number, z: number, r: number): number {
    return this.swarm.nearestAgentIndex(x, z, r);
  }

  /** 代理直扣血（无实体/无弹道；返回实际伤害） */
  damageAgent(i: number, dmg: number): number {
    return this.swarm.damageAgent(i, dmg);
  }

  /** 区域伤害：半径内**代理直扣**（快车道）+ **实体走伤害管线**（看得见的表现） */
  damageArea(x: number, z: number, r: number, dmg: number): { agents: number; entities: number } {
    let agents = 0, entities = 0;
    const r2 = r * r;
    const p = this.swarm.pool;
    // 倒序遍历：damageAgent 致死会 swap-remove（正序会漏/重）
    for (let i = p.count - 1; i >= 0; i--) {
      if (p.hp[i] <= 0) continue;
      const dx = p.x[i] - x, dz = p.z[i] - z;
      if (dx * dx + dz * dz > r2) continue;
      if (this.swarm.damageAgent(i, dmg) > 0) agents++;
    }
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.position.x - x, dz = e.position.z - z;
      if (dx * dx + dz * dz > r2) continue;
      applyDamage(dmg, AGENT_SOURCE, e, { hitPoint: { x: e.position.x, y: e.position.y + 1, z: e.position.z } });
      entities++;
    }
    return { agents, entities };
  }
}
