// ============================================================
// ChunkWalls —— chunk 断崖侧壁几何（自主检测生成，顶点色着色）
// ============================================================
// 为什么需要独立侧壁：标准 chunk 是位移平面，"侧面"只是地面贴图
// 的垂直拉伸——地面阴影梯度会被拉伸成墙面上的纵向渐变（上强下弱，
// 踩过的坑）。本构建器扫描高度场，落差达标的断崖处生成真实四边形，
// 按「朝向 × 烘焙太阳」顶点色直接上色：形体稳定、不吃任何光照。
//
// 与 Boss4DArena 墙体构建同思路（绕序表沿用其推导）；区别：
//   - 只生成落差 ≥ MIN_WALL_DROP 的断崖（道路 ±0.3m 抖动不出碎片墙）
//   - 仅视觉：物理碰撞仍由位移平面 trimesh 承担（侧壁在其内部）
// ============================================================

import * as THREE from 'three';
import { CHUNK_SIZE, hash2 } from './ChunkGenerator';
import { hsl2rgb } from './TerrainPalette';
import { BAKE_SUN, CAST_MIN_DEPTH } from './bakeCompute';
import { regionParamsAt, SEMANTIC_THEME_MIX } from './RegionTheme';
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

/** 四向断崖绕序表（法线朝低处外侧；自 Boss4DArena 迁移的已推导版本） */
const DIRS = [
  { dx: 1, dz: 0, ax: 1, az: 0, bx: 1, bz: 1 },
  { dx: -1, dz: 0, ax: 0, az: 1, bx: 0, bz: 0 },
  { dx: 0, dz: 1, ax: 1, az: 1, bx: 0, bz: 1 },
  { dx: 0, dz: -1, ax: 0, az: 0, bx: 1, bz: 0 },
];

/**
 * 扫描 chunk 高度场，生成全部断崖侧壁合并网格（局部坐标，中心为原点）。
 * @returns 无断崖时返回 null（调用方可跳过添加）
 */
export function buildChunkSideWalls(raster: RasterMap, cx: number, cz: number): THREE.Mesh | null {
  const N = CHUNK_SIZE;
  const ox = cx * N;
  const oz = cz * N;
  const seed = raster.worldSeed;

  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  let vi = 0;

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const hCur = raster.heightAt(ox + i + 0.5, oz + j + 0.5);
      for (const d of DIRS) {
        const ni = i + d.dx, nj = j + d.dz;
        const hNb = (ni >= 0 && ni < N && nj >= 0 && nj < N)
          ? raster.heightAt(ox + ni + 0.5, oz + nj + 0.5)
          : raster.heightAt(ox + ni + 0.5, oz + nj + 0.5); // 越界由 heightAt 兜底返回 0
        const drop = hCur - hNb;
        if (drop < MIN_WALL_DROP) continue;

        // 地块底色（取墙对应地块；颜色归一化后乘明暗——直接塞 0~255 会被钳白）
        // ★ 区域主题调制：与地面烘焙同源同强度语义（墙色不与地面脱节）
        const td = raster.tileDefAt(ox + i + 0.5 + d.dx * 0.5, oz + j + 0.5 + d.dz * 0.5);
        const rpT = regionParamsAt(seed, ox + i + 0.5, oz + j + 0.5);
        const thM = td.isDepression ? SEMANTIC_THEME_MIX : 1;
        const wH = (((td.visual.baseHsl.h + rpT.hueShift * thM) % 1) + 1) % 1;
        const wS = Math.min(1, td.visual.baseHsl.s * (1 + (rpT.satMul - 1) * thM));
        const wL = Math.min(1, td.visual.baseHsl.l * (1 + (rpT.lightMul - 1) * thM));
        let [r, g, b] = hsl2rgb(wH, wS, wL);
        // 朝向 × 太阳：外法线与太阳水平方向同向 = 朝阳 → 亮
        const facing = Math.max(0, d.dx * SUN_HX + d.dz * SUN_HZ);
        const k = wallShade(raster, seed, ox + i, oz + j, drop, facing) / 255;

        const xA = i + d.ax - N / 2, zA = j + d.az - N / 2; // 局部坐标（中心原点）
        const xB = i + d.bx - N / 2, zB = j + d.bz - N / 2;
        const yT = hCur, yB = hNb - WALL_EPS;
        pos.push(xA, yT, zA, xB, yT, zB, xB, yB, zB, xA, yB, zA);
        for (let c = 0; c < 4; c++) {
          nor.push(d.dx, 0, d.dz);
          col.push(r * k, g * k, b * k);
        }
        idx.push(vi, vi + 2, vi + 3, vi, vi + 1, vi + 2);
        vi += 4;
      }
    }
  }

  if (idx.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);

  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  wallMaterials.add(mat);
  return new THREE.Mesh(geo, mat);
}
