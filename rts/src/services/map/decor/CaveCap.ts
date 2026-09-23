// ============================================================
// CaveCap —— 浮空洞顶岩板（"坑洞 + 顶板封顶"的实体化）
// ============================================================
// 数据来源：ChunkData.caveCap（逐 4m 块顶面高度，NaN = 无；TerrainPresets 'cave' 产出）。
//   · 顶面：与高原表面齐平（可站）
//   · ★ 材质复用：直接借用本 chunk 地形顶面材质（TerrainMaterial：albedo/lightmap/
//     材质图案 + 昼夜光照全同源）——uv 重映射到"最近的未封顶块"，
//     于是洞顶看起来就是周围高原的同一份地块材质，而不是另贴一张皮
//   · 底面（洞内天花板）：1m 网格 + vnoise 插值起伏；顶点色压暗（顶 1.0 / 侧 0.7 / 底 0.45）
//   · 洞口罩边：封顶块与非封顶块交界处补竖直裙边（顶面 ↔ 底面）
//   · 可破坏：子弹命中岩板 → ChunkManager.digCaveCap 把该 4m 块挖掉并重建
//   · 物理：同一份三角汤 trimesh（经 host.createGround 装配成固定地面体）
// 角色"站上洞顶"由 RasterMap.surfaceHeightAtFor（第二层高度）负责，本网格只管
// 看得见 + 子弹/碰撞；洞内在盒底面下可正常通行。
// ============================================================

import * as THREE from 'three';
import { BLOCKS_PER_SIDE, CHUNK_SIZE } from '../ChunkGenerator';
import { vnoise } from '../TerrainNoise';

/** 岩板基础厚度（米；洞内净高 = cap - floor - 本值 ± 起伏） */
export const CAVE_CAP_THICK = 0.6;
/** 洞顶起伏幅度（米，±） */
const CAP_UND_AMP = 0.3;
/** 洞顶最低净高保护 */
const CAP_MIN_THICK = 0.3;

export interface CaveCapPhysics {
  vertices: Float32Array;
  indices: Uint32Array;
}

/** 兜底材质（拿不到地形材质时用：暗色岩石，不参与昼夜光照） */
const FALLBACK_MAT = new THREE.MeshStandardMaterial({
  color: 0x6a635a, roughness: 1, metalness: 0, flatShading: true, side: THREE.DoubleSide,
});
FALLBACK_MAT.userData.decorShared = true;

export function disposeCaveCapShared(): void {
  FALLBACK_MAT.dispose();
}

/** 洞顶底面高度（1m 网格插值：同一世界坐标恒同值 → 跨块连续） */
function undersideY(capY: number, wx: number, wz: number, seed: number): number {
  const n = (vnoise(wx * 0.32, wz * 0.32, seed + 777) - 0.5) * 2 * CAP_UND_AMP;
  return capY - Math.max(CAP_MIN_THICK, CAVE_CAP_THICK + n);
}

/**
 * 由 caveCap 数据生成岩板层（顶点为 chunk 局部坐标，group 原点在块心）。
 * @param terrainMaterial 本 chunk 地形顶面材质（借用；uv 重映射采样周围地块贴图）
 * 无数据/无封顶块 → null。
 */
