// ============================================================
// Boss4DArena —— 【保留·最终 Boss 战地图】四维空间专用地形网格构建器
// ============================================================
// ★ 来源：2026-08-25 主地图"高台侧壁"重构。该方案在主地图上视觉失败
//   （纯几何台阶 + 透视拉伸 + 贴面穿插），但失败特征恰好契合最终 Boss 战
//   的"四维空间"主题，转正为 Boss 专用构建器——最终决战就在这里打。
// ★ 外观纹理 = bakeChunkAppearance 的 BOSS4D_BAKE 参数档（双尺度AO+日照投影），
//   与主地图共用同一烘焙器实现，无拷贝漂移。
//
// 视觉特征（刻意保留 = 四维空间主题的一部分）：
//   - 每米格独立平面 → 纯粹几何拼接感
//   - 垂直侧壁顶点色（tile 调色板 × 落差加深）→ 与顶面颜色断裂
//   - 无任何裙边过渡 → 高低差处生硬错切、贴图透视错乱、可穿模观察
//
// ★★ 虚空地块（2026-08-26）：isBoss4DVoidChunk 命中的 chunk 只建物理不建
//   视觉——复刻早期"chunk 有碰撞体无纹理、角色站虚空"的 bug 并将其主题化：
//   四维空间的一部分地面"不存在"，小地图照常显示（空间在骗你），
//   踩上去之前无从分辨。确定性 hash 选块 → 同一天内重建结果一致。
//
// 启用方式：Boss 模式调用 buildBoss4DChunk() / buildBoss4DChunkPhysics()
//   生成 Group(+物理 trismesh) 或纯物理 trimesh。
//   同步构建路径（不走 Worker 烘焙管线）；主地图勿用。
// ============================================================

import * as THREE from 'three';
import { CHUNK_SIZE } from './ChunkGenerator';
import { hsl2rgb } from './TerrainPalette';
import { bakeChunkAppearance, BOSS4D_BAKE } from './ChunkAppearance';
import type { PlannedDecal } from './decor/TileDecalBase';
import { hash2 } from './TerrainNoise';
import type { RasterMap } from './RasterMap';

export interface Boss4DChunkBuild {
  /** 已装配好的视觉网格（含外观顶面 + 侧壁；调用方 add 到场景并定位） */
  group: THREE.Group;
  /** 物理碰撞数据（顶面+侧壁合并 trimesh；调用方创建 fixed 刚体） */
  trimeshVertices: Float32Array;
  trimeshIndices: Uint32Array;
}

export interface Boss4DChunkPhysics {
  /** 物理碰撞数据（与可见 chunk 同一套几何，保证脚下手感一致） */
  trimeshVertices: Float32Array;
  trimeshIndices: Uint32Array;
}

// ============================================================
// 共享几何生成（视觉路径与纯物理路径单一事实来源）
// ============================================================

/** 米格高度场采样（N×N，取格中心 raw 高度） */
function sampleHeightField(raster: RasterMap, cx: number, cz: number): Float32Array {
  const N = CHUNK_SIZE;
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      H[j * N + i] = raster.heightAt(cx * N + i + 0.5, cz * N + j + 0.5);
    }
  }
  return H;
}

/** 顶面几何数据（相对 chunk 角；每格独立平面） */
function topSurfaceData(H: Float32Array): {
  tPos: Float32Array; tUv: Float32Array; tNor: Float32Array; tIdx: Uint32Array;
} {
  const N = CHUNK_SIZE;
  const tPos = new Float32Array(N * N * 12);
  const tUv = new Float32Array(N * N * 8);
  const tNor = new Float32Array(N * N * 12);
  const tIdx = new Uint32Array(N * N * 6);
  let tv = 0, ti = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const h = H[j * N + i];
      tPos.set([i, h, j, i + 1, h, j, i, h, j + 1, i + 1, h, j + 1], tv * 3);
      tUv.set([i / N, j / N, (i + 1) / N, j / N, i / N, (j + 1) / N, (i + 1) / N, (j + 1) / N], tv * 2);
      for (let k = 0; k < 4; k++) tNor.set([0, 1, 0], (tv + k) * 3);
      const a = tv, b = tv + 1, c = tv + 2, d = tv + 3;
      tIdx[ti++] = a; tIdx[ti++] = b; tIdx[ti++] = d;
      tIdx[ti++] = b; tIdx[ti++] = c; tIdx[ti++] = d;
      tv += 4;
    }
  }
  return { tPos, tUv, tNor, tIdx };
}

