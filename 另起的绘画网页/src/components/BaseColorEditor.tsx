import React, { useState, useRef, useEffect, useCallback } from 'react';

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

// ========== 几何辅助函数 ==========
function distanceToLineSegment(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number
): number {
  const ax = px - x1, ay = py - y1;
  const bx = x2 - x1, by = y2 - y1;
  const dot = ax * bx + ay * by;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(ax, ay);
  let t = dot / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * bx;
  const projY = y1 + t * by;
  return Math.hypot(px - projX, py - projY);
}

import { computeRegionsExact } from '../utils/regionDetectionExact';
import {
  clusterAndGenerateTexturesV2,
  computeBBoxAllRings,
  rasterizeRegionMaskLocal,
  hslToRgb,
  rgbToHsl,
} from '../utils/colorCompressor';
import type { Point, Shape } from '../types';

// ============ 坐标转换 ============
const TEX_SIZE = 512;

function canvasToWorld(cx: number, cy: number): Point {
  return { x: cx / TEX_SIZE, y: 1 - cy / TEX_SIZE };
}

function worldToCanvas(wx: number, wy: number): Point {
  return { x: wx * TEX_SIZE, y: (1 - wy) * TEX_SIZE };
}

// ============ 射线法多边形包含测试 ============
function pointInPolygon(px: number, py: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ============ 从虚线多边形提取基础色 ============
function extractBaseFromDashedPolygons(
  bgImageData: ImageData,
  worldPolygons: Point[][],
  textureSize: number = TEX_SIZE
): { baseTexture: ImageData; residualTexture: ImageData; bbox: { x: number; y: number; w: number; h: number } } | null {
  if (worldPolygons.length === 0) return null;

  // 1. 计算区域的世界坐标 bbox
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of worldPolygons) {
    for (const p of ring) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  // 转为像素坐标 bbox（Y 翻转，因为 world Y 是 0~1 向上，canvas Y 向下）
  const pxBbox = {
    x: Math.max(0, Math.floor(minX * textureSize)),
    y: Math.max(0, Math.floor((1 - maxY) * textureSize)),
    w: Math.min(textureSize, Math.ceil((maxX - minX) * textureSize)),
    h: Math.min(textureSize, Math.ceil((maxY - minY) * textureSize)),
  };
  if (pxBbox.w <= 0 || pxBbox.h <= 0) return null;

  // 2. 栅格化 mask（直接传入世界坐标，rasterizeRegionMaskLocal 内部会处理坐标转换）
  const mask = rasterizeRegionMaskLocal(worldPolygons, pxBbox);
  if (!mask || mask.length === 0) return null;

  // 4. 颜色聚类
  const { baseColors, regionIdTex, deltaTex } = clusterAndGenerateTexturesV2(
    mask,
    pxBbox,
    bgImageData,
    0.05,
    textureSize
  );

  // 5. 构建基础色纹理（全透明初始化）
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = textureSize;
  baseCanvas.height = textureSize;
  const baseCtx = baseCanvas.getContext('2d')!;
  baseCtx.clearRect(0, 0, textureSize, textureSize);
  const baseImageData = baseCtx.getImageData(0, 0, textureSize, textureSize);

  if (regionIdTex && baseColors.length > 0) {
    // 有 regionIdTex：按区域填充
    for (let y = 0; y < pxBbox.h; y++) {
      for (let x = 0; x < pxBbox.w; x++) {
        const idx = y * pxBbox.w + x;
        if (mask[idx] === 0) continue;
        const baseIdx = regionIdTex[idx] - 1;
        if (baseIdx >= 0 && baseIdx < baseColors.length) {
          const base = baseColors[baseIdx];
          const rgb = hslToRgb(base.h, base.s, base.l);
          const gx = pxBbox.x + x;
          const gy = pxBbox.y + y;
          const pi = (gy * textureSize + gx) * 4;
          baseImageData.data[pi] = rgb.r;
          baseImageData.data[pi + 1] = rgb.g;
          baseImageData.data[pi + 2] = rgb.b;
          baseImageData.data[pi + 3] = 255;
        }
      }
    }
  } else if (baseColors.length > 0) {
    // 无 regionIdTex：整个区域用第一个基础色
    const base = baseColors[0];
    const rgb = hslToRgb(base.h, base.s, base.l);
    for (let y = 0; y < pxBbox.h; y++) {
      for (let x = 0; x < pxBbox.w; x++) {
        const idx = y * pxBbox.w + x;
        if (mask[idx] === 0) continue;
        const gx = pxBbox.x + x;
        const gy = pxBbox.y + y;
        const pi = (gy * textureSize + gx) * 4;
        baseImageData.data[pi] = rgb.r;
        baseImageData.data[pi + 1] = rgb.g;
        baseImageData.data[pi + 2] = rgb.b;
        baseImageData.data[pi + 3] = 255;
      }
    }
  }

  // 6. 生成残差纹理（原始 - 基础色，偏移 128 存储）
  const residualImageData = new ImageData(textureSize, textureSize);
  for (let i = 0; i < residualImageData.data.length; i += 4) {
    const r = bgImageData.data[i] - baseImageData.data[i];
    const g = bgImageData.data[i + 1] - baseImageData.data[i + 1];
    const b = bgImageData.data[i + 2] - baseImageData.data[i + 2];
    residualImageData.data[i] = r + 128;
    residualImageData.data[i + 1] = g + 128;
    residualImageData.data[i + 2] = b + 128;
    residualImageData.data[i + 3] = 255;
  }

  return { baseTexture: baseImageData, residualTexture: residualImageData, bbox: pxBbox };
}

// ============ 组件 ============
export const BaseColorEditor: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bgImageData, setBgImageData] = useState<ImageData | null>(null);
  const [dashedPolygons, setDashedPolygons] = useState<Point[][]>([]);
  const [drawingPolygon, setDrawingPolygon] = useState<Point[] | null>(null);
  const [currentTool, setCurrentTool] = useState<'dashed' | 'bezier' | 'paint' | 'picker'>('dashed');
  const [mode, setMode] = useState<'base' | 'residual' | 'composite'>('base');
  const [baseTexture, setBaseTexture] = useState<ImageData | null>(null);
  const [residualTexture, setResidualTexture] = useState<ImageData | null>(null);
  const [bbox, setBbox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [brushColor, setBrushColor] = useState('#ff0000');
  const [brushSize, setBrushSize] = useState(8);
  const [isDrawing, setIsDrawing] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapPoint, setSnapPoint] = useState<Point | null>(null);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(prev => Math.max(0.1, Math.min(10, prev * delta)));
  }, []);

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

    const canvasPoint = { x: point.x * TEX_SIZE, y: (1 - point.y) * TEX_SIZE };
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
        addCandidate(poly[i]);
      }
    }

    if (drawingPolygon) {
      drawingPolygon.forEach(p => addCandidate(p));
    }

    for (const p of candidateMap.values()) {
      const pCanvas = { x: p.x * TEX_SIZE, y: (1 - p.y) * TEX_SIZE };
      const dist = Math.hypot(canvasPoint.x - pCanvas.x, canvasPoint.y - pCanvas.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = p;
      }
    }

    return bestMatch || point;
  }, [snapEnabled, dashedPolygons, drawingPolygon]);

  // 加载背景图
  const handleLoadBackground = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = TEX_SIZE;
        canvas.height = TEX_SIZE;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE);
        setBgImageData(ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE));
        setDashedPolygons([]);
        setDrawingPolygon(null);
        setBaseTexture(null);
        setResidualTexture(null);
        setBbox(null);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

  // 自动提取
  const handleAutoExtract = useCallback(() => {
    if (!bgImageData) return;
    const allPolygons = drawingPolygon && drawingPolygon.length >= 3
      ? [...dashedPolygons, drawingPolygon]
      : dashedPolygons;
    if (allPolygons.length === 0) return;

    const result = extractBaseFromDashedPolygons(bgImageData, allPolygons);
    if (result) {
      setBaseTexture(result.baseTexture);
      setResidualTexture(result.residualTexture);
      setBbox(result.bbox);
    }
  }, [bgImageData, dashedPolygons, drawingPolygon]);

  // 获取画布上的像素坐标
  const getCanvasPixel = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = TEX_SIZE / rect.width;
    const scaleY = TEX_SIZE / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  }, []);

  // 取色
  const pickColor = useCallback((px: number, py: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pixel = ctx.getImageData(px, py, 1, 1).data;
    const hex = '#' + [pixel[0], pixel[1], pixel[2]]
      .map(v => v.toString(16).padStart(2, '0'))
      .join('');
    setBrushColor(hex);
  }, []);

  // 在基础色纹理上涂色
  const paintOnBase = useCallback((px: number, py: number) => {
    if (!baseTexture) return;
    const rgb = brushColor.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!rgb) return;
    const r = parseInt(rgb[1], 16);
    const g = parseInt(rgb[2], 16);
    const b = parseInt(rgb[3], 16);

    const data = baseTexture.data;
    const half = Math.floor(brushSize / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (dx * dx + dy * dy > half * half) continue;
        const gx = px + dx;
        const gy = py + dy;
        if (gx < 0 || gx >= TEX_SIZE || gy < 0 || gy >= TEX_SIZE) continue;
        const pi = (gy * TEX_SIZE + gx) * 4;
        data[pi] = r;
        data[pi + 1] = g;
        data[pi + 2] = b;
        data[pi + 3] = 255;
      }
    }
    // 更新 baseTexture 引用触发重绘（不修改残差，残差保持原始值）
    setBaseTexture(new ImageData(new Uint8ClampedArray(data), TEX_SIZE, TEX_SIZE));
  }, [baseTexture, brushColor, brushSize]);

  // 鼠标事件
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pixel = getCanvasPixel(e);
    const world = canvasToWorld(pixel.x, pixel.y);

    if (currentTool === 'dashed') {
      if (e.button === 2 || e.detail === 2) {
        e.preventDefault();
        if (drawingPolygon && drawingPolygon.length >= 3) {
          setDashedPolygons(prev => [...prev, drawingPolygon]);
          setDrawingPolygon(null);
        }
        return;
      }
      if (e.button === 0) {
        const snapped = snapPointToExisting(world, drawingPolygon ? drawingPolygon.length : 0, 'dashed');
        setDrawingPolygon(prev => prev ? [...prev, snapped] : [snapped]);
      }
    } else if (currentTool === 'bezier') {
      if (e.button === 2 || e.detail === 2) {
        e.preventDefault();
        if (drawingPolygon && drawingPolygon.length >= 3) {
          setDashedPolygons(prev => [...prev, drawingPolygon]);
          setDrawingPolygon(null);
        }
        return;
      }
      if (e.button === 0) {
        const pointCount = drawingPolygon ? drawingPolygon.length : 0;
        const snapped = snapPointToExisting(world, pointCount, 'bezier');
        if (pointCount === 2) {
          const newPoly = [...drawingPolygon!, snapped];
          setDashedPolygons(prev => [...prev, newPoly]);
          setDrawingPolygon(null);
          setPreviewPoint(null);
        } else {
          setDrawingPolygon(prev => prev ? [...prev, snapped] : [snapped]);
        }
      }
    } else if (currentTool === 'paint') {
      setIsDrawing(true);
      paintOnBase(pixel.x, pixel.y);
    } else if (currentTool === 'picker') {
      pickColor(pixel.x, pixel.y);
    }
  }, [currentTool, getCanvasPixel, drawingPolygon, paintOnBase, pickColor, snapPointToExisting]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pixel = getCanvasPixel(e);
    setMousePos(pixel);
    const world = canvasToWorld(pixel.x, pixel.y);

    if (currentTool === 'dashed' || currentTool === 'bezier') {
      if (drawingPolygon && drawingPolygon.length > 0) {
        const pointCount = drawingPolygon.length;
        const snapped = snapPointToExisting(world, pointCount, currentTool);
        setPreviewPoint(snapped);
        const isSnapped = Math.abs(world.x - snapped.x) > 0.0001 || Math.abs(world.y - snapped.y) > 0.0001;
        setSnapPoint(isSnapped ? snapped : null);
      }
    }

    if (isDrawing && currentTool === 'paint') {
      paintOnBase(pixel.x, pixel.y);
    }
  }, [isDrawing, currentTool, getCanvasPixel, paintOnBase, drawingPolygon, snapPointToExisting]);

  const handleMouseUp = useCallback(() => {
    setIsDrawing(false);
  }, []);

  // 右键菜单禁用
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // 渲染画布
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

    // 1. 背景图
    if (bgImageData) {
      ctx.putImageData(bgImageData, 0, 0);
    }

    // 2. 基础色、残差或叠加显示
    if (mode === 'composite' && baseTexture && residualTexture) {
      // 基础色 + 残差还原 = 原始图像
      const compositeData = new ImageData(new Uint8ClampedArray(baseTexture.data), baseTexture.width, baseTexture.height);
      for (let i = 0; i < compositeData.data.length; i += 4) {
        compositeData.data[i] = Math.min(255, Math.max(0, baseTexture.data[i] + residualTexture.data[i] - 128));
        compositeData.data[i + 1] = Math.min(255, Math.max(0, baseTexture.data[i + 1] + residualTexture.data[i + 1] - 128));
        compositeData.data[i + 2] = Math.min(255, Math.max(0, baseTexture.data[i + 2] + residualTexture.data[i + 2] - 128));
      }
      ctx.putImageData(compositeData, 0, 0);
    } else {
      const displayData = mode === 'base' ? baseTexture : residualTexture;
      if (displayData) {
        ctx.putImageData(displayData, 0, 0);
      }
    }

    // 3. 已完成的多边形（虚线）
    ctx.save();
    ctx.strokeStyle = '#ffaa00';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    for (const poly of dashedPolygons) {
      if (poly.length < 2) continue;
      const pts = poly.map(p => worldToCanvas(p.x, p.y));
      if (poly.length === 3) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.quadraticCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y);
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

    // 4. 正在绘制的多边形（含预览虚线）
    if (drawingPolygon && drawingPolygon.length >= 1) {
      ctx.save();
      ctx.strokeStyle = '#ffaa00';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      const pts = drawingPolygon.map(p => worldToCanvas(p.x, p.y));
      
      if (currentTool === 'bezier' && drawingPolygon.length === 2) {
        if (previewPoint) {
          const previewCanvas = worldToCanvas(previewPoint.x, previewPoint.y);
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.quadraticCurveTo(pts[1].x, pts[1].y, previewCanvas.x, previewCanvas.y);
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
        if (previewPoint) {
          const previewCanvas = worldToCanvas(previewPoint.x, previewPoint.y);
          ctx.lineTo(previewCanvas.x, previewCanvas.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // 5. 多边形顶点和控制点
    ctx.save();
    for (const poly of dashedPolygons) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const cp = worldToCanvas(p.x, p.y);
        if (poly.length === 3 && i === 1) {
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
        const cp = worldToCanvas(p.x, p.y);
        if (currentTool === 'bezier' && drawingPolygon.length === 2 && i === 1) {
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
    ctx.restore();

    // 6. 吸附点显示
    if (snapPoint) {
      ctx.save();
      ctx.fillStyle = '#52c41a';
      ctx.beginPath();
      const sp = worldToCanvas(snapPoint.x, snapPoint.y);
      ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 6. BBox 显示
    if (bbox) {
      ctx.save();
      ctx.strokeStyle = '#52c41a';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
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
  }, [bgImageData, baseTexture, residualTexture, mode, dashedPolygons, drawingPolygon, bbox, mousePos, currentTool, brushColor, brushSize]);

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
          onClick={handleAutoExtract}
          disabled={!bgImageData || dashedPolygons.length === 0}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
        >
          自动提取
        </button>
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
          disabled={!baseTexture}
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
            background: mode === 'base' ? '#52c41a' : '#f0f0f0',
            color: mode === 'base' ? '#fff' : '#333',
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
          onClick={() => {
            setBaseTexture(null);
            setResidualTexture(null);
            setBbox(null);
          }}
          disabled={!baseTexture && !residualTexture}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
        >
          清除结果
        </button>
      </div>

      {/* 独立画布容器（支持滚轮缩放和拖拽平移） */}
      <div
        ref={containerRef}
        style={{
          position: 'relative', flex: 1, width: '100%', overflow: 'hidden',
          background: '#2a2a2a',
          display: 'flex', justifyContent: 'center', alignItems: 'center',
        }}
        onMouseDown={handleContainerMouseDown}
        onMouseMove={handleContainerMouseMove}
        onMouseUp={handleContainerMouseUp}
        onMouseLeave={handleContainerMouseUp}
      >
        <canvas
          ref={canvasRef}
          width={TEX_SIZE}
          height={TEX_SIZE}
          style={{
            display: 'block',
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
        />
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