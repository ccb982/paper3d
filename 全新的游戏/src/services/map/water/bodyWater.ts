// ============================================================
// bodyWater —— ★ 水体级水面几何（2026-10-27 架构收敛 P2）
// ============================================================
// ★ 为什么要重做（用户定调）：
//   ① 「求解器各自算唇 这个直接删了」—— 水位不再是求解器的产物，
//      而是**水体（body）的属性**：body.L = min(0, 各水块与陆地交界的岸高)。
//      求解器退化成纯粹的执行者：给定水位 + 水块集合 → 出几何。
//   ② 「水怎么还是按 chunk 存的」—— 水面几何改**按 body 存**：
//      一个 body = 一个 mesh（跨 chunk，世界坐标），不再按 chunk 切。
//
// ★ 水位来源（删掉探针/唇）：
//   岸高 = 水块 4 邻方向上**陆地**的地形高度（块精度，登记时就算好）
//   body.L = min(0, 所有岸高)   ← 「取最body内小高度」
//   ⇒ 同一 body 内所有水面高度**天然一致**，不需要任何事后拉平。
// ============================================================

import { WATER_MAX_DEEP, WATER_Y_EPS } from '../WaterSurface';
import type { WaterSurfaceRaw } from '../WaterSurface';

/** 水体几何生成的输入 */
export interface BodyWaterInput {
  /** 成员水块（世界 4m 块 key；编码 = (bx+4096)*8192 + (bz+4096)） */
  blocks: Iterable<number>;
  /** ★ 水位（body 唯一水位） */
  level: number;
  /** 池底高度（世界 y） */
  bedAt: (bx: number, bz: number) => number;
  /** 该块是否贴岸（贴岸 ⇒ 顶点钉死，不参与 FFT 位移，防岸线翘边） */
  isEdge: (bx: number, bz: number) => boolean;
  /** ★ 细分档：1 = 每块 1m 网格（近景）；4 = 每块一张 quad（远景） */
  step: 1 | 4;
}

/** 块 key → 世界块坐标 */
export function blockKeyToXZ(k: number): { bx: number; bz: number } {
  return { bx: Math.floor(k / 8192) - 4096, bz: (k % 8192) - 4096 };
}

/**
 * 生成**水体级**水面几何（世界坐标；一个 body 一份）。
 * @param inp 输入（水位 + 水块 + 池底 + 贴岸判定 + 细分档）
 */
export function buildBodyWater(inp: BodyWaterInput): WaterSurfaceRaw {
  const verts: number[] = [];
  const nors: number[] = [];
  const uvs: number[] = [];
  const deps: number[] = [];
  const borders: number[] = [];
  const idx: number[] = [];
  const y = inp.level - WATER_Y_EPS;      // ★ 水面基准下沉（避免与 y=0 地块共面 z-fighting）
  const S = inp.step;                    // 细分档（米）

  for (const bk of inp.blocks) {
    const { bx, bz } = blockKeyToXZ(bk);
    const x0 = bx * 4, z0 = bz * 4, x1 = x0 + 4, z1 = z0 + 4;
    const bed = inp.bedAt(bx, bz);
    const deep = Math.min(Math.max(inp.level - bed, 0), WATER_MAX_DEEP);
    const edge = inp.isEdge(bx, bz) ? 1 : 0;
    const base = verts.length / 3;

    if (S === 4) {
      // 远景：每块一张 quad
      verts.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      for (let k = 0; k < 4; k++) { nors.push(0, 1, 0); uvs.push(x0, z0); deps.push(deep); borders.push(edge); }
      idx.push(base, base + 3, base + 2, base, base + 2, base + 1);
    } else {
      // 近景：每块 1m 网格（4×4 quad）
      for (let iz = 0; iz < 4; iz++) {
        for (let ix = 0; ix < 4; ix++) {
          const ax = x0 + ix, az = z0 + iz;
          const b = verts.length / 3;
          verts.push(ax, y, az, ax + 1, y, az, ax + 1, y, az + 1, ax, y, az + 1);
          for (let k = 0; k < 4; k++) { nors.push(0, 1, 0); uvs.push(ax, az); deps.push(deep); borders.push(edge); }
          idx.push(b, b + 3, b + 2, b, b + 2, b + 1);
        }
      }
    }
  }

  return {
    vertices: new Float32Array(verts),
    normals: new Float32Array(nors),
    uvs: new Float32Array(uvs),
    deep: new Float32Array(deps),
    border: new Float32Array(borders),
    spin: new Float32Array((verts.length / 3) * 2),
    indices: new Uint32Array(idx),
    quads: idx.length / 6,
    // ★ levelIsForced = true：body 级几何的水位就是 body.L，**不是**求解器算的唇
    //   ⇒ 主线程不会把它当"唇候选"回灌 ⇒ 不会污染 body.L 的汇总。
    level: inp.level,
    levelIsForced: true,
  };
}
