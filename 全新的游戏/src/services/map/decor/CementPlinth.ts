// ============================================================
// CementPlinth —— 水泥高台台座（高台结构件；用户手绘 JSON 定稿 2026-09-06）
// ============================================================
// 语义（《水泥高台上的装饰性实体.json》+ 用户定调）：
//   · 4×4m 整格铺满水泥高台地块（底座与高台顶面完整贴合），
//     顶面收成梯形（上窄下宽，侧视梯形），正置无旋转（地块轴向）；
//   · 顶面中间有一块向下凹陷且保持平面的槽（角色可站进槽内）；
//   · ★ 与墙裙同款"高度查询"：台座带顶进 RasterMap.surfaceHeightAt 叠加层
//     （plinthHeightAt）→ 看得见的台座 = 站得上的台座；
//   · 概率 = 35% 水泥高台块有台座（用户 2026-09-06 定版保留原 perCellProb）；
//   · 物理 = trimesh（与墙裙同管线，host.createGround；非 cuboid 防挤压去
//     穿透抖动——4×4 整格薄盒同地面 trimesh 挤压会穿模，已踩坑）；
//   · 几何复用 MapEntityDecorBase.buildTrapezoidPlinth（顶面带下沉槽的
//     平截四棱台）；共享材质（水泥 0x6f6f6a→被装饰实体共享缓存），
//     decorShared/cached 标记防 chunk 重建释放。
// ============================================================

import * as THREE from 'three';
import { hash2 } from '../TerrainNoise';
import { tileById } from '../Tiles';
import { CHUNK_SIZE } from '../ChunkGenerator';
import { buildTrapezoidPlinth } from './MapEntityDecorBase';

/** 台座形态常量（与 buildTrapezoidPlinth 参数一致） */
const BASE_HALF = 2.0;    // 底座半宽 → 4×4m 整格
const TOP_HALF = 1.5;     // 顶面半宽（梯形上层）
const PLINTH_H = 0.6;     // 台座高
const SLOT_DEPTH = 0.2;   // 顶面下沉槽深
const SLOT_HALF = 0.8;    // 下沉槽半宽
const PLINTH_P = 0.35;    // 水泥高台块出现台座的概率（用户定版）

/** 台座带顶相对基面高度（槽内 = 台面 + 槽深） */
export function plinthTopDelta(lx: number, lz: number): number | null {
  // 块内局部坐标（±BASE_HALF 归一）
  const ax = Math.abs(lx), az = Math.abs(lz);
  // 顶面槽区（x/z 都在槽半宽内）→ 槽底（保持平面）
  if (ax <= SLOT_HALF && az <= SLOT_HALF) return PLINTH_H - SLOT_DEPTH;
  // 梯形内（含斜面投影区）→ 断崖式带顶：台面 + 台座高
  if (Math.max(ax, az) < TOP_HALF) return PLINTH_H;
  // 斜面过渡带：从台面（BASE_HALF 处 = 0）线性升到台面 + 台座高（TOP_HALF 处）
  if (Math.max(ax, az) < BASE_HALF) {
    const d = (BASE_HALF - Math.max(ax, az)) / (BASE_HALF - TOP_HALF);
    return d * PLINTH_H;
  }
  return null; // 块外
}

/** 台座块计划（一棵台座：块坐标 + 基面高度；确定性可复现） */
export interface CementPlinthTile {
  bx: number;   // chunk 局部块坐标 0~14
  bz: number;
  base: number; // 台座基面高度（世界；块中心采样，台座铺满整格）
}

