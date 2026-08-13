// ============================================================
// Attack —— 攻击抽象（服务层，架构 4.2 统一攻击管线）
// ============================================================
// ★ 三种攻击类型统一为"攻击意图"，执行器分派 → 命中 → 伤害管线：
//   projectile 弹道（子弹：飞行 → 接触命中）
//   melee      近战（范围瞬时：挥击时刻 querySphere 判定 → 立即结算）
//   aoe        范围（落点延迟结算；预留）
// AI 行为/玩家技能只发意图（ctx.attack / executeAttack），不碰实现细节。

import type { EntityBase } from '../../entity/EntityBase';
import type { EntityManager } from '../../entity/EntityManager';
import { applyDamage } from './DamagePipeline';
import { BulletManager, type SpawnBulletOptions } from './BulletManager';

/** 阵营类型 */
export type Camp = 'player' | 'ally' | 'enemy';

/** ★ 攻击意图（联合类型） */
export type AttackOptions =
  | ({ type: 'projectile'; source: EntityBase } & SpawnBulletOptions)
  | {
      type: 'melee';
      source: EntityBase;
      /** 挥击中心（世界 xyz） */
      x: number;
      y: number;
      z: number;
      /** 攻击范围（米） */
      range: number;
      damage: number;
      camp: Camp;
      /** 伤害类型（元素后续） */
      dmgType?: string;
    }
  | {
      type: 'aoe';
      source: EntityBase;
      x: number;
      y: number;
      z: number;
      radius: number;
      damage: number;
      camp: Camp;
      /** 延迟结算（秒；预留） */
      delay?: number;
      dmgType?: string;
    };

/** ★ 攻击执行器：分派攻击意图 → 命中判定 → 伤害管线 */
export function executeAttack(
  em: EntityManager,
  bullets: BulletManager | null,
  opts: AttackOptions,
): void {
  switch (opts.type) {
    case 'projectile': {
      bullets?.spawn(opts);
      break;
    }
    case 'melee': {
      // 范围瞬时判定（RasterMap 分块查询）→ 敌对目标 → 伤害管线
      const targets = em.querySphere(opts.x, opts.z, opts.range);
      for (const t of targets) {
        if (t === opts.source || t.camp === opts.camp) continue;
        if (Math.abs(t.position.y - opts.y) > 2) continue; // 高度过滤（不同层）
        const r = applyDamage(opts.damage, opts.source, t, opts.dmgType);
        console.log(`[近战] ${t.constructor.name}${r.dodged ? '【闪避】' : r.crit ? '【暴击】' : ''} -${r.final}`);
      }
      break;
    }
    case 'aoe': {
      // 范围结算（延迟效果后续：delay 到点再结算）
      const targets = em.querySphere(opts.x, opts.z, opts.radius);
      for (const t of targets) {
        if (t === opts.source || t.camp === opts.camp) continue;
        if (Math.abs(t.position.y - opts.y) > 3) continue;
        applyDamage(opts.damage, opts.source, t, opts.dmgType);
      }
      break;
    }
  }
}
