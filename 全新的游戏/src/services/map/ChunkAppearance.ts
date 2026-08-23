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
import type { RasterMap } from './RasterMap';

/** 外观分辨率（默认 256²；低端机降 128²） */
export const APPEARANCE_RES = 256;

/** AO 参数（与架构文档一致；压暗下限 0.55 防死黑） */
const AO_RADIUS = 2.5;
const AO_STRENGTH = 0.09;
const AO_MIN = 0.55;

/** 平滑值噪声（双线性 + smoothstep），用于大尺度明暗斑驳 */
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
 * 烘焙一张 chunk 外观纹理。
 * @param raster 地图查询层（typeColor / heightAt / worldSeed）
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

      // ---- 类型底色（路/高台/坑/水）----
      let [r, g, b] = raster.terrainColorAt(wx, wz);

      // ---- 大尺度噪声明暗（去平铺重复感；0.86~1.12）----
      const n = vnoise(wx * 0.045, wz * 0.045, seed);
      const shade = 0.86 + 0.26 * n;

      // ---- 逐像素 AO（8 向环形高度采样，凹处压暗）----
      const h = raster.heightAt(wx, wz);
      let occ = 0;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const dh = raster.heightAt(wx + Math.cos(ang) * AO_RADIUS, wz + Math.sin(ang) * AO_RADIUS) - h;
        if (dh > 0) occ += Math.min(dh, 2.5);
      }
      const ao = Math.max(AO_MIN, 1 - (occ / 8) * AO_STRENGTH);

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