/** 侧壁几何数据（相对 chunk 角；相邻格高差 → 1m 宽垂直墙，绕序已推导法线朝低处外；
 *  颜色仅视觉路径消费，纯物理路径忽略之） */
function wallSurfaceData(raster: RasterMap, cx: number, cz: number, H: Float32Array): {
  wPos: number[]; wNor: number[]; wCol: number[]; wIdx: number[];
} {
  const N = CHUNK_SIZE;
  const wPos: number[] = [];
  const wNor: number[] = [];
  const wCol: number[] = [];
  const wIdx: number[] = [];
  let wVi = 0;
  const EPS = 0.05;
  const DIRS = [
    { dx: 1, dz: 0, ax: 1, az: 0, bx: 1, bz: 1 },
    { dx: -1, dz: 0, ax: 0, az: 1, bx: 0, bz: 0 },
    { dx: 0, dz: 1, ax: 1, az: 1, bx: 0, bz: 1 },
    { dx: 0, dz: -1, ax: 0, az: 0, bx: 1, bz: 0 },
  ];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const hCur = H[j * N + i];
      for (const dir of DIRS) {
        const ni = i + dir.dx, nj = j + dir.dz;
        const hNb = (ni >= 0 && ni < N && nj >= 0 && nj < N)
          ? H[nj * N + ni]
          : raster.heightAt(cx * N + ni + 0.5, cz * N + nj + 0.5);
        if (hCur - hNb <= EPS) continue;
        const xA = i + dir.ax, zA = j + dir.az;
        const xB = i + dir.bx, zB = j + dir.bz;
        const yT = hCur, yB = hNb - EPS;
        // 颜色：tile 底色(0~255) → 归一化 × 落差加深（直接塞 0~255 会被钳成纯白——踩过坑）
        const td = raster.tileDefAt(
          cx * N + i + 0.5 + dir.dx * 0.5,
          cz * N + j + 0.5 + dir.dz * 0.5,
        );
        let [r, g, b] = hsl2rgb(td.visual.baseHsl.h, td.visual.baseHsl.s, td.visual.baseHsl.l);
        const k = (0.42 + Math.min(1, (hCur - hNb) / 4) * 0.22) / 255;
        wPos.push(xA, yT, zA, xB, yT, zB, xB, yB, zB, xA, yB, zA);
        for (let c = 0; c < 4; c++) { wNor.push(dir.dx, 0, dir.dz); wCol.push(r * k, g * k, b * k); }
        wIdx.push(wVi, wVi + 2, wVi + 3, wVi, wVi + 1, wVi + 2);
        wVi += 4;
      }
    }
  }
  return { wPos, wNor, wCol, wIdx };
}

/** 顶面+侧壁合并为物理 trimesh（索引按顶面顶点数偏移） */
function mergePhysicsTrimesh(
  tPos: Float32Array, tIdx: Uint32Array, wPos: number[], wIdx: number[],
): { trimeshVertices: Float32Array; trimeshIndices: Uint32Array } {
  const trimeshVertices = new Float32Array(tPos.length + wPos.length);
  trimeshVertices.set(tPos, 0);
  trimeshVertices.set(wPos, tPos.length);
  const vOff = tPos.length / 3;
  const trimeshIndices = new Uint32Array(tIdx.length + wIdx.length);
  trimeshIndices.set(tIdx, 0);
  for (let k = 0; k < wIdx.length; k++) trimeshIndices[tIdx.length + k] = wIdx[k] + vOff;
  return { trimeshVertices, trimeshIndices };
}

