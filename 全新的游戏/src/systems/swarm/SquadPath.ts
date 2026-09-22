// ============================================================
// SquadPath —— 小队寻路（4m 格 A* + 拉绳平滑；《敌人管线设计.md》§5 落地版）
// ============================================================
// 现有 FlowField 只服务代理，且是"以玩家为中心"的单一距离场；
// 小队要去的是**命令目标**（舰船防线 / 工事点 / 玩家），必须按小队各自求路。
// 这里在 RasterMap 4m 块网格上做**有界 A***（窗口 = 起点/终点包围盒 + 边距），
// 产出稀疏 waypoint（走廊点），由 `SquadTactics.currentTargetOf` 沿线滚动 ——
// 实体 steer 与代理指令共用同一份结果（一次求解、全队复用）。
//
// 代价模型（与 FlowField 同口径）：
//   · 坑 / 深水（>0.8m）→ **阻挡**（敌人不能过，本地探测也会挡）
//   · 上坡相邻格高差 > 0.6m → 墙（**只挡上升**：≤0.6 硬边可上、下落差放行；
//     与执行层 CharacterBase.EDGE_CLIFF_BAND=0.6 同口径，防"寻路放行 0.7 升、
//     实体挡 0.6+ → 半路卡死在立面"）
//   · 未加载 chunk → 软代价（3，允许通过；数据就绪后重算会修正）
// 失败（窗口越界 / 无解 / 迭代超限）→ 返回 false，调用方回落直线（绝不停摆）。
// ============================================================

import type { RasterMap } from '../../services/map/RasterMap';
import { CHUNK_SIZE } from '../../services/map/ChunkGenerator';
import { samplerFor } from '../../services/map/TerrainSampler';
import { SLOPE_DH, WALL_DH, SLOPE_COST } from './TerrainScore';
import { DANGER } from './SwarmDanger';

const CELL = 4;
/** 单次寻路窗口上限（格；120×120 ≈ 480m，超出即拒绝，走直线兜底） */
const MAX_DIM = 120;
const MAX_CELLS = MAX_DIM * MAX_DIM;
/** A* 迭代上限（防病态地形拖帧） */
const MAX_ITER = 12000;
/** 未加载 chunk 的软代价 */
const COST_UNKNOWN = 3;
/** 上坡每米加价（与 FlowField 同口径） */
const COST_CLIMB = 1.5;
/** 下落每米加价（轻微偏好缓坡；不阻挡） */
const COST_DROP = 0.2;
/** 相邻格高差超过此值 = 墙（**只挡上升**；下落放行）。
 *  ★ 2026-09-22 与 CharacterBase.EDGE_CLIFF_BAND=0.6 统一（原 0.8 与执行层脱节）。 */
const WALL_STEP = DANGER.WALL_STEP;
/** 深水阈值（米；敌人不涉水） */
const DEEP_WATER = 0.8;
const SQRT2 = Math.SQRT2;

export class SquadPathFinder {
  private cols = 0;
  private rows = 0;
  /** 窗口左上角（世界 4m 格坐标） */
  private ox = 0;
  private oz = 0;

  private readonly g = new Float32Array(MAX_CELLS);
  private readonly f = new Float32Array(MAX_CELLS);
  private readonly parent = new Int32Array(MAX_CELLS);
  private readonly closed = new Uint8Array(MAX_CELLS);
  private readonly blocked = new Uint8Array(MAX_CELLS);
  private readonly cost = new Float32Array(MAX_CELLS);
  private readonly height = new Float32Array(MAX_CELLS);

  private readonly heapCell = new Int32Array(MAX_CELLS * 4);
  private readonly heapF = new Float32Array(MAX_CELLS * 4);
  private heapSize = 0;

