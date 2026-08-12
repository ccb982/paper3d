// ============================================================
// RasterMap —— 光栅化地图（统一空间层，架构 3.10）
// ============================================================
// 1m cell 网格，同时承载：
//   静态：地形高度 / 装饰噪点（小地图数据源、射击阻挡后续）
//   动态：实体索引（insert/move/remove，哈希移块）
// 查询（替代 SpatialGrid）：
//   querySphere / queryRay / queryFrustum（★ 2D 梯形：相机视锥地面投影，
//   精确覆盖前方视野，身后/远处不遍历——LOD 的"硬剔除"基础）
// LOD：梯形内实体按距离分级（距离表由调用方/实体层定，本类只提供梯形范围）

import type { EntityBase } from '../../entity/EntityBase';
import type { MapQuery } from './MapQuery';
import * as THREE from 'three';

/** 点是否在多边形内（射线法，任意凸/凹多边形） */
function pointInPolygon(px: number, pz: number, pts: { x: number; z: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, zi = pts[i].z;
    const xj = pts[j].x, zj = pts[j].z;
    if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export class RasterMap {
  readonly size: number;
  /** 地块高度网格（cell 中心采样，size×size） */
  private heights: Float32Array;
  /** 装饰噪点（1 = 亮点 cell；确定性随机） */
  private decor: Uint8Array;
  /** ★ 实体索引：cell key → 实体集合 */
  private cells = new Map<number, Set<EntityBase>>();
  /** 实体当前 cell（移块判定） */
  private cellOf = new Map<EntityBase, number>();

  constructor(map: MapQuery, seed = 12345) {
    this.size = map.size;
    this.heights = new Float32Array(this.size * this.size);
    for (let z = 0; z < this.size; z++) {
      for (let x = 0; x < this.size; x++) {
        this.heights[z * this.size + x] = map.getHeight(x + 0.5, z + 0.5);
      }
    }
    // 确定性噪点（同 seed 同分布——3D 标记与小地图一一对应）
    this.decor = new Uint8Array(this.size * this.size);
    let s = seed;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    const count = Math.floor(this.size * this.size * 0.05);
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rnd() * this.size);
      const z = Math.floor(rnd() * this.size);
      this.decor[z * this.size + x] = 1;
    }
  }

  // ============ 静态地形 ============

  heightAt(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return 0;
    return this.heights[z * this.size + x];
  }

  isDecor(x: number, z: number): boolean {
    if (x < 0 || z < 0 || x >= this.size || z >= this.size) return false;
    return this.decor[z * this.size + x] === 1;
  }

  terrainColorAt(x: number, z: number): [number, number, number] {
    if (this.isDecor(x, z)) return [255, 220, 90];
    const h = this.heightAt(x, z);
    const t = Math.max(0, Math.min(1, h / 8));
    const r = Math.round(45 + (150 - 45) * t);
    const g = Math.round(90 + (140 - 90) * t);
    const b = Math.round(39 + (60 - 39) * t);
    return [r, g, b];
  }

  // ============ 实体索引（替代 SpatialGrid） ============

  private keyOf(x: number, z: number): number {
    return z * this.size + x;
  }

  /** 注册（EntityManager.register 调用） */
  insert(e: EntityBase): void {
    const key = this.keyOf(Math.floor(e.position.x), Math.floor(e.position.z));
    let set = this.cells.get(key);
    if (!set) {
      set = new Set();
      this.cells.set(key, set);
    }
    set.add(e);
    this.cellOf.set(e, key);
  }

  /** 注销（EntityManager.unregister 调用） */
  remove(e: EntityBase): void {
    const key = this.cellOf.get(e);
    if (key === undefined) return;
    this.cells.get(key)?.delete(e);
    this.cellOf.delete(e);
  }

  /** ★ 集中刷新（EntityBase.update 末尾）：哈希比较，变化才移块 */
  move(e: EntityBase): void {
    const newKey = this.keyOf(Math.floor(e.position.x), Math.floor(e.position.z));
    const oldKey = this.cellOf.get(e);
    if (newKey === oldKey) return;
    if (oldKey !== undefined) this.cells.get(oldKey)?.delete(e);
    let set = this.cells.get(newKey);
    if (!set) {
      set = new Set();
      this.cells.set(newKey, set);
    }
    set.add(e);
    this.cellOf.set(e, newKey);
  }

  clear(): void {
    this.cells.clear();
    this.cellOf.clear();
  }

  // ============ 查询 ============

  /** 范围查询：圆覆盖 cell → 实体距离过滤（索敌/技能/拾取） */
  querySphere(x: number, z: number, r: number): EntityBase[] {
    const out: EntityBase[] = [];
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(this.size - 1, Math.floor(x + r));
    const z0 = Math.max(0, Math.floor(z - r));
    const z1 = Math.min(this.size - 1, Math.floor(z + r));
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const set = this.cells.get(this.keyOf(cx, cz));
        if (!set) continue;
        for (const e of set) {
          const dx = e.position.x - x;
          const dz = e.position.z - z;
          if (dx * dx + dz * dz <= r2) out.push(e);
        }
      }
    }
    return out;
  }

  /** 射线路径查询（DDA 网格采样，瞄准候选集） */
  queryRay(origin: { x: number; z: number }, dir: { x: number; z: number }, maxDist: number): EntityBase[] {
    const out: EntityBase[] = [];
    const seen = new Set<EntityBase>();
    const x0 = origin.x, z0 = origin.z;
    const dx = dir.x, dz = dir.z;
    let tMaxX: number;
    let tMaxZ: number;
    if (dx > 0) tMaxX = ((Math.floor(x0) + 1) - x0) / dx;
    else if (dx < 0) tMaxX = (Math.floor(x0) - x0) / dx;
    else tMaxX = Infinity;
    if (dz > 0) tMaxZ = ((Math.floor(z0) + 1) - z0) / dz;
    else if (dz < 0) tMaxZ = (Math.floor(z0) - z0) / dz;
    else tMaxZ = Infinity;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let x = x0, z = z0, t = 0;
    const maxSteps = Math.ceil(maxDist) + 2;
    for (let i = 0; i < maxSteps; i++) {
      if (t > maxDist) break;
      const set = this.cells.get(this.keyOf(Math.floor(x), Math.floor(z)));
      if (set) {
        for (const e of set) {
          if (!seen.has(e)) {
            seen.add(e);
            out.push(e);
          }
        }
      }
      if (tMaxX < tMaxZ) {
        t = tMaxX;
        tMaxX += tDeltaX;
        x += dx > 0 ? 1 : -1;
      } else {
        t = tMaxZ;
        tMaxZ += tDeltaZ;
        z += dz > 0 ? 1 : -1;
      }
    }
    return out;
  }

  /** ★ 2D 梯形查询（相机视锥地面投影，架构 3.10）：
   *   far 4 角投影到 y=0 → 四边形（梯形）→ 覆盖 AABB 内 cell 做点在多边形测试
   *   → 只返回前方视野内的实体（身后/远处不遍历）。maxDist 钳制远角。 */
  queryFrustum(camera: THREE.Camera, maxDist = 100): EntityBase[] {
    camera.updateMatrixWorld();
    const pts: { x: number; z: number }[] = [];
    const ndc = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const tmp = new THREE.Vector3();
    for (const [nx, ny] of ndc) {
      tmp.set(nx, ny, 1).unproject(camera);
      const dir = tmp.sub(camera.position);
      if (Math.abs(dir.y) < 1e-6) dir.y = 1e-6;
      const t = -camera.position.y / dir.y;
      if (t <= 0) {
        // 射线向上（仰视）→ 钳制到 maxDist（保守，保证多边形闭合）
        pts.push({
          x: camera.position.x + dir.normalize().x * maxDist,
          z: camera.position.z + dir.z * maxDist,
        });
      } else if (t > maxDist) {
        pts.push({
          x: camera.position.x + dir.x * maxDist,
          z: camera.position.z + dir.z * maxDist,
        });
      } else {
        pts.push({ x: camera.position.x + dir.x * t, z: camera.position.z + dir.z * t });
      }
    }
    // 覆盖 AABB
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
    // 相机附近（近处地面在四边形内，兜底纳入）
    minX = Math.min(minX, camera.position.x - 1);
    maxX = Math.max(maxX, camera.position.x + 1);
    minZ = Math.min(minZ, camera.position.z - 1);
    maxZ = Math.max(maxZ, camera.position.z + 1);
    const out: EntityBase[] = [];
    const seen = new Set<EntityBase>();
    const cx0 = Math.max(0, Math.floor(minX));
    const cx1 = Math.min(this.size - 1, Math.floor(maxX));
    const cz0 = Math.max(0, Math.floor(minZ));
    const cz1 = Math.min(this.size - 1, Math.floor(maxZ));
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        // ★ 点在四边形内才遍历（梯形精确，不进 AABB 冗余区）
        if (!pointInPolygon(cx + 0.5, cz + 0.5, pts)) continue;
        const set = this.cells.get(this.keyOf(cx, cz));
        if (!set) continue;
        for (const e of set) {
          if (!seen.has(e)) {
            seen.add(e);
            out.push(e);
          }
        }
      }
    }
    return out;
  }
}
