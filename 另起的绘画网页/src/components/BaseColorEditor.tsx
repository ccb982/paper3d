import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  clusterAndGenerateTexturesV2,
  hslToRgb,
  rgbToHsl,
  dequantize,
} from '../utils/colorCompressor';
import type { Point } from '../types';

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
const TEX_SIZE = 512;

function canvasToWorld(cx: number, cy: number): Point {
  return { x: cx / TEX_SIZE, y: 1 - cy / TEX_SIZE };
}

function worldToCanvas(wx: number, wy: number): Point {
  return { x: wx * TEX_SIZE, y: (1 - wy) * TEX_SIZE };
}

// ============ 提取模式下的BFS取色 ============
function extractBaseByClick(
  bgImageData: ImageData,
  worldPolygons: Point[][],
  clickPixel: { x: number; y: number },
  textureSize: number = TEX_SIZE
): {
  baseTexture: ImageData;
  residualTexture: ImageData;
  bbox: { x: number; y: number; w: number; h: number };
  baseColors: Array<{ h: number; s: number; l: number }>;
} | null {
  if (worldPolygons.length === 0) return null;

  // 将贝塞尔曲线转换为折线（采样）
  const rasterizablePolygons = worldPolygons.map(poly => {
    if (poly.length === 3) {
      return buildBezierPath(poly);
    }
    return poly.slice();
  });

  // 1. 创建墙mask：虚线和贝塞尔曲线作为不可穿过的墙
  const wallMask = new Uint8Array(textureSize * textureSize);
  
  // 将所有多边形（虚线和贝塞尔）光栅化为墙
  for (const poly of rasterizablePolygons) {
    if (poly.length < 2) continue;
    
    // 绘制线段作为墙（8邻域扩展）
    for (let i = 0; i < poly.length - 1; i++) {
      const p1 = poly[i];
      const p2 = poly[i + 1];
      
      const x1 = Math.round(p1.x * textureSize);
      const y1 = Math.round((1 - p1.y) * textureSize);
      const x2 = Math.round(p2.x * textureSize);
      const y2 = Math.round((1 - p2.y) * textureSize);
      
      // 绘制线段（Bresenham算法）
      const dx = Math.abs(x2 - x1);
      const dy = Math.abs(y2 - y1);
      const sx = x1 < x2 ? 1 : -1;
      const sy = y1 < y2 ? 1 : -1;
      let err = dx - dy;
      let x = x1;
      let y = y1;
      
      while (true) {
        if (x >= 0 && x < textureSize && y >= 0 && y < textureSize) {
          // 8邻域标记为墙
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

  // 2. BFS取色：从点击位置开始，不能穿过墙
  const bfsVisited = new Uint8Array(textureSize * textureSize);
  const queue: { x: number; y: number }[] = [];
  
  const cx = clickPixel.x;
  const cy = clickPixel.y;
  
  console.log('[DEBUG BFS] starting at:', { cx, cy, textureSize });
  
  if (cx < 0 || cx >= textureSize || cy < 0 || cy >= textureSize) {
    console.log('[DEBUG BFS] click outside bounds');
    return null;
  }
  if (wallMask[cy * textureSize + cx] === 1) {
    console.log('[DEBUG BFS] click on wall');
    return null;
  }
  
  queue.push({ x: cx, y: cy });
  bfsVisited[cy * textureSize + cx] = 1;
  
  const dx = [-1, 1, 0, 0];
  const dy = [0, 0, -1, 1];
  
  let visitedCount = 1;
  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    
    for (let i = 0; i < 4; i++) {
      const nx = x + dx[i];
      const ny = y + dy[i];
      
      if (nx >= 0 && nx < textureSize && ny >= 0 && ny < textureSize) {
        if (bfsVisited[ny * textureSize + nx] === 0 && wallMask[ny * textureSize + nx] === 0) {
          bfsVisited[ny * textureSize + nx] = 1;
          visitedCount++;
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }
  
  console.log('[DEBUG BFS] completed:', { visitedCount });

  // 3. 计算BFS区域的bbox
  let minX = textureSize, minY = textureSize, maxX = -1, maxY = -1;
  for (let y = 0; y < textureSize; y++) {
    for (let x = 0; x < textureSize; x++) {
      if (bfsVisited[y * textureSize + x] === 1) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  
  if (maxX < 0) return null;
  
  const pxBbox = {
    x: minX,
    y: minY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };

  // 4. 裁剪局部 mask
  const { w, h } = pxBbox;
  const localMask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const globalIdx = (pxBbox.y + y) * textureSize + (pxBbox.x + x);
      localMask[y * w + x] = bfsVisited[globalIdx];
    }
  }
  
  console.log('[DEBUG] localMask created:', {
    localMaskSample: [localMask[0], localMask[100], localMask[1000]],
    localMaskSum: localMask.reduce((a, b) => a + b, 0)
  });

  // 5. 调用聚类函数
  console.log('[DEBUG] before clustering - bfsVisited check:', {
    sample1: bfsVisited[pxBbox.y * textureSize + pxBbox.x],
    sample2: bfsVisited[(pxBbox.y + 5) * textureSize + pxBbox.x + 5],
    count: bfsVisited.reduce((a, b) => a + b, 0)
  });
  
  const { baseColors: colors, regionIdTex, deltaTex } = clusterAndGenerateTexturesV2(
    localMask,
    pxBbox,
    bgImageData,
    0.025,
    textureSize
  );
  
  console.log('[DEBUG] after clustering - bfsVisited check:', {
    sample1: bfsVisited[pxBbox.y * textureSize + pxBbox.x],
    sample2: bfsVisited[(pxBbox.y + 5) * textureSize + pxBbox.x + 5],
    count: bfsVisited.reduce((a, b) => a + b, 0)
  });

  console.log('[DEBUG] extractBaseByClick:', {
    colorsCount: colors.length,
    firstColor: colors.length > 0 ? colors[0] : null,
    regionIdTexLength: regionIdTex?.length,
    deltaTexLength: deltaTex?.length,
    pxBbox: pxBbox,
  });

  if (colors.length === 0) return null;

  // 6. 构建基础色纹理（聚类平均色填充）
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = textureSize;
  baseCanvas.height = textureSize;
  const baseCtx = baseCanvas.getContext('2d')!;
  const baseImageData = baseCtx.createImageData(textureSize, textureSize);
  const baseData = baseImageData.data;

  console.log('[DEBUG] building baseTexture:', {
    pxBbox,
    w, h,
    colorsLength: colors.length,
    regionIdTexLength: regionIdTex?.length,
    regionIdTexSample: regionIdTex ? [
      regionIdTex[0],
      regionIdTex[100],
      regionIdTex[1000]
    ] : 'null'
  });

  let paintedPixels = 0;
  
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
        paintedPixels++;
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
        paintedPixels++;
      }
    }
  }
  
  console.log('[DEBUG] baseTexture loop complete:', { paintedPixels });

  let foundPixel = null;
  for (let i = 0; i < regionIdTex?.length; i++) {
    if (regionIdTex && regionIdTex[i] > 0) {
      const localY = Math.floor(i / w);
      const localX = i % w;
      const globalY = pxBbox.y + localY;
      const globalX = pxBbox.x + localX;
      const idx = (globalY * textureSize + globalX) * 4;
      foundPixel = {
        localIdx: i,
        globalX, globalY,
        clusterIdx: regionIdTex[i],
        rgb: [baseData[idx], baseData[idx + 1], baseData[idx + 2], baseData[idx + 3]]
      };
      break;
    }
  }
  
  console.log('[DEBUG] baseTexture created:', {
    foundPixel,
    foundPixelRgb: foundPixel ? foundPixel.rgb : null,
    paintedPixels: paintedPixels
  });

  // 7. 构建残差纹理（使用 deltaTex 编码值）
  const residualCanvas = document.createElement('canvas');
  residualCanvas.width = textureSize;
  residualCanvas.height = textureSize;
  const residualCtx = residualCanvas.getContext('2d')!;
  const residualImageData = residualCtx.createImageData(textureSize, textureSize);
  const residualData = residualImageData.data;

  for (let y = 0; y < textureSize; y++) {
    for (let x = 0; x < textureSize; x++) {
      const idx = (y * textureSize + x) * 4;
      residualData[idx] = 128;
      residualData[idx + 1] = 128;
      residualData[idx + 2] = 128;
      residualData[idx + 3] = 255;
    }
  }
  
  for (let localIdx = 0; localIdx < deltaTex.length / 3; localIdx++) {
    const dIdx = localIdx * 3;
    const localY = Math.floor(localIdx / w);
    const localX = localIdx % w;
    const globalY = pxBbox.y + localY;
    const globalX = pxBbox.x + localX;
    const idx = (globalY * textureSize + globalX) * 4;
    
    residualData[idx] = deltaTex[dIdx];
    residualData[idx + 1] = deltaTex[dIdx + 1];
    residualData[idx + 2] = deltaTex[dIdx + 2];
    residualData[idx + 3] = 255;
  }

  return {
    baseTexture: baseImageData,
    residualTexture: residualImageData,
    bbox: pxBbox,
    baseColors: colors,
    regionIdTex: regionIdTex || new Uint8Array(0),
    texW: w,
    texH: h,
  };
}

// ============ 组件 ============
export const BaseColorEditor: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [bgImageData, setBgImageData] = useState<ImageData | null>(null);
  const [dashedPolygons, setDashedPolygons] = useState<Point[][]>([]);
  const [drawingPolygon, setDrawingPolygon] = useState<Point[] | null>(null);
  const [currentTool, setCurrentTool] = useState<'dashed' | 'bezier' | 'paint' | 'picker' | 'select'>('dashed');
  const [mode, setMode] = useState<'base' | 'residual' | 'composite' | 'base2'>('base');
  const [baseTexture, setBaseTexture] = useState<ImageData | null>(null);
  const [residualTexture, setResidualTexture] = useState<ImageData | null>(null);
  const [bbox, setBbox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [baseColors, setBaseColors] = useState<Array<{ h: number; s: number; l: number }>>([]);
  const [regionIdTex, setRegionIdTex] = useState<Uint8Array>(new Uint8Array(0));
  const [texWH, setTexWH] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
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

  // 撤销历史
  interface HistoryState {
    dashedPolygons: Point[][];
    baseTexture: ImageData | null;
    residualTexture: ImageData | null;
    bbox: { x: number; y: number; w: number; h: number } | null;
    baseColors: Array<{ h: number; s: number; l: number }>;
  }
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const saveToHistory = useCallback(() => {
    const newState: HistoryState = {
      dashedPolygons: dashedPolygons.map(poly => poly.map(p => ({ ...p }))),
      baseTexture: baseTexture ? new ImageData(new Uint8ClampedArray(baseTexture.data), baseTexture.width, baseTexture.height) : null,
      residualTexture: residualTexture ? new ImageData(new Uint8ClampedArray(residualTexture.data), residualTexture.width, residualTexture.height) : null,
      bbox: bbox ? { ...bbox } : null,
      baseColors: baseColors.map(c => ({ ...c })),
    };
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  }, [dashedPolygons, baseTexture, residualTexture, bbox, baseColors, history, historyIndex]);

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    const prevState = history[historyIndex - 1];
    setDashedPolygons(prevState.dashedPolygons);
    setBaseTexture(prevState.baseTexture);
    setResidualTexture(prevState.residualTexture);
    setBbox(prevState.bbox);
    setBaseColors(prevState.baseColors);
    setHistoryIndex(historyIndex - 1);
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const nextState = history[historyIndex + 1];
    setDashedPolygons(nextState.dashedPolygons);
    setBaseTexture(nextState.baseTexture);
    setResidualTexture(nextState.residualTexture);
    setBbox(nextState.bbox);
    setBaseColors(nextState.baseColors);
    setHistoryIndex(historyIndex + 1);
  }, [history, historyIndex]);

  // 键盘快捷键
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
        setBaseColors([]);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  }, []);

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

  const handleExtractClick = useCallback((pixel: { x: number; y: number }) => {
    if (!bgImageData) return;
    const allPolygons = drawingPolygon && drawingPolygon.length >= 3
      ? [...dashedPolygons, drawingPolygon]
      : dashedPolygons;
    if (allPolygons.length === 0) return;

    const result = extractBaseByClick(bgImageData, allPolygons, pixel);
    if (result) {
      console.log('[DEBUG] extract result:', {
        baseTextureExists: !!result.baseTexture,
        firstPixel: result.baseTexture ? [
          result.baseTexture.data[0],
          result.baseTexture.data[1],
          result.baseTexture.data[2],
          result.baseTexture.data[3]
        ] : null,
        bbox: result.bbox
      });
      setBaseTexture(result.baseTexture);
      setResidualTexture(result.residualTexture);
      setBbox(result.bbox);
      setBaseColors(result.baseColors);
      setRegionIdTex(result.regionIdTex);
      setTexWH({ w: result.texW, h: result.texH });
      setIsExtractMode(false);
      setTimeout(() => saveToHistory(), 0);
    }
  }, [bgImageData, dashedPolygons, drawingPolygon, saveToHistory]);

  // 更新基础色并重新生成纹理
  const updateBaseColor = useCallback((index: number, newHSL: { h: number; s: number; l: number }) => {
    setBaseColors(prev => {
      const updated = [...prev];
      updated[index] = newHSL;
      return updated;
    });

    // 重新生成 baseTexture
    if (baseTexture && regionIdTex.length > 0 && bbox) {
      const newData = new Uint8ClampedArray(baseTexture.data);
      const rgb = hslToRgb(newHSL.h, newHSL.s, newHSL.l);
      const { w, h: hTex } = texWH;

      for (let localIdx = 0; localIdx < regionIdTex.length; localIdx++) {
        const clusterIdx = regionIdTex[localIdx];
        if (clusterIdx === index + 1) {
          const localY = Math.floor(localIdx / w);
          const localX = localIdx % w;
          const globalY = bbox.y + localY;
          const globalX = bbox.x + localX;
          const idx = (globalY * TEX_SIZE + globalX) * 4;
          newData[idx] = rgb.r;
          newData[idx + 1] = rgb.g;
          newData[idx + 2] = rgb.b;
          newData[idx + 3] = 255;
        }
      }

      setBaseTexture(new ImageData(newData, TEX_SIZE, TEX_SIZE));
    }
  }, [baseTexture, regionIdTex, bbox, texWH]);

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

    const updated = new ImageData(new Uint8ClampedArray(data), TEX_SIZE, TEX_SIZE);
    setBaseTexture(updated);
  }, [baseTexture, brushColor, brushSize]);

  // 鼠标事件
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pixel = getCanvasPixel(e);
    const world = canvasToWorld(pixel.x, pixel.y);

    if (isExtractMode && e.button === 0) {
      handleExtractClick(pixel);
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
            setTimeout(() => saveToHistory(), 0);
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
          setTimeout(() => saveToHistory(), 0);
        } else {
          setDrawingPolygon(prev => prev ? [...prev, snapped] : [snapped]);
        }
      }
    } else if (currentTool === 'paint') {
      saveToHistory();
      setIsDrawing(true);
      paintOnBase(pixel.x, pixel.y);
    } else if (currentTool === 'picker') {
      pickColor(pixel.x, pixel.y);
    }
  }, [currentTool, getCanvasPixel, drawingPolygon, paintOnBase, pickColor, saveToHistory, snapPointToExisting]);

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
    if (isDrawing && baseTexture) {
      setTimeout(() => saveToHistory(), 0);
    }
    setIsDrawing(false);
  }, [isDrawing, baseTexture, saveToHistory]);

  // 右键菜单禁用
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  // 渲染画布（主要内容，不依赖 mousePos）
  const renderCountRef = useRef(0);
  useEffect(() => {
    renderCountRef.current++;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    console.log(`[DEBUG] RENDER #${renderCountRef.current} START: mode=${mode}, baseTexture=${!!baseTexture}, isExtractMode=${isExtractMode}`);

    // ===== 新基础色模式：完全独立的渲染路径 =====
    if (mode === 'base2') {
      ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

      if (baseTexture) {
        ctx.putImageData(baseTexture, 0, 0);
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
        ctx.beginPath();
        const p0 = worldToCanvas(poly[0].x, poly[0].y);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < poly.length; i++) {
          const p = worldToCanvas(poly[i].x, poly[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();

      // 绘制 bbox
      if (bbox) {
        ctx.save();
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bbox.x, bbox.y, bbox.w, bbox.h);
        ctx.restore();
      }

      return;
    }

    // 基础色模式：直接绘制基础色纹理
    if (mode === 'base') {
      if (baseTexture) {
        // 临时测试：用 fillRect 填充白色
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
        console.log('[DEBUG] BASE MODE: fillRect WHITE');
      } else if (bgImageData) {
        ctx.putImageData(bgImageData, 0, 0);
      }
    }
    // 残差模式：基础色区域显示残差（偏移128），其他区域显示灰色
    else if (mode === 'residual') {
      if (residualTexture) {
        ctx.putImageData(residualTexture, 0, 0);
      }
    }
    // 叠加模式：基础色 + 残差还原（原始图像）
    else if (mode === 'composite') {
      if (baseTexture && residualTexture) {
        const compositeData = new ImageData(
          new Uint8ClampedArray(baseTexture.data),
          TEX_SIZE,
          TEX_SIZE
        );
        const baseData = baseTexture.data;
        const residualData = residualTexture.data;

        for (let y = 0; y < TEX_SIZE; y++) {
          for (let x = 0; x < TEX_SIZE; x++) {
            const idx = (y * TEX_SIZE + x) * 4;
            if (baseData[idx + 3] > 0) {
              const hslBase = rgbToHsl(baseData[idx], baseData[idx + 1], baseData[idx + 2]);
              const dH = dequantize(residualData[idx], 0.25);
              const dS = dequantize(residualData[idx + 1], 1.0);
              const dL = dequantize(residualData[idx + 2], 1.0);
              let finalH = hslBase.h + dH;
              if (finalH < 0) finalH += 1.0;
              if (finalH >= 1.0) finalH -= 1.0;
              const finalS = Math.max(0, Math.min(1, hslBase.s + dS));
              const finalL = Math.max(0, Math.min(1, hslBase.l + dL));
              const rgb = hslToRgb(finalH, finalS, finalL);
              compositeData.data[idx] = rgb.r;
              compositeData.data[idx + 1] = rgb.g;
              compositeData.data[idx + 2] = rgb.b;
              compositeData.data[idx + 3] = 255;
            } else {
              compositeData.data[idx + 3] = 0;
            }
          }
        }
        ctx.putImageData(compositeData, 0, 0);
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
      ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
      ctx.fillStyle = '#ff0000';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('提取模式 - 点击区域提取颜色', TEX_SIZE / 2, TEX_SIZE / 2);
      ctx.font = '12px Arial';
      ctx.fillText('虚线/贝塞尔曲线作为墙，BFS无法穿过', TEX_SIZE / 2, TEX_SIZE / 2 + 24);
      ctx.restore();
    }

    // 4. 已完成的多边形（虚线）
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

    // 5. 正在绘制的多边形（含预览虚线）
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
        if (previewPoint) {
          const previewCanvas = worldToCanvas(previewPoint.x, previewPoint.y);
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
        const cp = worldToCanvas(p.x, p.y);
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
        const cp = worldToCanvas(p.x, p.y);
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

    console.log(`[DEBUG] RENDER #${renderCountRef.current} END`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bgImageData, baseTexture, residualTexture, mode, dashedPolygons, drawingPolygon, bbox, isExtractMode]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const octx = overlay.getContext('2d')!;
    // 清除 overlay
    octx.clearRect(0, 0, TEX_SIZE, TEX_SIZE);

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
  }, [mousePos, currentTool, brushColor, brushSize]);

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
          onClick={undo}
          disabled={historyIndex <= 0}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer', border: '1px solid #d9d9d9' }}
          title="Ctrl+Z"
        >
          ↩ 撤销
        </button>
        <button
          onClick={redo}
          disabled={historyIndex >= history.length - 1}
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
          onClick={() => setMode('base2')}
          style={{
            padding: '2px 8px', fontSize: '11px', cursor: 'pointer',
            background: mode === 'base2' ? '#ff4d4f' : '#f0f0f0',
            color: mode === 'base2' ? '#fff' : '#333',
            border: '1px solid #d9d9d9',
          }}
        >
          新基础色
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
            setBaseColors([]);
          }}
          disabled={!baseTexture && !residualTexture}
          style={{ padding: '2px 8px', fontSize: '11px', cursor: 'pointer' }}
        >
          清除结果
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
              width={TEX_SIZE}
              height={TEX_SIZE}
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
            />
            <canvas
              ref={overlayRef}
              width={TEX_SIZE}
              height={TEX_SIZE}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                display: 'block',
                border: '1px solid #333',
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                pointerEvents: 'none',
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

        {/* 基础色信息面板 - position: absolute 避免影响 canvas 布局 */}
        {(mode === 'base' || mode === 'base2') && baseColors.length > 0 && (
          <div style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: '280px',
            padding: '12px',
            background: '#f5f5f5',
            borderLeft: '1px solid #ddd',
            overflowY: 'auto',
            overflowX: 'hidden',
            fontSize: '12px',
            zIndex: 10,
          }}>
            <h4 style={{ margin: '0 0 8px 0' }}>基础色列表 ({baseColors.length})</h4>
            {baseColors.map((hsl, index) => {
              const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
              const hex = `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`;
              return (
                <div key={index} style={{
                  marginBottom: '12px',
                  padding: '8px',
                  background: '#fff',
                  borderRadius: '4px',
                  border: '1px solid #e0e0e0',
                }}>
                  {/* 颜色行 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ minWidth: '28px', fontWeight: 'bold', color: '#333' }}>#{index + 1}</span>
                    <div style={{ width: '28px', height: '28px', borderRadius: '4px', background: hex, border: '1px solid #ccc' }} />
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#666' }}>
                      {hex.toUpperCase()}
                    </span>
                  </div>
                  {/* HSL 滑块 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                    <span style={{ width: '12px', fontSize: '10px', color: '#999' }}>H</span>
                    <input
                      type="range"
                      min={0} max={360} step={1}
                      value={hsl.h * 360}
                      onChange={e => updateBaseColor(index, { ...hsl, h: Number(e.target.value) / 360 })}
                      style={{ flex: 1, height: '4px' }}
                    />
                    <span style={{ width: '36px', textAlign: 'right', fontFamily: 'monospace', fontSize: '10px' }}>
                      {(hsl.h * 360).toFixed(0)}°
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
                    <span style={{ width: '12px', fontSize: '10px', color: '#999' }}>S</span>
                    <input
                      type="range"
                      min={0} max={100} step={1}
                      value={hsl.s * 100}
                      onChange={e => updateBaseColor(index, { ...hsl, s: Number(e.target.value) / 100 })}
                      style={{ flex: 1, height: '4px' }}
                    />
                    <span style={{ width: '36px', textAlign: 'right', fontFamily: 'monospace', fontSize: '10px' }}>
                      {(hsl.s * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ width: '12px', fontSize: '10px', color: '#999' }}>L</span>
                    <input
                      type="range"
                      min={0} max={100} step={1}
                      value={hsl.l * 100}
                      onChange={e => updateBaseColor(index, { ...hsl, l: Number(e.target.value) / 100 })}
                      style={{ flex: 1, height: '4px' }}
                    />
                    <span style={{ width: '36px', textAlign: 'right', fontFamily: 'monospace', fontSize: '10px' }}>
                      {(hsl.l * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })}
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