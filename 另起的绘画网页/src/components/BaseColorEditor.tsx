import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  clusterAndGenerateTexturesV2,
  hslToRgb,
  rgbToHsl,
} from '../utils/colorCompressor';
import {
  quantizeH,
  quantizeS,
  quantizeL,
  dequantizeH,
  dequantizeS,
  dequantizeL,
  getAdaptiveBlockIndex,
  getRangeForBlock,
  packRGB565,
  unpackRGB565,
  ADAPTIVE_TOTAL_BLOCKS,
} from '../core/ftxCore';
import type { Point } from '../types';
import BaseColorList from './BaseColorList';
import { useAppStore } from '../stores/useAppStore';
import type { SharedBaseColor } from '../stores/useAppStore';
import { packMultiFrameToBinary } from '../utils/multiFrameExport';
import { compressToGzip } from '../utils/binaryCompression';
import { refineResidualsAndColors } from '../core/refineResiduals';

// ========== 贝塞尔曲线辅助函数 ==========
function sampleQuadraticBezier(p0: Point, p1: Point, ctrl: Point, segments = 20): Point[] {
  const result: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x;
    const y = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;
    result.push({ x, y });
  }
  return result;
}

function buildBezierPath(points: Point[]): Point[] {
  if (points.length < 2) return points.slice();
  if (points.length === 2) return [points[0], points[1]];
  const fullPath: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const p0 = points[i - 1];
    const p1 = points[i + 1];
    const ctrl = points[i];
    const curve = sampleQuadraticBezier(p0, p1, ctrl, 20);
    fullPath.push(...curve.slice(1));
  }
  fullPath.push(points[points.length - 1]);
  return fullPath;
}

// ============ 坐标转换 ============

function canvasToWorld(cx: number, cy: number, textureSize: number): Point {
  return { x: cx / textureSize, y: 1 - cy / textureSize };
}

function worldToCanvas(wx: number, wy: number, textureSize: number): Point {
  return { x: wx * textureSize, y: (1 - wy) * textureSize };
}

function buildResidualTextureFromPacked(
  deltaPacked: Uint16Array,
  regionIdTex: Uint8Array,
  bbox: { x: number; y: number; w: number; h: number },
  textureSize: number
): ImageData {
  const { w, h, x: offsetX, y: offsetY } = bbox;
  const imageData = new ImageData(textureSize, textureSize);
  const data = imageData.data;
  data.fill(0);

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = py * w + px;
      if (regionIdTex[idx] === 0) continue;
      const packed = deltaPacked[idx];
      const { s, h: qH, l: qL } = unpackRGB565(packed);

      const globalX = offsetX + px;
      const globalY = offsetY + py;
      const pIdx = (globalY * textureSize + globalX) * 4;

      data[pIdx] = (qH / 63) * 255;
      data[pIdx + 1] = (s / 31) * 255;
      data[pIdx + 2] = (qL / 31) * 255;
      data[pIdx + 3] = 255;
    }
  }
  return imageData;
}

function buildCompositeFromPacked(
  regionIdTex: Uint8Array,
  baseColors: Array<{ id: number; h: number; s: number; l: number }>,
  deltaPacked: Uint16Array,
  bbox: { x: number; y: number; w: number; h: number },
  blockFlags: bigint,
  textureSize: number
): ImageData {
  const { w, h, x: offsetX, y: offsetY } = bbox;
  const imageData = new ImageData(textureSize, textureSize);
  const data = imageData.data;
  data.fill(0);

  const colorMapById = new Map<number, typeof baseColors[0]>();
  for (const c of baseColors) {
    colorMapById.set(c.id, c);
  }

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = py * w + px;
      const colorIdx = regionIdTex[idx];
      if (colorIdx === 0) continue;
      const base = colorMapById.get(colorIdx);
      if (!base) continue;

      const packed = deltaPacked[idx];
      const { s, h: qH, l: qL } = unpackRGB565(packed);

      const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
      const range = getRangeForBlock(blockFlags, blockIdx);

      const dH = dequantizeH(qH, range);
      const dS = dequantizeS(s, range);
      const dL = dequantizeL(qL, range);

      let finalH = base.h + dH;
      if (finalH < 0) finalH += 1.0;
      else if (finalH >= 1.0) finalH -= 1.0;
      const finalS = Math.max(0, Math.min(1, base.s + dS));
      const finalL = Math.max(0, Math.min(1, base.l + dL));

      const rgb = hslToRgb(finalH, finalS, finalL);
      const globalX = offsetX + px;
      const globalY = offsetY + py;
      const pIdx = (globalY * textureSize + globalX) * 4;
      data[pIdx] = rgb.r;
      data[pIdx + 1] = rgb.g;
      data[pIdx + 2] = rgb.b;
      data[pIdx + 3] = 255;
    }
  }
  return imageData;
}

// ============ 提取模式下的BFS取色 ============
function extractBaseByClick(
  bgImageData: ImageData,
  worldPolygons: Point[][],
  _clickPixel?: { x: number; y: number },
  textureSize: number = 512,
  forcedBbox?: { x: number; y: number; w: number; h: number } | null
): {
  baseTexture: ImageData;
  residualTexture: ImageData;
  deltaPacked: Uint16Array;
  bbox: { x: number; y: number; w: number; h: number };
  baseColors: Array<{ h: number; s: number; l: number }>;
  regionIdTex: Uint8Array;
  texW: number;
  texH: number;
  blockFlags: bigint;
} | null {
  if (worldPolygons.length === 0) return null;

  const rasterizablePolygons = worldPolygons.map(poly => {
    if (poly.length === 3) {
      return buildBezierPath(poly);
    }
    return poly.slice();
  });

  const wallMask = new Uint8Array(textureSize * textureSize);
  
  for (const poly of rasterizablePolygons) {
    if (poly.length < 2) continue;
    
    for (let i = 0; i < poly.length - 1; i++) {
      const p1 = poly[i];
      const p2 = poly[i + 1];
      
      const x1 = Math.round(p1.x * textureSize);
      const y1 = Math.round((1 - p1.y) * textureSize);
      const x2 = Math.round(p2.x * textureSize);
      const y2 = Math.round((1 - p2.y) * textureSize);
      
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);
      const sx = x1 < x2 ? 1 : -1;
      const sy = y1 < y2 ? 1 : -1;
      let err = dx - dy;
      let x = x1;
      let y = y1;
      
      while (true) {
        if (x >= 0 && x < textureSize && y >= 0 && y < textureSize) {
          for (let nx = x - 2; nx <= x + 2; nx++) {
            for (let ny = y - 2; ny <= y + 2; ny++) {
              if (nx >= 0 && nx < textureSize && ny >= 0 && ny < textureSize) {
                wallMask[ny * textureSize + nx] = 1;
              }
            }
          }
        }
        if (x === x2 && y === y2) break;
        const e2 = err * 2;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
    }
  }

  let pxBbox: { x: number; y: number; w: number; h: number };
  
  if (forcedBbox) {
    pxBbox = { ...forcedBbox };
  } else {
    let minX = textureSize, minY = textureSize, maxX = -1, maxY = -1;
    for (const poly of rasterizablePolygons) {
      for (const p of poly) {
        const px = Math.round(p.x * textureSize);
        const py = Math.round((1 - p.y) * textureSize);
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
    }
    
    minX = Math.max(0, minX - 10);
    minY = Math.max(0, minY - 10);
    maxX = Math.min(textureSize - 1, maxX + 10);
    maxY = Math.min(textureSize - 1, maxY + 10);
    
    pxBbox = {
      x: minX,
      y: minY,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    };
  }
  
  // 构建mask时跳过透明像素（alpha < 128），避免透明背景被当作黑色聚类
  const bfsVisited = new Uint8Array(textureSize * textureSize);
  let visitedCount = 0;
  for (let y = pxBbox.y; y < pxBbox.y + pxBbox.h; y++) {
    for (let x = pxBbox.x; x < pxBbox.x + pxBbox.w; x++) {
      const pIdx = (y * textureSize + x) * 4;
      const alpha = bgImageData.data[pIdx + 3];
      if (alpha >= 128) {
        bfsVisited[y * textureSize + x] = 1;
        visitedCount++;
      }
    }
  }

  const { w, h } = pxBbox;
  const localMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const globalIdx = (pxBbox.y + y) * textureSize + (pxBbox.x + x);
      localMask[y * w + x] = bfsVisited[globalIdx];
    }
  }

  let { baseColors: colors, regionIdTex, deltaPacked, blockFlags } = clusterAndGenerateTexturesV2(
    localMask,
    pxBbox,
    bgImageData,
    0.025,
    textureSize
  );

  if (colors.length === 0) return null;

  // ========== 自动修正：第一次产生残差后自动调用一次修正 ==========
  if (regionIdTex) {
    const totalPixels = w * h;
    
    // 将 deltaPacked（RGB565打包）转换为 tempDeltas（浮点残差）
    const tempDeltas = new Float32Array(totalPixels * 3);
    for (let idx = 0; idx < totalPixels; idx++) {
      const colorIdx = regionIdTex[idx];
      if (colorIdx === 0) {
        tempDeltas[idx * 3] = 0;
        tempDeltas[idx * 3 + 1] = 0;
        tempDeltas[idx * 3 + 2] = 0;
        continue;
      }
      const base = colors[colorIdx - 1];
      if (!base) continue;

      const packed = deltaPacked[idx];
      const { s, h: qH, l: qL } = unpackRGB565(packed);
      const blockIdx = getAdaptiveBlockIndex(idx % w, Math.floor(idx / w), w, h);
      const range = getRangeForBlock(blockFlags, blockIdx);

      const dH = dequantizeH(qH, range);
      const dS = dequantizeS(s, range);
      const dL = dequantizeL(qL, range);

      tempDeltas[idx * 3] = dH;
      tempDeltas[idx * 3 + 1] = dS;
      tempDeltas[idx * 3 + 2] = dL;
    }

    // 添加 id 字段以便 refineResidualsAndColors 使用
    const colorsWithId = colors.map((c, i) => ({ id: i + 1, ...c }));
    const regionIdTexCopy = new Uint8Array(regionIdTex);

    // 调用修正函数
    const refinementResult = refineResidualsAndColors(
      regionIdTexCopy,
      colorsWithId,
      pxBbox,
      bgImageData,
      tempDeltas,
      textureSize,
      0.015,
      3
    );

    // 更新修正后的结果
    regionIdTex = regionIdTexCopy;
    colors = colorsWithId;
    blockFlags = refinementResult.blockFlags;

    // 将修正后的 tempDeltas 重新打包为 deltaPacked
    const newDeltaPacked = new Uint16Array(totalPixels);
    for (let idx = 0; idx < totalPixels; idx++) {
      const colorIdx = regionIdTex[idx];
      if (colorIdx === 0) {
        newDeltaPacked[idx] = 0;
        continue;
      }
      const base = colors[colorIdx - 1];
      if (!base) continue;

      const dH = tempDeltas[idx * 3];
      const dS = tempDeltas[idx * 3 + 1];
      const dL = tempDeltas[idx * 3 + 2];

      const blockIdx = getAdaptiveBlockIndex(idx % w, Math.floor(idx / w), w, h);
      const range = getRangeForBlock(blockFlags, blockIdx);

      const qH = quantizeH(dH, range);
      const qS = quantizeS(dS, range);
      const qL = quantizeL(dL, range);

      newDeltaPacked[idx] = packRGB565(qS, qH, qL);
    }
    deltaPacked = newDeltaPacked;
  }

  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = textureSize;
  baseCanvas.height = textureSize;
  const baseCtx = baseCanvas.getContext('2d')!;
  const baseImageData = baseCtx.createImageData(textureSize, textureSize);
  const baseData = baseImageData.data;

  if (regionIdTex) {
    for (let localIdx = 0; localIdx < regionIdTex.length; localIdx++) {
      const clusterIdx = regionIdTex[localIdx];
      if (clusterIdx > 0) {
        const colorIndex = clusterIdx - 1;
        const base = colors[colorIndex] || colors[0];
        const rgb = hslToRgb(base.h, base.s, base.l);
        
        const localY = Math.floor(localIdx / w);
        const localX = localIdx % w;
        const globalY = pxBbox.y + localY;
        const globalX = pxBbox.x + localX;
        const idx = (globalY * textureSize + globalX) * 4;
        
        baseData[idx] = rgb.r;
        baseData[idx + 1] = rgb.g;
        baseData[idx + 2] = rgb.b;
        baseData[idx + 3] = 255;
      }
    }
  } else if (colors.length > 0) {
    const base = colors[0];
    const rgb = hslToRgb(base.h, base.s, base.l);
    for (let localY = 0; localY < h; localY++) {
      for (let localX = 0; localX < w; localX++) {
        const globalY = pxBbox.y + localY;
        const globalX = pxBbox.x + localX;
        const idx = (globalY * textureSize + globalX) * 4;
        baseData[idx] = rgb.r;
        baseData[idx + 1] = rgb.g;
        baseData[idx + 2] = rgb.b;
        baseData[idx + 3] = 255;
      }
    }
  }

  const residualTexture = buildResidualTextureFromPacked(deltaPacked, regionIdTex!, pxBbox, textureSize);

  return {
    baseTexture: baseImageData,
    residualTexture,
    deltaPacked,
    bbox: pxBbox,
    baseColors: colors,
    regionIdTex: regionIdTex || new Uint8Array(0),
    texW: w,
    texH: h,
    blockFlags,
  };
}

