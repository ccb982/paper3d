// ============================================================
// ChunkWalls —— chunk 断崖侧壁几何（自主检测生成，顶点色着色）
// ============================================================
// 为什么需要独立侧壁：标准 chunk 顶面是"板 + weld 坡"的近水平面，
// 竖直落差需要真实四边形——地面贴图直接拉伸会变成墙面纵向渐变
// （上强下弱，踩过的坑）。本构建器扫描高度场，在两类边生成墙：
//   ① cliff 裁决边（《地形边缘裁决与视觉面架构.md》§3.3）：
//      drop > 0 即生成——硬边界的结构性墙，无论落差多小；
//   ② weld 大落差边（历史行为）：drop ≥ MIN_WALL_DROP——高台/坑壁。
// 按「朝向 × 烘焙太阳」顶点色直接上色：形体稳定、不吃任何光照。
//
// ★ 物理同源（2026-08-29）：墙三角形必须并入地面 trimesh——trimesh
//   无体积，cliff 边若无墙面，低侧物体会水平穿入高板体内侧坠落
//   （单面网格下方 = 无底）。buildChunkSideWalls 同时输出物理数组，
//   由 ChunkManager 与顶面合并后建刚体（碰撞=所见不变式）。
//
// 与 Boss4DArena 墙体构建同思路（绕序表沿用其推导）。
// ============================================================

import * as THREE from 'three';
import { CHUNK_SIZE, BLOCKS_PER_SIDE, hash2 } from './ChunkGenerator';
import { hsl2rgb } from './TerrainPalette';
import { BAKE_SUN, CAST_MIN_DEPTH } from './bakeCompute';
import { SEMANTIC_THEME_MIX, groupByKey, applyGroupTintHsl, type GroupPalette } from './TileGroups';
import { edgeOf } from './SurfaceRules';
import type { RasterMap } from './RasterMap';
import { TERRAIN_LIGHT_TUNING } from './TerrainMaterial';

/** 侧壁材质注册表（每帧由 updateWallLighting 统一喂昼夜标量；dispose 时 clear） */
const wallMaterials = new Set<THREE.MeshBasicMaterial>();

/**
 * 每帧昼夜调制（与地形顶面同源：仅改整体亮度，不改烘焙阴影方向）。
 * 地形顶面经 updateTerrainLighting 变暗/变冷，侧壁若不跟随则夜晚"发光断崖"。
 * @param sun 太阳状态（与 updateTerrainLighting 同源）
 */
export function updateWallLighting(sun: {
  color: number;
  intensityScale: number;
  daylight: number;
}): void {
  const T = TERRAIN_LIGHT_TUNING;
  const ambI = T.ambientNightIntensity +
    (T.ambientDayIntensity - T.ambientNightIntensity) * sun.daylight;
  // 近似地形综合亮度包络（ambient + sun×平均直射），与顶面同趋势
  const scalar = ambI + T.sunIntensity * sun.intensityScale * 0.8;
  for (const m of wallMaterials) m.color.setScalar(scalar);
}

/** 模式退出时清空注册表（材质已由 ChunkManager.disposeVisual 释放） */
export function clearWallMaterials(): void {
  wallMaterials.clear();
}

/** 生成门槛：与烘焙投影门槛同一来源（bakeCompute.CAST_MIN_DEPTH import） */
const MIN_WALL_DROP = CAST_MIN_DEPTH;

/** 墙底延伸（防与地面共面闪烁） */
const WALL_EPS = 0.05;

// ---- 侧壁明暗调参（集中此处；全部确定性，同种子必复现）----
/** 背阳壁基准亮度（深影端） */
const WALL_K_BACK = 0.22;
/** 朝阳壁基准亮度（亮端） */
const WALL_K_LIT = 0.82;
/** 落差加深：满落差（4m，如坑壁）时额外压暗的比例 */
const WALL_DEPTH_DARKEN = 0.16;
/** 天空遮蔽加深：完全被高地围住（吃不到天光）的墙压暗比例 */
const WALL_SKY_DIM = 0.22;
/** 逐墙确定性抖动幅度（±半幅；打破整面墙单一色的呆板感） */
const WALL_JITTER = 0.10;

// 烘焙太阳水平方向：唯一权威来源 = bakeCompute.BAKE_SUN（import，勿手抄）
const SUN_HX = BAKE_SUN.hx;
const SUN_HZ = BAKE_SUN.hz;

/**
 * 单面墙的显示空间亮度乘数。
 * 变化来源（由强到弱）：朝向 × 太阳 > 落差深度 > 天空可见度 > 位置抖动。
 */
function wallShade(
  raster: RasterMap, seed: number,
  wi: number, wj: number,      // 墙所属格（世界格坐标，抖动种子用）
  drop: number,                // 落差（米）
  facing: number,              // 朝阳度 0..1（外法线·太阳水平方向）
): number {
  let k = WALL_K_BACK + (WALL_K_LIT - WALL_K_BACK) * facing;

  // 落差深度：坑壁比普通高台更深沉
  k -= Math.min(1, drop / 4) * WALL_DEPTH_DARKEN;

  // 天空可见度：墙顶周围 8 向采样，被更高地形挡住的比例越高越暗
  // （坑内/谷地墙吃不到天光；开阔高台墙不受影响）
  const wx = wi + 0.5, wz = wj + 0.5;
  const hTop = raster.heightAt(wx, wz) + 0.6;
  let open = 0;
  for (let n = 0; n < 8; n++) {
    const ang = (n / 8) * Math.PI * 2;
    if (raster.heightAt(wx + Math.cos(ang) * 2.5, wz + Math.sin(ang) * 2.5) <= hTop) open++;
  }
  const openF = open / 8;
  k *= 1 - WALL_SKY_DIM * (1 - openF);

  // 确定性微抖动（±WALL_JITTER/2，对称不偏移平均亮度）
  k *= 1 + (hash2(wi, wj, seed + 7717) - 0.5) * 2 * WALL_JITTER;

  return Math.max(0.14, k);
}