// ============================================================
// 公共构建入口
// ============================================================

/**
 * 构建一个 Boss 四维空间 chunk：米格独立顶面 + 高差垂直侧壁。
 * @param decals 装饰贴图计划（预渲染前放置完成 → 印进外观纹理）
 * @param group.position 已设为 chunk 角 (cx*CHUNK_SIZE, 0, cz*CHUNK_SIZE)
 */
export function buildBoss4DChunk(
  raster: RasterMap, cx: number, cz: number,
  decals?: PlannedDecal[],
): Boss4DChunkBuild {
  const H = sampleHeightField(raster, cx, cz);
  const { tPos, tUv, tNor, tIdx } = topSurfaceData(H);

  // ---- ① 顶面网格（Boss4D 外观材质）----
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  topGeo.setAttribute('uv', new THREE.BufferAttribute(tUv, 2));
  topGeo.setAttribute('normal', new THREE.BufferAttribute(tNor, 3));
  topGeo.setIndex(new THREE.BufferAttribute(tIdx, 1));

  // ---- ② 侧壁网格 ----
  const { wPos, wNor, wCol, wIdx } = wallSurfaceData(raster, cx, cz, H);

  // ---- Group 组装 ----
  const group = new THREE.Group();
  group.position.set(cx * CHUNK_SIZE, 0, cz * CHUNK_SIZE);

  const mapTex = bakeChunkAppearance(raster, cx, cz, BOSS4D_BAKE, decals);
  const topMat = new THREE.MeshStandardMaterial({ map: mapTex, roughness: 0.95, metalness: 0 });
  const topMesh = new THREE.Mesh(topGeo, topMat);
  group.add(topMesh);

  if (wIdx.length > 0) {
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
    wallGeo.setAttribute('normal', new THREE.Float32BufferAttribute(wNor, 3));
    wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(wCol, 3));
    wallGeo.setIndex(wIdx);
    const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    group.add(wallMesh);
  }

  // ---- 物理 trimesh 合并 ----
  const { trimeshVertices, trimeshIndices } = mergePhysicsTrimesh(tPos, tIdx, wPos, wIdx);
  return { group, trimeshVertices, trimeshIndices };
}

/**
 * 纯物理构建（虚空地块专用）：跳过烘焙与全部视觉资源，
 * 碰撞数据与可见 chunk 同一套几何生成——脚下手感完全一致。
 */
export function buildBoss4DChunkPhysics(raster: RasterMap, cx: number, cz: number): Boss4DChunkPhysics {
  const H = sampleHeightField(raster, cx, cz);
  const { tPos, tIdx } = topSurfaceData(H);
  const { wPos, wIdx } = wallSurfaceData(raster, cx, cz, H);
  return mergePhysicsTrimesh(tPos, tIdx, wPos, wIdx);
}

// ============================================================
// 虚空地块判定
// ============================================================

/** 虚空地块占比（约 1/5 的 chunk 不可见但有碰撞） */
export const BOSS4D_VOID_RATIO = 0.18;

/**
 * 判定某 chunk 是否为四维空间虚空地块（只建物理不建视觉）。
 * 确定性：同 seed 同坐标恒返回同值 → 流式重建/风格切换往返结果一致。
 * seed 与地形 hash 用异或盐解耦，避免虚空分布与地块类型布局相关。
 */
export function isBoss4DVoidChunk(seed: number, cx: number, cz: number): boolean {
  // 出生区 3×3 永不虚空（出生点/初始敌人/测试物品都落在这里）
  if (cx >= -1 && cx <= 1 && cz >= -1 && cz <= 1) return false;
  return hash2(cx * 2 + 7, cz * 2 - 3, (seed ^ 0x5f4d) | 0) < BOSS4D_VOID_RATIO;
}
