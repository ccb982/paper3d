// ============================================================
// MinimapWarmup —— 小地图 / 大地图【开局预加载】
// ============================================================
// 背景（2026-09-15 性能复盘）：
//   进世界首帧 / 停靠 / 打坑的"瞬时卡"里，小地图的**首次全量绘制**是最大单项——
//     · reveal()     全扫 (2r+1)² = 32,761 格做 Map 读写  → 实测 27.7ms
//     · rebuildBase() 逐像素 160² = 25,600 次取色 + 雾判定 → 数 ms
//     · ensureBandIdx LOD 边带索引 25,600 次 hypot
//   三者都是**纯函数**：
//     · 探索圆盘 = 出生格 ± viewRadius 的整数格集合（与地形数据无关）
//     · 地形颜色 = f(seed, x, z)（RasterMap.mapTileAt 只读 blockTypes，
//       而 blockTypes 是 generateChunk 的纯输出、运行时**从不被修改**——
//       挖坑改的是 levels，不参与地图取色）
//   而抽卡页就已经知道全部输入：dailyMapSeed(seed, day) + 出生格 (30,30) + 常量窗口。
//   → 在抽卡页把这三样算好，进世界时直接交接，"开局点亮"零成本。
//
// 交接语义：
//   · consumeMinimapWarmup() 返回**独立副本**（稠密位图 32KB 拷贝 + 底图 100KB 拷贝，
//     合计 ≈0.03ms），因此同一份预热数据可服务多次进世界（停靠→出舱→再停靠）。
//   · 任何不匹配（种子 / 尺寸 / 窗口 / 半径 / 未就绪）→ 返回 null，调用方走冷路径。
//     **预热只是加速，绝不参与正确性**。
//
// 与渲染层的一致性契约（改任一常量必须同步）：
//   MINIMAP_SIZE / MINIMAP_WINDOW_HALF / MINIMAP_VIEW_RADIUS / LOD_BAND /
//   MAP_SPAWN_X / MAP_SPAWN_Z —— 本文件为唯一来源，Minimap / WorldMode 从这里取。
// ============================================================

import type { GameSession } from '../../core/Session';
import { dailyMapSeed } from '../../core/Session';
import { generateChunk, CHUNK_SIZE, BLOCK_SIZE, BLOCKS_PER_SIDE } from '../map/ChunkGenerator';
import { tileById } from '../map/Tiles';
import { getTestPreset } from '../map/TerrainPresets';
import { ExploredMask } from '../map/ExploredMask';
import { chunkKeyOf } from '../map/RasterMap';
import { LOD_MAX_DIST } from '../lod';

// ============ 共享常量（渲染层唯一来源） ============

/** 小地图画布边长（像素；1 像素 = 1 米） */
export const MINIMAP_SIZE = 160;
/** 小地图窗口半宽（米）—— 窗口 = 玩家 ± windowHalf */
export const MINIMAP_WINDOW_HALF = 80;
/** 开雾（探索点亮）半径（米）= LOD 消失距离 */
export const MINIMAP_VIEW_RADIUS = LOD_MAX_DIST;
/** LOD 圈"点亮边带"半宽（米）：覆盖跨格位移 + reveal 浮点/量化中心偏差（±~0.7m） */
export const LOD_BAND = 4.0;

/** ★ 每次出击固定出生格（WorldMode.enter 固定 chunk(0,0) → 舰船与角色都从 (30,30) 出发） */
export const MAP_SPAWN_X = 30;
export const MAP_SPAWN_Z = 30;

// ============ LOD 边带索引（Minimap / 预热共用） ============

/**
 * ★ LOD 圈边带像素索引（静态预计算）
 *
 * 推导：`Minimap.rebuildBase` 的 px/pz 恒为玩家格中心 (cx+0.5, cz+0.5)，
 * 而 x0 = floor(px − windowHalf) = cx − windowHalf（windowHalf 为整数），
 * 于是 ddx = x0 + ix + 0.5 − px = ix − windowHalf，与调用无关 → 距离表是常量。
 *
 * @returns windowHalf 非整数时返回 null（调用方回退逐像素原作法，保正确性）
 */
export function buildBandIdx(
  size: number, windowHalf: number, radius: number, band: number,
): Uint32Array | null {
  if (!Number.isInteger(windowHalf)) return null;
  const list: number[] = [];
  const lo = radius - band;
  const hi = radius + band;
  const hiSq = hi * hi;
  for (let iy = 0; iy < size; iy++) {
    const dy = iy - windowHalf;
    const dySq = dy * dy;
    if (dySq > hiSq) continue;
    for (let ix = 0; ix < size; ix++) {
      const dx = ix - windowHalf;
      const d = Math.sqrt(dx * dx + dySq);
      if (d > lo && d < hi) list.push(iy * size + ix);
    }
  }
  return Uint32Array.from(list);
}

