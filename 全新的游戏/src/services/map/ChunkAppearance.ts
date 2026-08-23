// ============================================================
// ChunkAppearance —— chunk 外观纹理烘焙器（静态预渲染）
// ============================================================
// 架构文档 8.0 v2 的核心：chunk 创建时把"颜色类信息"一次性烘进
// 一张 Canvas 纹理，不随相机/时间变化。运行时只剩便宜的光照。
//
// 烘焙内容（逐像素）：
//   类型底色 × hash2 噪声明暗 × 逐像素 AO（高度场环形采样）
//
// 分界铁律（防重复计费）：
//   - 颜色类 → 全部在这里烘焙
//   - 几何明暗(N·L) → 实时（预计算法线，标准材质自动算）
//   - 实体投影阴影 → 实时阴影图（唯一动态分量）
//   ⚠️ 启用本 canvas 后，顶点色/AO 必须停用——AO 只能存在一处
//
// 像素 ↔ 世界映射约定：
//   pixel(px,py) ↔ world( cx*60+(px+0.5)*step , cz*60+(py+0.5)*step )
//   配套顶点 UV = (lx/60, lz/60)，texture.flipY = false
// ============================================================

import * as THREE from 'three';
import { CHUNK_SIZE, hash2 } from './ChunkGenerator';
import { TERRAIN_BASE_HSL, hsl2rgb, type Hsl } from './TerrainPalette';
import type { RasterMap } from './RasterMap';

/** 外观分辨率（默认 256²；低端机降 128²） */
export const APPEARANCE_RES = 256;

/** AO 参数（与架构文档一致；压暗下限 0.55 防死黑） */
const AO_RADIUS = 2.5;
const AO_STRENGTH = 0.09;
const AO_MIN = 0.55;

/** 平滑值噪声（双线性 + smoothstep），用于大尺度明暗斑驳（幅度刻意克制，保方块感） */
function vnoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const h = (a: number, b: number) => hash2(a, b, seed);
  const top = h(xi, yi) * (1 - sx) + h(xi + 1, yi) * sx;
  const bot = h(xi, yi + 1) * (1 - sx) + h(xi + 1, yi + 1) * sx;
  return top * (1 - sy) + bot * sy;
}

/**
 * ★ 逐地块基础色抖动 —— 方块感的来源。
 * 以世界 tile 坐标 (4m 格) 做 hash2，在 H/S/L 三通道独立微抖：
 *   色相 ±0.8% / 饱和 ±3% / 亮度 ±5%
 * 相邻地块颜色略不同、同块内部完全一致 → 干净的"棋盘感"。
 * 水域不抖（液体应均质）；坑洞减半幅度（警示色要保持醒目）。
 */
function tileJitter(
  wx: number, wz: number, seed: number, type: number, base: Hsl,
): Hsl {
  const tx = Math.floor(wx / 4);
  const tz = Math.floor(wz / 4);
  if (type === 4) return base; // BLOCK_WATER：不抖
  const ampMul = type === 2 ? 0.5 : 1; // BLOCK_PIT：半幅
  const dh = ((hash2(tx, tz, seed + 101) - 0.5) * 0.016) * ampMul;
  const ds = ((hash2(tx, tz, seed + 202) - 0.5) * 0.06) * ampMul;
  const dl = ((hash2(tx, tz, seed + 303) - 0.5) * 0.10) * ampMul;
  return {
    h: base.h + dh,
    s: Math.min(1, Math.max(0, base.s * (1 + ds))),
    l: Math.min(1, Math.max(0, base.l * (1 + dl))),
  };
}

/**
 * 烘焙一张 chunk 外观纹理。
 * @param raster 地图查询层（terrainTypeAt / heightAt / worldSeed）
 * @param cx,cz  chunk 坐标
 * @returns 已配置好 colorSpace/filter 的 CanvasTexture（随 chunk 销毁时 dispose）
 */