/** 本 chunk 台座计划：遍历 15×15 块，水泥高台 + 哈希 < 0.35 → 台座 */
export function planCementPlinths(
  cx: number, cz: number, seed: number,
  blockTypes: Uint8Array | undefined,
  H: (lx: number, lz: number) => number,
): CementPlinthTile[] | null {
  if (!blockTypes) return null;
  const out: CementPlinthTile[] = [];
  for (let bz = 0; bz < 15; bz++) {
    for (let bx = 0; bx < 15; bx++) {
      if (tileById(blockTypes[bz * 15 + bx]).key !== 'cement_platform') continue;
      if (hash2(cx * 15 + bx, cz * 15 + bz, seed + 0x51E7) >= PLINTH_P) continue;
      // 块中心基面高度（★ 用基面采样，防自反馈；台座铺满整格，块内统一）
      out.push({ bx, bz, base: H(bx * 4 + 2, bz * 4 + 2) });
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * ★ 台座解析高度（用户 2026-09-06：与墙裙同款高度查询 — 台座属于高台结构）：
 * (lx,lz) 落在某棵台座的 4×4 块带内 → 基面 + 台座带顶；否则 null。
 * 视觉几何（buildCementPlinths）与解析共用同一份计划与带顶函数 → 逐位一致。
 */
export function cementPlinthHeightAt(
  tiles: CementPlinthTile[], lx: number, lz: number,
): number | null {
  for (const t of tiles) {
    const dx = lx - (t.bx * 4 + 2);
    const dz = lz - (t.bz * 4 + 2);
    const d = plinthTopDelta(dx, dz);
    if (d !== null) return t.base + d;
  }
  return null;
}

/** 台座共享几何/材质（模块级单例；chunk 重建复用，模式退出统一 dispose） */
let sharedGeo: THREE.BufferGeometry | null = null;
let sharedMat: THREE.MeshStandardMaterial | null = null;

function getSharedGeo(): THREE.BufferGeometry {
  if (sharedGeo) return sharedGeo;
  sharedGeo = buildTrapezoidPlinth({
    baseHalf: BASE_HALF, topHalf: TOP_HALF, height: PLINTH_H,
    slotDepth: SLOT_DEPTH, slotHalf: SLOT_HALF, color: 0x6f6f6a,
  });
  sharedGeo.userData.decorShared = true;
  return sharedGeo;
}

function getSharedMat(): THREE.MeshStandardMaterial {
  if (sharedMat) return sharedMat;
  sharedMat = new THREE.MeshStandardMaterial({
    color: 0x6f6f6a, roughness: 0.92, metalness: 0, flatShading: true,
  });
  sharedMat.userData.decorShared = true;
  return sharedMat;
}

/** 台座物理 trimesh（顶点 chunk 中心相对坐标系，y 世界绝对高度；同墙裙管线） */
export interface CementPlinthPhysics {
  vertices: Float32Array;
  indices: Uint32Array;
}

/** 台座构建：几何复用 buildTrapezoidPlinth；mesh 正置（rotation=0）、
 * 块中心放置 + 贴地；trimesh 给 host.createGround（可站可挡）。 */
export function buildCementPlinths(
  cx: number, cz: number, seed: number,
  blockTypes: Uint8Array | undefined,
  surfaceHeightAt: (x: number, z: number) => number,
): { mesh: THREE.InstancedMesh; physics: CementPlinthPhysics } | null {
  const tiles = planCementPlinths(cx, cz, seed, blockTypes,
    (lx, lz) => surfaceHeightAt(cx * CHUNK_SIZE + lx, cz * CHUNK_SIZE + lz));
  if (!tiles) return null;

  const geo = getSharedGeo();
  const mat = getSharedMat();
  const mesh = new THREE.InstancedMesh(geo, mat, tiles.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3(1, 1, 1);
  q.identity();
  const half = CHUNK_SIZE / 2;

  // 物理三顶点累积（非索引展开；trimesh 顶点数 = 唯一顶点 np/tile）
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const pos = posAttr.array as Float32Array;
  const np = pos.length / 3;
  const triCount = (geo.index ? geo.index.count : pos.length / 3) / 3;
  const physVerts = new Float32Array(tiles.length * np * 3);
  const physIdx = new Uint32Array(tiles.length * triCount * 3);
  let o = 0;
  let vertBase = 0;

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const wx = cx * CHUNK_SIZE + t.bx * 4 + 2;   // 块中心世界坐标
    const wz = cz * CHUNK_SIZE + t.bz * 4 + 2;
    const y = t.base;                      // 底座贴台面（带顶=base+0.6 与解析一致）
    v.set(t.bx * 4 + 2, y, t.bz * 4 + 2);         // chunk 局部坐标（layer 挂 group，group 已对齐角）
    m.compose(v, q, s);
    mesh.setMatrixAt(i, m);

    // 物理：chunk 中心相对 x/z − half，y 世界绝对（同地形地面刚体帧）
    for (let j = 0; j < np; j++) {
      const px = pos[j * 3], py = pos[j * 3 + 1], pz = pos[j * 3 + 2];
      physVerts[o++] = wx - half + px;
      physVerts[o++] = y + py;
      physVerts[o++] = wz - half + pz;
    }
    const base = i * triCount * 3;
    const idxArr = geo.index ? geo.index.array : null;
    for (let j = 0; j < triCount * 3; j++) physIdx[base + j] = vertBase + (idxArr ? idxArr[j] : j);
    vertBase += np;
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { mesh, physics: { vertices: physVerts, indices: physIdx } };
}

/** 模式退出时释放共享几何/材质 */
export function disposeCementPlinthShared(): void {
  sharedGeo?.dispose();
  sharedMat?.dispose();
  sharedGeo = null;
  sharedMat = null;
}