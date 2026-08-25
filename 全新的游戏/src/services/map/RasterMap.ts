// ============================================================
// RasterMap —— 光栅化地图（统一空间层，架构 3.10 / 3.8）
// ============================================================
// ★ 无限扩张地图（chunk 流式，块状地形）：
//   - chunk 60×60 米，初始 3×3，玩家移动驱动扩张（updateChunks）
//   - 地形：chunk → ChunkData（heights/blockTypes/blockHeight/walkable）
//   - 实体索引：cellKey 全局编码（无限）→ 查询跨 chunk 无界
//   - 回收：天内只增不删；clearAll() 天结束统一回收
// 消费方：Minimap（地形/黑雾数据）、EntityManager（实体索引/梯形剔除）、
//         WorldMode（玩家驱动加载 + 地面刚体/视觉网格）
// ★ 结构上满足 ChunkAppearance.TerrainBakeSource 烘焙契约
//   （heightAt/surfaceHeightAt/tileDefAt/worldSeed）——外观烘焙经
//   该窄接口消费本类，依赖倒置，勿在烘焙器内反向耦合本类。

import type { EntityBase } from '../../entity/EntityBase';
import * as THREE from 'three';
import { tileById, type TileDef } from './Tiles';
import {
  generateChunk, type ChunkData,
  CHUNK_SIZE, BLOCK_SIZE, BLOCKS_PER_SIDE,
} from './ChunkGenerator';

/** chunkKey（负数安全偏移编码） */
export function chunkKeyOf(cx: number, cz: number): number {
  return (cx + 4096) * 8192 + (cz + 4096);
}

/** 全局 cellKey（1m cell，世界坐标无限；±1e7 范围）——Minimap 黑雾等外部复用 */
export function cellKeyOf(x: number, z: number): number {
  return (x + 1e7) * 2e7 + (z + 1e7);
}

export class RasterMap {
  /** 地形 chunk：chunkKey → ChunkData（块状地形：平地/高台/坑洞） */
  private chunks = new Map<number, ChunkData>();
  /** 实体索引：cellKey（全局）→ 实体集合 */
  private cells = new Map<number, Set<EntityBase>>();
  /** 实体当前 cell（移块判定） */
  private cellOf = new Map<EntityBase, number>();
  /** 玩家所在 chunk（扩张判定缓存） */
  private lastPcx = 0;
  private lastPcz = 0;
  /** 首次调用标记（★ 构造不预生成 chunk——初始 3×3 由首次 updateChunks 统一生成，
   *   否则预生成的数据不会进入"新增列表"，对应刚体/网格永不创建） */
  private initialized = false;

  static current: RasterMap | null = null;
  constructor(private seed = 12345) {
    RasterMap.current = this;
    // 初始不预生成：首次 updateChunks（syncChunks）统一生成 3×3（加载半径 2）
  }

  /** 世界种子（外观 canvas 烘焙的噪声用；同 seed 同地形 → 装饰/噪声也一致） */
  get worldSeed(): number {
    return this.seed;
  }

  // ============ chunk 加载（玩家驱动扩张） ============

  /** 确保单个 chunk 存在（块状地形生成，确定性） */
  private ensureChunk(cx: number, cz: number): void {
    const key = chunkKeyOf(cx, cz);
    if (this.chunks.has(key)) return;
    this.chunks.set(key, generateChunk(this.seed, cx, cz));
  }

  /** ★ 玩家驱动加载：跨 chunk 时按加载半径扩张，返回本次新增 chunk 列表
   *   （调用方据此建地面刚体/视觉网格）。加载半径 = 可视(1) + 预加载(1) */
  updateChunks(px: number, pz: number, loadRadius = 2): { cx: number; cz: number }[] {
    const pcx = Math.floor(px / CHUNK_SIZE);
    const pcz = Math.floor(pz / CHUNK_SIZE);
    if (this.initialized) {
      if (pcx === this.lastPcx && pcz === this.lastPcz) return [];
    } else {
      this.initialized = true; // ★ 首次强制加载（数据已就绪，同步刚体/网格）
    }
    this.lastPcx = pcx;
    this.lastPcz = pcz;
    const added: { cx: number; cz: number }[] = [];
    for (let cx = pcx - loadRadius; cx <= pcx + loadRadius; cx++) {
      for (let cz = pcz - loadRadius; cz <= pcz + loadRadius; cz++) {
        if (!this.chunks.has(chunkKeyOf(cx, cz))) {
          this.ensureChunk(cx, cz);
          added.push({ cx, cz });
        }
      }
    }
    return added;
  }

  /** ★ 天结束统一回收（世界重建；seed 确定性保证每天地形一致） */
  clearAll(): void {
    this.chunks.clear();
    this.cells.clear();
    this.cellOf.clear();
    this.initialized = false; // 重置强制标记（下次 updateChunks 重建全部）
  }