// ============ 预热数据 ============

export interface MinimapWarmData {
  seed: number;
  size: number;
  windowHalf: number;
  radius: number;
  /** 窗口中心所在玩家格（= 出生格） */
  cellX: number;
  cellZ: number;
  /** 稠密探索区（独立副本，可被实例随意写） */
  mask: ExploredMask;
  /** 底图像素 size*size*4（已含探索雾 + LOD 挖孔），origin = (baseOX, baseOZ) */
  baseImg: Uint8ClampedArray;
  baseOX: number;
  baseOZ: number;
  /** LOD 边带像素索引 */
  bandIdx: Uint32Array | null;
}

interface WarmBuild {
  seed: number;
  size: number;
  windowHalf: number;
  radius: number;
  cellX: number;
  cellZ: number;
  mask: ExploredMask | null;
  baseImg: Uint8ClampedArray | null;
  baseOX: number;
  baseOZ: number;
  bandIdx: Uint32Array | null;
  ready: boolean;
}

let build: WarmBuild | null = null;
/** 构建代号（换代/清空时 +1，作废在途分帧任务） */
let generation = 0;
/** 上次被禁用的原因（仅调试可见） */
let disabled = false;
/** 预热被成功交接的次数（调试/验证用） */
let consumedCount = 0;

// ---- 分帧调度（一次一个 chunk，避免抽卡页出现长任务） ----

const schedule = ((): ((cb: () => void) => void) => {
  const g = globalThis as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  };
  if (typeof g.requestIdleCallback === 'function') {
    const ric = g.requestIdleCallback.bind(g);
    return (cb) => { ric(cb, { timeout: 60 }); };
  }
  return (cb) => { setTimeout(cb, 0); };
})();

/** 单 chunk 内的地图索引（与 RasterMap.mapTileAt 同算法：block 4m / 15 块一边） */
function recordIndexOf(x: number, z: number, cx: number, cz: number): number {
  const bx = Math.floor((x - cx * CHUNK_SIZE) / BLOCK_SIZE);
  const bz = Math.floor((z - cz * CHUNK_SIZE) / BLOCK_SIZE);
  return bz * BLOCKS_PER_SIDE + bx;
}

// ============================================================
// 对外 API
// ============================================================

/**
 * ★ 抽卡页调用：为"当天地图 + 出生格"预热小地图数据。
 *
 * 幂等（同种子重复调用直接返回）；换局换天（种子变）自动换代重建；
 * 分帧执行（每 tick 只生成 1 列 chunk），不会在抽卡页制造长任务。
 */
