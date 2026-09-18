// ============================================================
// CrowdGrid —— 人群网格（《蜂群架构.md》§5.3）
// ============================================================
// 均匀分桶（4m，对齐地形米格块）：代理分离 / 邻居查询。
// 每帧重建一次（200 代理 = 200 次 push，成本可忽略）；查询只扫 3×3 桶。
// ============================================================

import type { AgentPool } from './AgentPool';

const CELL = 4;

/** 格子编码（负数安全；世界坐标 / 4m 对齐） */
function cellKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

export class CrowdGrid {
  private buckets = new Map<number, number[]>();
  private keyBuf: number[] = [];
  /** 段命中去重（复用，零分配） */
  private seen = new Set<number>();

  /** 重建（每帧调用） */
  rebuild(pool: AgentPool): void {
    this.buckets.clear();
    const keys = this.keyBuf;
    keys.length = 0;
    for (let i = 0; i < pool.count; i++) {
      const k = cellKey(Math.floor(pool.x[i] / CELL), Math.floor(pool.z[i] / CELL));
      let arr = this.buckets.get(k);
      if (!arr) {
        arr = [];
        this.buckets.set(k, arr);
      }
      arr.push(i);
      keys.push(k);
    }
  }

  /**
   * ★ 线段 vs 代理命中（子弹用）：返回最先命中的代理下标（-1 = 无）。
   * 沿线段取样 + 3×3 桶查询 + 点到线段距离；半径 = r + 代理半径。
   */
  segmentHit(
    pool: AgentPool,
    x0: number, z0: number, x1: number, z1: number, r: number,
  ): number {
    const dx = x1 - x0, dz = z1 - z0;
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-8) return -1;
    const len = Math.sqrt(len2);
    const steps = Math.max(1, Math.ceil(len / (CELL / 2)));
    const seen = this.seen;
    seen.clear();
    let best = -1;
    let bestT = Infinity;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.floor((x0 + dx * t) / CELL);
      const cz = Math.floor((z0 + dz * t) / CELL);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oz = -1; oz <= 1; oz++) {
          const arr = this.buckets.get(cellKey(cx + ox, cz + oz));
          if (!arr) continue;
          for (const j of arr) {
            if (seen.has(j)) continue;
            seen.add(j);
            const rr = r + pool.scale[j] * 0.45;
            const px = pool.x[j], pz = pool.z[j];
            const tp = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / len2));
            const qx = x0 + dx * tp, qz = z0 + dz * tp;
            const ddx = px - qx, ddz = pz - qz;
            if (ddx * ddx + ddz * ddz <= rr * rr && tp < bestT) {
              bestT = tp;
              best = j;
            }
          }
        }
      }
    }
    return best;
  }

  /**
   * 分离：把 i 从邻域其他代理推开（水平位移增量写入 out）。
   * 只处理"互相重叠"的邻居（距离 < 半径和）；重叠越深推力越大。
   */
  separation(pool: AgentPool, i: number, out: { x: number; z: number }): void {
    out.x = 0; out.z = 0;
    const x = pool.x[i], z = pool.z[i];
    const rSelf = pool.scale[i] * 0.45; // 碰撞半径近似（贴片宽 × 系数）
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = this.buckets.get(cellKey(cx + dx, cz + dz));
        if (!arr) continue;
        for (const j of arr) {
          if (j === i) continue;
          // ★ 空中层（2026-09-18）：不同层互不推挤（飞兵悬在地面兵头顶，水平重叠不该互相挤）
          if (pool.isAir[i] !== pool.isAir[j]) continue;
          const ox = pool.x[j] - x, oz = pool.z[j] - z;
          const rr = rSelf + pool.scale[j] * 0.45;
          const d2 = ox * ox + oz * oz;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          const push = (rr - d) * 0.5;
          out.x -= (ox / d) * push;
          out.z -= (oz / d) * push;
        }
      }
    }
  }
}