  // ============ 静态地形（无界采样） ============

  /** 取 chunk 数据（视觉/物理生成用） */
  getChunkData(cx: number, cz: number): ChunkData | undefined {
    return this.chunks.get(chunkKeyOf(cx, cz));
  }

  /** 世界高度（格值，无 chunk = 0 占位） */
  heightAt(x: number, z: number): number {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKeyOf(cx, cz));
    if (!chunk) return 0;
    const lx = Math.floor(x - cx * CHUNK_SIZE);
    const lz = Math.floor(z - cz * CHUNK_SIZE);
    return chunk.heights[lz * CHUNK_SIZE + lx] ?? 0;
  }

  /** ★ 视觉面顶点值（格线交点）= 周围 2×2 格高度取 max——
   *   直角立面：块边界顶点取台面高（否则视觉斜坡 → 角色站在斜坡上方悬空） */
  vertexHeightAt(x: number, z: number): number {
    return Math.max(
      this.heightAt(x - 1, z - 1), this.heightAt(x, z - 1),
      this.heightAt(x - 1, z), this.heightAt(x, z),
    );
  }

  /** ★ 视觉面一致采样（角色脚底 y 用）：顶点值双线性插值——
   *   与网格渲染完全一致（同一顶点值 + 同插值）→ 角色永贴视觉面（不陷地） */
  surfaceHeightAt(x: number, z: number): number {
    const gx = Math.floor(x);
    const gz = Math.floor(z);
    const fx = x - gx;
    const fz = z - gz;
    const h00 = this.vertexHeightAt(gx, gz);
    const h10 = this.vertexHeightAt(gx + 1, gz);
    const h01 = this.vertexHeightAt(gx, gz + 1);
    const h11 = this.vertexHeightAt(gx + 1, gz + 1);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
  }

  /** 世界阻挡高度（高台立面；射击 rayMarch 用） */
  blockHeightAt(x: number, z: number): number {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKeyOf(cx, cz));
    if (!chunk) return 0;
    const lx = Math.floor(x - cx * CHUNK_SIZE);
    const lz = Math.floor(z - cz * CHUNK_SIZE);
    return chunk.blockHeight[lz * CHUNK_SIZE + lx] ?? 0;
  }

  /** 世界可通行（坑洞 = false；AI 寻路/移动判定用） */
  isWalkable(x: number, z: number): boolean {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKeyOf(cx, cz));
    if (!chunk) return true; // 未加载区默认可走（防止边界卡死）
    const lx = Math.floor(x - cx * CHUNK_SIZE);
    const lz = Math.floor(z - cz * CHUNK_SIZE);
    return (chunk.walkable[lz * CHUNK_SIZE + lx] ?? 1) === 1;
  }

  /** 地形颜色（按模板 + 块类型分区着色：高台暖黄/平地冷灰/坑洞深红/斜坡过渡） */
  /** ★ 地块定义查询（外观 Canvas 烘焙/装饰散布用；未加载回退平地） */
  tileDefAt(x: number, z: number): TileDef {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKeyOf(cx, cz));
    if (!chunk) return tileById(0);
    const bx = Math.floor((x - cx * CHUNK_SIZE) / 4);
    const bz = Math.floor((z - cz * CHUNK_SIZE) / 4);
    return tileById(chunk.blockTypes[bz * 15 + bx]);
  }

  /** 地表类型 id（未加载返回 BLOCK_FLAT） */
  terrainTypeAt(x: number, z: number): number {
    return this.tileDefAt(x, z).id;
  }

  /** 基准色 RGB（纯净无抖动；小地图消费） */
  terrainColorAt(x: number, z: number): [number, number, number] {
    return this.tileDefAt(x, z).baseRgb;
  }

  // ============ 实体索引（全局 cell，无限） ============

  /** 注册（EntityManager.register 调用） */
  insert(e: EntityBase): void {
    const key = cellKeyOf(Math.floor(e.position.x), Math.floor(e.position.z));
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
    const newKey = cellKeyOf(Math.floor(e.position.x), Math.floor(e.position.z));
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

  // ============ 查询（无界，跨 chunk） ============

  /** 范围查询：圆覆盖 cell → 实体距离过滤 */
  querySphere(x: number, z: number, r: number): EntityBase[] {
    const out: EntityBase[] = [];
    const r2 = r * r;
    const x0 = Math.floor(x - r);
    const x1 = Math.floor(x + r);
    const z0 = Math.floor(z - r);
    const z1 = Math.floor(z + r);
    for (let cz = z0; cz <= z1; cz++) {
      for (let cx = x0; cx <= x1; cx++) {
        const set = this.cells.get(cellKeyOf(cx, cz));
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
    if (dx > 0) tMaxX = (Math.floor(x0) + 1 - x0) / dx;
    else if (dx < 0) tMaxX = (Math.floor(x0) - x0) / dx;
    else tMaxX = Infinity;
    if (dz > 0) tMaxZ = (Math.floor(z0) + 1 - z0) / dz;
    else if (dz < 0) tMaxZ = (Math.floor(z0) - z0) / dz;
    else tMaxZ = Infinity;
    const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let x = x0, z = z0, t = 0;
    const maxSteps = Math.ceil(maxDist) + 2;
    for (let i = 0; i < maxSteps; i++) {
      if (t > maxDist) break;
      const set = this.cells.get(cellKeyOf(Math.floor(x), Math.floor(z)));
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

  /** ★ 视锥梯形 4 顶点（世界 xz；调试绘制/查询共用）：
   *   下边 = 下边界视线与 y=0 交点（近处）；上边 = 上视线水平延伸 maxDist（远处）
   *   ⚠ 上视线指向天空时（俯视）不能钳到相机位置（退化三角），见 queryFrustum */
  frustumCorners(camera: THREE.Camera, maxDist = 100): { x: number; z: number }[] {
    camera.updateMatrixWorld();
    const pts: { x: number; z: number }[] = [];
    const ndc = [[-1, -1], [1, -1], [1, 1], [-1, 1]]; // 左下、右下、右上、左上
    const tmp = new THREE.Vector3();
    for (const [nx, ny] of ndc) {
      tmp.set(nx, ny, 1).unproject(camera);
      const dir = tmp.sub(camera.position).normalize();
      let px: number;
      let pz: number;
      if (Math.abs(dir.y) < 1e-6) {
        const hl = Math.hypot(dir.x, dir.z);
        const hx = hl > 1e-6 ? dir.x / hl : 0;
        const hz = hl > 1e-6 ? dir.z / hl : 0;
        px = camera.position.x + hx * maxDist;
        pz = camera.position.z + hz * maxDist;
      } else {
        const t = -camera.position.y / dir.y;
        if (t > 0 && t <= maxDist) {
          px = camera.position.x + dir.x * t;
          pz = camera.position.z + dir.z * t;
        } else {
          const hl = Math.hypot(dir.x, dir.z);
          const hx = hl > 1e-6 ? dir.x / hl : 0;
          const hz = hl > 1e-6 ? dir.z / hl : 0;
          px = camera.position.x + hx * maxDist;
          pz = camera.position.z + hz * maxDist;
        }
      }
      pts.push({ x: px, z: pz });
    }
    return pts;
  }

  /** ★ 视锥梯形查询：视锥 4 条角点视线投影到 y=0 → 凸梯形 → 行扫描区间（无界）
   *   ⚠ 踩坑记录：
   *   ① dir 必须归一化再乘 t（未归一 → 投影点上万单位外 → 迭代爆炸卡死）
   *   ② 上边界视线指向天空（t<0）时不能把投影点钳到相机位置——
   *      那会让四边形退化成三角形（相机+两个近处地面点），只覆盖近处，
   *      中远距离实体全部漏遍历。正确做法：上视线用【水平方向延伸 maxDist】
   *      的远处地面点（地面可见区由 far 距离截断）
   *   ③ 扫描范围钳到相机 ±2×maxDist（防投影异常迭代爆炸） */
  queryFrustum(camera: THREE.Camera, maxDist = 100): EntityBase[] {
    const pts = this.frustumCorners(camera, maxDist);
    let zMin = Infinity, zMax = -Infinity;
    for (const p of pts) {
      zMin = Math.min(zMin, p.z);
      zMax = Math.max(zMax, p.z);
    }
    // ★ 防御：扫描范围钳到相机 ±2×maxDist（防任何投影异常导致迭代爆炸）
    zMin = Math.max(zMin, camera.position.z - maxDist * 2);
    zMax = Math.min(zMax, camera.position.z + maxDist * 2);
    const out: EntityBase[] = [];
    const seen = new Set<EntityBase>();
    for (let cz = Math.floor(zMin); cz <= Math.ceil(zMax); cz++) {
      const z = cz + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a.z <= z && b.z >= z) || (a.z >= z && b.z <= z)) {
          const t = (z - a.z) / (b.z - a.z);
          xs.push(a.x + (b.x - a.x) * t);
        }
      }
      if (xs.length < 2) continue;
      const x0 = Math.floor(Math.min(xs[0], xs[1]));
      const x1 = Math.ceil(Math.max(xs[0], xs[1]));
      for (let cx = x0; cx <= x1; cx++) {
        const set = this.cells.get(cellKeyOf(cx, cz));
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
