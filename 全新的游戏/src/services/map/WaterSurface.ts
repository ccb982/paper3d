// ============================================================
// WaterSurface —— 水体管线：静止基面几何（共享纯函数，Worker/主线程同源）
// ============================================================
// 语义（《水体管线架构.md》§2.1/§3.1）：
//   · 水位恒定世界 y=0（用户定调）。只在地形表定型后读一次 FaceTable：
//       水 mask = cell.topTileId === TILE_WATER.id
//       水深   = 0 − 地形顶高（cell.h，负）
//       坑水交界 = 水 cell 邻 pit → 沿共享边下落水帘（唇沿=壁顶 topEdgeY，帘底=坑底 hBase）
//   · 几何随地形 chunk 一体装配，渲染期由 WaterMaterial 做 LOD/动画。
//   · 顶点为 chunk 局部坐标（与顶面同约定 lx − HALF，原点=chunk 中心）。
// 本文件不 import three —— Worker 依赖最小（与 PatchCompute 同哲学）。
// ============================================================

import { BLOCKS_PER_SIDE, CHUNK_SIZE } from "./ChunkGenerator";
import { TILE_PIT, TILE_WATER } from "./Tiles";
import type { FaceTable } from "./FaceTable";
import type { BlockSource } from "./Refinements";

const BPS = BLOCKS_PER_SIDE; // 15
const N = CHUNK_SIZE;        // 60
const HALF = CHUNK_SIZE / 2; // 30（几何局部坐标中心化，与 FaceBuild 同约定）
/** 水深钳制上限（着色器归一用；m） */
export const WATER_MAX_DEEP = 6;
/** 水帘贴墙内收（m，避坑侧壁 z-fight） */
const FALL_INSET = 0.05;
/** 水帘最小落差（m；过浅不生成） */
const FALL_MIN = 0.2;
/** 平面剔除容差：水块地形顶高于 0+ε 视为干地，不铺水面 */
const PLANE_Y_EPS = 0.05;

/** 水顶点方向常量 */
const DIR4 = [
  { dx: 1, dz: 0 },
  { dx: -1, dz: 0 },
  { dx: 0, dz: 1 },
  { dx: 0, dz: -1 },
] as const;
/** 各向期望外法线（WaterSurface 产出；顶点序反推用） */
const DIR_NORMALS: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
];

export interface WaterSurfaceRaw {
  vertices: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** 逐顶点：平面 = 水深（0..WATER_MAX_DEEP）；水帘 = -1 哨兵（顶点 shader 识别，唇沿跟随水面波） */
  deep: Float32Array;
  /** 逐顶点旋转参数(angularSpeed, phase)：标准水全 0；boss4D 水幕 = 4D 自转/漂浮 */
  spin: Float32Array;
  indices: Uint32Array;
  /** 诊断：平面 quad 数 + 水帘 quad 数 */
  quads: number;
}

/**
 * 给定 chunk 表 → 静止基面几何字节（局部坐标；无水位/起伏，起伏由 shader 做）。
 * @param table  该 chunk 的 FaceTable（Pass1 已定型：topTileId/h）
 * @param src    邻域源（跨 chunk 边判 pit 邻接用）
 */
