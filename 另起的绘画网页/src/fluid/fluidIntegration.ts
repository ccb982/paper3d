import * as THREE from 'three';
import type { Point, FrameData } from '../types';
import { rgbToHsl } from '../utils/colorCompressor';

// ============================================================
// 流体集成工具集（主编辑器 ↔ FluidSolver 桥接）
// ============================================================
//
// 核心约定（与 MainCanvas 完全一致，详见 FluidSolver.buildCompositeMat 注释）：
//   - 区域 COLOR mesh 的 UV.y = 1 - world.y，故 uColorTex 数据 row 0 = world y=1（顶部）。
//   - boundBaseTexture / boundResidualTexture 用 flipY=false 上传，row 0 = world 顶部。
//   - FluidSolver 的 colorGrid / obstacle / compositeTarget 全部沿用同一约定（row 0 = world 顶部）。
//
// 用户需求：流体库的针对目标是区域实体模板缓冲中帧纹理的「残差」，
//           流体要直接绘制在残差之上（MCSDA：base 静态 + 残差被平流）。

// ============================================================
// 1. 区域边界 → 障碍物纹理
// ============================================================

/**
 * 将区域实体边界光栅化为障碍物纹理（RedFormat，Uint8）。
 *
 * 语义（与 FluidSolver SOR/平流着色器一致）：
 *   R = 0   → 流体可通过（区域内部）
 *   R = 255 → 墙（区域外部）
 *
 * 坐标对齐：
 *   boundary 为世界归一化坐标 (0~1)，world Y 向上。
 *   目标纹理 row 0 必须等于 world y=1（顶部），与 colorGrid/boundResidualTexture 对齐。
 *   Canvas2D 的 Y 向下，故绘制时 canvas_y = (1 - world.y) * h（与 colorCompressor.rasterizeRegionMask 同约定）。
 *   读回后 DataTexture.flipY = false → UV.y=0 采样 row 0 = world 顶部。✓
 *
 * 多环用 evenodd 填充，自动处理孔洞。
 */
export function rasterizeBoundaryToObstacle(
  boundary: Point[][],
  width: number,
  height: number,
): THREE.DataTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 区域外 = 黑（墙），区域内 = 白（流体）
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#ffffff';
  for (const ring of boundary) {
    if (!ring || ring.length < 3) continue;
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const cx = ring[i].x * width;
      const cy = (1 - ring[i].y) * height; // world Y up → canvas Y down
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.closePath();
  }
  ctx.fill('evenodd');

  // 描边，避免边界像素被误判为墙（区域窄缝也能流通）
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (const ring of boundary) {
    if (!ring || ring.length < 3) continue;
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const cx = ring[i].x * width;
      const cy = (1 - ring[i].y) * height;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.closePath();
    ctx.stroke();
  }

  const img = ctx.getImageData(0, 0, width, height);
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    // 区域内(白, R>128) → 流体(0)；区域外(黑) → 墙(255)
    data[i] = img.data[i * 4] > 128 ? 0 : 255;
  }

  const tex = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false; // ★ row 0 = world 顶部，与 colorGrid 对齐
  tex.needsUpdate = true;
  return tex;
}

// ============================================================
// 2. 从已绑定帧数据恢复 baseHslData（Float32 HSLA）
// ============================================================

/**
 * 由 boundBaseTexture（base+delta 烘焙后的最终帧）与 boundResidualTexture（量化残差）
 * 反推基础色 HSL 浮点数据，供 FluidSolver MCSDA 合成使用。
 *
 * 反推公式（与 FluidSolver.buildCompositeMat 反量化一致）：
 *   finalHSL = rgbToHsl(boundBaseTexture)
 *   dH = (r/255 * 2 - 1) * 0.5,  dS/dL/dA = (.. * 2 - 1) * 0.5
 *   baseH = fract(finalH - dH)   （色相环形）
 *   baseS = clamp01(finalS - dS)
 *   baseL = clamp01(finalL - dL)
 *   baseA = clamp01(finalA - dA)
 *
 * 这样：composite = base + 平流(残差) = 正确重建，且残差随流体流动。
 *
 * 返回 null 时调用方应回退到 direct 模式（直接平流 boundBaseTexture）。
 */
export function buildBaseHslFromFrame(
  frameData: FrameData,
): { data: Float32Array; width: number; height: number } | null {
  const base = frameData.boundBaseTexture;
  if (!base) return null;
  const w = base.width;
  const h = base.height;
  const out = new Float32Array(w * h * 4);

  const resid = frameData.boundResidualTexture;
  const rangeH = 0.5;
  const rangeSL = 0.5;

  for (let i = 0; i < w * h; i++) {
    const r = base.data[i * 4];
    const g = base.data[i * 4 + 1];
    const b = base.data[i * 4 + 2];
    const a = base.data[i * 4 + 3];

    // ★ 与编辑器一致：全程 sRGB 空间，不做 sRGB→线性 转换。
    //   残差 delta 在 sRGB-HSL 空间量化，反推的 baseH 也必须在 sRGB-HSL 空间，
    //   合成着色器 hsl2rgb 直接输出 sRGB 值写入 RenderTarget，才能 base+delta 完美还原。
    //   若在此处做 srgbToLinear，会导致 baseH 落在线性-HSL 空间，与 delta 错位，
    //   合成后初始色相就发生偏移（向量模式 bug 根因）。
    const fHSL = rgbToHsl(r, g, b);
    let bH = fHSL.h;
    let bS = fHSL.s;
    let bL = fHSL.l;
    let bA = a / 255;

    if (resid) {
      const rr = resid.data[i * 4] / 255;
      const rg = resid.data[i * 4 + 1] / 255;
      const rb = resid.data[i * 4 + 2] / 255;
      const ra = resid.data[i * 4 + 3] / 255;
      const dH = (rr * 2 - 1) * rangeH;
      const dS = (rg * 2 - 1) * rangeSL;
      const dL = (rb * 2 - 1) * rangeSL;
      const dA = (ra * 2 - 1) * rangeSL;
      bH = bH - dH;
      if (bH < 0) bH += 1;
      else if (bH >= 1) bH -= 1;
      bS = Math.max(0, Math.min(1, bS - dS));
      bL = Math.max(0, Math.min(1, bL - dL));
      bA = Math.max(0, Math.min(1, bA - dA));
    }

    out[i * 4] = bH;
    out[i * 4 + 1] = bS;
    out[i * 4 + 2] = bL;
    out[i * 4 + 3] = bA;
  }

  return { data: out, width: w, height: h };
}

// ============================================================
// 3. 残差纹理尺寸探测
// ============================================================

/**
 * 取残差/基础纹理的尺寸（优先残差，其次基础纹理，最后 sourceResolution）。
 * FluidSolver 分辨率应与纹理尺寸 1:1，避免采样缩放引入的残差量化错位。
 */
export function resolveFluidResolution(frameData: FrameData): { w: number; h: number } {
  const r = frameData.boundResidualTexture;
  if (r && r.width > 0 && r.height > 0) return { w: r.width, h: r.height };
  const b = frameData.boundBaseTexture;
  if (b && b.width > 0 && b.height > 0) return { w: b.width, h: b.height };
  const s = frameData.sourceResolution || 512;
  return { w: s, h: s };
}

// 注：流体配置 JSON 导入/导出转换器已移至 ./fluidConfigIO.ts（独立文件，
// 仅依赖 FluidSolver 类型，避免与 useAppStore 形成循环依赖）。
// 需要时直接从 fluidConfigIO 导入：parseImportedFluidConfig / serializeFluidConfigToJSON / defaultFluidRuntime。