/** 四向断崖绕序表（法线朝低处外侧；自 Boss4DArena 迁移的已推导版本）
 *  edgeOf 方向参数映射：DIRS 索引即 dir（0=+x 1=−x 2=+z 3=−z） */
const DIRS = [
  { dx: 1, dz: 0, ax: 1, az: 0, bx: 1, bz: 1 },
  { dx: -1, dz: 0, ax: 0, az: 1, bx: 0, bz: 0 },
  { dx: 0, dz: 1, ax: 1, az: 1, bx: 0, bz: 1 },
  { dx: 0, dz: -1, ax: 0, az: 0, bx: 1, bz: 0 },
];

/** 墙构建产物：视觉网格 + 物理数组（局部坐标，与顶面同约定可合并建 trimesh） */
export interface ChunkWallsBuild {
  mesh: THREE.Mesh | null;
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * 扫描 chunk 高度场，生成全部断崖侧壁合并网格（局部坐标，中心为原点）。
 * cliff 裁决边：drop > 0 即墙（硬边界结构性侧壁，落差再小也不斜坡）；
 * weld 边：维持历史门槛 drop ≥ MIN_WALL_DROP（高台/坑壁）。
 */
export function buildChunkSideWalls(raster: RasterMap, cx: number, cz: number): ChunkWallsBuild {
  const N = CHUNK_SIZE;
  const ox = cx * N;
  const oz = cz * N;
  const seed = raster.worldSeed;
  // ★ 融合原 RegionTheme：本 chunk 所属组的调色板（硬边界、肉鸽友好）
  const gkey = raster.getChunkData(cx, cz)?.groupKey;
  const palette: GroupPalette | undefined = gkey ? groupByKey(gkey)?.palette : undefined;

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let vi = 0;

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const hCur = raster.heightAt(ox + i + 0.5, oz + j + 0.5);
      for (let d = 0; d < 4; d++) {
        const dir = DIRS[d];
        const ni = i + dir.dx, nj = j + dir.dz;
        const hNb = raster.heightAt(ox + ni + 0.5, oz + nj + 0.5); // 越界由 heightAt 兜底返回 0
        const drop = hCur - hNb;
        if (drop <= 0) continue;

        // ★ 边裁决（SurfaceRules 唯一真源）：cliff 边任何落差都出墙；
        //   weld 边维持旧门槛（道路 ±0.3m 抖动不出碎片墙）
        const info = edgeOf(raster.surfaceBlocks, cx * BLOCKS_PER_SIDE + Math.floor(i / 4), cz * BLOCKS_PER_SIDE + Math.floor(j / 4), d as 0 | 1 | 2 | 3);
        if (info.ruling === 'cliff') {
          if (info.drop <= 0) continue; // 同高等高的 cliff（如端口）无几何
        } else if (drop < MIN_WALL_DROP) {
          continue;
        }

        // 地块底色（取墙对应地块；颜色归一化后乘明暗——直接塞 0~255 会被钳白）
        // ★ 区域主题调制：与地面烘焙同源同强度语义（墙色不与地面脱节）
        const td = raster.tileDefAt(ox + i + 0.5 + dir.dx * 0.5, oz + j + 0.5 + dir.dz * 0.5);
        const thM = td.isDepression ? SEMANTIC_THEME_MIX : 1;
        const th = applyGroupTintHsl(td.visual.baseHsl, palette, thM);
        let [r, g, b] = hsl2rgb(th.h, th.s, th.l);
        // 朝向 × 太阳：外法线与太阳水平方向同向 = 朝阳 → 亮
        const facing = Math.max(0, dir.dx * SUN_HX + dir.dz * SUN_HZ);
        const k = wallShade(raster, seed, ox + i, oz + j, drop, facing) / 255;

        const xA = i + dir.ax - N / 2, zA = j + dir.az - N / 2; // 局部坐标（中心原点）
        const xB = i + dir.bx - N / 2, zB = j + dir.bz - N / 2;
        const yT = hCur, yB = hNb - WALL_EPS;
        pos.push(xA, yT, zA, xB, yT, zB, xB, yB, zB, xA, yB, zA);
        for (let c = 0; c < 4; c++) {
          nor.push(dir.dx, 0, dir.dz);
          col.push(r * k, g * k, b * k);
        }
        idx.push(vi, vi + 2, vi + 3, vi, vi + 1, vi + 2);
        vi += 4;
      }
    }
  }

  // 物理数组（局部坐标；与顶面缓冲同约定，ChunkManager 合并后建 trimesh）
  const vertices = new Float32Array(pos);
  const indices = new Uint32Array(idx);
  if (idx.length === 0) return { mesh: null, vertices, indices };

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);

  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  wallMaterials.add(mat);
  return { mesh: new THREE.Mesh(geo, mat), vertices, indices };
}