export function warmupMinimap(session: GameSession): void {
  const seed = dailyMapSeed(session.meta.seed, session.meta.day);
  if (getTestPreset() !== null) {
    // 测试预设会改变 generateChunk 输出 → 预热结果不可信，本次不建
    disabled = true;
    build = null;
    generation++;
    return;
  }
  disabled = false;
  if (build && build.seed === seed && (build.ready || build.mask)) return; // 已在建 / 已就绪

  const size = MINIMAP_SIZE;
  const windowHalf = MINIMAP_WINDOW_HALF;
  const radius = MINIMAP_VIEW_RADIUS;
  const cellX = MAP_SPAWN_X;
  const cellZ = MAP_SPAWN_Z;
  const cxCenter = cellX + 0.5;
  const czCenter = cellZ + 0.5;
  const x0 = Math.floor(cxCenter - windowHalf);
  const z0 = Math.floor(czCenter - windowHalf);

  build = {
    seed, size, windowHalf, radius, cellX, cellZ,
    mask: null, baseImg: null, baseOX: x0, baseOZ: z0,
    bandIdx: null, ready: false,
  };
  const gen = ++generation;

  const cxA = Math.floor(x0 / CHUNK_SIZE);
  const cxB = Math.floor((x0 + size - 1) / CHUNK_SIZE);
  const czA = Math.floor(z0 / CHUNK_SIZE);
  const czB = Math.floor((z0 + size - 1) / CHUNK_SIZE);
  const recs = new Map<number, Uint8Array>();

  // ③ LOD 边带索引
  const stepBandIdx = (): void => {
    const b = build;
    if (gen !== generation || !b) return;
    b.bandIdx = buildBandIdx(size, windowHalf, MINIMAP_VIEW_RADIUS, LOD_BAND);
    b.ready = true;
  };

  // ② 底图（地形色 + 探索雾 + LOD 挖孔）——与 Minimap.rebuildBase 首帧逐像素等价
  const stepBaseImg = (): void => {
    const b = build;
    if (gen !== generation || !b || !b.mask) return;
    const img = new Uint8ClampedArray(size * size * 4);
    const mask = b.mask;
    const MIST_R = 64, MIST_G = 66, MIST_B = 72, MIST_S = 0.85;
    const rSq = MINIMAP_VIEW_RADIUS * MINIMAP_VIEW_RADIUS;
    const flatPacked = tileById(0).packedRgb;
    let i = 0;
    for (let iy = 0; iy < size; iy++) {
      const wz = z0 + iy;
      const ddz = wz + 0.5 - czCenter;
      const ddzSq = ddz * ddz;
      const ccz = Math.floor(wz / CHUNK_SIZE);
      for (let ix = 0; ix < size; ix++, i += 4) {
        const wx = x0 + ix;
        if (mask.has(wx, wz)) {
          const ccx = Math.floor(wx / CHUNK_SIZE);
          const rec = recs.get(chunkKeyOf(ccx, ccz));
          const packed = rec ? tileById(rec[recordIndexOf(wx, wz, ccx, ccz)]).packedRgb : flatPacked;
          let r = (packed >> 16) & 255;
          let g = (packed >> 8) & 255;
          let bl = packed & 255;
          const ddx = wx + 0.5 - cxCenter;
          if (ddx * ddx + ddzSq > rSq) {
            r += (MIST_R - r) * MIST_S;
            g += (MIST_G - g) * MIST_S;
            bl += (MIST_B - bl) * MIST_S;
          }
          img[i] = r; img[i + 1] = g; img[i + 2] = bl;
        } else {
          img[i] = 4; img[i + 1] = 4; img[i + 2] = 8;
        }
        img[i + 3] = 255;
      }
    }
    b.baseImg = img;
    schedule(stepBandIdx);
  };

  // ① 探索圆盘（稠密位图；判定与 Minimap.markDisk 全量分支逐格一致）
  //   ★ 圆心恒为 (cellX+0.5, cellZ+0.5)：Minimap.adoptWarm 会把 lastRevealP 落在
  //     同一圆心 → 后续增量环带 (r−d, r] 从它量起，与预热点亮的区域严丝合缝。
  const stepDisk = (): void => {
    const b = build;
    if (gen !== generation || !b) return;
    const d = radius;
    const w = 2 * d + 1;
    const mask = new ExploredMask(cellX - d, cellZ - d, w, w);
    const rSq = d * d;
    for (let z = cellZ - d; z <= cellZ + d; z++) {
      const dz = z + 0.5 - czCenter;
      const dzSq = dz * dz;
      if (dzSq > rSq) continue;
      for (let x = cellX - d; x <= cellX + d; x++) {
        const dx = x + 0.5 - cxCenter;
        if (dx * dx + dzSq <= rSq) mask.mark(x, z);
      }
    }
    b.mask = mask;
    schedule(stepBaseImg);
  };

  // 先逐列生成 chunk 记录（每 tick 一列），再盘 → 底图 → 边带索引
  const stepChunks = (ci: number): void => {
    const b = build;
    if (gen !== generation || !b) return;
    if (ci > cxB) { stepDisk(); return; }
    for (let cz = czA; cz <= czB; cz++) {
      recs.set(chunkKeyOf(ci, cz), generateChunk(seed, ci, cz).blockTypes);
    }
    schedule(() => stepChunks(ci + 1));
  };

  schedule(() => stepChunks(cxA));
}

/**
 * ★ 进世界时调用：取一份**独立副本**的预热数据。
 * 任何不匹配（种子 / 尺寸 / 窗口 / 半径 / 未就绪）→ null（调用方走冷路径）。
 */
export function consumeMinimapWarmup(
  seed: number, size: number, windowHalf: number, radius: number,
): MinimapWarmData | null {
  const b = build;
  if (!b || !b.ready || !b.mask || !b.baseImg) return null;
  if (b.seed !== seed || b.size !== size || b.windowHalf !== windowHalf || b.radius !== radius) return null;
  consumedCount++;
  return {
    seed: b.seed, size: b.size, windowHalf: b.windowHalf, radius: b.radius,
    cellX: b.cellX, cellZ: b.cellZ,
    mask: b.mask.clone(),                     // 32KB 位图拷贝 ≈ 0.01ms
    baseImg: new Uint8ClampedArray(b.baseImg), // 100KB 拷贝 ≈ 0.02ms
    baseOX: b.baseOX, baseOZ: b.baseOZ,
    bandIdx: b.bandIdx,
  };
}

/** 清空预热（换局/换天/回基地时调用；在途分帧任务随之作废） */
export function clearMinimapWarmup(): void {
  build = null;
  generation++;
}

/** 预热状态（调试用） */
export function minimapWarmupState(): {
  seed: number | null; ready: boolean; disabled: boolean; consumed: number;
} {
  return { seed: build?.seed ?? null, ready: !!build?.ready, disabled, consumed: consumedCount };
}