function buildBaseTextureFromLocalColors(
  colors: Array<{ h: number; s: number; l: number }>,
  regionIdTex: Uint8Array,
  bbox: { x: number; y: number; w: number; h: number },
  textureSize: number
): ImageData {
  const { w, h, x: offsetX, y: offsetY } = bbox;
  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(textureSize, textureSize);
  const data = imageData.data;
  data.fill(0);

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = py * w + px;
      const localIdx = regionIdTex[idx];
      if (localIdx === 0) continue;
      const color = colors[localIdx - 1];
      if (!color) continue;
      const rgb = hslToRgb(color.h, color.s, color.l);
      const globalX = offsetX + px;
      const globalY = offsetY + py;
      const pIdx = (globalY * textureSize + globalX) * 4;
      data[pIdx] = rgb.r;
      data[pIdx + 1] = rgb.g;
      data[pIdx + 2] = rgb.b;
      data[pIdx + 3] = 255;
    }
  }
  return imageData;
}

// 色相差值（环形距离）
function deltaHue(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > 0.5) d = 1 - d;
  return d;
}

// ============ 组件 ============
export const BaseColorEditor: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [drawingPolygon, setDrawingPolygon] = useState<Point[] | null>(null);
  const [currentTool, setCurrentTool] = useState<'dashed' | 'bezier' | 'paint' | 'picker' | 'select'>('dashed');
  const [mode, setMode] = useState<'base' | 'residual' | 'composite' | 'base2'>('base');
  const {
    skillGroupEditor,
    canvasWidth,
    addSkillFrame,
    removeSkillFrame,
    switchSkillFrame,
    updateSkillFrame,
    setGlobalBbox,
    syncGlobalBboxFromCurrentFrame,
    updateColorValue,
    addColorToPalette,
    syncFrameTextures,
    sortPaletteByArea,
    reclusterFrameFromScratch,
    triggerCanvasRedraw,
    setEnableFramePrediction,
    undo,           // 全局撤销
    redo,           // 全局重做
    saveHistory,    // 全局保存历史
    historyIndex,   // 全局历史索引
    historySnapshots, // 全局历史快照
    mergeSimilarColors,
  } = useAppStore();

  const { frames, sharedBaseColors, activeFrameId, globalBbox, enableFramePrediction } = skillGroupEditor;
  const currentFrame = frames.find((f: typeof frames[0]) => f.id === activeFrameId) || null;

  const bgImageData = currentFrame?.bgImageData || null;
  const dashedPolygons = currentFrame?.dashedPolygons || [];
  const baseTexture = currentFrame?.baseTexture || null;
  const residualTexture = currentFrame?.residualTexture || null;
  const bbox = currentFrame?.bbox || null;
  const regionIdTex = currentFrame?.regionIdTex || new Uint8Array(0);
  const baseColors = sharedBaseColors;

  const setBgImageData = useCallback((val: ImageData | null) => {
    if (activeFrameId) updateSkillFrame(activeFrameId, { bgImageData: val });
  }, [activeFrameId, updateSkillFrame]);

  const setDashedPolygons = useCallback((val: Point[][] | ((prev: Point[][]) => Point[][])) => {
    if (!activeFrameId) return;
    const frame = frames.find((f: typeof frames[0]) => f.id === activeFrameId);
    const currentPolygons = frame?.dashedPolygons || [];
    const newVal = typeof val === 'function' ? val(currentPolygons) : val;
    updateSkillFrame(activeFrameId, { dashedPolygons: newVal });
  }, [activeFrameId, frames, updateSkillFrame]);

  const setBaseTexture = useCallback((val: ImageData | null) => {
    if (activeFrameId) updateSkillFrame(activeFrameId, { baseTexture: val });
  }, [activeFrameId, updateSkillFrame]);

  const setResidualTexture = useCallback((val: ImageData | null) => {
    if (activeFrameId) updateSkillFrame(activeFrameId, { residualTexture: val });
  }, [activeFrameId, updateSkillFrame]);

  const setBbox = useCallback((val: { x: number; y: number; w: number; h: number } | null) => {
    if (activeFrameId) updateSkillFrame(activeFrameId, { bbox: val });
  }, [activeFrameId, updateSkillFrame]);

  const setRegionIdTex = useCallback((val: Uint8Array) => {
    if (activeFrameId) updateSkillFrame(activeFrameId, { regionIdTex: val });
  }, [activeFrameId, updateSkillFrame]);

  // ★ 动态纹理分辨率（必须在 handleResolutionChange 之前声明）
  const [texSize, setTexSize] = useState(canvasWidth);

  // ★ 修改：仅在初始化时同步 canvasWidth，后续允许手动调整分辨率
  useEffect(() => {
    // 只有在没有任何帧数据时才自动同步（初始化阶段）
    const hasFrameData = frames.some(f => f.bgImageData || f.baseTexture || f.bbox);
    if (canvasWidth && canvasWidth !== texSize && !hasFrameData) {
      console.log(`[BaseColorEditor] texSize 初始化同步：${texSize} → ${canvasWidth}`);
      setTexSize(canvasWidth);
    }
  }, [canvasWidth, frames, texSize]);

  // ★ 分辨率调整功能：缩放所有帧数据到新尺寸
  const handleResolutionChange = useCallback((newSize: number) => {
    // ★ 输入验证：确保分辨率在合理范围内
    const minSize = 64;
    const maxSize = 2048;
    
    if (isNaN(newSize) || newSize < minSize || newSize > maxSize) {
      console.warn(`[分辨率调整] 无效值 ${newSize}，范围应为 ${minSize}~${maxSize}`);
      // 恢复显示旧值
      setTexSize(texSize);
      return;
    }
    
    if (newSize === texSize) return;
    
    console.log(`[分辨率调整] ${texSize}×${texSize} → ${newSize}×${newSize}`);
    
    // 保存历史（调整前）
    saveHistory();
    
    const oldSize = texSize;
    const scaleX = newSize / oldSize;
    const scaleY = newSize / oldSize;
    
    // 缩放所有帧的数据
    frames.forEach((frame) => {
      const updates: Record<string, unknown> = {};
      
      // 1. 缩放背景图
      if (frame.bgImageData) {
        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = oldSize;
        srcCanvas.height = oldSize;
        const srcCtx = srcCanvas.getContext('2d')!;
        srcCtx.putImageData(frame.bgImageData, 0, 0);
        
        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = newSize;
        dstCanvas.height = newSize;
        const dstCtx = dstCanvas.getContext('2d')!;
        // 使用最近邻插值保留像素清晰度
        dstCtx.imageSmoothingEnabled = false;
        dstCtx.drawImage(srcCanvas, 0, 0, newSize, newSize);
        
        updates.bgImageData = dstCtx.getImageData(0, 0, newSize, newSize);
      }
      
      // ★ 移除 baseTexture 和 residualTexture 的直接缩放
      // 因为它们需要根据新的 regionIdTex 重新生成
      // 将在后面通过 syncFrameTextures 统一生成，确保与 regionIdTex 同步
      
      // 4. 缩放 bbox（坐标和尺寸）
      if (frame.bbox) {
        const newBbox = {
          x: Math.round(frame.bbox.x * scaleX),
          y: Math.round(frame.bbox.y * scaleY),
          w: Math.round(frame.bbox.w * scaleX),
          h: Math.round(frame.bbox.h * scaleY),
        };
        // ★ 边界检查：确保 bbox 在画布范围内且尺寸有效
        newBbox.x = Math.max(0, Math.min(newSize - 1, newBbox.x));
        newBbox.y = Math.max(0, Math.min(newSize - 1, newBbox.y));
        newBbox.w = Math.max(1, Math.min(newSize - newBbox.x, newBbox.w));
        newBbox.h = Math.max(1, Math.min(newSize - newBbox.y, newBbox.h));
        // 如果 bbox 有效则更新
        if (newBbox.w > 0 && newBbox.h > 0) {
          updates.bbox = newBbox;
        } else {
          console.warn(`[分辨率调整] 帧 ${frame.id} 的 bbox 缩放后无效，已丢弃`);
        }
      }
      
      // 5. 缩放 regionIdTex 和 deltaPacked（需要重采样）
      // ★ 只有当 bbox 有效时才进行缩放
      if (frame.regionIdTex && updates.bbox) {
        const oldBbox = frame.bbox!;
        const newBbox = updates.bbox;
        
        const oldW = oldBbox.w;
        const oldH = oldBbox.h;
        const newW = newBbox.w;
        const newH = newBbox.h;
        
        // 创建新的 regionIdTex
        const newRegionIdTex = new Uint8Array(newW * newH);
        newRegionIdTex.fill(0);
        
        // 创建新的 deltaPacked
        const newDeltaPacked = new Uint16Array(newW * newH);
        newDeltaPacked.fill(0);
        
        // 最近邻重采样
        for (let ny = 0; ny < newH; ny++) {
          for (let nx = 0; nx < newW; nx++) {
            // 反向映射到旧坐标
            const oldPy = Math.min(oldH - 1, Math.floor(ny / scaleY));
            const oldPx = Math.min(oldW - 1, Math.floor(nx / scaleX));
            const oldIdx = oldPy * oldW + oldPx;
            const newIdx = ny * newW + nx;
            
            newRegionIdTex[newIdx] = frame.regionIdTex[oldIdx];
            if (frame.deltaPacked) {
              newDeltaPacked[newIdx] = frame.deltaPacked[oldIdx];
            }
          }
        }
        
        updates.regionIdTex = newRegionIdTex;
        if (frame.deltaPacked) {
          updates.deltaPacked = newDeltaPacked;
        }
      }
      
      // 6. 缩放 dashedPolygons（世界坐标不变，无需修改）
      // 虚线多边形使用世界坐标 (0~1)，缩放画布尺寸后自动适配
      
      if (Object.keys(updates).length > 0) {
        updateSkillFrame(frame.id, updates);
      }
    });
    
    // 7. 缩放 globalBbox
    if (globalBbox) {
      setGlobalBbox({
        x: Math.round(globalBbox.x * scaleX),
        y: Math.round(globalBbox.y * scaleY),
        w: Math.round(globalBbox.w * scaleX),
        h: Math.round(globalBbox.h * scaleY),
      });
    }
    
    // 8. 更新 texSize
    setTexSize(newSize);
    
    // 9. ★ 重新生成所有帧的基础色和残差纹理（基于新的 regionIdTex 和 deltaPacked）
    // 使用 setTimeout 确保 state 更新完成后再执行
    setTimeout(() => {
      for (const frame of frames) {
        if (frame.regionIdTex && frame.regionIdTex.length > 0 && frame.bbox) {
          syncFrameTextures(frame.id);
        }
      }
      console.log(`[分辨率调整] 完成，已缩放 ${frames.length} 个帧，已重新生成纹理`);
    }, 0);
  }, [texSize, frames, updateSkillFrame, setGlobalBbox, saveHistory, syncFrameTextures]);

  const [residualRanges, setResidualRanges] = useState<Float32Array | null>(null);
  const [blockFlags, setBlockFlags] = useState(0n);

  const [showColorInfoOnClick, setShowColorInfoOnClick] = useState(false);
  
  const [debugShowBadPixels, setDebugShowBadPixels] = useState(false);
  const [debugBadPixels, setDebugBadPixels] = useState<number[]>([]);
  
  const [colorInfo, setColorInfo] = useState<{
    x: number;
    y: number;
    overlayRgb: { r: number; g: number; b: number };
    overlayHsl: { h: number; s: number; l: number };
    bgRgb: { r: number; g: number; b: number };
    bgHsl: { h: number; s: number; l: number };
    baseColor: { h: number; s: number; l: number };
    residualHsl: { h: number; s: number; l: number };
    hueDiff: number;
    satDiff: number;
    lightDiff: number;
    hueThreshold: number;
    satThreshold: number;
    lightThreshold: number;
    meetsStandard: boolean;
    colorId: number;
  } | null>(null);

  useEffect(() => {
    if (frames.length === 0) {
      addSkillFrame('帧 1');
    }
  }, [frames.length, addSkillFrame]);

  const buildColorPixelsMap = useCallback((regionIdTex: Uint8Array): Map<number, number[]> => {
    const map = new Map<number, number[]>();
    for (let i = 0; i < regionIdTex.length; i++) {
      const globalId = regionIdTex[i];
      if (globalId > 0) {
        if (!map.has(globalId)) map.set(globalId, []);
        map.get(globalId)!.push(i);
      }
    }
    return map;
  }, []);

  useEffect(() => {
    setDrawingPolygon(null);
    const frame = frames.find((f: typeof frames[0]) => f.id === activeFrameId);
    if (frame && frame.regionIdTex.length > 0) {
      setColorPixelsMap(buildColorPixelsMap(frame.regionIdTex));
    }
  }, [activeFrameId, frames, buildColorPixelsMap]);

  useEffect(() => {
    setDebugBadPixels([]);
    setDebugShowBadPixels(false);
  }, [activeFrameId]);

  const [colorPixelsMap, setColorPixelsMap] = useState<Map<number, number[]> | null>(null);
  const [selectedBaseColorId, setSelectedBaseColorId] = useState<number | null>(null);
  const [pickingId, setPickingId] = useState<number | null>(null);
  const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
  const [editingFrameName, setEditingFrameName] = useState('');

  const highlightCanvasRef = useRef<HTMLCanvasElement>(null);
  const tempPixelsRef = useRef<Set<string>>(new Set());
  const isProcessingRef = useRef(false);

  const handleSelectBaseColor = useCallback((id: number) => {
    const prev = selectedBaseColorId;
    const newId = prev === id ? null : id;
    setSelectedBaseColorId(newId);

    // ★ 调试输出：颜色选择详情
    if (newId !== null) {
      const color = sharedBaseColors.find(c => c.id === newId);
      console.log(`[高亮调试] 选中颜色 ID=${newId}`);
      console.log(`  颜色值: H=${color?.h.toFixed(4) ?? '?'} S=${color?.s.toFixed(4) ?? '?'} L=${color?.l.toFixed(4) ?? '?'}`);
      console.log(`  区域面积: ${color?.area ?? 0} 像素`);
      console.log(`  texSize: ${texSize}, bbox: ${bbox ? `(${bbox.x},${bbox.y}) w=${bbox.w} h=${bbox.h}` : 'null'}`);
      console.log(`  区域ID数据: ${regionIdTex ? regionIdTex.length : 0} 像素`);
    } else {
      console.log(`[高亮调试] 取消选中 (前: ID=${prev})`);
    }
  }, [selectedBaseColorId, sharedBaseColors, texSize, bbox, regionIdTex]);

  useEffect(() => {
    return () => {
      tempPixelsRef.current.clear();
    };
  }, []);

  // 2D Canvas 高亮绘制：选中颜色时，在 regionIdTex 中对应像素上绘制半透明白色
  useEffect(() => {
    const canvas = highlightCanvasRef.current;
    if (!canvas) return;

    // 尺寸与 texSize 同步
    if (canvas.width !== texSize || canvas.height !== texSize) {
      canvas.width = texSize;
      canvas.height = texSize;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 如果模式不是 base2 或没有选中颜色，清空画布
    if (mode !== 'base2' || selectedBaseColorId === null || !regionIdTex || regionIdTex.length === 0 || !bbox) {
      ctx.clearRect(0, 0, texSize, texSize);
      return;
    }

    const { w, h, x: offsetX, y: offsetY } = bbox;
    const imageData = ctx.createImageData(texSize, texSize);
    const data = imageData.data;

    // 先全部透明
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }

    // 遍历 regionIdTex，匹配目标颜色 ID
    const targetId = selectedBaseColorId;
    let matchedPixels = 0;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const localIdx = py * w + px;
        if (regionIdTex[localIdx] === targetId) {
          const gx = offsetX + px;
          const gy = offsetY + py;
          const pixelIdx = (gy * texSize + gx) * 4;
          data[pixelIdx] = 255;      // R
          data[pixelIdx + 1] = 255;  // G
          data[pixelIdx + 2] = 255;  // B
          data[pixelIdx + 3] = 180;  // A (~70%)
          matchedPixels++;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
    if (matchedPixels > 0) {
      console.log(`[高亮] 选中 ID=${selectedBaseColorId}，高亮 ${matchedPixels} 个像素`);
    }
  }, [mode, selectedBaseColorId, regionIdTex, bbox, texSize]);

  const [brushColor, setBrushColor] = useState('#ff0000');
  const [brushSize, setBrushSize] = useState(8);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapPoint, setSnapPoint] = useState<Point | null>(null);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const [isExtractMode, setIsExtractMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // 键盘快捷键（使用全局撤销/重做）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  // 全局撤销/重做后，重置本地缓存状态（blockFlags/residualRanges 可能已过时）
  useEffect(() => {
    setSelectedBaseColorId(null);
    setResidualRanges(null);
    setBlockFlags(0n);
  }, [currentFrame?.regionIdTex?.length, currentFrame?.deltaPacked?.length, currentFrame?.bbox?.w, currentFrame?.bbox?.h]);

  // 滚轮缩放
  // 拖拽平移（中键或空格+左键）
  const handleContainerMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  }, [pan]);

  const handleContainerMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const dy = e.clientY - panStartRef.current.y;
    setPan({ x: panStartRef.current.panX + dx, y: panStartRef.current.panY + dy });
  }, []);

  const handleContainerMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  // 点吸附函数（控制点不参与吸附）
  const snapPointToExisting = useCallback((point: Point, currentPointCount: number, toolType: string): Point => {
    if (!snapEnabled) return point;
    const shouldSnap = (() => {
      if (toolType === 'bezier' && currentPointCount >= 2) return false;
      return true;
    })();
    if (!shouldSnap) return point;

    const canvasPoint = { x: point.x * texSize, y: (1 - point.y) * texSize };
    const snapRadiusPx = 10;
    let bestMatch: Point | null = null;
    let bestDist = snapRadiusPx;

    const candidateMap = new Map<string, Point>();
    const addCandidate = (p: Point) => {
      const key = `${Math.round(p.x * 1e6)}_${Math.round(p.y * 1e6)}`;
      if (!candidateMap.has(key)) candidateMap.set(key, p);
    };

    for (const poly of dashedPolygons) {
      for (let i = 0; i < poly.length; i++) {
        if (poly.length === 3 && i === 2) continue;
        addCandidate(poly[i]);
      }
    }

    if (drawingPolygon) {
      drawingPolygon.forEach(p => addCandidate(p));
    }

    for (const p of candidateMap.values()) {
      const pCanvas = { x: p.x * texSize, y: (1 - p.y) * texSize };
      const dist = Math.hypot(canvasPoint.x - pCanvas.x, canvasPoint.y - pCanvas.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = p;
      }
    }

    return bestMatch || point;
  }, [snapEnabled, dashedPolygons, drawingPolygon, texSize]);

  // 加载背景图
  const handleLoadBackground = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // 根据图片原始尺寸计算纹理分辨率
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const MAX_SIZE = 2048;
        if (w > MAX_SIZE || h > MAX_SIZE) {
          const scale = Math.min(MAX_SIZE / w, MAX_SIZE / h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const newSize = Math.max(w, h);
        setTexSize(newSize);

        const canvas = document.createElement('canvas');
        canvas.width = newSize;
        canvas.height = newSize;
        const ctx = canvas.getContext('2d')!;
        // 居中绘制图片
        const sx = (newSize - w) / 2;
        const sy = (newSize - h) / 2;
        ctx.drawImage(img, sx, sy, w, h);
        const imageData = ctx.getImageData(0, 0, newSize, newSize);
        setBgImageData(imageData);
        setDashedPolygons([]);
        setDrawingPolygon(null);
        setBaseTexture(null);
        setResidualTexture(null);
        setBbox(null);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, [setBgImageData, setDashedPolygons, setBaseTexture, setResidualTexture, setBbox]);

  // 进入提取模式
  const handleAutoExtract = useCallback(() => {
    if (!bgImageData) return;
    const allPolygons = drawingPolygon && drawingPolygon.length >= 3
      ? [...dashedPolygons, drawingPolygon]
      : dashedPolygons;
    if (allPolygons.length === 0) return;

    setDrawingPolygon(null);
    setPreviewPoint(null);
    setCurrentTool('select');
    setIsExtractMode(true);
  }, [bgImageData, dashedPolygons, drawingPolygon]);

  const autoMergeToGlobal = useCallback((frameId: string) => {
    const store = useAppStore.getState();
    const frame = store.skillGroupEditor.frames.find(f => f.id === frameId);
    if (!frame) return;
    if (!frame.baseColorValues || frame.baseColorValues.length === 0) return;
    if (!frame.regionIdTex || frame.regionIdTex.length === 0) return;

    const localColors = frame.baseColorValues;

    // 映射本地颜色索引 (1-based) → 全局颜色 ID
    const localToGlobal = new Map<number, number>();
    for (let i = 0; i < localColors.length; i++) {
      const globalId = store.addColorToPalette(localColors[i], frameId);
      localToGlobal.set(i + 1, globalId);
    }

    // 替换 regionIdTex 中的本地索引为全局 ID
    const newRegionIdTex = new Uint8Array(frame.regionIdTex.length);
    for (let i = 0; i < frame.regionIdTex.length; i++) {
      const localIdx = frame.regionIdTex[i];
      newRegionIdTex[i] = localIdx === 0 ? 0 : (localToGlobal.get(localIdx) || 0);
    }

    updateSkillFrame(frameId, {
      regionIdTex: newRegionIdTex,
      baseColorValues: [],
    });

    syncFrameTextures(frameId);
    sortPaletteByArea();

    console.log(`[自动合并] 帧 ${frameId}: ${localColors.length} 个本地颜色 → 全局调色板`);
  }, [updateSkillFrame, syncFrameTextures, sortPaletteByArea, addColorToPalette]);

  const handleExtractClick = useCallback((pixel: { x: number; y: number }) => {
    const state = useAppStore.getState();
    const currentActiveFrameId = state.skillGroupEditor.activeFrameId;
    const currentFrameData = state.skillGroupEditor.frames.find(f => f.id === currentActiveFrameId);
    if (!currentFrameData?.bgImageData) return;

    const currentDashedPolygons = currentFrameData.dashedPolygons || [];
    let allPolygons = currentDashedPolygons;
    if (drawingPolygon && drawingPolygon.length >= 3) {
      allPolygons = [...currentDashedPolygons, drawingPolygon];
    }
    if (allPolygons.length === 0) return;

    const result = extractBaseByClick(currentFrameData.bgImageData, allPolygons, pixel, texSize, state.skillGroupEditor.globalBbox);
    if (result) {
      const { baseColors: localBaseColors, regionIdTex: localRegionIdTex, deltaPacked, bbox, residualTexture, blockFlags } = result;

      const newBaseTexture = buildBaseTextureFromLocalColors(
        localBaseColors,
        localRegionIdTex,
        bbox,
        texSize
      );

      updateSkillFrame(currentActiveFrameId, {
        baseColorValues: localBaseColors,
        baseTexture: newBaseTexture,
        residualTexture: residualTexture,
        bbox: bbox,
        regionIdTex: localRegionIdTex,
        deltaPacked: deltaPacked,
        blockFlags: blockFlags,
      });

      setIsExtractMode(false);

      autoMergeToGlobal(currentActiveFrameId);
      mergeSimilarColors(0.005);  // 合并相似颜色后再保存历史

      if (!state.skillGroupEditor.globalBbox) {
        setGlobalBbox(result.bbox);
      }

      setTimeout(() => {
        const updatedFrame = useAppStore.getState().skillGroupEditor.frames.find(f => f.id === currentActiveFrameId);
        if (updatedFrame && updatedFrame.regionIdTex.length > 0) {
          setColorPixelsMap(buildColorPixelsMap(updatedFrame.regionIdTex));
        }
        saveHistory();
      }, 0);
    }
  }, [drawingPolygon, updateSkillFrame, setColorPixelsMap, buildColorPixelsMap, autoMergeToGlobal, setGlobalBbox, texSize]);

  const recalculateResidual = useCallback(() => {
    if (!bgImageData || !bbox || baseColors.length === 0) return;

    const { w, h } = bbox;
    const totalPixels = w * h;
    const tempDeltas = new Float32Array(totalPixels * 3);

    // 构建颜色映射：ID -> 基础色（使用最新的 baseColors，来自全局调色板）
    const colorMapById = new Map<number, SharedBaseColor>();
    for (const c of baseColors) {
      colorMapById.set(c.id, c);
    }

    // 1. 计算原始残差（基于背景色和基础色）
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx3 = py * w + px;
        const colorId = regionIdTex[idx3];
        const baseHsl = colorMapById.get(colorId);
        if (!baseHsl) continue;

        const x = bbox.x + px;
        const y = bbox.y + py;
        const idx = (y * texSize + x) * 4;
        const origHsl = rgbToHsl(bgImageData.data[idx], bgImageData.data[idx + 1], bgImageData.data[idx + 2]);

        let dH = origHsl.h - baseHsl.h;
        if (dH > 0.5) dH -= 1.0;
        if (dH < -0.5) dH += 1.0;
        tempDeltas[idx3 * 3] = dH;
        tempDeltas[idx3 * 3 + 1] = origHsl.s - baseHsl.s;
        tempDeltas[idx3 * 3 + 2] = origHsl.l - baseHsl.l;
      }
    }

    // 2. 计算初始 blockFlags（窄范围判断）
    const blockPixelCount = new Uint32Array(ADAPTIVE_TOTAL_BLOCKS);
    const blockSmallCount = new Uint32Array(ADAPTIVE_TOTAL_BLOCKS);
    for (let idx = 0; idx < totalPixels; idx++) {
      const colorId = regionIdTex[idx];
      if (colorId === 0) continue;
      const px = idx % w;
      const py = Math.floor(idx / w);
      const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
      blockPixelCount[blockIdx]++;

      const dH = tempDeltas[idx * 3];
      const dS = tempDeltas[idx * 3 + 1];
      const dL = tempDeltas[idx * 3 + 2];
      if (Math.abs(dH) <= 0.25 && Math.abs(dS) <= 0.25 && Math.abs(dL) <= 0.25) {
        blockSmallCount[blockIdx]++;
      }
    }

    let newBlockFlags = 0;
    for (let b = 0; b < ADAPTIVE_TOTAL_BLOCKS; b++) {
      if (blockPixelCount[b] > 0 && blockSmallCount[b] / blockPixelCount[b] >= 0.95) {
        newBlockFlags |= (1 << b);
      }
    }
    console.log('[初始 blockFlags]', newBlockFlags.toString(16).padStart(4, '0'));

    // 3. 调用修正（处理坏像素）
    const regionIdTexCopy = new Uint8Array(regionIdTex);
    const baseColorsCopy = baseColors.map(c => ({ ...c }));
    const prevColorCount = baseColorsCopy.length;
    const refinementResult = refineResidualsAndColors(
      regionIdTexCopy,
      baseColorsCopy,
      bbox,
      bgImageData,
      tempDeltas,
      texSize,
      0.015,
      3
    );

    // 4. 采用修正后的 blockFlags（如果修正改变了 blockFlags，则采用新值）
    if (refinementResult.blockFlags !== newBlockFlags) {
      console.log(`[残差修正] blockFlags 更新: 0x${newBlockFlags.toString(16)} → 0x${refinementResult.blockFlags.toString(16)}`);
      newBlockFlags = refinementResult.blockFlags;
    }

    // 5. 如果修正修改了 regionIdTex 或 baseColors，则同步到 store
    if (refinementResult.changed) {
      if (activeFrameId) {
        updateSkillFrame(activeFrameId, { regionIdTex: regionIdTexCopy });
      }
      if (baseColorsCopy.length !== prevColorCount) {
        const oldToNewId = new Map<number, number>();
        for (let i = prevColorCount; i < baseColorsCopy.length; i++) {
          const c = baseColorsCopy[i];
          const globalId = addColorToPalette({ h: c.h, s: c.s, l: c.l }, activeFrameId || '');
          oldToNewId.set(c.id, globalId);
        }
        for (let i = 0; i < regionIdTexCopy.length; i++) {
          const oldId = regionIdTexCopy[i];
          if (oldToNewId.has(oldId)) {
            regionIdTexCopy[i] = oldToNewId.get(oldId)!;
          }
        }
        if (activeFrameId) {
          updateSkillFrame(activeFrameId, { regionIdTex: regionIdTexCopy });
        }
      }
    }

    // 保存坏像素列表（用于调试高亮）
    if (refinementResult.badPixels) {
      setDebugBadPixels(refinementResult.badPixels);
    }

    // 6. 根据最终 blockFlags 计算范围数组
    const ranges = new Float32Array(ADAPTIVE_TOTAL_BLOCKS);
    for (let b = 0; b < ADAPTIVE_TOTAL_BLOCKS; b++) {
      ranges[b] = (newBlockFlags & (1n << BigInt(b))) ? 0.25 : 0.5;
    }
    setResidualRanges(ranges);
    setBlockFlags(newBlockFlags);

    // 7. 重新打包 deltaPacked（使用最新的 tempDeltas 和 ranges）
    const effectiveRegionIdTex = refinementResult.changed ? regionIdTexCopy : regionIdTex;
    const deltaPacked = new Uint16Array(totalPixels);
    for (let idx = 0; idx < totalPixels; idx++) {
      const colorId = effectiveRegionIdTex[idx];
      if (colorId === 0) continue;
      const px = idx % w;
      const py = Math.floor(idx / w);
      const blockIdx = getAdaptiveBlockIndex(px, py, w, h);
      const range = ranges[blockIdx];

      const dH = tempDeltas[idx * 3];
      const dS = tempDeltas[idx * 3 + 1];
      const dL = tempDeltas[idx * 3 + 2];
      const qH = quantizeH(dH, range);
      const qS = quantizeS(dS, range);
      const qL = quantizeL(dL, range);
      deltaPacked[idx] = packRGB565(qS, qH, qL);
    }

    // 8. 生成残差纹理（用于显示）
    const residualDisplay = buildResidualTextureFromPacked(deltaPacked, regionIdTex, bbox, texSize);
    setResidualTexture(residualDisplay);

    // 9. 更新帧数据（包含 blockFlags 和 deltaPacked）
    if (activeFrameId) {
      updateSkillFrame(activeFrameId, {
        residualTexture: residualDisplay,
        deltaPacked: deltaPacked,
        blockFlags: newBlockFlags,
      });

      // 同步 blockFlags 和 deltaPacked 到 frameDataMap（Toolbar 导出需要）
      const store = useAppStore.getState();
      const frameDataEntries = store.frameDataMap;
      let syncedCount = 0;
      const currentFrame = store.skillGroupEditor.frames.find(f => f.id === activeFrameId);
      if (currentFrame && currentFrame.bbox && currentFrame.regionIdTex) {
        for (const [layerId, fd] of Object.entries(frameDataEntries)) {
          // 通过 bbox 和 regionIdTex 长度匹配（更具唯一性）
          if (fd.rawBbox && 
              fd.rawBbox.x === currentFrame.bbox!.x && 
              fd.rawBbox.y === currentFrame.bbox!.y &&
              fd.rawBbox.w === currentFrame.bbox!.w &&
              fd.rawBbox.h === currentFrame.bbox!.h &&
              fd.rawRegionIdTex && currentFrame.regionIdTex &&
              fd.rawRegionIdTex.length === currentFrame.regionIdTex.length) {
            useAppStore.setState({
              frameDataMap: {
                ...store.frameDataMap,
                [layerId]: {
                  ...fd,
                  rawBlockFlags: BigInt(newBlockFlags),
                  rawDeltaPacked: deltaPacked,
                },
              },
            });
            syncedCount++;
          }
        }
      }
      if (syncedCount > 0) {
        console.log(`[残差计算] blockFlags=0x${newBlockFlags.toString(16)} 同步到 ${syncedCount} 个 frameDataMap 条目`);
      }
    }

    // 10. 强制触发画布重绘（确保合成模式立即更新）
    setTimeout(() => {
      triggerCanvasRedraw();
      saveHistory();
    }, 0);

    console.log(`[残差计算完成] blockFlags=0x${newBlockFlags.toString(16).padStart(4, '0')}, 坏像素=${refinementResult.badPixels?.length || 0}`);
  }, [bgImageData, bbox, baseColors, regionIdTex, activeFrameId, texSize, addColorToPalette, updateSkillFrame, triggerCanvasRedraw]);

  // 更新基础色值（仅更新调色板，不重算残差——滑块拖动时性能优化）
  const updateBaseColor = useCallback((id: number, newHSL: { h: number; s: number; l: number }) => {
    updateColorValue(id, newHSL);
  }, [updateColorValue]);

  const handlePickColor = useCallback((id: number) => {
    setPickingId(prev => prev === id ? null : id);
  }, []);

  // HSL 滑块拖拽结束后合并相似颜色，再重算残差
  const handleDragEnd = useCallback(() => {
    mergeSimilarColors(0.005);
    recalculateResidual();
  }, [mergeSimilarColors, recalculateResidual]);

  const handleRecluster = useCallback(() => {
    if (!activeFrameId) return;
    
    reclusterFrameFromScratch(activeFrameId);

    setSelectedBaseColorId(null);
    setResidualRanges(null);
    setBlockFlags(0);

    setTimeout(() => {
      const state = useAppStore.getState();
      const currentFrame = state.skillGroupEditor.frames.find(f => f.id === state.skillGroupEditor.activeFrameId);
      if (currentFrame && currentFrame.regionIdTex) {
        setColorPixelsMap(buildColorPixelsMap(currentFrame.regionIdTex));
      }
      // 刷新纹理和画布（仅显示更新，不重新计算残差）
      syncFrameTextures(activeFrameId);
      triggerCanvasRedraw();
      saveHistory();
    }, 0);
  }, [activeFrameId, reclusterFrameFromScratch, syncFrameTextures, triggerCanvasRedraw, buildColorPixelsMap, setColorPixelsMap]);

  // 处理临时像素（在鼠标松开时调用）
  const processPaintedPixels = useCallback(() => {
    if (!baseTexture || !bbox || !activeFrameId || isProcessingRef.current) return;
    const tempPixels = tempPixelsRef.current;
    if (tempPixels.size === 0) return;

    isProcessingRef.current = true;

    // 1. 提取所有临时像素的颜色
    const pixels: { x: number; y: number; hsl: { h: number; s: number; l: number } }[] = [];
    const texSizeLocal = texSize;
    for (const key of tempPixels) {
      const [x, y] = key.split(',').map(Number);
      const idx = (y * texSizeLocal + x) * 4;
      const r = baseTexture.data[idx];
      const g = baseTexture.data[idx + 1];
      const b = baseTexture.data[idx + 2];
      if (baseTexture.data[idx + 3] > 0) {
        pixels.push({ x, y, hsl: rgbToHsl(r, g, b) });
      }
    }

    if (pixels.length === 0) {
      tempPixels.clear();
      isProcessingRef.current = false;
      return;
    }

    // 2. 颜色聚类（简单硬阈值，基于色相、饱和度、亮度）
    const clusters: { hsl: { h: number; s: number; l: number }; pixels: typeof pixels }[] = [];
    const used = new Set<number>();
    const threshold = 0.025;

    for (let i = 0; i < pixels.length; i++) {
      if (used.has(i)) continue;
      const cluster = { hsl: { ...pixels[i].hsl }, pixels: [pixels[i]] };
      used.add(i);
      for (let j = i + 1; j < pixels.length; j++) {
        if (used.has(j)) continue;
        const dh = deltaHue(pixels[i].hsl.h, pixels[j].hsl.h);
        const ds = Math.abs(pixels[i].hsl.s - pixels[j].hsl.s);
        const dl = Math.abs(pixels[i].hsl.l - pixels[j].hsl.l);
        if (dh < threshold && ds < threshold && dl < threshold) {
          cluster.pixels.push(pixels[j]);
          used.add(j);
        }
      }
      // 计算簇的平均 HSL
      let sumH = 0, sumS = 0, sumL = 0;
      for (const p of cluster.pixels) {
        sumH += p.hsl.h;
        sumS += p.hsl.s;
        sumL += p.hsl.l;
      }
      cluster.hsl = {
        h: sumH / cluster.pixels.length,
        s: sumS / cluster.pixels.length,
        l: sumL / cluster.pixels.length,
      };
      clusters.push(cluster);
    }

    console.log(`[画笔后处理] 聚类 ${pixels.length} 个像素 -> ${clusters.length} 个簇`);

    // 3. 为每个簇分配颜色 ID（复用或新建）
    const state = useAppStore.getState();
    const currentFrame = state.skillGroupEditor.frames.find(f => f.id === activeFrameId);
    if (!currentFrame || !currentFrame.regionIdTex) {
      isProcessingRef.current = false;
      return;
    }
    const newRegionIdTex = new Uint8Array(currentFrame.regionIdTex);
    const { w } = bbox;

    for (const cluster of clusters) {
      const colorId = addColorToPalette(cluster.hsl, activeFrameId);
      for (const p of cluster.pixels) {
        const localX = p.x - bbox.x;
        const localY = p.y - bbox.y;
        const idx = localY * w + localX;
        if (idx >= 0 && idx < newRegionIdTex.length) {
          newRegionIdTex[idx] = colorId;
        }
      }
    }

    // 4. 更新 store 中的 regionIdTex
    updateSkillFrame(activeFrameId, { regionIdTex: newRegionIdTex });

    // 5. 清空临时集合
    tempPixels.clear();

    // 6. 重新生成基础色纹理（基于新 regionIdTex）并重排调色板
    syncFrameTextures(activeFrameId);
    sortPaletteByArea();
    mergeSimilarColors(0.005);  // 合并相似颜色
    saveHistory();             // 保存合并后的完整状态

    isProcessingRef.current = false;
  }, [baseTexture, bbox, activeFrameId, texSize, addColorToPalette, updateSkillFrame, syncFrameTextures, sortPaletteByArea, mergeSimilarColors, saveHistory]);

  // 获取画布上的像素坐标
  const getCanvasPixel = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = texSize / rect.width;
    const scaleY = texSize / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }, [texSize]);

  // 取色
  const pickColor = useCallback((px: number, py: number) => {
    if (!baseTexture) {
      console.warn('取色器：baseTexture 为空，无法取色');
      return;
    }
    if (px < 0 || px >= texSize || py < 0 || py >= texSize) {
      console.warn('取色器：坐标超出范围', { px, py });
      return;
    }
    const idx = (py * texSize + px) * 4;
    const r = baseTexture.data[idx];
    const g = baseTexture.data[idx + 1];
    const b = baseTexture.data[idx + 2];
    const a = baseTexture.data[idx + 3];
    
    if (a === 0) {
      console.warn('取色器：采样点为透明');
      return;
    }
    
    const hex = '#' + [r, g, b]
      .map(v => v.toString(16).padStart(2, '0'))
      .join('');
    setBrushColor(hex);
  }, [baseTexture, texSize]);

  // 在基础色纹理上涂色
  const paintOnBase = useCallback((px: number, py: number) => {
    if (!baseTexture) return;
    const rgb = brushColor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!rgb) return;
    const r = parseInt(rgb[1], 16);
    const g = parseInt(rgb[2], 16);
    const b = parseInt(rgb[3], 16);

    const data = baseTexture.data;
    // 画笔半径（像素）
    const radiusPx = Math.max(1, brushSize);
    const half = Math.floor(radiusPx);

    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (dx * dx + dy * dy > half * half) continue;
        const gx = px + dx;
        const gy = py + dy;
        if (gx < 0 || gx >= texSize || gy < 0 || gy >= texSize) continue;
        const pi = (gy * texSize + gx) * 4;
        data[pi] = r;
        data[pi + 1] = g;
        data[pi + 2] = b;
        data[pi + 3] = 255;
        // 记录被修改的像素坐标（用于后续处理）
        tempPixelsRef.current.add(`${gx},${gy}`);
      }
    }

    const updated = new ImageData(new Uint8ClampedArray(data), baseTexture.width, baseTexture.height);
    setBaseTexture(updated);
  }, [baseTexture, brushColor, brushSize, texSize, setBaseTexture]);

  // 鼠标事件
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pixel = getCanvasPixel(e);
    const world = canvasToWorld(pixel.x, pixel.y, texSize);

    if (isExtractMode && e.button === 0) {
      handleExtractClick(pixel);
      return;
    }

    if (pickingId !== null && e.button === 0) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const displayPixel = ctx.getImageData(pixel.x, pixel.y, 1, 1).data;
      const r = displayPixel[0];
      const g = displayPixel[1];
      const b = displayPixel[2];
      
      const hsl = rgbToHsl(r, g, b);
      updateBaseColor(pickingId, hsl);
      setPickingId(null);
      setTimeout(() => saveHistory(), 0);
      return;
    }

    if (currentTool === 'dashed') {
      if (e.button === 0) {
        if (e.detail === 2 && drawingPolygon && drawingPolygon.length >= 2) {
          const lastPoint = drawingPolygon[drawingPolygon.length - 1];
          const dist = Math.hypot(world.x - lastPoint.x, world.y - lastPoint.y);
          if (dist < 0.02) {
            setDashedPolygons(prev => [...prev, drawingPolygon]);
            setDrawingPolygon(null);
            setPreviewPoint(null);
            setTimeout(() => saveHistory(), 0);
            return;
          }
        }
        const snapped = snapPointToExisting(world, drawingPolygon ? drawingPolygon.length : 0, 'dashed');
        setDrawingPolygon(prev => prev ? [...prev, snapped] : [snapped]);
      }
    } else if (currentTool === 'bezier') {
      if (e.button === 0) {
        if (e.detail === 2 && drawingPolygon && drawingPolygon.length >= 2) {
          const lastPoint = drawingPolygon[drawingPolygon.length - 1];
          const dist = Math.hypot(world.x - lastPoint.x, world.y - lastPoint.y);
          if (dist < 0.02) {
            setDashedPolygons(prev => [...prev, drawingPolygon]);
            setDrawingPolygon(null);
            setPreviewPoint(null);
            return;
          }
        }
        const pointCount = drawingPolygon ? drawingPolygon.length : 0;
        const snapped = snapPointToExisting(world, pointCount, 'bezier');
        if (pointCount === 2) {
          const newPoly = [...drawingPolygon!, snapped];
          setDashedPolygons(prev => [...prev, newPoly]);
          setDrawingPolygon(null);
          setPreviewPoint(null);
          setTimeout(() => saveHistory(), 0);
        } else {
          setDrawingPolygon(prev => prev ? [...prev, snapped] : [snapped]);
        }
      }
    } else if (currentTool === 'paint') {
      if (mode !== 'base2') {
        console.warn('画笔仅在基础色模式下可用');
        return;
      }
      saveHistory();
      setIsDrawing(true);
      paintOnBase(pixel.x, pixel.y);
    } else if (currentTool === 'picker') {
      if (mode !== 'base2') {
        console.warn('取色器仅在基础色模式下可用');
        return;
      }
      pickColor(pixel.x, pixel.y);
    }
  }, [currentTool, getCanvasPixel, drawingPolygon, paintOnBase, pickColor, saveHistory, snapPointToExisting, pickingId, bgImageData, updateBaseColor, mode, texSize]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pixel = getCanvasPixel(e);
    setMousePos(pixel);
    const world = canvasToWorld(pixel.x, pixel.y, texSize);

    if (currentTool === 'dashed' || currentTool === 'bezier') {
      if (drawingPolygon && drawingPolygon.length > 0) {
        const pointCount = drawingPolygon.length;
        const snapped = snapPointToExisting(world, pointCount, currentTool);
        setPreviewPoint(snapped);
        const isSnapped = Math.abs(world.x - snapped.x) > 0.0001 || Math.abs(world.y - snapped.y) > 0.0001;
        setSnapPoint(isSnapped ? snapped : null);
      }
    }

    if (isDrawing && currentTool === 'paint' && mode === 'base2') {
      paintOnBase(pixel.x, pixel.y);
    }
  }, [isDrawing, currentTool, getCanvasPixel, paintOnBase, drawingPolygon, snapPointToExisting, mode, texSize]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing && baseTexture) {
      setTimeout(() => {
        saveHistory();
        // 处理临时像素（聚类、合并、新建ID）
        processPaintedPixels();
      }, 0);
    }
    setIsDrawing(false);
  }, [isDrawing, baseTexture, processPaintedPixels]);

  const handleColorInfoClick = useCallback((e: React.MouseEvent) => {
    if (!showColorInfoOnClick) return;
    
    const pixel = getCanvasPixel(e);
    const px = pixel.x;
    const py = pixel.y;
    
    if (!bgImageData || !bbox || !currentFrame?.deltaPacked || !currentFrame?.regionIdTex) {
      setColorInfo(null);
      return;
    }

    const colorMapById = new Map<number, SharedBaseColor>();
    for (const c of baseColors) {
      colorMapById.set(c.id, c);
    }

    const inBbox = px >= bbox.x && px < bbox.x + bbox.w && py >= bbox.y && py < bbox.y + bbox.h;
    
    if (!inBbox) {
      setColorInfo(null);
      return;
    }

    const localX = px - bbox.x;
    const localY = py - bbox.y;
    const idx = localY * bbox.w + localX;
    
    const colorId = currentFrame.regionIdTex[idx];
    const base = colorMapById.get(colorId);
    
    if (!base) {
      setColorInfo(null);
      return;
    }

    const bgIdx = (py * texSize + px) * 4;
    const bgRgb = {
      r: bgImageData.data[bgIdx],
      g: bgImageData.data[bgIdx + 1],
      b: bgImageData.data[bgIdx + 2],
    };
    const bgHsl = rgbToHsl(bgRgb.r, bgRgb.g, bgRgb.b);

    const packed = currentFrame.deltaPacked[idx];
    const { s: qS, h: qH, l: qL } = unpackRGB565(packed);
    
    const blockIdx = getAdaptiveBlockIndex(localX, localY, bbox.w, bbox.h);
    const frameBlockFlags = currentFrame.blockFlags ?? 0n;
    const range = getRangeForBlock(frameBlockFlags, blockIdx);
    
    const dH = dequantizeH(qH, range);
    const dS = dequantizeS(qS, range);
    const dL = dequantizeL(qL, range);

    let finalH = base.h + dH;
    if (finalH < 0) finalH += 1.0;
    else if (finalH >= 1.0) finalH -= 1.0;
    const finalS = Math.max(0, Math.min(1, base.s + dS));
    const finalL = Math.max(0, Math.min(1, base.l + dL));
    
    const overlayRgb = hslToRgb(finalH, finalS, finalL);
    const overlayHsl = { h: finalH, s: finalS, l: finalL };
    const residualHsl = { h: dH, s: dS, l: dL };

    const hueDiff = Math.abs(finalH - bgHsl.h);
    const correctedHueDiff = hueDiff > 0.5 ? 1 - hueDiff : hueDiff;
    const satDiff = Math.abs(finalS - bgHsl.s);
    const lightDiff = Math.abs(finalL - bgHsl.l);
    
    const hueThreshold = 0.015;
    const satThreshold = 0.015;
    const lightThreshold = 0.015;
    const meetsStandard = correctedHueDiff <= hueThreshold && satDiff <= satThreshold && lightDiff <= lightThreshold;

    setColorInfo({
      x: e.clientX,
      y: e.clientY,
      overlayRgb,
      overlayHsl,
      bgRgb,
      bgHsl,
      baseColor: { h: base.h, s: base.s, l: base.l },
      residualHsl,
      hueDiff: correctedHueDiff,
      satDiff,
      lightDiff,
      hueThreshold,
      satThreshold,
      lightThreshold,
      meetsStandard,
      colorId,
    });
  }, [showColorInfoOnClick, getCanvasPixel, bgImageData, bbox, currentFrame, baseColors, blockFlags, texSize]);

  // 右键菜单禁用
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // 渲染画布（主要内容，不依赖 mousePos）
  const renderCountRef = useRef(0);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    // ===== 新基础色模式：完全独立的渲染路径 =====
    if (mode === 'base2') {
      ctx.clearRect(0, 0, texSize, texSize);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, texSize, texSize);

      if (baseTexture) {
        ctx.save();
        if (bbox) {
          ctx.beginPath();
          ctx.rect(bbox.x, bbox.y, bbox.w, bbox.h);
          ctx.clip();
        }
        ctx.putImageData(baseTexture, 0, 0);
        ctx.restore();
      } else if (bgImageData) {
        ctx.putImageData(bgImageData, 0, 0);
      }

      // 绘制虚线多边形
      ctx.save();
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      for (const poly of dashedPolygons) {
        if (poly.length < 2) continue;
        const pts = poly.map((p: Point) => worldToCanvas(p.x, p.y, texSize));
        if (poly.length === 3) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.quadraticCurveTo(pts[2].x, pts[2].y, pts[1].x, pts[1].y);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
          }
          ctx.closePath();
          ctx.stroke();
        }
      }
      ctx.restore();

      // 绘制当前帧 bbox
      if (bbox) {
        ctx.save();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
        ctx.restore();
      }

      // 绘制全局 bbox（红色，与当前帧区分）
      if (globalBbox) {
        ctx.save();
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 4]);
        ctx.strokeRect(globalBbox.x, globalBbox.y, globalBbox.w, globalBbox.h);
        ctx.restore();
      }

      // 正在绘制的多边形（含预览虚线）
      if (drawingPolygon && drawingPolygon.length >= 1) {
        ctx.save();
        ctx.strokeStyle = '#ffaa00';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        const pts = drawingPolygon.map(p => worldToCanvas(p.x, p.y, texSize));
        
        if (currentTool === 'bezier' && drawingPolygon.length === 2) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          const midX = (pts[0].x + pts[1].x) / 2;
          const midY = (pts[0].y + pts[1].y) / 2;
          ctx.quadraticCurveTo(midX, midY, pts[1].x, pts[1].y);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
          }
          const currentPreview = previewPoint || (mousePos ? canvasToWorld(mousePos.x, mousePos.y, texSize) : null);
          if (currentPreview) {
            const previewCanvas = worldToCanvas(currentPreview.x, currentPreview.y, texSize);
            ctx.lineTo(previewCanvas.x, previewCanvas.y);
          }
          ctx.stroke();
        }
        ctx.restore();
      }

      // 绘制顶点
      ctx.save();
      ctx.fillStyle = '#ff0000';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      for (const poly of dashedPolygons) {
        for (const p of poly) {
          const pt = worldToCanvas(p.x, p.y, texSize);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      if (drawingPolygon) {
        for (const p of drawingPolygon) {
          const pt = worldToCanvas(p.x, p.y, texSize);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();

    }

    // 参考图模式：显示原始上传的背景图
    else if (mode === 'base') {
      if (bgImageData) {
        ctx.putImageData(bgImageData, 0, 0);
      } else {
        ctx.fillStyle = '#333';
        ctx.fillRect(0, 0, texSize, texSize);
      }
    }
    else if (mode === 'residual') {
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, texSize, texSize);
      
      if (bbox && currentFrame?.deltaPacked && currentFrame.regionIdTex && baseColors.length > 0) {
        const residualDisplay = buildResidualTextureFromPacked(currentFrame.deltaPacked, currentFrame.regionIdTex, bbox, texSize);
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(bbox.x, bbox.y, bbox.w, bbox.h);
        ctx.clip();
        ctx.putImageData(residualDisplay, 0, 0);
        ctx.restore();
      }
    }
    else if (mode === 'composite') {
      ctx.fillStyle = '#333';
      ctx.fillRect(0, 0, texSize, texSize);
      
      if (bbox && baseTexture && currentFrame?.deltaPacked && currentFrame.regionIdTex && baseColors.length > 0) {
        const compositeData = buildCompositeFromPacked(
          currentFrame.regionIdTex,
          baseColors,
          currentFrame.deltaPacked,
          bbox,
          currentFrame.blockFlags,
          texSize
        );
        
        ctx.save();
        ctx.beginPath();
        ctx.rect(bbox.x, bbox.y, bbox.w, bbox.h);
        ctx.clip();
        ctx.putImageData(compositeData, 0, 0);
        ctx.restore();
      } else if (bgImageData) {
        ctx.putImageData(bgImageData, 0, 0);
      }
    }
    // 默认模式：只显示背景图
    else if (bgImageData) {
      ctx.putImageData(bgImageData, 0, 0);
    }

    // 提取模式提示
    if (isExtractMode) {
      ctx.save();
      ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
      ctx.fillRect(0, 0, texSize, texSize);
      ctx.fillStyle = '#ff0000';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('提取模式 - 点击区域提取颜色', texSize / 2, texSize / 2);
      ctx.font = '12px Arial';
      ctx.fillText('虚线/贝塞尔曲线作为墙，BFS无法穿过', texSize / 2, texSize / 2 + 24);
      ctx.restore();
    }

    // 4. 已完成的多边形（虚线）- base2模式已在前面绘制，跳过
    if (mode !== 'base2') {
      ctx.save();
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      for (const poly of dashedPolygons) {
        if (poly.length < 2) continue;
        const pts = poly.map((p: Point) => worldToCanvas(p.x, p.y, texSize));
        if (poly.length === 3) {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.quadraticCurveTo(pts[2].x, pts[2].y, pts[1].x, pts[1].y);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i].x, pts[i].y);
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 5. 正在绘制的多边形（含预览虚线）
    if (drawingPolygon && drawingPolygon.length >= 1) {
      ctx.save();
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const pts = drawingPolygon.map(p => worldToCanvas(p.x, p.y, texSize));
      
      if (currentTool === 'bezier' && drawingPolygon.length === 2) {
        const currentPreview = previewPoint || (mousePos ? canvasToWorld(mousePos.x, mousePos.y, texSize) : null);
        if (currentPreview) {
          const previewCanvas = worldToCanvas(currentPreview.x, currentPreview.y, texSize);
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.quadraticCurveTo(previewCanvas.x, previewCanvas.y, pts[1].x, pts[1].y);
          ctx.stroke();
          
          ctx.setLineDash([2, 4]);
          ctx.strokeStyle = '#888';
          ctx.beginPath();
          ctx.moveTo(pts[1].x, pts[1].y);
          ctx.lineTo(previewCanvas.x, previewCanvas.y);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i].x, pts[i].y);
        }
        const currentPreview = previewPoint || (mousePos ? canvasToWorld(mousePos.x, mousePos.y, texSize) : null);
        if (currentPreview) {
          const previewCanvas = worldToCanvas(currentPreview.x, currentPreview.y, texSize);
          ctx.lineTo(previewCanvas.x, previewCanvas.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // 6. 多边形顶点和控制点
    ctx.save();
    for (const poly of dashedPolygons) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const cp = worldToCanvas(p.x, p.y, texSize);
        if (poly.length === 3 && i === 2) {
          ctx.fillStyle = '#ff4444';
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#ffaa00';
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (drawingPolygon) {
      for (let i = 0; i < drawingPolygon.length; i++) {
        const p = drawingPolygon[i];
        const cp = worldToCanvas(p.x, p.y, texSize);
        if (currentTool === 'bezier' && drawingPolygon.length === 2 && i === 1) {
          ctx.fillStyle = '#ffaa00';
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#ffaa00';
          ctx.beginPath();
          ctx.arc(cp.x, cp.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // 7. 吸附点显示
    if (snapPoint) {
      ctx.save();
      ctx.fillStyle = '#52c41a';
      ctx.beginPath();
      const sp = worldToCanvas(snapPoint.x, snapPoint.y, texSize);
      ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 6. 当前帧 BBox 显示
    if (bbox) {
      ctx.save();
      ctx.strokeStyle = '#52c41a';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
      ctx.restore();
    }

    // 7. 全局 BBox 显示（红色粗虚线，与当前帧区分）
    if (globalBbox) {
      ctx.save();
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(globalBbox.x, globalBbox.y, globalBbox.w, globalBbox.h);
      ctx.restore();
    }

    // 调试：绘制坏像素高亮（所有模式都支持）
    if (debugShowBadPixels && debugBadPixels.length > 0 && bbox) {
      const { x: offsetX, y: offsetY, w, h } = bbox;
      ctx.save();
      ctx.fillStyle = 'white';
      for (const localIdx of debugBadPixels) {
        const px = localIdx % w;
        const py = Math.floor(localIdx / w);
        const globalX = offsetX + px;
        const globalY = offsetY + py;
        ctx.fillRect(globalX, globalY, 1, 1);
      }
      ctx.restore();
    }

    // 7. 画笔光标
    if (mousePos && (currentTool === 'paint' || currentTool === 'picker')) {
      ctx.save();
      ctx.strokeStyle = currentTool === 'picker' ? '#1890ff' : brushColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(mousePos.x, mousePos.y, brushSize / 2, 0, Math.PI * 2);
      ctx.stroke();
      if (currentTool === 'picker') {
        ctx.beginPath();
        ctx.arc(mousePos.x, mousePos.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#1890ff';
        ctx.fill();
      }
      ctx.restore();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bgImageData, baseTexture, residualTexture, mode, dashedPolygons, drawingPolygon, bbox, globalBbox, isExtractMode, mousePos, sharedBaseColors, debugShowBadPixels, debugBadPixels, texSize, currentFrame?.blockFlags, currentFrame?.deltaPacked, currentFrame?.regionIdTex]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const octx = overlay.getContext('2d')!;

    octx.clearRect(0, 0, texSize, texSize);

    if (mode === 'base2' && highlightCanvasRef.current) {
      octx.drawImage(highlightCanvasRef.current, 0, 0);
    }

    if (!mousePos || (currentTool !== 'paint' && currentTool !== 'picker')) return;

    octx.save();
    octx.strokeStyle = currentTool === 'picker' ? '#1890ff' : brushColor;
    octx.lineWidth = 1;
    octx.setLineDash([]);
    octx.beginPath();
    octx.arc(mousePos.x, mousePos.y, brushSize / 2, 0, Math.PI * 2);
    octx.stroke();
    if (currentTool === 'picker') {
      octx.beginPath();
      octx.arc(mousePos.x, mousePos.y, 2, 0, Math.PI * 2);
      octx.fillStyle = '#1890ff';
      octx.fill();
    }
    octx.restore();
  }, [mousePos, currentTool, brushColor, brushSize, selectedBaseColorId, mode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(prev => Math.max(0.1, Math.min(10, prev * delta)));
    };
    container.addEventListener('wheel', wheelHandler, { passive: false });
    return () => container.removeEventListener('wheel', wheelHandler);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', background: '#fff' }}>
      {/* 帧管理栏 */}
      <div style={{ display: 'flex', gap: '4px', padding: '6px 12px', borderBottom: '1px solid #e8e8e8', alignItems: 'center', background: '#f5f5f5' }}>
        <span style={{ fontSize: '11px', color: '#666', marginRight: '4px' }}>帧:</span>
        {frames.map((frame: typeof frames[0]) => (
          <div
            key={frame.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              padding: '2px 6px',
              fontSize: '11px',
              cursor: 'pointer',
              background: frame.id === activeFrameId ? '#1890ff' : '#fff',
              color: frame.id === activeFrameId ? '#fff' : '#333',
              border: '1px solid #d9d9d9',
              borderRadius: '3px',
            }}
            onClick={() => switchSkillFrame(frame.id)}
          >
            {frame.id === editingFrameId ? (
              <input
                type="text"
                value={editingFrameName}
                onChange={(e) => setEditingFrameName(e.target.value.slice(0, 10))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    updateSkillFrame(frame.id, { name: editingFrameName || `帧 ${frames.indexOf(frame) + 1}` });
                    setEditingFrameId(null);
                  } else if (e.key === 'Escape') {
                    setEditingFrameId(null);
                  }
                }}
                onBlur={() => {
                  updateSkillFrame(frame.id, { name: editingFrameName || `帧 ${frames.indexOf(frame) + 1}` });
                  setEditingFrameId(null);
                }}
                style={{
                  width: '80px',
                  fontSize: '11px',
                  padding: '1px 3px',
                  border: '1px solid #999',
                  borderRadius: '2px',
                  background: frame.id === activeFrameId ? '#096dd9' : '#fff',
                  color: frame.id === activeFrameId ? '#fff' : '#333',
                }}
                autoFocus
              />
            ) : (
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingFrameId(frame.id);
                  setEditingFrameName(frame.name);
                }}
                style={{ textDecoration: 'underline', textDecorationStyle: 'dotted', cursor: 'text' }}
              >
                {frame.name}
              </span>
            )}
            {frames.length > 1 && (
              <span
                style={{
                  fontSize: '10px',
                  color: frame.id === activeFrameId ? '#fff' : '#999',
                  cursor: 'pointer',
                  padding: '0 2px',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`确定删除 ${frame.name}?`)) {
                    removeSkillFrame(frame.id);
                  }
                }}
              >
                ×
              </span>
            )}
          </div>
        ))}
        <button
          onClick={() => addSkillFrame()}
          style={{
            padding: '2px 8px',
            fontSize: '11px',
            cursor: 'pointer',
            border: '1px solid #d9d9d9',
            background: '#fff',
          }}
        >
          + 新建帧
        </button>
        {/* 分辨率选择器（支持自定义输入） */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px' }}>
          <span style={{ fontSize: '11px', color: '#666' }}>分辨率:</span>
          <input
            type="text"
            value={texSize}
            onChange={(e) => {
              const value = e.target.value;
              // 只允许数字输入
              const numericValue = value.replace(/[^0-9]/g, '');
              e.target.value = numericValue;
            }}
            onBlur={(e) => {
              const value = parseInt(e.target.value, 10);
              handleResolutionChange(value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const value = parseInt(e.target.value, 10);
                handleResolutionChange(value);
                e.target.blur();
              } else if (e.key === 'Escape') {
                e.target.value = texSize.toString();
                e.target.blur();
              }
            }}
            style={{
              width: '60px',
              fontSize: '11px',
              padding: '1px 4px',
              textAlign: 'center',
              border: '1px solid #d9d9d9',
              borderRadius: '3px',
            }}
            title="输入自定义分辨率（64~2048），回车确认"
          />
          <span style={{ fontSize: '11px', color: '#999' }}>×{texSize}</span>
          {/* 快捷尺寸按钮 */}
          <div style={{ display: 'flex', gap: '2px' }}>
            {[128, 256, 512, 1024].map(size => (
              <button
                key={size}
                onClick={() => handleResolutionChange(size)}
                style={{
                  padding: '1px 6px',
                  fontSize: '10px',
                  cursor: 'pointer',
                  border: texSize === size ? '1px solid #1890ff' : '1px solid #d9d9d9',
                  background: texSize === size ? '#e6f7ff' : '#fff',
                  color: texSize === size ? '#1890ff' : '#666',
                  borderRadius: '2px',
                }}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={() => syncGlobalBboxFromCurrentFrame()}
          disabled={!currentFrame?.bbox}
          style={{
            padding: '2px 8px',
            fontSize: '11px',
            cursor: currentFrame?.bbox ? 'pointer' : 'not-allowed',
            border: '1px solid #d9d9d9',
            background: currentFrame?.bbox ? '#fff' : '#f5f5f5',
            color: currentFrame?.bbox ? '#333' : '#999',
          }}
          title="将当前帧的 bbox 设为全局统一 bbox"
        >
          统一 bbox
        </button>
        <span style={{ fontSize: '11px', color: '#999' }}>
          {globalBbox ? `全局bbox: ${globalBbox.w}×${globalBbox.h}` : '全局bbox: 未设置'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#999' }}>
          共享基础色: {sharedBaseColors.length} 个
        </span>
      </div>
      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', padding: '8px 12px', borderBottom: '1px solid #e8e8e8', alignItems: 'center', background: '#fafafa' }}>
        <label style={{ fontSize: '11px', padding: '2px 6px', background: '#e6f7ff', borderRadius: '3px', cursor: 'pointer', border: '1px solid #91d5ff' }}>
          加载背景
          <input
            type="file"
            accept="image/*"
            onChange={(e) => e.target.files?.[0] && handleLoadBackground(e.target.files[0])}
            style={{ display: 'none' }}
          />
        </label>
        <button
          onClick={undo}
          disabled={historyIndex <= 0}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', border: '1px solid #d9d9d9' }}
          title="Ctrl+Z"
        >
          ↩ 撤销
        </button>
        <button
          onClick={redo}
          disabled={historyIndex >= historySnapshots.length - 1}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', border: '1px solid #d9d9d9' }}
          title="Ctrl+Shift+Z"
        >
          ↪ 重做
        </button>
        <button
          onClick={handleAutoExtract}
          disabled={!bgImageData || dashedPolygons.length === 0 || isExtractMode}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
        >
          {isExtractMode ? '提取中...' : '提取模式'}
        </button>
        {isExtractMode && (
          <button
            onClick={() => setIsExtractMode(false)}
            style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', background: '#ff4444', color: '#fff', border: 'none' }}
          >
            退出提取
          </button>
        )}
        <button
          onClick={() => { setCurrentTool('dashed'); setDrawingPolygon(null); }}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: currentTool === 'dashed' ? '#ffaa00' : '#f0f0f0',
            color: currentTool === 'dashed' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          虚线
        </button>
        <button
          onClick={() => { setCurrentTool('bezier'); setDrawingPolygon(null); }}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: currentTool === 'bezier' ? '#ff4444' : '#f0f0f0',
            color: currentTool === 'bezier' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          贝塞尔
        </button>
        <label style={{ fontSize: '11px', padding: '2px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
            style={{ margin: 0 }}
          />
          吸附
        </label>
        <button
          onClick={() => { setCurrentTool('paint'); setDrawingPolygon(null); }}
          disabled={!baseTexture || mode !== 'base2'}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: currentTool === 'paint' ? '#1890ff' : '#f0f0f0',
            color: currentTool === 'paint' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          画笔
        </button>
        <button
          onClick={() => { setCurrentTool('picker'); setDrawingPolygon(null); }}
          disabled={mode !== 'base2'}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: currentTool === 'picker' ? '#1890ff' : '#f0f0f0',
            color: currentTool === 'picker' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          取色
        </button>
        <input
          type="color"
          value={brushColor}
          onChange={(e) => setBrushColor(e.target.value)}
          style={{ width: '24px', height: '24px', padding: 0, border: 'none', cursor: 'pointer' }}
          title="画笔颜色"
        />
        <select
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          style={{ fontSize: '11px', padding: '1px 4px' }}
          title="笔刷大小"
        >
          {[2, 4, 6, 8, 12, 16, 24, 32].map(s => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>
        <button
          onClick={() => setMode('base')}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: mode === 'base' ? '#1890ff' : '#f0f0f0',
            color: mode === 'base' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          参考图
        </button>
        <button
          onClick={() => setMode('base2')}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: mode === 'base2' ? '#52c41a' : '#f0f0f0',
            color: mode === 'base2' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          基础色
        </button>
        <button
          onClick={() => setMode('residual')}
          disabled={!residualTexture}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: mode === 'residual' ? '#52c41a' : '#f0f0f0',
            color: mode === 'residual' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          残差
        </button>
        {mode === 'residual' && (
          <button
            onClick={recalculateResidual}
            disabled={!baseTexture || !bgImageData || !bbox}
            style={{
              padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
              background: '#722ed1',
              color: '#fff',
              border: '1px solid #d9d9d9',
            }}
          >
            重新计算残差
          </button>
        )}
        <button
          onClick={() => setMode('composite')}
          disabled={!baseTexture || !residualTexture}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: mode === 'composite' ? '#1890ff' : '#f0f0f0',
            color: mode === 'composite' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          叠加
        </button>
        <button
          onClick={() => setShowColorInfoOnClick(!showColorInfoOnClick)}
          disabled={!baseTexture || !residualTexture}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: showColorInfoOnClick ? '#faad14' : '#f0f0f0',
            color: showColorInfoOnClick ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          {showColorInfoOnClick ? '✓ HSL检查' : 'HSL检查'}
        </button>
        <button
          onClick={() => {
            console.log('[坏像素按钮] 点击了按钮');
            console.log('[坏像素按钮] 当前状态:', {
              debugShowBadPixels: debugShowBadPixels,
              debugBadPixelsLength: debugBadPixels.length,
              hasBgImageData: !!bgImageData,
              hasBbox: !!bbox,
              baseColorsLength: baseColors.length,
            });
            
            if (debugBadPixels.length === 0 && bgImageData && bbox && baseColors.length > 0) {
              console.log('[坏像素按钮] 坏像素数据为空，触发recalculateResidual');
              recalculateResidual();
            } else if (debugBadPixels.length === 0) {
              console.log('[坏像素按钮] 坏像素数据为空，但条件不满足:', {
                bgImageData: !!bgImageData,
                bbox: !!bbox,
                baseColorsLength: baseColors.length,
              });
            }
            
            const newState = !debugShowBadPixels;
            setDebugShowBadPixels(newState);
            if (newState && debugBadPixels.length > 0 && bbox) {
              const { x: offsetX, y: offsetY, w } = bbox;
              const badPixelCoords = debugBadPixels.map(localIdx => {
                const px = localIdx % w;
                const py = Math.floor(localIdx / w);
                return { x: offsetX + px, y: offsetY + py };
              });
            }
          }}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: debugShowBadPixels ? '#ff4d4f' : '#f0f0f0',
            color: debugShowBadPixels ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          {debugShowBadPixels ? '隐藏坏像素' : '显示坏像素'}
          {debugBadPixels.length > 0 && ` (${debugBadPixels.length})`}
        </button>
        <button
          onClick={() => {
            setBaseTexture(null);
            setResidualTexture(null);
            setBbox(null);
            setResidualRanges(null);
            setBlockFlags(0);
          }}
          disabled={!baseTexture && !residualTexture}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
        >
          清除结果
        </button>
        <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', padding: '2px 8px', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
          <input
            type="checkbox"
            checked={enableFramePrediction}
            onChange={(e) => setEnableFramePrediction(e.target.checked)}
          />
          帧间预测
        </label>
        <button
          onClick={async () => {
            const state = useAppStore.getState();
            const { frames, sharedBaseColors } = state.skillGroupEditor;
            const validFrames = frames.filter(f => f.bbox && f.regionIdTex && f.regionIdTex.length > 0);
            if (validFrames.length === 0) {
              alert('没有可导出的帧（需要先提取基础色）');
              return;
            }

            const sortedColors = [...sharedBaseColors].sort((a, b) => a.id - b.id);
            const idToIndex = new Map<number, number>();
            sortedColors.forEach((c, idx) => idToIndex.set(c.id, idx));

            const exportFrames = validFrames.map(frame => {
              const origRegionIdTex = frame.regionIdTex!;
              const newRegionIdTex = new Uint8Array(origRegionIdTex.length);
              for (let i = 0; i < origRegionIdTex.length; i++) {
                const id = origRegionIdTex[i];
                if (id === 0) {
                  newRegionIdTex[i] = 0;
                } else {
                  const idx = idToIndex.get(id);
                  if (idx === undefined) {
                    console.warn(`颜色ID ${id} 不在调色板中，可能已被合并或删除，该像素将被忽略`);
                    newRegionIdTex[i] = 0;
                  } else {
                    newRegionIdTex[i] = idx + 1;
                  }
                }
              }
              return {
                name: frame.name || '未命名',
                width: texSize,
                height: texSize,
                bbox: frame.bbox!,
                regionIdTex: newRegionIdTex,
                deltaPacked: frame.deltaPacked,
                blockFlags: BigInt(frame.blockFlags ?? 0),
              };
            });

            const binary = packMultiFrameToBinary(sortedColors, exportFrames, enableFramePrediction);
            console.log('[多帧导出] 二进制数据生成成功，大小:', binary.length, '字节');
            console.log('[多帧导出] 魔数:', binary.slice(0, 4).join(','));
            console.log('[多帧导出] 版本:', binary[4]);
            console.log('[多帧导出] 预测标志:', binary[5]);
            console.log('[多帧导出] 帧数:', (binary[6] | (binary[7] << 8)));
            console.log('[多帧导出] 调色板数:', (binary[8] | (binary[9] << 8)));
            const gzipped = await compressToGzip(binary);
            console.log('[多帧导出] Gzip压缩完成，大小:', gzipped.size, '字节');
            const url = URL.createObjectURL(gzipped);
            const a = document.createElement('a');
            a.href = url;
            a.download = `multiframe_export_${Date.now()}.ftx3.gz`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: '#13c2c2',
            color: '#fff',
            border: '1px solid #d9d9d9',
          }}
        >
          导出多帧纹理
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
        {/* 独立画布容器（支持滚轮缩放和拖拽平移） */}
        <div
          ref={containerRef}
          style={{
            position: 'relative', flex: 1, overflow: 'hidden',
            background: '#2a2a2a',
            display: 'flex', justifyContent: 'center', alignItems: 'center',
          }}
          onMouseDown={handleContainerMouseDown}
          onMouseMove={handleContainerMouseMove}
          onMouseUp={handleContainerMouseUp}
          onMouseLeave={handleContainerMouseUp}
        >
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <canvas
              ref={canvasRef}
              width={texSize}
              height={texSize}
              style={{
                display: 'block',
                border: '1px solid #333',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                cursor: currentTool === 'dashed' ? 'crosshair' : isPanningRef.current ? 'grabbing' : 'default',
                boxShadow: '0 0 8px rgba(0,0,0,0.5)',
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onContextMenu={handleContextMenu}
              onClick={handleColorInfoClick}
            />
            <canvas
              ref={highlightCanvasRef}
              width={texSize}
              height={texSize}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                display: 'block',
                border: '1px solid #333',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                pointerEvents: 'none',
                zIndex: 6,
              }}
            />
            <canvas
              ref={overlayRef}
              width={texSize}
              height={texSize}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                display: 'block',
                border: '1px solid #333',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                pointerEvents: 'none',
                zIndex: 10,
              }}
            />
          </div>
          {/* 缩放指示器 */}
          <div style={{
            position: 'absolute', bottom: 8, right: 8,
            background: 'rgba(0,0,0,0.7)', color: '#fff',
            padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
            pointerEvents: 'none',
          }}>
            {Math.round(zoom * 100)}% | Alt+拖拽平移 | 滚轮缩放
          </div>
        </div>

        {mode === 'base2' && baseColors.length > 0 && (
          <BaseColorList
            colors={baseColors}
            selectedId={selectedBaseColorId}
            pickingId={pickingId}
            onSelect={handleSelectBaseColor}
            onUpdate={updateBaseColor}
            onDragEnd={handleDragEnd}
            onRecluster={handleRecluster}
            onPickColor={handlePickColor}
          />
        )}

        {colorInfo && (
          <div
            style={{
              position: 'fixed',
              left: colorInfo.x + 10,
              top: colorInfo.y + 10,
              background: '#fff',
              border: '1px solid #ccc',
              borderRadius: '8px',
              padding: '12px',
              fontSize: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              zIndex: 1000,
              minWidth: '280px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontWeight: 'bold', fontSize: '13px' }}>像素颜色信息</span>
              <button
                onClick={() => setColorInfo(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '16px',
                  cursor: 'pointer',
                  color: '#999',
                  padding: '0 4px',
                }}
              >
                ×
              </button>
            </div>
            
            <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #eee' }}>
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>基础色 ID: {colorInfo.colorId}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <div
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '4px',
                    backgroundColor: `hsl(${colorInfo.baseColor.h * 360}, ${colorInfo.baseColor.s * 100}%, ${colorInfo.baseColor.l * 100}%)`,
                    border: '1px solid #ddd',
                  }}
                />
                <div style={{ fontSize: '11px', color: '#666' }}>
                  基础色 HSL: ({colorInfo.baseColor.h.toFixed(4)}, {colorInfo.baseColor.s.toFixed(4)}, {colorInfo.baseColor.l.toFixed(4)})
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>叠加色 (基础色+残差)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '4px',
                      backgroundColor: `rgb(${colorInfo.overlayRgb.r}, ${colorInfo.overlayRgb.g}, ${colorInfo.overlayRgb.b})`,
                      border: '1px solid #ddd',
                    }}
                  />
                  <div>
                    <div style={{ fontSize: '11px' }}>
                      RGB: ({colorInfo.overlayRgb.r}, {colorInfo.overlayRgb.g}, {colorInfo.overlayRgb.b})
                    </div>
                    <div style={{ fontSize: '11px' }}>
                      HSL: ({colorInfo.overlayHsl.h.toFixed(4)}, {colorInfo.overlayHsl.s.toFixed(4)}, {colorInfo.overlayHsl.l.toFixed(4)})
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>背景色 (原始)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '4px',
                      backgroundColor: `rgb(${colorInfo.bgRgb.r}, ${colorInfo.bgRgb.g}, ${colorInfo.bgRgb.b})`,
                      border: '1px solid #ddd',
                    }}
                  />
                  <div>
                    <div style={{ fontSize: '11px' }}>
                      RGB: ({colorInfo.bgRgb.r}, {colorInfo.bgRgb.g}, {colorInfo.bgRgb.b})
                    </div>
                    <div style={{ fontSize: '11px' }}>
                      HSL: ({colorInfo.bgHsl.h.toFixed(4)}, {colorInfo.bgHsl.s.toFixed(4)}, {colorInfo.bgHsl.l.toFixed(4)})
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '4px' }}>残差 HSL (delta):</div>
              <div style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                dH: {colorInfo.residualHsl.h.toFixed(4)} | dS: {colorInfo.residualHsl.s.toFixed(4)} | dL: {colorInfo.residualHsl.l.toFixed(4)}
              </div>
            </div>

            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #eee' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '12px' }}>色相差: </span>
                <span style={{ fontWeight: 'bold', fontSize: '14px', color: colorInfo.hueDiff <= colorInfo.hueThreshold ? '#52c41a' : '#ff4d4f' }}>
                  {colorInfo.hueDiff.toFixed(4)}
                </span>
                <span style={{ fontSize: '11px', color: '#999' }}>(阈值: {colorInfo.hueThreshold})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '12px' }}>饱和度差: </span>
                <span style={{ fontWeight: 'bold', fontSize: '14px', color: colorInfo.satDiff <= colorInfo.satThreshold ? '#52c41a' : '#ff4d4f' }}>
                  {colorInfo.satDiff.toFixed(4)}
                </span>
                <span style={{ fontSize: '11px', color: '#999' }}>(阈值: {colorInfo.satThreshold})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '12px' }}>亮度差: </span>
                <span style={{ fontWeight: 'bold', fontSize: '14px', color: colorInfo.lightDiff <= colorInfo.lightThreshold ? '#52c41a' : '#ff4d4f' }}>
                  {colorInfo.lightDiff.toFixed(4)}
                </span>
                <span style={{ fontSize: '11px', color: '#999' }}>(阈值: {colorInfo.lightThreshold})</span>
              </div>
              <div
                style={{
                  marginTop: '4px',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  textAlign: 'center',
                  fontWeight: 'bold',
                  backgroundColor: colorInfo.meetsStandard ? '#f6ffed' : '#fff2f0',
                  color: colorInfo.meetsStandard ? '#52c41a' : '#ff4d4f',
                  border: `1px solid ${colorInfo.meetsStandard ? '#b7eb8f' : '#ffccc7'}`,
                }}
              >
                {colorInfo.meetsStandard ? '✓ 符合标准' : '✗ 不符合标准'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 状态信息 */}
      <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
        {bgImageData ? '背景已加载' : '未加载背景'} |
        多边形: {dashedPolygons.length}{drawingPolygon ? ` + 1(绘制中: ${drawingPolygon.length}点)` : ''}
        {bbox && ` | BBox: (${bbox.x},${bbox.y}) ${bbox.w}x${bbox.h}`}
      </div>
      <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
        虚线: 点击添加顶点, 右键/双击闭合 | 画笔: 拖拽涂抹 | 取色: 点击取样
      </div>
    </div>
  );
};