export function buildWaterSurface(table: FaceTable, src: BlockSource): WaterSurfaceRaw {
  const { cx, cz } = table;
  const verts: number[] = [];
  const nors: number[] = [];
  const uvs: number[] = [];
  const deps: number[] = [];
  const idx: number[] = [];
  let quads = 0;

  // ---- ① 水面平面（1m coarse 格，只铺水块；贴地形 coarse 网格同位） ----
  for (let lz = 0; lz < N; lz++) {
    for (let lx = 0; lx < N; lx++) {
      const lbx = lx >> 2;      // 4m 块内局部列
      const lbz = lz >> 2;
      const cell = table.cells[lbz * BPS + lbx];
      if (cell.topTileId !== TILE_WATER.id) continue;
      const depth = 0 - cell.h;
      if (depth < -PLANE_Y_EPS) continue; // 干地防穿面
      const d = Math.min(Math.max(depth, 0), WATER_MAX_DEEP);
      const x0 = lx - HALF, z0 = lz - HALF;
      const vi = verts.length / 3;
      verts.push(x0, 0, z0, x0 + 1, 0, z0, x0 + 1, 0, z0 + 1, x0, 0, z0 + 1);
      nors.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      uvs.push(lx / N, lz / N, (lx + 1) / N, lz / N, (lx + 1) / N, (lz + 1) / N, lx / N, (lz + 1) / N);
      deps.push(d, d, d, d);
      idx.push(vi, vi + 3, vi + 1, vi + 3, vi + 2, vi + 1);
      quads++;
    }
  }

  // ---- ② 坑水交界 —— 下落水帘（水块沿 pit 邻边，y=0 → pit 底） ----
  for (let lbz = 0; lbz < BPS; lbz++) {
    for (let lbx = 0; lbx < BPS; lbx++) {
      const cell = table.cells[lbz * BPS + lbx];
      if (cell.topTileId !== TILE_WATER.id) continue;
      const bx = cx * BPS + lbx;
      const bz = cz * BPS + lbz;
      const x0 = lbx * 4 - HALF, x1 = lbx * 4 + 4 - HALF;
      const z0 = lbz * 4 - HALF, z1 = lbz * 4 + 4 - HALF;
      for (let dir = 0; dir < 4; dir++) {
        const n = src.blockAt(bx + DIR4[dir].dx, bz + DIR4[dir].dz);
        if (!n || n.id !== TILE_PIT.id) continue;
        const botY = n.hBase ?? n.h;     // 帘底 = 坑块底板（实测约 -3.65，与侧壁 minY 一致）
        const lipY = 0;           // 唇沿 = 接壤水的实际水位（全局恒定 0，用户定调；不跟地形壁顶走）
        const fallLen = lipY - botY;
        if (fallLen < FALL_MIN) continue; // 落差过浅不生成
        // 四角（顶点序 [a bottom-start, b top-start, c top-end, d bottom-end]；统一 [x, 高度, z]）
        let pts: [number, number, number][];
        if (dir === 0)   pts = [[x1 + FALL_INSET, botY, z0], [x1 + FALL_INSET, lipY, z0], [x1 + FALL_INSET, lipY, z1], [x1 + FALL_INSET, botY, z1]];
        else if (dir === 1) pts = [[x0 - FALL_INSET, botY, z1], [x0 - FALL_INSET, lipY, z1], [x0 - FALL_INSET, lipY, z0], [x0 - FALL_INSET, botY, z0]];
        else if (dir === 2) pts = [[x1, botY, z1 + FALL_INSET], [x1, lipY, z1 + FALL_INSET], [x0, lipY, z1 + FALL_INSET], [x0, botY, z1 + FALL_INSET]];
        else                pts = [[x0, botY, z0 - FALL_INSET], [x0, lipY, z0 - FALL_INSET], [x1, lipY, z0 - FALL_INSET], [x1, botY, z0 - FALL_INSET]];
        const want = DIR_NORMALS[dir];
        // 校验/修正绕序：外法线 = cross(b−a, c−a)；不符则翻面
        const ax = pts[0][0], az = pts[0][2];
        const dx1 = pts[1][0] - ax, dy1 = pts[1][1] - pts[0][1], dz1 = pts[1][2] - az;
        const dx2 = pts[2][0] - ax, dy2 = pts[2][1] - pts[0][1], dz2 = pts[2][2] - az;
        const nx = dy1 * dz2 - dz1 * dy2;
        const ny = dz1 * dx2 - dx1 * dz2;
        const nz = dx1 * dy2 - dy1 * dx2;
        const flip =
          (nx * want[0] + ny * want[1] + nz * want[2]) < 0;
        if (flip) pts = [pts[0], pts[3], pts[2], pts[1]]; // 翻转绕序（a,d,c,b）
        const vi = verts.length / 3;
        for (let k = 0; k < 4; k++) {
          const [px, py, pz] = pts[k];
          verts.push(px, py, pz);
          nors.push(want[0], want[1], want[2]);
          // uv：x = 沿帘切线 0..1；y = 落差 0(唇)..1(坑底)
          const u = dir === 0 || dir === 1 ? (pz - z0) / 4 : (px - x0) / 4;
          uvs.push(u, (lipY - py) / fallLen);
          deps.push(-1);
        }
        idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
        quads++;
      }
    }
  }

  return {
    vertices: Float32Array.from(verts),
    normals: Float32Array.from(nors),
    uvs: Float32Array.from(uvs),
    deep: Float32Array.from(deps),
    spin: new Float32Array((verts.length / 3) * 2), // 标准水静止 → 旋速/相位全 0
    indices: Uint32Array.from(idx),
    quads,
  };
}