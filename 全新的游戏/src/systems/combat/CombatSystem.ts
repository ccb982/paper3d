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
import { sweepTerrainCrossing, terrainNormalAt } from '../../services/combat/TerrainSweep';

/**
 * ★ 命中后子弹停放高度（米）：地表之上抬升一点，避免贴地时下一物理步
 *   又被判成「起点在地下」而误触发第二次命中。
 */
const BULLET_GROUND_LIFT = 0.02;

export interface CombatSystemDeps {
  physics: PhysicsWorld | null;
  swarm: SwarmSystem;
  /** 玩家/友军子弹池（代理线段判定只扫这个池；敌方弹不参与） */
  bullets: BulletManager;
  /**
   * ★ 全部子弹池（地形兜底扫掠用；玩家/友军/敌方弹走同一条判据）。
   *   敌方弹也穿地形（只是不挖坑）⇒ 一并覆盖。
   */
  allBulletPools: BulletManager[];
  chunks: ChunkManager;
  /** 友军弹落地生成站桩友军（WorldMode.spawnSentinelAt） */
  spawnSentinelAt(x: number, z: number): void;
  /** 静态命中掉落结算（WorldMode.spawnItemDrops） */
  spawnItemDrops(impact: ImpactReport): void;
  /** 命中点附近水面波动（WaterFx.agitateNear） */
  agitateWaterNear(x: number, z: number): void;
  /** 代理命中伤害数字（世界飘字） */
  showAgentDamage(x: number, y: number, z: number, dmg: number): void;
  /**
   * ★ 地形高度采样（数据层唯一真源 = RasterMap.baseSurfaceHeightAt）。
   *   地形物理 collider 是【分区懒建】的（chunk 创建时只有 1/9 分区建好，
   *   玩家周边 1 chunk 外的其余分区永不预建）⇒ 大片看得见的地形没有碰撞体，
   *   子弹打上去不产生物理接触 → 直接穿过去（用户实测：进入地图初期最明显）。
   *   ⇒ 地形命中改由高度场扫掠裁决，不依赖 collider 是否已建。
   *   返回 null = 该处数据未加载 → 判为未知（不判命中）。
   */
  terrainHeightAt(x: number, z: number): number | null;
}

export class CombatSystem {
  constructor(private readonly deps: CombatSystemDeps) {}