  /** 求路：成功则把 waypoint（世界坐标，不含起点、含精确目标）写入 out */
  find(
    raster: RasterMap,
    sx: number, sz: number,
    gx: number, gz: number,
    out: { x: number; z: number }[],
    costMul?: (x: number, z: number) => number,
  ): boolean {
    out.length = 0;
    const scx = Math.floor(sx / CELL), scz = Math.floor(sz / CELL);
    const gcx = Math.floor(gx / CELL), gcz = Math.floor(gz / CELL);
    const margin = 10;
    const minX = Math.min(scx, gcx) - margin;
    const minZ = Math.min(scz, gcz) - margin;
    const cols = Math.abs(scx - gcx) + 1 + margin * 2;
    const rows = Math.abs(scz - gcz) + 1 + margin * 2;
    if (cols > MAX_DIM || rows > MAX_DIM) return false;
    this.ox = minX;
    this.oz = minZ;
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;

    // ---- 采样：阻碍 / 基础代价 / 高度 ----
    const cost = this.cost, blocked = this.blocked, height = this.height;
    const smp = samplerFor(raster);
    for (let iz = 0; iz < rows; iz++) {
      for (let ix = 0; ix < cols; ix++) {
        const i = iz * cols + ix;
        const wx = (minX + ix) * CELL + CELL / 2;
        const wz = (minZ + iz) * CELL + CELL / 2;
        const h = smp.heightAt(raster, wx, wz);
        height[i] = h;
        const role = smp.roleAt(raster, wx, wz);
        // ★ 水域允许通过（不再阻挡；站立/涉水由执行层处理）
        if (role === 'pit') {
          blocked[i] = 1;
          cost[i] = 1;
          continue;
        }
        blocked[i] = 0;
        const loaded = !!raster.getChunkData(
          Math.floor(wx / CHUNK_SIZE), Math.floor(wz / CHUNK_SIZE),
        );
        cost[i] = loaded ? 1 : COST_UNKNOWN;
      }
    }

    // ★ 表口径（与 TerrainScore 同源，4m 同格）：陡差 > WALL_DH → 硬边界；
    //   > SLOPE_DH → 坡面加价（不再"只挡上升"，两侧陡差都算）
    for (let iz = 1; iz < rows - 1; iz++) {
      for (let ix = 1; ix < cols - 1; ix++) {
        const i = iz * cols + ix;
        if (blocked[i]) continue;
        const h = height[i];
        const dh = Math.max(
          Math.abs(h - height[i - 1]), Math.abs(h - height[i + 1]),
          Math.abs(h - height[i - cols]), Math.abs(h - height[i + cols]),
        );
        if (dh > WALL_DH) { blocked[i] = 1; continue; }
        if (dh > SLOPE_DH) cost[i] *= SLOPE_COST;
      }
    }

    // ★ 掩体/战壕折扣（0.6~1；战壕/掩体=寻路加分点 → 拆解路径偏好有遮蔽的路线）
    if (costMul) {
      for (let iz = 0; iz < rows; iz++) {
        for (let ix = 0; ix < cols; ix++) {
          const i = iz * cols + ix;
          if (blocked[i]) continue;
          const wx = (minX + ix) * CELL + CELL / 2;
          const wz = (minZ + iz) * CELL + CELL / 2;
          const mul = costMul(wx, wz);
          if (!Number.isFinite(mul)) { blocked[i] = 1; continue; }
          cost[i] *= Math.max(0.5, Math.min(1.5, mul));
        }
      }
    }

    // ---- 起点/终点所在格（被挡则就近找可站格；找不到 → 直线兜底） ----
    const si0 = this.cellOf(scx, scz);
    const gi0 = this.cellOf(gcx, gcz);
    const si = this.nearestOpen(si0);
    const gi = this.nearestOpen(gi0);
    if (si < 0 || gi < 0) return false;
    const goalExact = gi === gi0;   // 目标格被挡过 → 末点改用可站格中心

    // ---- A*（octile 启发） ----
    this.g.fill(Infinity, 0, n);
    this.closed.fill(0, 0, n);
    this.parent.fill(-1, 0, n);
    this.heapSize = 0;
    this.g[si] = 0;
    this.push(si, this.heuristic(si, gi));
    let iter = 0;
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (this.closed[cur]) continue;
      this.closed[cur] = 1;
      if (cur === gi) return this.reconstruct(gi, gx, gz, sx, sz, goalExact, out);
      if (++iter > MAX_ITER) break;
      const ix = cur % cols;
      const iz = (cur - ix) / cols;
      const gc = this.g[cur];
      const hCur = height[cur];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = ix + dx, nz = iz + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          const nb = nz * cols + nx;
          if (blocked[nb] || this.closed[nb]) continue;
          // 斜向不切墙角
          if (dx !== 0 && dz !== 0
            && (blocked[iz * cols + nx] || blocked[nz * cols + ix])) continue;
          const dh = height[nb] - hCur;
          if (dh > WALL_STEP) continue;                      // 陡升 = 墙（不能爬崖）
          let step = (dx !== 0 && dz !== 0 ? SQRT2 : 1) * cost[nb];
          if (dh > 0) step += dh * COST_CLIMB;
          else step += -dh * COST_DROP;                      // 下落放行（轻微加价）
          const ng = gc + step;
          if (ng < this.g[nb]) {
            this.g[nb] = ng;
            this.parent[nb] = cur;
            this.push(nb, ng + this.heuristic(nb, gi));
          }
        }
      }
    }
    return false;
  }

  /** 回溯 + 拉绳平滑（贪心：能直达就跳过中间点） */
  private reconstruct(
    gi: number, gx: number, gz: number, sx: number, sz: number, goalExact: boolean,
    out: { x: number; z: number }[],
  ): boolean {
    const cells: number[] = [];
    let c = gi;
    while (c >= 0) {
      cells.push(c);
      c = this.parent[c];
    }
    cells.reverse();
    const kept: number[] = [cells[0]];
    let anchor = 0;
    while (anchor < cells.length - 1) {
      let next = cells.length - 1;
      while (next > anchor + 1 && !this.lineClear(cells[anchor], cells[next])) next--;
      kept.push(cells[next]);
      anchor = next;
    }
    for (let k = 0; k < kept.length; k++) {
      if (k === kept.length - 1) {
        // 目标格原本可站 → 用精确目标；被挡过 → 用就近可站格中心（别把终点丢进水里）
        if (goalExact) { out.push({ x: gx, z: gz }); continue; }
        const gc = gi;
        const gix = gc % this.cols;
        const giz = (gc - gix) / this.cols;
        out.push({ x: (this.ox + gix) * CELL + CELL / 2, z: (this.oz + giz) * CELL + CELL / 2 });
        continue;
      }
      const cell = kept[k];
      const ix = cell % this.cols;
      const iz = (cell - ix) / this.cols;
      const wx = (this.ox + ix) * CELL + CELL / 2;
      const wz = (this.oz + iz) * CELL + CELL / 2;
      if (Math.hypot(wx - sx, wz - sz) > 2.5) out.push({ x: wx, z: wz });
    }
    return out.length > 0;
  }

  /** 两点间是否可直线通过（Bresenham；阻挡 + 陡升检查） */
  private lineClear(a: number, b: number): boolean {
    const cols = this.cols;
    let ax = a % cols, az = (a - ax) / cols;
    const bx = b % cols, bz = (b - bx) / cols;
    const dx = Math.abs(bx - ax), dz = Math.abs(bz - az);
    const sx = ax < bx ? 1 : -1, sz = az < bz ? 1 : -1;
    let err = dx - dz;
    while (true) {
      const i = az * cols + ax;
      if (this.blocked[i]) return false;
      if (ax === bx && az === bz) return true;
      const h0 = this.height[i];
      const e2 = 2 * err;
      if (e2 > -dz) { err -= dz; ax += sx; }
      if (e2 < dx) { err += dx; az += sz; }
      if (this.height[az * cols + ax] - h0 > WALL_STEP) return false;   // 只挡陡升
    }
  }

  /** 就近可站格（半径 2 格内；找不到 -1） */
  private nearestOpen(cell: number): number {
    if (cell < 0) return -1;
    if (!this.blocked[cell]) return cell;
    const cx = cell % this.cols;
    const cz = (cell - cx) / this.cols;
    for (let r = 1; r <= 2; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= this.cols || nz >= this.rows) continue;
          const i = nz * this.cols + nx;
          if (!this.blocked[i]) return i;
        }
      }
    }
    return -1;
  }

  private cellOf(cx: number, cz: number): number {
    const ix = cx - this.ox;
    const iz = cz - this.oz;
    if (ix < 0 || iz < 0 || ix >= this.cols || iz >= this.rows) return -1;
    return iz * this.cols + ix;
  }

  /** octile 距离（格） */
  private heuristic(a: number, b: number): number {
    const ax = a % this.cols, az = (a - ax) / this.cols;
    const bx = b % this.cols, bz = (b - bx) / this.cols;
    const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
    return (dx + dz) + (SQRT2 - 2) * Math.min(dx, dz);
  }

  private push(cell: number, f: number): void {
    if (this.heapSize >= this.heapCell.length) return;
    let i = this.heapSize++;
    this.heapCell[i] = cell;
    this.heapF[i] = f;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapF[p] <= this.heapF[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  private pop(): number {
    const top = this.heapCell[0];
    const n = --this.heapSize;
    this.heapCell[0] = this.heapCell[n];
    this.heapF[0] = this.heapF[n];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.heapF[l] < this.heapF[m]) m = l;
      if (r < n && this.heapF[r] < this.heapF[m]) m = r;
      if (m === i) break;
      this.swap(m, i);
      i = m;
    }
    return top;
  }

  private swap(a: number, b: number): void {
    const c = this.heapCell[a];
    this.heapCell[a] = this.heapCell[b];
    this.heapCell[b] = c;
    const f = this.heapF[a];
    this.heapF[a] = this.heapF[b];
    this.heapF[b] = f;
  }
}
