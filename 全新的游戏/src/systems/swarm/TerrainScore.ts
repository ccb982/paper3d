// ============================================================
// TerrainScore —— 地块有利位置评分表（全兵种共用；2026-09-21 用户定调）
// ============================================================
// 一句话：把地形扫描从"一次性点位清单"升级为**逐格评分表**——
//   每格分 = 态势权重 × [高度(绝对) + 舰船距离 + 掩体/制高加成 - 近舰负分]；
//   距离锚 = 玩家要守的舰船；所有兵种都读它，只是解读方式不同。
// 动态：掩体建成 / 换落点 / 态势切换 / 地形变化 → 重建（8m 格，~1.4k 格，可随时重算）。
// 阶段权重（可调）：前期距离权重低 + 靠近飞船负分（往外展开）；
//   总攻 dist 权重转负且猛加（压向舰船）；撤退 dist 正权重（远离）。
// ============================================================

import type { RasterMap } from '../../services/map/RasterMap';
import type { BattlePosture } from './Posture';
import type { DefensePlan } from './LandingTerrain';

/** 评分格边长（米；位置分不需要 4m 精度，8m 省 4 倍） */
const CELL = 8;
/** 表半径（米；覆盖落点周边） */
const R = 144;
const SIDE = Math.floor((R * 2) / CELL) + 1;

/** ★ 态势权重表（h 高度 / dist 舰船距离 / cover 掩体制高 / near 近舰负分） */
export const PHASE_WEIGHTS: Record<BattlePosture, { h: number; dist: number; cover: number; near: number }> = {
  fortify:  { h: 0.6, dist: 0.06, cover: 0.8, near: 1.6 },   // 前期：距离权重低，靠近飞船负分
  patrol:   { h: 0.6, dist: 0.08, cover: 0.8, near: 1.2 },
  advance:  { h: 0.5, dist: 0.02, cover: 1.0, near: 0.0 },
  mass:     { h: 0.4, dist: -0.06, cover: 1.0, near: 0.0 },
  assault:  { h: 0.3, dist: -0.35, cover: 0.6, near: 0.0 },  // 总攻：舰船距离猛加（负号=越近越高）
  withdraw: { h: 0.5, dist: 0.25, cover: 1.2, near: 0.0 },   // 撤退：远离舰船
};

export class TerrainScore {
  private sx = 0;
  private sz = 0;
  private stamp = -1;
  private ready = false;
  private readonly score = new Float32Array(SIDE * SIDE);
  private readonly pass = new Uint8Array(SIDE * SIDE);

  get isReady(): boolean { return this.ready; }

  /** 重建（触发戳 = plan 版本 + 掩体数 + 态势；变了才重算） */
  rebuild(
    raster: RasterMap, plan: DefensePlan, builtCovers: { x: number; z: number }[],
    posture: BattlePosture, stamp: number,
  ): void {
    if (this.ready && stamp === this.stamp) return;
    this.stamp = stamp;
    this.sx = plan.cx - R;
    this.sz = plan.cz - R;
    const w = PHASE_WEIGHTS[posture] ?? PHASE_WEIGHTS.patrol;
    const bonus = new Map<string, number>();
    for (const p of plan.posts) {
      bonus.set(this.key(p.x, p.z), p.kind === 'cover' ? 1.2 : 0.8);
    }
    for (const c of builtCovers) bonus.set(this.key(c.x, c.z), 2.5);   // ★ 造好的掩体 = 新有利位置
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const x = this.sx + ix * CELL + CELL / 2;
        const z = this.sz + iz * CELL + CELL / 2;
        const i = iz * SIDE + ix;
        const h = raster.surfaceHeightAt(x, z);
        const role = raster.tileDefAt(x, z).genRole;
        const ok = !(role === 'pit' || (role === 'liquid' && h < -0.8) || h < -1.2);
        this.pass[i] = ok ? 1 : 0;
        if (!ok) { this.score[i] = -1e9; continue; }
        const d = Math.hypot(x - plan.cx, z - plan.cz);
        let s = w.h * h + w.dist * d + (bonus.get(this.key(x, z)) ?? 0) * w.cover;
        if (w.near > 0 && d < 30) s -= w.near * (1 - d / 30) * 4;   // 近舰负分（前期往外展开）
        this.score[i] = s;
      }
    }
    this.ready = true;
  }

  /** 该点评分（未就绪/表外 → null；不可站 → -1e9） */
  scoreAt(x: number, z: number): number | null {
    if (!this.ready) return null;
    const ix = Math.round((x - this.sx - CELL / 2) / CELL);
    const iz = Math.round((z - this.sz - CELL / 2) / CELL);
    if (ix < 0 || iz < 0 || ix >= SIDE || iz >= SIDE) return null;
    const i = iz * SIDE + ix;
    return this.pass[i] ? this.score[i] : -1e9;
  }

  /** 半径内最高分格（消费方：站位/集结/施工排序；无 → null） */
  bestNear(x: number, z: number, radius: number): { x: number; z: number; score: number } | null {
    if (!this.ready) return null;
    const r2 = radius * radius;
    let best: { x: number; z: number; score: number } | null = null;
    for (let iz = 0; iz < SIDE; iz++) {
      for (let ix = 0; ix < SIDE; ix++) {
        const i = iz * SIDE + ix;
        if (!this.pass[i]) continue;
        const bx = this.sx + ix * CELL + CELL / 2;
        const bz = this.sz + iz * CELL + CELL / 2;
        if ((bx - x) ** 2 + (bz - z) ** 2 > r2) continue;
        if (!best || this.score[i] > best.score) best = { x: bx, z: bz, score: this.score[i] };
      }
    }
    return best;
  }

  clear(): void {
    this.ready = false;
    this.stamp = -1;
  }

  private key(x: number, z: number): string {
    return `${Math.round(x / CELL)},${Math.round(z / CELL)}`;
  }
}
