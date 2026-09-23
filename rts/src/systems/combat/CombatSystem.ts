// ============================================================
// CombatSystem —— 命中解析层（《实体架构.md》§9.5 / P5）
// ============================================================
// 从 WorldMode 搬出（行为零变化）：
//   ① resolveBulletHit：子弹命中唯一入口 ——
//        祖宗弹 → 落点生成站桩友军；实体 → applyDamage；静态世界 → resolveImpact 一次权威判定
//   ② updateAgentHits：玩家/友军子弹 vs 蜂群代理（线段 vs 人群网格 → damageAgent → 飘字/回池）
// 掉落 / 友军生成 / 水面波动由模式层回调注入（物品 / UI / 水系统各自归口）。
// ============================================================

import type { BulletHitPayload } from '../../services/combat/BulletEntity';
import type { BulletManager } from '../../services/combat/BulletManager';
import { applyDamage } from '../../services/combat/DamagePipeline';
import type { PhysicsWorld } from '../../services/physics/PhysicsWorld';
import type { ChunkManager, ImpactReport } from '../../services/map/ChunkManager';
import { playSfx } from '../../services/audio/Sfx';
import type { SwarmSystem } from '../swarm/SwarmSystem';

export interface CombatSystemDeps {
  physics: PhysicsWorld | null;
  swarm: SwarmSystem;
  /** 玩家/友军子弹池（代理线段判定只扫这个池；敌方弹不参与） */
  bullets: BulletManager;
  chunks: ChunkManager;
  /** 友军弹落地生成站桩友军（WorldMode.spawnSentinelAt） */
  spawnSentinelAt(x: number, z: number): void;
  /** 静态命中掉落结算（WorldMode.spawnItemDrops） */
  spawnItemDrops(impact: ImpactReport): void;
  /** 命中点附近水面波动（WaterFx.agitateNear） */
  agitateWaterNear(x: number, z: number): void;
  /** 代理命中伤害数字（世界飘字） */
  showAgentDamage(x: number, y: number, z: number, dmg: number): void;
}

export class CombatSystem {
  constructor(private readonly deps: CombatSystemDeps) {}

  /** ★★ 命中解析层（唯一入口）：一次子弹碰撞 → 全分类结算。
   *   敌人实体 → 伤害管线 + 'damage' 事件（combat 归口）；
   *   静态世界（地块 / 装饰物）→ resolveImpact 一次权威判定 →
   *     地形扣除（消费地块属性）/ 水面波动 / 物品掉落（消费报告三键）。 */
  resolveBulletHit({ self, other, point, damage }: BulletHitPayload): void {
    // ★ 祖宗弹：命中/落地 → 在落点生成站桩友军，子弹就地回收（不结算伤害、不改地形）
    if (self.allyOnHit) {
      self.deactivate();
      self.recycle?.();
      this.deps.spawnSentinelAt(point.x, point.z);
      return;
    }
    if (other) {
      // 伤害/事件统一在 applyDamage 内结算（base 已含攻击力 → 不再叠加）
      // ★ 命中点 = bullet 接触点（payload 自带）→ 受击染料落在中弹处
      applyDamage(damage, self, other, { hitPoint: point });
      return;
    }
    // ★ 敌方弹（弩箭等）打地形：不改造地形、不掉落 —— 否则玩家能靠敌人弹"挖矿"
    //   （命中特效仍由 BulletEntity.hitFx 播放，反馈不缺）
    if (self.camp === 'enemy') return;
    const impact = this.deps.chunks.resolveImpact(point.x, point.y, point.z);
    this.deps.chunks.playBulletImpact(impact); // 地形修改：消费解析结果（含地块资格门；capHit 走挖洞顶）
    // ★ 击地 / 击水音：water='hit' = 真打在水面上 → 水花；
    //   'edge'（岸边地块）和 'none' 都算打到实地 → 击地音（水面另有波动，不重复响）
    if (impact.water === 'hit') playSfx('bulletWater', 70);
    else playSfx('bulletGround');
    this.deps.agitateWaterNear(point.x, point.z); // 水面波动
    if (!impact.capHit) this.deps.spawnItemDrops(impact); // 掉落：ground/water/crystal 全来自报告（洞顶不掉）
  }

  /** ★ P2：玩家/友军子弹命中代理（线段 vs 人群网格；命中即结算并回收子弹）
   *   ★ 远端代理无刚体：用上一帧位置 → 当前位置的线段扫（防高速穿透）。 */
  updateAgentHits(dt: number): void {
    const phys = this.deps.physics;
    if (!phys || this.deps.swarm.count === 0) return;
    this.deps.bullets.forEachActive((b) => {
      if (!b.isActive || b.camp === 'enemy') return;
      const p = b.entity.position;
      let x0 = p.x, z0 = p.z;
      const rb = b.entity.rigidBody;
      if (rb) {
        const v = phys.getLinearVelocity(rb.handle);
        x0 -= v.x * dt;
        z0 -= v.z * dt;
      }
      const idx = this.deps.swarm.hitTestSegment(x0, z0, p.x, p.z, b.hitRadius);
      if (idx < 0) return;
      const final = this.deps.swarm.damageAgent(idx, b.damageAtHit());
      if (final > 0) {
        this.deps.showAgentDamage(
          this.deps.swarm.agentX(idx), this.deps.swarm.agentY(idx) + 1.4, this.deps.swarm.agentZ(idx),
          final,
        );
      }
      // ★ 命中反馈 + 正确回池：只 deactivate 不 recycle 会漏池（10 发池打空后无法开火）
      b.hitFx?.(null);
      b.deactivate();
      b.recycle?.();
    });
  }
}
