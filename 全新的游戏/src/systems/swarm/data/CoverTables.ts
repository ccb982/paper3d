// ============================================================
// data/CoverTables —— 工事表集合（HoleMask/HoleTable + 掩体加成 + LOS 地形层）
// ============================================================
// 从 SwarmData 抽出（2026-09-30 架构收口）：只做"表"的生命周期与查询，
// 不碰事态/环/端口。外部一律经 SwarmData 的 holeMask/holeTable 只读口访问。
// ============================================================

import { HoleMask } from '../HoleMask';
import { HoleTable } from '../HoleTable';
import { buildBonus } from '../FortifyPlanner';
import { hasCoverFrom, type TerrainCover } from '../UnitTactics';
import { WALL_DH, type TerrainSemantics } from '../TerrainSemantics';
import type { PassTable } from '../nav/PassTable';
import { COVER_HP, coverBlocksLine, snapshotCovers } from '../../../entity/CoverEntity';
import type { DefensePlan } from '../LandingTerrain';

export class CoverTables {
  /** ★ 独立破坏掩码（1m 深度场；"挖过即战壕"） */
  readonly mask = new HoleMask();
  /** ★★ 敌用动态坑洞公式表（掩码 → 深×近打分；2Hz 持续重排） */
  readonly table = new HoleTable();
  private tag = '';
  private clock = 0;
  private bonus: { key: string; map: ReadonlyMap<string, number> } = { key: '', map: new Map() };

  constructor(private readonly deps: {
    plan(): DefensePlan | null;
    builtList(): Iterable<{ x: number; z: number; kind: 'cover' | 'trench' }>;
    builtCount(): number;
    pass(): PassTable;
  }) {}

  /** ★ 掩体 LOS 地形层（三张表原则）：墙=pit 或 4m 邻差>WALL_DH；壕=HoleMask；贴墙=邻差>0.8·WALL_DH。 */
  readonly blocker: TerrainCover = {
    blockedAt: (x, z) => this.wallAt(x, z, 1.0),
    isTrenchAt: (x, z) => this.mask.isDug(x, z),
    wallNearAt: (x, z) => this.wallAt(x, z, 0.8),
  };

  private wallAt(x: number, z: number, k: number): boolean {
    const t = this.deps.pass();
    const h = t.heightAt(x, z);
    for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4]] as const) {
      if (Math.abs(t.heightAt(x + dx, z + dz) - h) > WALL_DH * k) return true;
    }
    return false;
  }

  /** 硬墙（k=1.0；工兵需求分排除用） */
  blockedNow(x: number, z: number): boolean {
    return this.wallAt(x, z, 1.0);
  }

  /** ★ 调试/探针：掩体校验真源（与队长同源 hasCoverFrom） */
  debugHasCover(tx: number, tz: number, x: number, z: number): boolean {
    return hasCoverFrom(tx, tz, x, z, this.blocker);
  }

  /** ★ 掩体加成缓存（键=掩体集/已建数/落点） */
  bonusCached(): ReadonlyMap<string, number> {
    const plan = this.deps.plan();
    const key = plan ? `${this.table.covers.length}|${this.deps.builtCount()}|${plan.cx},${plan.cz}` : '';
    if (plan && key !== this.bonus.key) {
      this.bonus = { key, map: buildBonus(plan, [...this.table.covers, ...this.deps.builtList()]) };
    }
    return this.bonus.map;
  }

  /** 2Hz 重建敌用工事表；返回 true = 掩体集合变化（评分代次 +1 信号） */
  tick(dt: number, sem: TerrainSemantics | null, playerX: number, playerZ: number): boolean {
    this.clock += dt;
    if (this.clock < 0.5) return false;
    this.clock = 0;
    const cov = snapshotCovers('enemy').map((c) => ({
      x: c.x, z: c.z, hp: c.hp, maxHp: COVER_HP, variant: c.variant, heading: c.heading,
      hidden: coverBlocksLine(c.x, c.z, playerX, playerZ),
    }));
    this.table.rebuild(this.mask, sem, playerX, playerZ, cov);
    const tag = `${cov.length}:${cov.map((c) => `${c.x | 0},${c.z | 0}`).join(';')}`;
    if (tag !== this.tag) { this.tag = tag; return true; }
    return false;
  }

  clear(): void {
    this.table.clear();
    this.tag = '';
    this.clock = 0;
    this.bonus = { key: '', map: new Map() };
  }
}