export function buildCaveCaps(
  cx: number,
  cz: number,
  seed: number,
  caveCap: Float32Array | undefined,
  terrainMaterial?: THREE.Material | null,
): { mesh: THREE.Object3D; physics: CaveCapPhysics } | null {
  if (!caveCap) return null;
  const HALF = CHUNK_SIZE / 2;
  const capped = (bx: number, bz: number): boolean =>
    Number.isFinite(caveCap[bz * BLOCKS_PER_SIDE + bx]);

  /** ★ 最近未封顶块（材质/贴图采样参照物）；找不到（全块封顶）→ 自身兜底 */
  const refBlockCache = new Map<number, number>();
  const refBlockOf = (bx: number, bz: number): { bx: number; bz: number } => {
    const key = bz * BLOCKS_PER_SIDE + bx;
    const cached = refBlockCache.get(key);
    if (cached !== undefined) return { bx: cached % BLOCKS_PER_SIDE, bz: Math.floor(cached / BLOCKS_PER_SIDE) };
    for (let r = 1; r < BLOCKS_PER_SIDE * 2; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = bx + dx, nz = bz + dz;
          if (nx < 0 || nz < 0 || nx >= BLOCKS_PER_SIDE || nz >= BLOCKS_PER_SIDE) continue;
          if (!capped(nx, nz)) {
            refBlockCache.set(key, nz * BLOCKS_PER_SIDE + nx);
            return { bx: nx, bz: nz };
          }
        }
      }
    }
    return { bx, bz };
  };

  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  let any = false;

  const pushV = (x: number, y: number, z: number, c: [number, number, number], u: number, v: number): void => {
    pos.push(x - HALF, y, z - HALF); // 物理/网格基准：块心相对（网格稍后 +HALF 回到角坐标）
    col.push(c[0], c[1], c[2]);
    uv.push(u, v);
  };
  const quad = (
    a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number],
    ca: [number, number, number], cb: [number, number, number], cc2: [number, number, number], cd: [number, number, number],
    uvs: [number, number][],
  ): void => {
    pushV(a[0], a[1], a[2], ca, uvs[0][0], uvs[0][1]);
    pushV(b[0], b[1], b[2], cb, uvs[1][0], uvs[1][1]);
    pushV(c[0], c[1], c[2], cc2, uvs[2][0], uvs[2][1]);
    pushV(d[0], d[1], d[2], cd, uvs[3][0], uvs[3][1]);
  };

  const TOP_C: [number, number, number] = [1, 1, 1];
  const SIDE_C: [number, number, number] = [0.7, 0.7, 0.7];
  const BOT_C: [number, number, number] = [0.45, 0.45, 0.45];

  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const bx = lx >> 2, bz = lz >> 2;
      const capY = caveCap[bz * BLOCKS_PER_SIDE + bx];
      if (!Number.isFinite(capY)) continue;
      any = true;
      // ★ uv 重映射：本块 → 最近的未封顶块（采样其地形贴图/光照，洞顶 = 周围地块材质）
      const ref = refBlockOf(bx, bz);
      const u0 = (ref.bx * 4 + (lx & 3)) / CHUNK_SIZE;
      const v0 = (ref.bz * 4 + (lz & 3)) / CHUNK_SIZE;
      const u1 = (ref.bx * 4 + (lx & 3) + 1) / CHUNK_SIZE;
      const v1 = (ref.bz * 4 + (lz & 3) + 1) / CHUNK_SIZE;
      const yT = capY;
      const u00 = undersideY(capY, cx * CHUNK_SIZE + lx, cz * CHUNK_SIZE + lz, seed);
      const u10 = undersideY(capY, cx * CHUNK_SIZE + lx + 1, cz * CHUNK_SIZE + lz, seed);
      const u11 = undersideY(capY, cx * CHUNK_SIZE + lx + 1, cz * CHUNK_SIZE + lz + 1, seed);
      const u01 = undersideY(capY, cx * CHUNK_SIZE + lx, cz * CHUNK_SIZE + lz + 1, seed);
      const T00: [number, number, number] = [lx, yT, lz];
      const T10: [number, number, number] = [lx + 1, yT, lz];
      const T11: [number, number, number] = [lx + 1, yT, lz + 1];
      const T01: [number, number, number] = [lx, yT, lz + 1];
      const B00: [number, number, number] = [lx, u00, lz];
      const B10: [number, number, number] = [lx + 1, u10, lz];
      const B11: [number, number, number] = [lx + 1, u11, lz + 1];
      const B01: [number, number, number] = [lx, u01, lz + 1];
      quad(T00, T01, T11, T10, TOP_C, TOP_C, TOP_C, TOP_C, [[u0, v0], [u0, v1], [u1, v1], [u1, v0]]);
      quad(B00, B10, B11, B01, BOT_C, BOT_C, BOT_C, BOT_C, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      // 边界裙边：邻格未封顶 → 补竖直面（双绕向：共用 FrontSide 的地形材质两面都可见）
      const skirt = (nx: number, nz: number, aT: [number, number, number], bT: [number, number, number], aB: [number, number, number], bB: [number, number, number]): void => {
        if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE && Number.isFinite(caveCap[(nz >> 2) * BLOCKS_PER_SIDE + (nx >> 2)])) return;
        const uvs: [number, number][] = [
          [aT[0] / 8, aT[1] / 8], [bT[0] / 8, bT[1] / 8], [bB[0] / 8, bB[1] / 8], [aB[0] / 8, aB[1] / 8],
        ];
        quad(aT, bT, bB, aB, SIDE_C, SIDE_C, SIDE_C, SIDE_C, uvs);
        quad(aT, aB, bB, bT, SIDE_C, SIDE_C, SIDE_C, SIDE_C, [uvs[0], uvs[3], uvs[2], uvs[1]]);
      };
      skirt(lx - 1, lz, T00, T01, B00, B01);
      skirt(lx + 1, lz, T10, T11, B10, B11);
      skirt(lx, lz - 1, T00, T10, B00, B10);
      skirt(lx, lz + 1, T01, T11, B01, B11);
    }
  }
  if (!any) return null;

  const vCount = pos.length / 3;
  const indices = new Uint32Array((vCount / 4) * 6);
  for (let q = 0, i = 0, o = 0; q < vCount / 4; q++, i += 4, o += 6) {
    indices[o] = i;
    indices[o + 1] = i + 1;
    indices[o + 2] = i + 2;
    indices[o + 3] = i;
    indices[o + 4] = i + 2;
    indices[o + 5] = i + 3;
  }
  const vertices = new Float32Array(pos); // 物理：块心相对坐标
  // 渲染：挂进 decor 层（层整体 −30 偏移）→ 网格坐标须为 chunk 角坐标（0..60）
  const meshPos = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    meshPos[i] = vertices[i] + HALF;
    meshPos[i + 1] = vertices[i + 1];
    meshPos[i + 2] = vertices[i + 2] + HALF;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(meshPos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  // ★ 地形材质声明 attribute float apw（补丁权重）：无补丁恒 0（显式提供更稳）
  geo.setAttribute('apw', new THREE.BufferAttribute(new Float32Array(vCount), 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, terrainMaterial ?? FALLBACK_MAT);
  // ★ 借用材质标记：disposeVisual 不得释放（材质归地形顶面网格所有）
  (mesh.userData as { decorKind?: string; borrowedMaterial?: boolean }).decorKind = 'decor';
  if (terrainMaterial) (mesh.userData as { borrowedMaterial?: boolean }).borrowedMaterial = true;
  mesh.name = 'cave-cap';
  return { mesh, physics: { vertices, indices } };
}