export function bakeChunkAppearance(
  raster: RasterMap,
  cx: number,
  cz: number,
): THREE.CanvasTexture {
  const S = APPEARANCE_RES;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = S;
  const ctx = cvs.getContext('2d')!;
  const img = ctx.createImageData(S, S);

  const seed = raster.worldSeed;
  const step = CHUNK_SIZE / S;               // 米/像素
  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const lx = (px + 0.5) * step;
      const lz = (py + 0.5) * step;
      const wx = originX + lx;
      const wz = originZ + lz;

      // ---- 类型判定 + 高度修正 ----
      // ★ 坑/水的"侧壁上段"修正：
      //   必须用 surfaceHeightAt（顶点值双线性插值 = 网格真实渲染高度）判定。
      //   ⚠️ 两个坑：
      //   ① heightAt 是原始格子数据（坑块内恒为负），判 h>0 永不成立；
      //   ② vertexHeightAt 是 max 且只向负方向采样 —— 在悬崖【低侧】看不到
      //      高邻块，同样判不出。surfaceHeightAt 与网格渲染完全一致才可靠。
      //   插值高度 >0 且水平归属坑/水 tile = 位于 0 线以上的侧壁暴露面，
      //   改按平地材质处理（不得涂水色/警示色）。
      let type = raster.terrainTypeAt(wx, wz);
      const hSurface = raster.surfaceHeightAt(wx, wz);
      if ((type === 2 || type === 4) && hSurface > 0) {
        type = 0; // 0 线以上的侧壁 → 平地材质
      }

      // ---- 类型 → 基准 HSL → 逐地块抖动 → RGB ----
      const base =
        type === 1 ? TERRAIN_BASE_HSL.platform :
        type === 2 ? TERRAIN_BASE_HSL.pit :
        type === 4 ? TERRAIN_BASE_HSL.water :
                     TERRAIN_BASE_HSL.flat;
      const jit = tileJitter(wx, wz, seed, type, base);
      let [r, g, b] = hsl2rgb(jit.h, jit.s, jit.l);

      // ---- 结构化细节层（替代白噪点——白噪=脏，结构=设计）----
      //   ① 色阶化斑块：中频噪声量化成 3 档离散亮度 → 手绘色块拼接感
      //   ② 地块内描边：贴边 ~0.3m 压暗一圈 → "精制面板"质感（方舟地图签名）
      //   ③ 平台方向性拉丝：各向异性噪声沿 X 拉伸 → 拉丝金属
      //   已删除：像素白噪点 / R,B 冷暖偏移（各向同性无结构 = 脏）
      const isWater = type === 4;
      const isPit = type === 2;

      // ① 色阶化斑块（~4m 特征；3 档：0.95 / 1.00 / 1.05）
      if (!isWater) {
        const pn = vnoise(wx * 0.22, wz * 0.22, seed + 88);
        const band = Math.min(2, Math.floor(pn * 3)) / 2; // 0 / 0.5 / 1
        const patch = 0.95 + band * 0.10;
        const pAmp = isPit ? 0.5 : 1;
        r *= 1 + (patch - 1) * pAmp;
        g *= 1 + (patch - 1) * pAmp;
        b *= 1 + (patch - 1) * pAmp;
      }

      // ② 地块内描边（非水域）：距块边 <0.3m 的像素压暗一圈
      if (!isWater) {
        const bxm = ((lx % 4) + 4) % 4;
        const bzm = ((lz % 4) + 4) % 4;
        const dEdge = Math.min(bxm, 4 - bxm, bzm, 4 - bzm);
        if (dEdge < 0.3) {
          const t = 1 - dEdge / 0.3; // 越贴边越暗
          const k = 1 - 0.13 * t;
          r *= k; g *= k; b *= k;
        }
      }

      // ③ 平台方向性拉丝（X 向拉伸噪声，±4%）
      if (type === 1) {
        const st = (vnoise(wx * 0.7, wz * 0.12, seed + 66) - 0.5) * 0.08;
        r *= 1 + st; g *= 1 + st; b *= 1 + st;
      }

      // ---- 大尺度斑驳（幅度刻意克制 ±6%，不抢方块感）----
      const n = vnoise(wx * 0.045, wz * 0.045, seed + 7);
      const shade = 0.94 + 0.12 * n;

      // ---- 逐像素 AO ----
      // ★ 凹陷地块（修正后仍是水/坑的部分 = 0 线以下的底面）：
      //   表面按 ≤0 的平面均匀着色，不参与邻域 AO —— 否则邻接高台/坡的
      //   高度差会烘进纹理，让水面/坑底出现明暗不均。深度感由几何侧壁承担。
      const isDepression = type === 2 || type === 4;
      let ao = 1;
      if (!isDepression) {
        const h = raster.heightAt(wx, wz);
        let occ = 0;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const dh = raster.heightAt(wx + Math.cos(ang) * AO_RADIUS, wz + Math.sin(ang) * AO_RADIUS) - h;
          if (dh > 0) occ += Math.min(dh, 2.5);
        }
        ao = Math.max(AO_MIN, 1 - (occ / 8) * AO_STRENGTH);
      }

      const f = shade * ao;
      const i = (py * S + px) * 4;
      img.data[i]     = Math.min(255, r * f);
      img.data[i + 1] = Math.min(255, g * f);
      img.data[i + 2] = Math.min(255, b * f);
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cvs);
  tex.flipY = false;                        // ★ 与显式 UV 约定配套（见文件头）
  tex.colorSpace = THREE.SRGBColorSpace;    // 真实显示色（区别于 FTX 的线性 HSL 数据）
  tex.anisotropy = 4;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