  /** ★★ 命中解析层（唯一入口）：一次子弹碰撞 → 全分类结算。
   *   敌人实体 → 伤害管线 + 'damage' 事件（combat 归口）；
   *   静态世界（地块 / 装饰物）→ resolveImpact 一次权威判定 →
   *     地形扣除（消费地块属性）/ 水面波动 / 物品掉落（消费报告三键）。
   *
   *  ★ 2026-11-07 新增分支：**结构件命中（staticKind==='structure'）→ 子弹反弹**。
   *   水泥台座是建筑结构，不该被挖出坑（用户定 2026-11-07）。
   *   ⇒ 只播击中特效 + 金属撞击音，**不改地形、不掉落**；
   *     反弹由物理层 restitution 处理（子弹刚体 restitution=0.8）。
   */
  resolveBulletHit({ self, other, staticKind, point, damage }: BulletHitPayload): void {
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
    // ★ 结构件（水泥台座等）：子弹反弹 —— 不挖地形、不掉落（物理层已按 restitution 反弹）
    if (staticKind === 'structure') {
      playSfx('bulletGround');
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

  /**
   * ★★ 地形命中兜底（数据层扫掠）：**不依赖地形物理 collider 是否已建**。
   *
   *   ★ 为什么需要（2026-11-07 实测定位「子弹穿透地块」根因）：
   *     地形物理是【分区懒建】（ChunkManager.createChunkGround）：
   *       · chunk 创建时**只同步建 1 个分区**（cells[0]；热点 chunk 则是脚下那个）；
   *       · 其余 8 个分区进队列 3 个/帧补建（每个分区 collider 实测 5.5~5.7ms）；
   *       · 玩家周边 1 chunk 外的 8 个分区**永不预建**（LAZY_GROUND_RADIUS=1）。
   *     而视觉建造半径 ±2 chunk（120m）、子弹射程 150m（50m/s × 3s）
   *     ⇒ **大片看得见的地形没有碰撞体** → 子弹打上去不产生物理接触
   *       → 不挖坑、不被拦下 → 视觉上就是子弹穿地块。
   *     （用户实测：「穿透往往出现在地块创建初期」——正是分区还没补齐的那几帧）
   *
   *   ★ 不是 CCD 的锅（实测 rapier 0.14 真跑，50m/s、步长 1/60、球半径 0.05m）：
   *     无 CCD → 1m 厚墙 / 水平薄面 / 30° 斜面 全部穿透
   *     有 CCD → 三种场景全部挡住
   *     ⇒ 刚体级 ccd:true 已足够（软 CCD 预测是冗余，已撤）。
   *       穿透来自「没有碰撞体」，不是「漏检」。
   *
   *   ★ 判据源 = RasterMap.baseSurfaceHeightAt（与渲染网格逐位一致的高度场；
   *     角色贴地走的是同一份高度场 ⇒ 子弹与角色看到的是同一个「地面」）。
   *     台座/石围裙是独立刚体（createStructuralGround，总是建好），由物理层负责。
   *
   *   ★ 去重：物理层若已对该子弹报过静态命中（BulletEntity.hitStaticByPhysics），
   *     说明物理层已拦下并结算过（挖坑/音效/掉落），本步不再重复判定
   *     —— 否则同一个落点会被挖两次（坑深一倍）。
   *
   *   ★ 轨迹段 = 上一物理步位置 → 当前物理步位置（BulletEntity.prevPhysPos 记录）。
   *     不用「当前速度 × dt」反推：反弹后速度方向已变，反推出来的起点是错的
   *     ⇒ 会得到一段根本不存在的弹道。
   */
  updateGroundHits(): void {
    const phys = this.deps.physics;
    if (!phys) return;
    const heightAt = this.deps.terrainHeightAt;
    // ★ 出参复用对象（每弹一份挂在 BulletEntity 上 → 免每步分配）
    for (const pool of this.deps.allBulletPools) {
      pool.forEachActive((b) => {
        if (!b.isActive) return;
        const rb = b.entity.rigidBody;
        if (!rb) return;
        const cur = phys.getPosition(rb.handle);
        const prev = b.prevPhysPos;
        const endH = b.sweepEndH;
        // ★ 物理层本步已报过静态命中 → 已结算过 → 本步让位（防同一落点挖两次）
        if (b.hitStaticByPhysics) {
          b.hitStaticByPhysics = false;
          b.prevPhysPos = { x: cur.x, y: cur.y, z: cur.z };
          // ★ 位置被物理层改写（反弹/停下）→ 上一段的终点高度提示作废
          b.prevGroundH = null;
          return;
        }
        if (!prev) {
          // 刚发射（无上一物理步位置）→ 无轨迹段，记起点后返回
          b.prevPhysPos = { x: cur.x, y: cur.y, z: cur.z };
          b.prevGroundH = null;
          return;
        }
        // ★ 起点高度提示：上一步终点的高度（相邻步首尾相接 ⇒ 免一次重复采样）
        const hit = sweepTerrainCrossing(prev, cur, heightAt, b.prevGroundH, endH);
        if (!hit) {
          b.prevPhysPos = { x: cur.x, y: cur.y, z: cur.z };
          b.prevGroundH = endH.h;
          return;
        }
        // ★ 物理层没拦下 ⇒ 子弹已穿过地面：按地表法线反弹 + 交解析层结算（挖坑/掉落）
        //   ★ 法线必须在挖坑**之前**取：挖坑会改地形高度，之后的法线已失真
        const v = phys.getLinearVelocity(rb.handle);
        const n = terrainNormalAt(hit.x, hit.z, heightAt);
        const vn = v.x * n.x + v.y * n.y + v.z * n.z;
        if (vn < 0) {
          // 恢复系数与物理层一致（子弹 collider restitution 0.8 × 地面 0 ⇒ 合成 0.4）
          const REST = 0.4;
          phys.setLinearVelocity(
            rb.handle,
            v.x - (1 + REST) * vn * n.x,
            v.y - (1 + REST) * vn * n.y,
            v.z - (1 + REST) * vn * n.z,
          );
        }
        phys.setPosition(rb.handle, hit.x, hit.y + BULLET_GROUND_LIFT, hit.z);
        // ★ 起点改记「修正后」的位置：否则下一段仍从地下出发 → 反复判命中、反复挖坑
        b.prevPhysPos = { x: hit.x, y: hit.y + BULLET_GROUND_LIFT, z: hit.z };
        // ★ 位置被改写到落点 ⇒ 上一步终点高度提示作废（下一步起点高度需重采）
        b.prevGroundH = null;
        b.hitFx?.(null);
        this.resolveBulletHit({
          self: b,
          other: null,
          staticKind: 'ground',
          point: { x: hit.x, y: hit.y, z: hit.z },
          damage: b.damageAtHit(),
        });
      });
    }
  }
}
