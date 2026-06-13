import { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { Point, Shape, PointAnnotation, RegionAnnotation } from '../types';
import { AnnotationEditor } from './AnnotationEditor';
import { worldToCanvas, canvasToWorld, worldToAxis } from '../utils/transform';
import { findRegionByPoint, generateRegionSignature } from '../utils/regionDetection';
import { getRegionIdAtPoint, computeRegionIdAtPoint, getDebugRegions, computeGridRegions, computeScanlineIntervals, type DebugRay, type BoundaryPoint } from '../utils/regionDetectionExact';
import { generatePolygonFromPoints } from '../utils/geometryUtils';
import { drawCircleOnBuffer } from '../utils/paintBufferUtils';

const BASE_CANVAS_SIZE = 512;
const PAINT_BUFFER_SIZE = 512; // 绘制缓冲区固定尺寸

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
    fullPath.push(...curve.slice(1)); // 避免重复起点
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

function clipLineToCanvas(
  start: { x: number; y: number },
  end: { x: number; y: number },
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  let x = end.x;
  let y = end.y;
  
  // 如果端点在画布内，直接返回
  if (x >= 0 && x <= canvasWidth && y >= 0 && y <= canvasHeight) {
    return { x, y };
  }
  
  // 使用 Liang-Barsky 算法裁剪线段到画布边界
  const x0 = start.x, y0 = start.y;
  const x1 = end.x, y1 = end.y;
  const xmin = 0, ymin = 0, xmax = canvasWidth, ymax = canvasHeight;
  
  let t0 = 0, t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
  
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      // 线段平行于裁剪边界
      if (q[i] < 0) return { x: x0, y: y0 }; // 完全在边界外
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0 && t > t0) t0 = t;
      if (p[i] > 0 && t < t1) t1 = t;
    }
  }
  
  if (t0 > t1) return { x: x0, y: y0 }; // 线段完全在裁剪区域外
  
  // 返回裁剪后的端点
  return {
    x: x0 + t1 * dx,
    y: y0 + t1 * dy
  };
}

function sampleQuadraticCurve(p0: Point, p1: Point, ctrl: Point, segments = 30): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    const x = mt * mt * p0.x + 2 * mt * t * ctrl.x + t * t * p1.x;
    const y = mt * mt * p0.y + 2 * mt * t * ctrl.y + t * t * p1.y;
    points.push({ x, y });
  }
  return points;
}

export function MainCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const {
    imageState,
    layerVisibility,
    axis,
    grid,
    zoom,
    panOffset,
    isPanMode,
    setZoom,
    setPanOffset,
    mousePosition,
    setMousePosition,
    currentTool,
    shapes,
    addShape,
    activeGroupId,
    activeLayerId,
    layers,
    snapRadius,
    snapEnabled,
    lineWidth,
    pointAnnotations,
    addPointAnnotation,
    updatePointAnnotation,
    removePointAnnotation,
    regionAnnotations,
    addRegionAnnotation,
    updateRegionAnnotationWithRegionId,
    removeRegionAnnotation,
    saveToStorage,
    regionPolygonsCache,
    refreshRegionCache,
    colorBlockRegionsCache,
    refreshColorBlockCache,
    saveHistory,
    currentColor,
    paintBrushSize,
    paintBuffers,
    initPaintBuffer,
    updatePaintBuffer,
    extractPolygonsFromPaintBuffer,
    addPixelToRegion,
    regionIdTexture,
    isRestoringHistory,
    // 背景拖动
    setBackgroundDragging,
    startBackgroundDrag,
    updateBackgroundDrag,
    endBackgroundDrag,
    // 画布尺寸
    canvasWidth,
    canvasHeight,
    // 颜色提取模式
    colorExtractMode,
    setColorExtractMode,
    colorExtractTool,
    colorExtractPoints,
    addColorExtractPoint,
    clearColorExtractPoints,
  } = useAppStore();

  // 使用 ref 追踪恢复状态，避免触发 useEffect
  const isRestoringRef = useRef(false);
  useEffect(() => {
    isRestoringRef.current = isRestoringHistory;
  }, [isRestoringHistory]);

  // 调试：追踪 colorExtractMode 状态变化
  useEffect(() => {
    console.log(`[颜色提取] colorExtractMode 状态变化: ${colorExtractMode}`);
  }, [colorExtractMode]);

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  // 使用全局画布尺寸
  const [showDebugRegions, setShowDebugRegions] = useState(false);
  const [showGridCells, setShowGridCells] = useState(false);
  const [debugRegionId, setDebugRegionId] = useState(0);
  const [debugOutsideId, setDebugOutsideId] = useState(-1);
  const [debugShowOriginal, setDebugShowOriginal] = useState(true);
  const [debugDistanceThreshold, setDebugDistanceThreshold] = useState(1.2);
  const [debugRadialThreshold, setDebugRadialThreshold] = useState(2);
  const [debugDownsampleFactor, setDebugDownsampleFactor] = useState(0.5);
  const [debugRingDistanceThreshold, setDebugRingDistanceThreshold] = useState(2);
  const [debugRingRadialThreshold, setDebugRingRadialThreshold] = useState(2);
  const [debugShowEndpoints, setDebugShowEndpoints] = useState(false);
  const [debugShowRings, setDebugShowRings] = useState(false);
  const [debugShowSegments, setDebugShowSegments] = useState(false);
  const [debugShowWallGrouped, setDebugShowWallGrouped] = useState(false);
  
  // 上色画笔状态
  const [isPainting, setIsPainting] = useState(false);
  const lastPaintPointRef = useRef<Point | null>(null);

  // 记录圆内所有像素坐标到对应区域（使用预计算的区域ID纹理快速查询）
  const recordCirclePixelsToRegions = useCallback((
    centerWorld: Point,
    radiusWorld: number
  ) => {
    const centerX = centerWorld.x * PAINT_BUFFER_SIZE;
    const centerY = (1 - centerWorld.y) * PAINT_BUFFER_SIZE;
    const radiusPx = radiusWorld * PAINT_BUFFER_SIZE;
    const radiusSq = radiusPx * radiusPx;
    const minX = Math.max(0, Math.floor(centerX - radiusPx));
    const maxX = Math.min(PAINT_BUFFER_SIZE - 1, Math.ceil(centerX + radiusPx));
    const minY = Math.max(0, Math.floor(centerY - radiusPx));
    const maxY = Math.min(PAINT_BUFFER_SIZE - 1, Math.ceil(centerY + radiusPx));

    // 获取当前图层的区域ID纹理
    const layerId = activeLayerId || layers[0]?.id;
    if (!layerId) return;
    const texture = regionIdTexture.get(layerId);
    if (!texture) return;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        if (dx * dx + dy * dy <= radiusSq) {
          // 从纹理中快速查询区域ID（O(1)操作）
          const regionId = texture[y * PAINT_BUFFER_SIZE + x];
          if (regionId !== 0) {
            addPixelToRegion(regionId, x, y);
          }
        }
      }
    }
  }, [activeLayerId, layers, regionIdTexture, addPixelToRegion]);
  
  const generateEditorId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const [pointAnnotationEditor, setPointAnnotationEditor] = useState<{
    editorId: string;
    x: number;
    y: number;
    annotationId: string | null;
    existingText: string;
    position: Point;
  } | null>(null);

  const [regionAnnotationEditor, setRegionAnnotationEditor] = useState<{
    editorId: string;
    x: number;
    y: number;
    annotationId: string | null;
    existingText: string;
    polygon: Point[][];
    regionId: string;
  } | null>(null);

  const currentEditorIdRef = useRef<string | null>(null);

  const closeCurrentEditor = useCallback(() => {
    setPointAnnotationEditor(null);
    setRegionAnnotationEditor(null);
  }, []);

  // 同步当前编辑器ID到ref
  useEffect(() => {
    currentEditorIdRef.current = pointAnnotationEditor?.editorId || regionAnnotationEditor?.editorId || null;
  }, [pointAnnotationEditor, regionAnnotationEditor]);

  // ========== 橡皮擦专用状态 ==========
  const [isErasing, setIsErasing] = useState(false);
  const erasedShapesThisSessionRef = useRef<Set<string>>(new Set()); // 用 ref 避免不必要的重渲染

  // ========== 视图尺寸自适应（已移除，改用全局画布尺寸）==========

  // ========== Escape 键取消临时图形和注释编辑器 ==========
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'd') {
        setShowDebugRegions(prev => !prev);
        return;
      }
      if (e.ctrlKey && e.key === 'g') {
        setShowGridCells(prev => !prev);
        return;
      }
      if (e.key === 'Escape') {
        if (tempPoints.length > 0) {
          useAppStore.setState((s) => ({
            shapes: s.shapes.filter(sh => sh.id !== 'current_shape'),
          }));
          setTempPoints([]);
          setPreviewPoint(null);
        }
        if (pointAnnotationEditor || regionAnnotationEditor) {
          setPointAnnotationEditor(null);
          setRegionAnnotationEditor(null);
        }
        // 颜色提取模式：ESC 退出
        if (colorExtractMode) {
          console.log('[颜色提取] ESC 退出模式，已清除控制点');
          clearColorExtractPoints();
          setColorExtractMode(false);
          useAppStore.setState({ colorExtractTool: null });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tempPoints, pointAnnotationEditor, regionAnnotationEditor, colorExtractMode, clearColorExtractPoints, setColorExtractMode]);

  // ========== 切换工具时清理临时图形 ==========
  const prevToolRef = useRef(currentTool);
  useEffect(() => {
    if (prevToolRef.current !== currentTool) {
      if (tempPoints.length > 0) {
        useAppStore.setState((s) => ({
          shapes: s.shapes.filter(sh => sh.id !== 'current_shape'),
        }));
        setTempPoints([]);
        setPreviewPoint(null);
      }
      // 切换到非 select 工具时才退出颜色提取模式
      if (colorExtractMode && currentTool !== 'select') {
        clearColorExtractPoints();
        setColorExtractMode(false);
        useAppStore.setState({ colorExtractTool: null });
      }
    }
    prevToolRef.current = currentTool;
  }, [currentTool, tempPoints, colorExtractMode, clearColorExtractPoints, setColorExtractMode]);

  // ========== 坐标转换函数 ==========
  const canvasToWorldFn = useCallback((canvasX: number, canvasY: number): Point => {
    return canvasToWorld(canvasX, canvasY, axis, canvasWidth, canvasHeight, zoom, panOffset);
  }, [axis, canvasWidth, canvasHeight, zoom, panOffset]);

  const worldToCanvasFn = useCallback((worldX: number, worldY: number): Point => {
    return worldToCanvas(worldX, worldY, axis, canvasWidth, canvasHeight, { applyViewTransform: false });
  }, [axis, canvasWidth, canvasHeight]);

  const worldToCanvasForSnap = useCallback((worldX: number, worldY: number): Point => {
    return worldToCanvas(worldX, worldY, axis, canvasWidth, canvasHeight, { applyViewTransform: true }, zoom, panOffset);
  }, [axis, canvasWidth, canvasHeight, zoom, panOffset]);

  // ========== 点吸附 ==========
  const snapToExistingPoint = useCallback((
    point: Point,
    toolType: string,
    currentPointCount: number
  ): Point => {
    if (!snapEnabled) return point;
    const shouldSnapNow = (() => {
      if (toolType === 'quadratic' && currentPointCount >= 2) return false;
      if (toolType === 'rectangle' && currentPointCount >= 2) return false;
      return true;
    })();
    if (!shouldSnapNow) return point;

    const canvasPoint = worldToCanvasForSnap(point.x, point.y);
    let bestMatch: Point | null = null;
    let bestDist = snapRadius;

    const candidateMap = new Map<string, Point>();
    const addCandidate = (p: Point) => {
      const key = `${Math.round(p.x * 1e6)}_${Math.round(p.y * 1e6)}`;
      if (!candidateMap.has(key)) candidateMap.set(key, p);
    };

    for (const shape of shapes) {
      if (shape.id === 'current_shape') continue;
      shape.points.forEach(p => addCandidate(p));
      if (shape.type === 'rectangle' && shape.points.length >= 2) {
        const p1 = shape.points[0];
        const p2 = shape.points[1];
        const minX = Math.min(p1.x, p2.x);
        const maxX = Math.max(p1.x, p2.x);
        const minY = Math.min(p1.y, p2.y);
        const maxY = Math.max(p1.y, p2.y);
        addCandidate({ x: minX, y: minY });
        addCandidate({ x: maxX, y: minY });
        addCandidate({ x: maxX, y: maxY });
        addCandidate({ x: minX, y: maxY });
      }
    }

    if (toolType !== 'rectangle') {
      tempPoints.forEach(p => addCandidate(p));
    }

    for (const p of candidateMap.values()) {
      const pCanvas = worldToCanvasForSnap(p.x, p.y);
      const dist = Math.hypot(canvasPoint.x - pCanvas.x, canvasPoint.y - pCanvas.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = p;
      }
    }
    return bestMatch || point;
  }, [snapEnabled, snapRadius, shapes, tempPoints, worldToCanvasForSnap]);

  // ========== 查找图形上的点/边（用于注释）==========
  const findShapeAtPoint = useCallback((x: number, y: number) => {
    const hitRadius = snapRadius / zoom;
    for (const shape of shapes) {
      if (shape.id === 'current_shape') continue;
      for (let i = 0; i < shape.points.length; i++) {
        const p = shape.points[i];
        const distance = Math.hypot(x - p.x, y - p.y);
        if (distance < hitRadius) return { shape, pointIndex: i };
      }
      if (shape.points.length >= 2) {
        const p1 = shape.points[0];
        const p2 = shape.points[shape.points.length - 1];
        const lineLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (lineLength > 0) {
          const t = Math.max(0, Math.min(1, 
            ((x - p1.x) * (p2.x - p1.x) + (y - p1.y) * (p2.y - p1.y)) / (lineLength * lineLength)
          ));
          const closestX = p1.x + t * (p2.x - p1.x);
          const closestY = p1.y + t * (p2.y - p1.y);
          const distance = Math.hypot(x - closestX, y - closestY);
          if (distance < hitRadius) return { shape, pointIndex: undefined };
        }
      }
    }
    return null;
  }, [shapes, snapRadius, zoom]);

  // ========== 区域检测（用于注释闭合区域）==========
  const getShapeBounds = (shape: Shape) => {
    if (shape.points.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of shape.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { minX, minY, maxX, maxY };
  };

  const isClosedShape = (shape: Shape): boolean => {
    if (['circle', 'rectangle', 'triangle'].includes(shape.type)) return true;
    if (['line', 'brush', 'quadratic'].includes(shape.type) && shape.points.length >= 3) {
      const first = shape.points[0], last = shape.points[shape.points.length - 1];
      return Math.hypot(first.x - last.x, first.y - last.y) < 10;
    }
    return false;
  };

  const isPointInPolygon = (point: Point, vertices: Point[]): boolean => {
    let inside = false;
    const n = vertices.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = vertices[i].x, yi = vertices[i].y;
      const xj = vertices[j].x, yj = vertices[j].y;
      if (((yi > point.y) !== (yj > point.y)) &&
          (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };

  const getShapeVertices = (shape: Shape): Point[] => {
    switch (shape.type) {
      case 'circle': {
        const cx = shape.points[0].x, cy = shape.points[0].y;
        const radius = Math.hypot(shape.points[1].x - cx, shape.points[1].y - cy);
        const vertices: Point[] = [];
        const segments = 32;
        for (let i = 0; i < segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          vertices.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
        }
        return vertices;
      }
      case 'rectangle': {
        const p1 = shape.points[0], p2 = shape.points[1];
        return [{ x: p1.x, y: p1.y }, { x: p2.x, y: p1.y }, { x: p2.x, y: p2.y }, { x: p1.x, y: p2.y }];
      }
      case 'triangle': return shape.points.slice(0, 3);
      default: return shape.points;
    }
  };

  const getShapeArea = (shape: Shape): number => {
    switch (shape.type) {
      case 'circle': {
        const cx = shape.points[0].x, cy = shape.points[0].y;
        const radius = Math.hypot(shape.points[1].x - cx, shape.points[1].y - cy);
        return Math.PI * radius * radius;
      }
      case 'rectangle': {
        const p1 = shape.points[0], p2 = shape.points[1];
        return Math.abs(p2.x - p1.x) * Math.abs(p2.y - p1.y);
      }
      case 'triangle': {
        if (shape.points.length < 3) return 0;
        const [a, b, c] = shape.points;
        return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
      }
      default: {
        const vertices = getShapeVertices(shape);
        if (vertices.length < 3) return 0;
        let area = 0;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
          area += vertices[j].x * vertices[i].y - vertices[j].y * vertices[i].x;
        }
        return Math.abs(area / 2);
      }
    }
  };

  const isPointInsideShape = (point: Point, shape: Shape): boolean => {
    switch (shape.type) {
      case 'circle': {
        const center = shape.points[0];
        const radius = Math.hypot(shape.points[1].x - center.x, shape.points[1].y - center.y);
        return Math.hypot(point.x - center.x, point.y - center.y) <= radius;
      }
      case 'rectangle': {
        const p1 = shape.points[0], p2 = shape.points[1];
        const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
        const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
        return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
      }
      case 'triangle': {
        if (shape.points.length < 3) return false;
        const [a, b, c] = shape.points;
        const v1 = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
        const v2 = (c.x - b.x) * (point.y - b.y) - (c.y - b.y) * (point.x - b.x);
        const v3 = (a.x - c.x) * (point.y - c.y) - (a.y - c.y) * (point.x - c.x);
        const hasNeg = (v1 < 0) || (v2 < 0) || (v3 < 0);
        const hasPos = (v1 > 0) || (v2 > 0) || (v3 > 0);
        return !(hasNeg && hasPos);
      }
      default: return isPointInPolygon(point, getShapeVertices(shape));
    }
  };

  const detectRegionAtPoint = useCallback((worldX: number, worldY: number) => {
    const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
    const closedShapes = currentLayerShapes.filter(s => isClosedShape(s));
    if (closedShapes.length === 0) return null;
    const hitShapes: Shape[] = [];
    for (const shape of closedShapes) {
      if (isPointInsideShape({ x: worldX, y: worldY }, shape)) hitShapes.push(shape);
    }
    if (hitShapes.length === 0) return null;
    hitShapes.sort((a, b) => getShapeArea(a) - getShapeArea(b));
    const targetShape = hitShapes[0];
    return { shapeIds: [targetShape.id], bounds: getShapeBounds(targetShape), type: 'closed' as const, shape: targetShape };
  }, [shapes, activeLayerId]);

  // ========== 橡皮擦核心：检测给定画布像素坐标下需要擦除的图形ID ==========
  const getShapesToEraseAtPoint = useCallback((canvasX: number, canvasY: number): string[] => {
    const state = useAppStore.getState();
    const currentLayerId = state.activeLayerId || state.layers[0]?.id;
    if (!currentLayerId) return [];

    const shapesInLayer = state.shapes.filter(
      s => s.layerId === currentLayerId && s.id !== 'current_shape'
    );
    const toEraseIds: string[] = [];

    for (const shape of shapesInLayer) {
      // 如果本次会话已经删除过则跳过
      if (erasedShapesThisSessionRef.current.has(shape.id)) continue;

      const pointsCanvas = shape.points.map(p => worldToCanvasForSnap(p.x, p.y));
      let hit = false;

      switch (shape.type) {
        case 'point':
          if (pointsCanvas.length > 0) {
            const dist = Math.hypot(canvasX - pointsCanvas[0].x, canvasY - pointsCanvas[0].y);
            if (dist < snapRadius) hit = true;
          }
          break;
        case 'line':
          if (pointsCanvas.length >= 2) {
            const [p1, p2] = pointsCanvas;
            const dist = distanceToLineSegment(canvasX, canvasY, p1.x, p1.y, p2.x, p2.y);
            if (dist < snapRadius) hit = true;
          }
          break;
        case 'rectangle':
          if (pointsCanvas.length >= 2) {
            const [p1, p2] = pointsCanvas;
            const left = Math.min(p1.x, p2.x), right = Math.max(p1.x, p2.x);
            const top = Math.min(p1.y, p2.y), bottom = Math.max(p1.y, p2.y);
            if (distanceToLineSegment(canvasX, canvasY, left, top, right, top) < snapRadius ||
                distanceToLineSegment(canvasX, canvasY, right, top, right, bottom) < snapRadius ||
                distanceToLineSegment(canvasX, canvasY, right, bottom, left, bottom) < snapRadius ||
                distanceToLineSegment(canvasX, canvasY, left, bottom, left, top) < snapRadius) {
              hit = true;
            }
          }
          break;
        case 'circle':
          if (pointsCanvas.length >= 2) {
            const center = pointsCanvas[0], edge = pointsCanvas[1];
            const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
            const distToCenter = Math.hypot(canvasX - center.x, canvasY - center.y);
            if (Math.abs(distToCenter - radius) < snapRadius) hit = true;
          }
          break;
        case 'triangle':
          if (pointsCanvas.length >= 3) {
            const [p1, p2, p3] = pointsCanvas;
            if (distanceToLineSegment(canvasX, canvasY, p1.x, p1.y, p2.x, p2.y) < snapRadius ||
                distanceToLineSegment(canvasX, canvasY, p2.x, p2.y, p3.x, p3.y) < snapRadius ||
                distanceToLineSegment(canvasX, canvasY, p3.x, p3.y, p1.x, p1.y) < snapRadius) {
              hit = true;
            }
          }
          break;
        case 'quadratic':
          if (shape.points.length >= 3) {
            const [p0, p1, ctrl] = shape.points;
            const samples = sampleQuadraticCurve(p0, p1, ctrl, 30);
            const sampleCanvas = samples.map(p => worldToCanvasForSnap(p.x, p.y));
            for (let i = 0; i < sampleCanvas.length - 1; i++) {
              const a = sampleCanvas[i], b = sampleCanvas[i+1];
              const dist = distanceToLineSegment(canvasX, canvasY, a.x, a.y, b.x, b.y);
              if (dist < snapRadius) { hit = true; break; }
            }
          }
          break;
        case 'brush':
          if (pointsCanvas.length >= 2) {
            for (let i = 0; i < pointsCanvas.length - 1; i++) {
              const a = pointsCanvas[i], b = pointsCanvas[i+1];
              const dist = distanceToLineSegment(canvasX, canvasY, a.x, a.y, b.x, b.y);
              if (dist < snapRadius) { hit = true; break; }
            }
          } else if (pointsCanvas.length === 1) {
            const dist = Math.hypot(canvasX - pointsCanvas[0].x, canvasY - pointsCanvas[0].y);
            if (dist < snapRadius) hit = true;
          }
          break;
      }

      if (hit) toEraseIds.push(shape.id);
    }
    return toEraseIds;
  }, [snapRadius, worldToCanvasForSnap]);

  // 执行擦除（更新 store 和本地会话记录）
  const eraseShapes = useCallback((idsToErase: string[]) => {
    if (idsToErase.length === 0) return;
    useAppStore.setState(state => ({
      shapes: state.shapes.filter(s => !idsToErase.includes(s.id)),
    }));
    // 记录已删除的ID，防止同一会话中重复检测
    idsToErase.forEach(id => erasedShapesThisSessionRef.current.add(id));
  }, []);

  // ========== 绘图函数 ==========
  const drawShapeHighlight = (ctx: CanvasRenderingContext2D, shape: Shape) => {
    const points = shape.points;
    switch (shape.type) {
      case 'circle':
        if (points.length >= 2) {
          const center = worldToCanvasFn(points[0].x, points[0].y);
          const edge = worldToCanvasFn(points[1].x, points[1].y);
          const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
          ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        break;
      case 'rectangle':
        if (points.length >= 2) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          const p2 = worldToCanvasFn(points[1].x, points[1].y);
          ctx.fillRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
          ctx.strokeRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
        }
        break;
      case 'triangle':
        if (points.length >= 3) {
          ctx.beginPath();
          const p1 = worldToCanvasFn(points[0].x, points[0].y); ctx.moveTo(p1.x, p1.y);
          const p2 = worldToCanvasFn(points[1].x, points[1].y); ctx.lineTo(p2.x, p2.y);
          const p3 = worldToCanvasFn(points[2].x, points[2].y); ctx.lineTo(p3.x, p3.y); ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
        break;
      case 'quadratic':
        if (points.length >= 3) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          const p2 = worldToCanvasFn(points[1].x, points[1].y);
          const ctrl = worldToCanvasFn(points[2].x, points[2].y);
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y);
          ctx.quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y);
          ctx.lineTo(p2.x, p2.y); ctx.lineTo(p1.x, p1.y); ctx.closePath();
          ctx.fill(); ctx.stroke();
        }
        break;
      default:
        if (points.length >= 2) {
          ctx.beginPath();
          const p1 = worldToCanvasFn(points[0].x, points[0].y); ctx.moveTo(p1.x, p1.y);
          for (let i = 1; i < points.length; i++) {
            const p = worldToCanvasFn(points[i].x, points[i].y); ctx.lineTo(p.x, p.y);
          }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        break;
    }
  };

  const drawShape = useCallback((ctx: CanvasRenderingContext2D, shape: Shape, isPreview = false) => {
    const points = shape.points;
    const color = isPreview ? '#666' : (shape.color || '#ff0000');
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lineWidth;

    switch (shape.type) {
      case 'point':
        if (points.length > 0) {
          const p = worldToCanvasFn(points[0].x, points[0].y);
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 'line':
        if (points.length >= 2 && lineWidth > 0.01) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          const p2 = worldToCanvasFn(points[1].x, points[1].y);
          ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        }
        break;
      case 'rectangle':
        if (points.length >= 2 && lineWidth > 0.01) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          const p2 = worldToCanvasFn(points[1].x, points[1].y);
          ctx.strokeRect(Math.min(p1.x, p2.x), Math.min(p1.y, p2.y), Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y));
        }
        break;
      case 'circle':
        if (points.length >= 2 && lineWidth > 0.01) {
          const center = worldToCanvasFn(points[0].x, points[0].y);
          const edge = worldToCanvasFn(points[1].x, points[1].y);
          const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
          ctx.beginPath(); ctx.arc(center.x, center.y, radius, 0, Math.PI * 2); ctx.stroke();
        }
        break;
      case 'triangle':
        if (points.length >= 1) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          if (points.length === 1) { ctx.beginPath(); ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2); ctx.fill(); }
          else if (points.length === 2 && lineWidth > 0.01) {
            const p2 = worldToCanvasFn(points[1].x, points[1].y);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          } else if (lineWidth > 0.01) {
            const p2 = worldToCanvasFn(points[1].x, points[1].y);
            const p3 = worldToCanvasFn(points[2].x, points[2].y);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.closePath(); ctx.stroke();
          }
        }
        break;
      case 'quadratic':
        if (points.length >= 1) {
          const p1 = worldToCanvasFn(points[0].x, points[0].y);
          if (points.length === 1) { ctx.beginPath(); ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2); ctx.fill(); }
          else if (points.length === 2 && lineWidth > 0.01) {
            const p2 = worldToCanvasFn(points[1].x, points[1].y);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
          } else if (lineWidth > 0.01) {
            const p2 = worldToCanvasFn(points[1].x, points[1].y);
            const ctrl = worldToCanvasFn(points[2].x, points[2].y);
            ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y); ctx.stroke();
          }
        }
        break;
      case 'brush':
        if (points.length >= 2 && lineWidth > 0.01) {
          ctx.beginPath();
          const start = worldToCanvasFn(points[0].x, points[0].y); ctx.moveTo(start.x, start.y);
          for (let i = 1; i < points.length; i++) {
            const p = worldToCanvasFn(points[i].x, points[i].y); ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        } else if (points.length === 1) {
          const p = worldToCanvasFn(points[0].x, points[0].y);
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 'polygon':
        if (points.length >= 3) {
          const canvasPoints = points.map(p => worldToCanvasFn(p.x, p.y));
          ctx.beginPath();
          ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);
          for (let i = 1; i < canvasPoints.length; i++) {
            ctx.lineTo(canvasPoints[i].x, canvasPoints[i].y);
          }
          ctx.closePath();
          if (shape.fillOnly) {
            ctx.fillStyle = color;
            ctx.fill();
            if (lineWidth > 0.01) {
              ctx.strokeStyle = color;
              ctx.stroke();
            }
          } else {
            ctx.fillStyle = color + '20';
            ctx.fill();
            if (lineWidth > 0.01) ctx.stroke();
          }
        }
        break;
    }

    if (!isPreview) {
      if (shape.annotation) {
        let centerX = 0, centerY = 0;
        if (points.length > 0) {
          const canvasPoints = points.map(p => worldToCanvasFn(p.x, p.y));
          centerX = canvasPoints.reduce((sum, p) => sum + p.x, 0) / canvasPoints.length;
          centerY = canvasPoints.reduce((sum, p) => sum + p.y, 0) / canvasPoints.length;
        }
        ctx.save();
        ctx.fillStyle = '#1890ff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(centerX + 10, centerY - 10, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('A', centerX + 10, centerY - 10);
        ctx.restore();
      }
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.annotation) {
          const cp = worldToCanvasFn(p.x, p.y);
          ctx.save();
          ctx.fillStyle = '#52c41a'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(cp.x + 8, cp.y - 8, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText('a', cp.x + 8, cp.y - 8);
          ctx.restore();
        }
      }
    }
  }, [worldToCanvasFn, lineWidth, currentColor]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 使用全局画布尺寸
    const currentWidth = canvasWidth;
    const currentHeight = canvasHeight;

    ctx.clearRect(0, 0, currentWidth, currentHeight);
    ctx.save();
    ctx.translate(currentWidth / 2 + panOffset.x, currentHeight / 2 + panOffset.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-currentWidth / 2, -currentHeight / 2);

    // 绘制图片图层
    if (imageState.originalImage && imageState.imageSrc) {
      const imageLayer = layers.find(l => l.id === imageState.imageLayerId);
      const isImageLayerVisible = imageLayer?.visible ?? false;
      if (isImageLayerVisible) {
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, currentWidth, currentHeight);
        ctx.globalAlpha = imageLayer?.opacity ?? 0.5;
        const img = imageState.originalImage;
        
        // 保存当前状态
        ctx.save();
        
        // 应用背景层变换
        const bgOffsetX = imageState.offsetX ?? 0;
        const bgOffsetY = imageState.offsetY ?? 0;
        const bgScale = imageState.scale ?? 1;
        
        // 计算图片绘制位置（居中基础上应用变换）
        let drawWidth: number, drawHeight: number, offsetX: number, offsetY: number;
        
        if (imageState.selectionRect) {
          const sel = imageState.selectionRect;
          const scaleX = currentWidth / sel.width, scaleY = currentHeight / sel.height;
          const fitScale = Math.min(scaleX, scaleY);
          drawWidth = sel.width * fitScale * bgScale;
          drawHeight = sel.height * fitScale * bgScale;
          offsetX = (currentWidth - drawWidth) / 2 + bgOffsetX;
          offsetY = (currentHeight - drawHeight) / 2 + bgOffsetY;
          ctx.drawImage(img, sel.x, sel.y, sel.width, sel.height, offsetX, offsetY, drawWidth, drawHeight);
        } else {
          const fitScale = Math.min(currentWidth / img.width, currentHeight / img.height);
          drawWidth = img.width * fitScale * bgScale;
          drawHeight = img.height * fitScale * bgScale;
          offsetX = (currentWidth - drawWidth) / 2 + bgOffsetX;
          offsetY = (currentHeight - drawHeight) / 2 + bgOffsetY;
          ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        }
        
        // 恢复状态
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }

    // 绘制像素缓冲区 (叠加)
    const layerId = activeLayerId || layers[0]?.id;
    const buffer = paintBuffers[layerId];
    if (buffer && layerVisibility.drawLayer) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = buffer.width;
      tempCanvas.height = buffer.height;
      tempCanvas.getContext('2d')!.putImageData(buffer, 0, 0);
      ctx.drawImage(tempCanvas, 0, 0, currentWidth, currentHeight);
    }

    // 坐标轴与格子
    if (layerVisibility.axisLayer && grid.visible) {
      ctx.strokeStyle = '#d0d0d0'; ctx.lineWidth = 1;
      for (let i = 0; i <= grid.cols; i++) {
        // 将网格位置从世界坐标 [0,1] 映射到画布
        const worldX = i / grid.cols;
        const pos = worldX * currentWidth;
        ctx.beginPath(); ctx.moveTo(pos, 0); ctx.lineTo(pos, currentHeight); ctx.stroke();
        
        // 绘制网格标签（使用 axis 范围显示）
        const axisPos = worldToAxis(worldX, 0, axis);
        ctx.fillStyle = '#999'; ctx.font = '10px monospace';
        ctx.fillText(axisPos.x.toFixed(1), pos - 15, 12);
      }
      for (let i = 0; i <= grid.rows; i++) {
        // 将网格位置从世界坐标 [0,1] 映射到画布
        const worldY = i / grid.rows;
        const pos = worldY * currentHeight;
        ctx.beginPath(); ctx.moveTo(0, pos); ctx.lineTo(currentWidth, pos); ctx.stroke();
        
        // 绘制网格标签（使用 axis 范围显示）
        const axisPos = worldToAxis(0, worldY, axis);
        ctx.fillStyle = '#999'; ctx.font = '10px monospace';
        ctx.fillText(axisPos.y.toFixed(1), 2, pos + 4);
      }
      
      // 中心十字线（世界坐标 0.5 对应画布中心）
      const centerX = currentWidth / 2;
      const centerY = currentHeight / 2;
      ctx.strokeStyle = '#000000'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, centerY); ctx.lineTo(currentWidth, centerY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(centerX, 0); ctx.lineTo(centerX, currentHeight); ctx.stroke();
      
      // 轴标签（显示 axis 范围）
      ctx.fillStyle = '#666'; ctx.font = '12px monospace';
      ctx.fillText(`X: ${axis.xMin.toFixed(2)}`, 5, 18);
      ctx.fillText(`X: ${axis.xMax.toFixed(2)}`, currentWidth - 45, 18);
      ctx.fillText(`Y: ${axis.yMax.toFixed(2)}`, 5, 30);
      ctx.fillText(`Y: ${axis.yMin.toFixed(2)}`, 5, currentHeight - 5);
    }

    // 绘制普通图形
    if (layerVisibility.drawLayer) {
      layers.forEach(layer => {
        if (layer.visible) {
          ctx.globalAlpha = layer.opacity;
          shapes.forEach(shape => {
            if (shape.layerId === layer.id && shape.id !== 'current_shape') {
              drawShape(ctx, shape);
            }
          });
        }
      });
      ctx.globalAlpha = 1;
      // 绘制临时图形（绘制中）
      if (tempPoints.length > 0) {
        const tempShape: Shape = { id: 'temp', groupId: 'temp', type: currentTool as any, points: tempPoints, color: '#666' };
        drawShape(ctx, tempShape, true);
        if (previewPoint) {
          const previewShape: Shape = { id: 'preview', groupId: 'temp', type: currentTool as any, points: [...tempPoints, previewPoint], color: '#999' };
          drawShape(ctx, previewShape, true);
        }
      }
    }

    // 绘制点注释
    if (layerVisibility.drawLayer) {
      pointAnnotations.forEach(anno => {
        if (anno.layerId !== activeLayerId) return;
        const canvasPos = worldToCanvasFn(anno.position.x, anno.position.y);
        ctx.save();
        // 使用注释的颜色
        const color = anno.color || '#ff4d4f';
        ctx.fillStyle = color;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(canvasPos.x, canvasPos.y, 6, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('📍', canvasPos.x, canvasPos.y);
        ctx.fillStyle = color;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(anno.text.length > 15 ? anno.text.slice(0, 12) + '...' : anno.text, canvasPos.x + 10, canvasPos.y - 5);
        ctx.restore();
      });
    }

    // 绘制区域注释
    if (layerVisibility.drawLayer) {
      regionAnnotations.forEach(anno => {
        if (anno.layerId !== activeLayerId) return;
        ctx.save();
        // 使用注释的颜色
        const color = anno.color || '#1890ff';
        ctx.fillStyle = color.replace(/rgb\(|#/, '').length === 6 
          ? `rgba(${parseInt(color.slice(1,3),16)}, ${parseInt(color.slice(3,5),16)}, ${parseInt(color.slice(5,7),16)}, 0.2)` 
          : 'rgba(24, 144, 255, 0.2)';
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        for (const ring of anno.polygon) {
          if (ring.length < 3) continue;
          const canvasRing = ring.map(p => worldToCanvasFn(p.x, p.y));
          ctx.moveTo(canvasRing[0].x, canvasRing[0].y);
          for (let i = 1; i < canvasRing.length; i++) {
            ctx.lineTo(canvasRing[i].x, canvasRing[i].y);
          }
          ctx.closePath();
        }
        ctx.fill('evenodd');
        if (lineWidth > 0.01) {
          ctx.stroke();
        }
        const outerRing = anno.polygon[0];
        let minX = Infinity, minY = Infinity;
        for (const p of outerRing) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
        }
        const labelPos = worldToCanvasFn(minX, minY);
        ctx.fillStyle = color;
        ctx.font = '12px sans-serif';
        ctx.shadowBlur = 0;
        ctx.fillText(anno.text.length > 20 ? anno.text.slice(0, 17) + '...' : anno.text, labelPos.x + 5, labelPos.y - 5);
        ctx.restore();
      });
    }

    // 绘制区域图层（显示区域注释算法提取的色块区域）
    if (layerVisibility.regionLayer) {
      const regions = colorBlockRegionsCache[activeLayerId] || [];
      const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181', '#aa96da', '#a8e6cf', '#ffd3a5', '#ff8b94', '#6c5ce7'];
      
      regions.forEach((region, idx) => {
        ctx.save();
        const color = colors[idx % colors.length];
        ctx.fillStyle = color + '40'; // 40%透明度填充
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        
        for (const ring of region) {
          if (ring.length < 3) continue;
          const canvasRing = ring.map(p => worldToCanvasFn(p.x, p.y));
          ctx.beginPath();
          ctx.moveTo(canvasRing[0].x, canvasRing[0].y);
          for (let i = 1; i < canvasRing.length; i++) {
            ctx.lineTo(canvasRing[i].x, canvasRing[i].y);
          }
          ctx.closePath();
        }
        ctx.fill('evenodd');
        ctx.stroke();
        
        // 显示区域ID标签
        if (region.length > 0) {
          const centroid = region[0].reduce((acc, p) => ({
            x: acc.x + p.x,
            y: acc.y + p.y
          }), { x: 0, y: 0 });
          centroid.x /= region[0].length;
          centroid.y /= region[0].length;
          const labelPos = worldToCanvasFn(centroid.x, centroid.y);
          ctx.fillStyle = color;
          ctx.font = 'bold 12px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`色块${idx}`, labelPos.x, labelPos.y);
        }
        ctx.restore();
      });
    }

    // ========== 调试：BFS区域绘制 ==========
    if (showDebugRegions && layerVisibility.drawLayer) {
      const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
      if (currentLayerShapes.length > 0) {
        // 世界坐标固定为 [0,1]，与坐标轴显示范围无关
        const worldBounds = {
          xMin: 0,
          xMax: 1,
          yMin: 0,
          yMax: 1,
        };
        const debugRegions = getDebugRegions(currentLayerShapes, worldBounds, 600, debugDistanceThreshold, debugRadialThreshold, debugDownsampleFactor, debugRingDistanceThreshold, debugRingRadialThreshold);

        const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181', '#aa96da'];

        debugRegions.forEach((region, idx) => {
          // console.log(`[调试绘制] region.id=${region.id}, boundaryPoints=${region.boundaryPoints.length}`);
          if (debugRegionId !== 0 && region.id !== debugRegionId) return;
          ctx.save();
          const color = colors[idx % colors.length];

          // 绘制边界点（按 outsideId 分组，相同 outsideId 使用相同颜色）
          // 端点信息模式和绘制环模式下不绘制
          // 检查条件：非原始模式下也检查 uniqueBoundaryPoints
          const hasPoints = debugShowOriginal 
            ? (region.boundaryPoints && region.boundaryPoints.length > 0)
            : ((region.uniqueBoundaryPoints && region.uniqueBoundaryPoints.length > 0) || (region.boundaryPoints && region.boundaryPoints.length > 0));
          if (!debugShowEndpoints && !debugShowRings && !debugShowSegments && hasPoints) {
            // 按 outsideId 分组
            const debugPoints = debugShowOriginal
              ? region.boundaryPoints
              : (region.uniqueBoundaryPoints as any || region.boundaryPoints);
            // 确保即使只有一个 outsideId 也能正确绘制
            if (debugPoints.length === 0) {
              console.warn(`[警告] 区域${region.id}调试点数为0`);
              return;
            }
            const outsideIdGroups = new Map<number, { point: Point; insideId: number }[]>();
            for (const bp of debugPoints) {
              if (!outsideIdGroups.has(bp.outsideId)) {
                outsideIdGroups.set(bp.outsideId, []);
              }
              outsideIdGroups.get(bp.outsideId)!.push(bp);
            }

            // console.log(`[调试绘制] 区域${region.id}分组(${debugShowOriginal ? '原始' : '新聚类'}):`, Array.from(outsideIdGroups.entries()).map(([id, pts]) => `o:${id}=${pts.length}`));

            const pointColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#8800ff'];
            let colorIdx = 0;

            // 绘制所有 outsideId 组的点
            for (const [outsideId, points] of outsideIdGroups) {
              if (debugOutsideId !== -1 && outsideId !== debugOutsideId) continue;
              const color = pointColors[colorIdx % pointColors.length];
              colorIdx++;
              ctx.fillStyle = color;
              ctx.strokeStyle = '#000000';
              ctx.lineWidth = 1;

              for (const bp of points) {
                const canvasPoint = worldToCanvasFn(bp.point.x, bp.point.y);
                ctx.beginPath();
                ctx.arc(canvasPoint.x, canvasPoint.y, 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = color;
                ctx.font = '7px monospace';
                ctx.fillText(`o:${outsideId}`, canvasPoint.x + 6, canvasPoint.y - 6);
              }
            }

            // 绘制重心到每个去重后边界点的连线（端点信息模式且非原始模式时不绘制）
            if (!debugShowEndpoints && !debugShowOriginal && region.centroid && region.uniqueBoundaryPoints) {
              const centroidCanvas = worldToCanvasFn(region.centroid.x, region.centroid.y);
              
              // 绘制重心点
              ctx.fillStyle = '#ff0000';
              ctx.beginPath();
              ctx.arc(centroidCanvas.x, centroidCanvas.y, 5, 0, Math.PI * 2);
              ctx.fill();
              
              // 绘制重心标记
              ctx.font = 'bold 10px monospace';
              ctx.fillText('重心', centroidCanvas.x + 8, centroidCanvas.y - 8);
              
              // 按 outsideId 分组
              const uniqueGroups = new Map<number, { point: Point; outsideId: number }[]>();
              for (const ub of region.uniqueBoundaryPoints) {
                if (!uniqueGroups.has(ub.outsideId)) {
                  uniqueGroups.set(ub.outsideId, []);
                }
                uniqueGroups.get(ub.outsideId)!.push(ub);
              }
              
              const groupColors = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#00ffff', '#ff8800', '#8800ff', '#ffff00'];
              let groupColorIdx = 0;
              
              ctx.lineWidth = 1;
              ctx.globalAlpha = 0.7;
              
              // 按 outsideId 分组绘制连线和点
              for (const [outsideId, points] of uniqueGroups) {
                // 根据调试面板的外部ID过滤
                if (debugOutsideId !== -1 && outsideId !== debugOutsideId) continue;
                
                const color = groupColors[groupColorIdx % groupColors.length];
                groupColorIdx++;
                ctx.strokeStyle = color;
                
                for (const ub of points) {
                  const pointCanvas = worldToCanvasFn(ub.point.x, ub.point.y);
                  
                  // 裁剪连线到画布边界内
                  const clippedEnd = clipLineToCanvas(centroidCanvas, pointCanvas, canvasWidth, canvasHeight);
                  
                  ctx.beginPath();
                  ctx.moveTo(centroidCanvas.x, centroidCanvas.y);
                  ctx.lineTo(clippedEnd.x, clippedEnd.y);
                  ctx.stroke();
                }
              }
              
              ctx.globalAlpha = 1;
            }
          }

          // 绘制端点信息（原始模式下使用 originalOutsideIdEndpoints，非原始模式下使用 outsideIdEndpoints）
          // 绘制环模式下不显示端点信息
          const endpointsToShow = debugShowOriginal ? region.originalOutsideIdEndpoints : region.outsideIdEndpoints;
          if (debugShowEndpoints && !debugShowRings && !debugShowSegments && endpointsToShow && endpointsToShow.length > 0 && region.centroid) {
            const centroidCanvas = worldToCanvasFn(region.centroid.x, region.centroid.y);
            const endpointColors = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#00ffff', '#ff8800', '#8800ff', '#ffff00'];
            
            // 绘制重心点
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(centroidCanvas.x, centroidCanvas.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            ctx.font = 'bold 10px monospace';
            
            endpointsToShow!.forEach((ep, idx) => {
              if (debugOutsideId !== -1 && ep.outsideId !== debugOutsideId) return;
              
              const color = endpointColors[idx % endpointColors.length];
              
              // 绘制端点 p1
              const p1Canvas = worldToCanvasFn(ep.p1.x, ep.p1.y);
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(p1Canvas.x, p1Canvas.y, 6, 0, Math.PI * 2);
              ctx.fill();
              ctx.strokeStyle = '#000000';
              ctx.lineWidth = 2;
              ctx.stroke();
              
              // p1 标签
              ctx.fillStyle = color;
              ctx.fillText(`p1:(${ep.p1.x.toFixed(2)},${ep.p1.y.toFixed(2)}) d=${ep.p1.distToCentroid.toFixed(3)}`, p1Canvas.x + 8, p1Canvas.y - 8);
              
              // 如果有 p2，绘制 p2
              if (ep.p2) {
                const p2Canvas = worldToCanvasFn(ep.p2.x, ep.p2.y);
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(p2Canvas.x, p2Canvas.y, 6, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                ctx.stroke();
                
                // p2 标签
                ctx.fillStyle = color;
                ctx.fillText(`p2:(${ep.p2.x.toFixed(2)},${ep.p2.y.toFixed(2)}) d=${ep.p2.distToCentroid.toFixed(3)}`, p2Canvas.x + 8, p2Canvas.y - 8);
                
                // 绘制端点 ID 标签
                ctx.fillStyle = '#000000';
                ctx.fillText(`o:${ep.outsideId}`, (p1Canvas.x + p2Canvas.x) / 2 + 8, (p1Canvas.y + p2Canvas.y) / 2);
              } else {
                // 单点情况，只显示 outsideId
                ctx.fillStyle = '#000000';
                ctx.fillText(`o:${ep.outsideId}`, p1Canvas.x + 8, p1Canvas.y + 12);
              }
            });
          }

          // 绘制环（仅在 debugShowRings 为 true 时显示）
          if (debugShowRings) {
            // console.log(`[调试绘制] 区域${region.id} rings数据:`, region.rings);
            if (region.rings && region.rings.length > 0) {
            const ringColors = ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#00ffff', '#ff8800', '#8800ff', '#ffff00'];
            region.rings.forEach((ring, ringIdx) => {
              if (ring.length < 3) return;
              const ringColor = ringColors[ringIdx % ringColors.length];
              ctx.strokeStyle = ringColor;
              ctx.fillStyle = ringColor + '30';
              ctx.lineWidth = 3;
              ctx.beginPath();
              for (let i = 0; i < ring.length; i++) {
                const cp = worldToCanvasFn(ring[i].x, ring[i].y);
                if (i === 0) ctx.moveTo(cp.x, cp.y);
                else ctx.lineTo(cp.x, cp.y);
              }
              ctx.closePath();
              ctx.fill();
              ctx.stroke();

              const midIdx = Math.floor(ring.length / 2);
              const midPoint = worldToCanvasFn(ring[midIdx].x, ring[midIdx].y);
              ctx.fillStyle = ringColor;
              ctx.font = 'bold 12px monospace';
              ctx.fillText(`环${ringIdx}(${ring.length})`, midPoint.x, midPoint.y);
            });
            }
          }

          // 绘制片段（仅在 debugShowSegments 为 true 时显示）
          if (debugShowSegments) {
            if (region.segments && region.segments.length > 0) {
              const segmentColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#ff8800', '#8800ff'];
              region.segments.forEach((seg, segIdx) => {
                if (seg.points.length < 1) return;
                const segColor = segmentColors[segIdx % segmentColors.length];
                ctx.strokeStyle = segColor;
                ctx.lineWidth = 2;
                ctx.beginPath();
                
                // 绘制片段线条
                for (let i = 0; i < seg.points.length; i++) {
                  const cp = worldToCanvasFn(seg.points[i].x, seg.points[i].y);
                  if (i === 0) ctx.moveTo(cp.x, cp.y);
                  else ctx.lineTo(cp.x, cp.y);
                }
                ctx.stroke();

                // 绘制起点和终点标记
                if (seg.points.length >= 1) {
                  const startPoint = worldToCanvasFn(seg.start.x, seg.start.y);
                  ctx.fillStyle = '#ffffff';
                  ctx.strokeStyle = '#ff0000';
                  ctx.lineWidth = 2;
                  ctx.beginPath();
                  ctx.arc(startPoint.x, startPoint.y, 5, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.stroke();

                  if (seg.points.length >= 2) {
                    const endPoint = worldToCanvasFn(seg.end.x, seg.end.y);
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = '#00ff00';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(endPoint.x, endPoint.y, 5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                  }
                }

                // 在片段中间位置显示序号
                if (seg.points.length >= 2) {
                  const midIdx = Math.floor(seg.points.length / 2);
                  const midPoint = worldToCanvasFn(seg.points[midIdx].x, seg.points[midIdx].y);
                  ctx.fillStyle = segColor;
                  ctx.font = 'bold 10px monospace';
                  ctx.fillText(`段${segIdx}(${seg.points.length})`, midPoint.x, midPoint.y);
                }
              });
            }
          }

          // 绘制墙分组点（仅在 debugShowWallGrouped 为 true 时显示）
          if (debugShowWallGrouped) {
            if (region.wallGroupedPoints && region.wallGroupedPoints.size > 0) {
              const wallColors = ['#8b0000', '#006400', '#00008b', '#8b008b', '#8b4513', '#2f4f4f', '#556b2f', '#483d8b', '#008080', '#800000'];
              region.wallGroupedPoints.forEach((points, wallId) => {
                const colorIdx = Math.abs(wallId + 1) % wallColors.length;
                const color = wallColors[colorIdx];
                ctx.fillStyle = color;
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;

                // 绘制每个点
                points.forEach(p => {
                  const cp = worldToCanvasFn(p.x, p.y);
                  ctx.beginPath();
                  ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
                  ctx.fill();
                });

                // 在该组点的重心位置显示墙ID
                if (points.length > 0) {
                  let sumX = 0, sumY = 0;
                  points.forEach(p => { sumX += p.x; sumY += p.y; });
                  const centroid = { x: sumX / points.length, y: sumY / points.length };
                  const cp = worldToCanvasFn(centroid.x, centroid.y);
                  ctx.fillStyle = '#ffffff';
                  ctx.font = 'bold 10px monospace';
                  ctx.fillText(`墙${wallId}(${points.length})`, cp.x, cp.y);
                }
              });
            }
          }

          ctx.restore();
        });

        // console.log(`[调试] 绘制了 ${debugRegions.length} 个BFS区域`);
      }
    }

    // ========== 调试：绘制原始网格单元格（BFS搜索范围）==========
    if (showGridCells && layerVisibility.drawLayer) {
      const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
      if (currentLayerShapes.length > 0) {
        // 世界坐标固定为 [0,1]，与坐标轴显示范围无关
        const worldBounds = {
          xMin: 0,
          xMax: 1,
          yMin: 0,
          yMax: 1,
        };
        const gridData = computeGridRegions(currentLayerShapes, worldBounds, 100);
        const { regionIdGrid, stepX, stepY, xMin, yMin, resolution, regions, wallRegions } = gridData;

        const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181', '#aa96da'];
        const wallColors = ['#8b0000', '#006400', '#00008b', '#8b008b', '#8b4513', '#2f4f4f', '#556b2f', '#483d8b', '#008080', '#800000'];

        // 绘制所有墙区域的单元格（负ID）
        if (wallRegions && wallRegions.length > 0) {
          wallRegions.forEach(wallRegion => {
            ctx.save();
            const colorIdx = Math.abs(wallRegion.id + 1) % wallColors.length;
            const color = wallColors[colorIdx];
            ctx.fillStyle = color + 'cc'; // 较高不透明度

            wallRegion.cells.forEach(cell => {
              const worldX = xMin + cell.j * stepX;
              const worldY = yMin + cell.i * stepY;
              const canvasTL = worldToCanvasFn(worldX, worldY);
              const canvasBR = worldToCanvasFn(worldX + stepX, worldY + stepY);

              ctx.fillRect(canvasTL.x, canvasTL.y, canvasBR.x - canvasTL.x, canvasBR.y - canvasTL.y);
            });
            ctx.restore();
          });
        }

        // 绘制所有区域的单元格
        regions.forEach(region => {
          ctx.save();
          const color = colors[region.id % colors.length];
          ctx.fillStyle = color + '60'; // 60%透明度

          region.cells.forEach(cell => {
            const worldX = xMin + cell.j * stepX;
            const worldY = yMin + cell.i * stepY;
            const canvasTL = worldToCanvasFn(worldX, worldY);
            const canvasBR = worldToCanvasFn(worldX + stepX, worldY + stepY);

            ctx.fillRect(canvasTL.x, canvasTL.y, canvasBR.x - canvasTL.x, canvasBR.y - canvasTL.y);
          });
          ctx.restore();
        });

        // 绘制扫描线区间（左右范围）
        const scanlineCache = computeScanlineIntervals(gridData);
        
        regions.forEach(region => {
          ctx.save();
          const color = colors[region.id % colors.length];
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);

          const spans = scanlineCache[region.id] || [];
          spans.forEach(span => {
            const leftCanvas = worldToCanvasFn(span.xMin, span.y);
            const rightCanvas = worldToCanvasFn(span.xMax, span.y);
            
            // 绘制左边界线（向下延伸一小段）
            ctx.beginPath();
            ctx.moveTo(leftCanvas.x, leftCanvas.y - 5);
            ctx.lineTo(leftCanvas.x, leftCanvas.y + 5);
            ctx.stroke();
            
            // 绘制右边界线（向下延伸一小段）
            ctx.beginPath();
            ctx.moveTo(rightCanvas.x, rightCanvas.y - 5);
            ctx.lineTo(rightCanvas.x, rightCanvas.y + 5);
            ctx.stroke();
            
            // 绘制左右范围连线
            ctx.beginPath();
            ctx.moveTo(leftCanvas.x, leftCanvas.y);
            ctx.lineTo(rightCanvas.x, rightCanvas.y);
            ctx.stroke();
          });
          ctx.setLineDash([]);
          ctx.restore();
        });
      }
    }

    // 橡皮擦光标效果
    if (currentTool === 'eraser' && mousePosition) {
      ctx.save();
      ctx.strokeStyle = '#ff0000'; ctx.fillStyle = 'rgba(255, 0, 0, 0.2)'; ctx.lineWidth = 2 / zoom;
      const eraserCanvasPos = worldToCanvasFn(mousePosition.x, mousePosition.y);
      ctx.beginPath(); ctx.arc(eraserCanvasPos.x, eraserCanvasPos.y, snapRadius / zoom, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    // ========== 绘制颜色提取模式的虚线墙 ==========
    if (colorExtractMode && colorExtractPoints.length > 0) {
      ctx.save();
      ctx.setLineDash([8, 6]);
      ctx.strokeStyle = '#ffaa00';
      ctx.fillStyle = 'rgba(255, 170, 0, 0.15)';
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1;

      // 获取要绘制的路径点
      let drawPoints: Point[] = colorExtractPoints;
      if (colorExtractTool === 'bezier' && colorExtractPoints.length >= 3) {
        drawPoints = buildBezierPath(colorExtractPoints);
      }

      if (drawPoints.length >= 2) {
        // 绘制连线
        ctx.beginPath();
        const firstCanvas = worldToCanvasFn(drawPoints[0].x, drawPoints[0].y);
        ctx.moveTo(firstCanvas.x, firstCanvas.y);
        for (let i = 1; i < drawPoints.length; i++) {
          const pCanvas = worldToCanvasFn(drawPoints[i].x, drawPoints[i].y);
          ctx.lineTo(pCanvas.x, pCanvas.y);
        }
        ctx.stroke();

        // 若点数≥3，显示闭合虚线并半透明填充
        if (colorExtractPoints.length >= 3) {
          // 从最后一个点画到第一个点（闭合虚线）
          const lastCanvas = worldToCanvasFn(drawPoints[drawPoints.length - 1].x, drawPoints[drawPoints.length - 1].y);
          ctx.beginPath();
          ctx.moveTo(lastCanvas.x, lastCanvas.y);
          ctx.lineTo(firstCanvas.x, firstCanvas.y);
          ctx.stroke();

          // 填充多边形（基于原始控制点，贝塞尔也用控制点填充）
          const fillPoints = colorExtractPoints.map(p => worldToCanvasFn(p.x, p.y));
          ctx.beginPath();
          ctx.moveTo(fillPoints[0].x, fillPoints[0].y);
          for (let i = 1; i < fillPoints.length; i++) {
            ctx.lineTo(fillPoints[i].x, fillPoints[i].y);
          }
          ctx.closePath();
          ctx.fill();
        }
      }

      // 绘制控制点
      for (const p of colorExtractPoints) {
        const cp = worldToCanvasFn(p.x, p.y);
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#ffaa00';
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText('•', cp.x - 2, cp.y + 3);
      }

      ctx.restore();
    }

    ctx.restore();
  }, [imageState, layerVisibility, axis, grid, zoom, panOffset, shapes, tempPoints, previewPoint, currentTool, drawShape, layers, worldToCanvasFn, mousePosition, snapRadius, showDebugRegions, debugRegionId, debugOutsideId, debugShowOriginal, debugDistanceThreshold, debugRadialThreshold, debugDownsampleFactor, debugRingDistanceThreshold, debugRingRadialThreshold, debugShowEndpoints, debugShowRings, debugShowSegments, debugShowWallGrouped, isPainting, paintBrushSize, colorBlockRegionsCache, activeLayerId, paintBuffers, canvasWidth, canvasHeight, colorExtractMode, colorExtractTool, colorExtractPoints]);

  useEffect(() => { drawCanvas(); }, [drawCanvas]);

  useEffect(() => {
    refreshRegionCache(activeLayerId);
    refreshColorBlockCache(activeLayerId);
  }, []);



  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(Math.max(0.1, Math.min(10, zoom * delta)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoom, setZoom]);

  const getCanvasCoords = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // 直接读取 canvas 的像素尺寸（绘图缓冲区大小）
    const canvasPixelWidth = canvas.width;
    const canvasPixelHeight = canvas.height;
    const scaleX = canvasPixelWidth / rect.width;
    const scaleY = canvasPixelHeight / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []); // 无依赖，每次调用都从 DOM 获取最新值

  // ========== 鼠标事件 ==========
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // 优先处理背景拖动模式
    if (imageState.isBackgroundDragging && imageState.backgroundDragStart) {
      updateBackgroundDrag(e.clientX, e.clientY);
      // 立即触发重绘
      requestAnimationFrame(() => {
        drawCanvas();
      });
      return;
    }

    if (isPanning) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setPanOffset({ x: panOffset.x + dx, y: panOffset.y + dy });
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    const coords = getCanvasCoords(e);
    const worldCoords = canvasToWorldFn(coords.x, coords.y);
    setMousePosition(worldCoords);

    if (isErasing && currentTool === 'eraser') {
      const idsToErase = getShapesToEraseAtPoint(coords.x, coords.y);
      if (idsToErase.length > 0) eraseShapes(idsToErase);
      return;
    }

    if (isPainting && currentTool === 'paintBrush') {
      const layerId = activeLayerId || layers[0]?.id;
      if (!layerId) return;

      // 使用预计算的区域ID纹理快速查询区域ID
      const texture = regionIdTexture.get(layerId);
      if (!texture) return;

      // 使用固定缓冲区尺寸进行纹理索引（纹理固定为512x512）
      const canvasX = Math.floor(worldCoords.x * PAINT_BUFFER_SIZE);
      const canvasY = Math.floor((1 - worldCoords.y) * PAINT_BUFFER_SIZE);
      
      // 从纹理中获取区域ID（O(1)操作）
      const regionId = texture[canvasY * PAINT_BUFFER_SIZE + canvasX];
      if (regionId !== 0) {
        // 记录圆内所有像素到对应区域（使用纹理快速查询）
        recordCirclePixelsToRegions(worldCoords, paintBrushSize);

        if (!paintBuffers[layerId]) {
          initPaintBuffer(layerId);
        }

        updatePaintBuffer(layerId, (imgData) => {
          drawCircleOnBuffer(imgData, worldCoords, paintBrushSize, currentColor, PAINT_BUFFER_SIZE);
        });

        if (lastPaintPointRef.current) {
          const dist = Math.hypot(worldCoords.x - lastPaintPointRef.current.x,
                                  worldCoords.y - lastPaintPointRef.current.y);
          const step = paintBrushSize * 0.5;
          if (dist > step) {
            const steps = Math.ceil(dist / step);
            for (let i = 1; i < steps; i++) {
              const t = i / steps;
              const interpX = lastPaintPointRef.current.x + (worldCoords.x - lastPaintPointRef.current.x) * t;
              const interpY = lastPaintPointRef.current.y + (worldCoords.y - lastPaintPointRef.current.y) * t;
              
              // 插值点使用纹理查询区域ID（缓冲区固定512x512）
              const interpCanvasX = Math.floor(interpX * PAINT_BUFFER_SIZE);
              const interpCanvasY = Math.floor((1 - interpY) * PAINT_BUFFER_SIZE);
              const interpRegionId = texture[interpCanvasY * PAINT_BUFFER_SIZE + interpCanvasX];
              
              if (interpRegionId !== 0) {
                // 记录插值点圆内像素（使用纹理快速查询）
                recordCirclePixelsToRegions({ x: interpX, y: interpY }, paintBrushSize);
                
                updatePaintBuffer(layerId, (imgData) => {
                  drawCircleOnBuffer(imgData, { x: interpX, y: interpY }, paintBrushSize, currentColor, PAINT_BUFFER_SIZE);
                });
              }
            }
          }
        }
        lastPaintPointRef.current = worldCoords;
      }
      return;
    }

    if (tempPoints.length > 0 && currentTool !== 'select') {
      setPreviewPoint(worldCoords);
    }
  }, [isPanning, panStart, panOffset, getCanvasCoords, canvasToWorldFn, setMousePosition, setPanOffset, isErasing, currentTool, getShapesToEraseAtPoint, eraseShapes, tempPoints, isPainting, paintBrushSize, activeLayerId, layers, currentColor, paintBuffers, initPaintBuffer, updatePaintBuffer, recordCirclePixelsToRegions, regionIdTexture, imageState, updateBackgroundDrag, drawCanvas]);

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
    setMousePosition(null);
    setPreviewPoint(null);
  }, [setMousePosition]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 优先处理背景拖动模式
    if (imageState.isBackgroundDragging && e.button === 0) {
      startBackgroundDrag(e.clientX, e.clientY);
      return;
    }

    // 颜色提取模式：左键添加点
    if (colorExtractMode && e.button === 0) {
      console.log('[颜色提取] 进入颜色提取处理');
      const coords = getCanvasCoords(e);
      const worldCoords = canvasToWorldFn(coords.x, coords.y);
      // 可选：点吸附
      let snapped = worldCoords;
      if (snapEnabled && colorExtractPoints.length > 0) {
        snapped = snapToExistingPoint(worldCoords, 'point', colorExtractPoints.length);
      }
      const newIndex = colorExtractPoints.length;
      addColorExtractPoint(snapped);
      console.log(`[颜色提取] 添加控制点 #${newIndex + 1}: (${snapped.x.toFixed(4)}, ${snapped.y.toFixed(4)})`);
      console.log(`[颜色提取] 当前点数: ${newIndex + 1}, 工具: ${colorExtractTool}`);
      return;
    } else if (e.button === 0) {
      console.log(`[颜色提取] 未进入颜色提取模式，colorExtractMode: ${colorExtractMode}`);
    }

    if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && isPanMode)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    const coords = getCanvasCoords(e);
    const worldCoords = canvasToWorldFn(coords.x, coords.y);

    if (currentTool === 'pointAnnotation') {
      // 检测附近是否已有点注释（距离阈值：世界坐标 0.08，约画布的 8%）
      const proximityThreshold = 0.08;
      let existingAnnotation = null;
      let minDistance = Infinity;

      for (const anno of pointAnnotations) {
        if (anno.layerId !== activeLayerId) continue;
        const dx = anno.position.x - worldCoords.x;
        const dy = anno.position.y - worldCoords.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < proximityThreshold && distance < minDistance) {
          minDistance = distance;
          existingAnnotation = anno;
        }
      }

      if (existingAnnotation) {
        // 找到附近的注释，读取并允许修改
        console.log('[点注释] 找到附近的已有注释，距离:', minDistance.toFixed(4), ', 文本:', existingAnnotation.text);
        setPointAnnotationEditor({
          editorId: generateEditorId(),
          x: e.clientX,
          y: e.clientY,
          annotationId: existingAnnotation.id,
          existingText: existingAnnotation.text,
          position: existingAnnotation.position, // 使用已有注释的位置
        });
      } else {
        // 创建新注释
        setPointAnnotationEditor({
          editorId: generateEditorId(),
          x: e.clientX,
          y: e.clientY,
          annotationId: null,
          existingText: '',
          position: worldCoords,
        });
      }
      return;
    }

    if (currentTool === 'regionAnnotation') {
      // ⚠️ 重要备注：区域注释绑定的是 BFS 算法生成的区域 ID
      // 每次绘制新图形后，BFS 网格会重新计算，区域 ID 可能会发生变化
      // 因此建议在完成所有图形绘制后再添加区域注释
      // 如果在绘制过程中添加注释，后续绘制新图形可能导致注释绑定的区域不再匹配
      const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
      if (currentLayerShapes.length === 0) return;

      // 获取BFS区域ID（正数）
      // 世界坐标固定为 [0,1]，与坐标轴显示范围无关
      const worldBounds = {
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      };
      const bfsRegionId = computeRegionIdAtPoint(worldCoords, currentLayerShapes, worldBounds, 300);
      
      if (bfsRegionId === null) {
        console.log('[区域注释] 点击位置不在任何有效BFS区域内（可能是墙或外部）');
        return;
      }

      // 通过BFS区域ID查找已有注释
      const existingAnnotation = regionAnnotations.find(
        anno => anno.layerId === activeLayerId && String(anno.regionId) === String(bfsRegionId)
      );

      // 还需要获取多边形用于显示（保持原有逻辑，但匹配不依赖它）
      const regions = regionPolygonsCache[activeLayerId] || [];
      const hitRegion = findRegionByPoint(worldCoords, regions); // 仅用于获取多边形形状

      if (existingAnnotation) {
        // 编辑已有注释
        console.log('[区域注释] 找到匹配的已有注释，区域ID:', bfsRegionId, ', 文本:', existingAnnotation.text);
        setRegionAnnotationEditor({
          editorId: generateEditorId(),
          x: e.clientX,
          y: e.clientY,
          annotationId: existingAnnotation.id,
          existingText: existingAnnotation.text,
          polygon: hitRegion || existingAnnotation.polygon, // 优先用几何检测的结果，否则用已存储的
          regionId: String(bfsRegionId),
        });
      } else {
        if (!hitRegion) {
          console.log('[区域注释] 无法获取区域多边形，但BFS ID存在，可能算法不一致，放弃创建');
          return;
        }
        // 创建新注释
        console.log('[区域注释] 创建新注释，区域ID:', bfsRegionId);
        setRegionAnnotationEditor({
          editorId: generateEditorId(),
          x: e.clientX,
          y: e.clientY,
          annotationId: null,
          existingText: '',
          polygon: hitRegion,
          regionId: String(bfsRegionId),
        });
      }
      return;
    }

    if (currentTool === 'eraser') {
      setIsErasing(true);
      erasedShapesThisSessionRef.current.clear();
      const idsToErase = getShapesToEraseAtPoint(coords.x, coords.y);
      if (idsToErase.length > 0) eraseShapes(idsToErase);
      return;
    }

    if (currentTool === 'paintBrush') {
      setIsPainting(true);
      lastPaintPointRef.current = null;
      const layerId = activeLayerId || layers[0]?.id;
      if (layerId) {
        // 使用预计算的区域ID纹理快速查询区域ID
        const texture = regionIdTexture.get(layerId);
        if (texture) {
          // 将世界坐标转换为缓冲区像素坐标（缓冲区固定512x512）
          const canvasX = Math.floor(worldCoords.x * PAINT_BUFFER_SIZE);
          const canvasY = Math.floor((1 - worldCoords.y) * PAINT_BUFFER_SIZE); // Y轴翻转
          
          // 从纹理中获取区域ID（O(1)操作）
          const regionId = texture[canvasY * PAINT_BUFFER_SIZE + canvasX];
          if (regionId !== 0) {
            // 记录圆内所有像素到对应区域
            recordCirclePixelsToRegions(worldCoords, paintBrushSize);
            
            if (!paintBuffers[layerId]) initPaintBuffer(layerId);
            updatePaintBuffer(layerId, (imgData) => {
              drawCircleOnBuffer(imgData, worldCoords, paintBrushSize, currentColor, PAINT_BUFFER_SIZE);
            });
          }
        }
      }
      return;
    }
  }, [
    isPanMode,
    currentTool,
    getCanvasCoords,
    canvasToWorldFn,
    activeLayerId,
    regionPolygonsCache,
    getShapesToEraseAtPoint,
    eraseShapes,
    setIsPanning,
    setPanStart,
    setIsErasing,
    regionAnnotations,
    updateRegionAnnotationWithRegionId,
    paintBuffers,
    initPaintBuffer,
    updatePaintBuffer,
    paintBrushSize,
    currentColor,
    layers,
    recordCirclePixelsToRegions,
    regionIdTexture,
  ]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // 处理背景拖动结束
    if (imageState.isBackgroundDragging) {
      endBackgroundDrag(); // 重置拖动起始位置
      return;
    }

    if (isErasing && currentTool === 'eraser') {
      // 确保最后一次擦除（如果 mouseup 时还有未被 Move 覆盖的位置，但一般 Move 已覆盖，这步可省略，保留以保万无一失）
      const coords = getCanvasCoords(e);
      const finalIds = getShapesToEraseAtPoint(coords.x, coords.y);
      if (finalIds.length > 0) eraseShapes(finalIds);
      // 如果有任何图形被删除，保存历史
      if (erasedShapesThisSessionRef.current.size > 0) {
        useAppStore.getState().saveHistory();
      }
      setIsErasing(false);
      erasedShapesThisSessionRef.current.clear();
    }

    if (isPainting && currentTool === 'paintBrush') {
      setIsPainting(false);
      
      // 使用区域ID纹理清除不在任何精确区域内的像素
      const layerId = activeLayerId || layers[0]?.id;
      if (layerId && paintBuffers[layerId]) {
        const texture = regionIdTexture.get(layerId);
        if (texture) {
          updatePaintBuffer(layerId, (imgData) => {
            const data = imgData.data;
            
            for (let y = 0; y < PAINT_BUFFER_SIZE; y++) {
              for (let x = 0; x < PAINT_BUFFER_SIZE; x++) {
                // 从纹理中快速查询区域ID（O(1)操作）
                const regionId = texture[y * PAINT_BUFFER_SIZE + x];
                
                // 如果不在任何区域内且该像素有颜色，则清除
                if (regionId === 0) {
                  const idx = (y * PAINT_BUFFER_SIZE + x) * 4;
                  if (data[idx + 3] > 0) { // 检查 alpha 通道
                    data[idx] = 0;     // R
                    data[idx + 1] = 0; // G
                    data[idx + 2] = 0; // B
                    data[idx + 3] = 0; // A
                  }
                }
              }
            }
          });
        }
      }
      
      saveHistory();
    }

    setIsPanning(false);
  }, [isErasing, currentTool, getCanvasCoords, getShapesToEraseAtPoint, eraseShapes, isPainting, saveHistory, activeLayerId, layers, paintBuffers, updatePaintBuffer, regionIdTexture]);

  // 单击绘图逻辑（非擦除、非平移、非选择工具时）
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (currentTool === 'picker') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const imageData = ctx.getImageData(x, y, 1, 1);
      const [r, g, b] = imageData.data;
      const hexColor = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
      
      useAppStore.getState().setCurrentColor(hexColor);
      return;
    }
    
    if (isPanning || isPanMode || currentTool === 'select' || currentTool === 'eraser' || currentTool === 'pointAnnotation' || currentTool === 'regionAnnotation' || currentTool === 'paintBrush') return;
    const coords = getCanvasCoords(e);
    const worldCoords = canvasToWorldFn(coords.x, coords.y);
    const snappedCoords = snapToExistingPoint(worldCoords, currentTool, tempPoints.length);
    const toolPointsRequired: Record<string, number> = { point: 1, line: 2, rectangle: 2, circle: 2, triangle: 3, quadratic: 3, brush: Infinity };
    const requiredPoints = toolPointsRequired[currentTool] || 1;

    if (currentTool === 'brush') {
      setTempPoints(prev => [...prev, snappedCoords]);
    } else {
      const newPoints = [...tempPoints, snappedCoords];
      setTempPoints(newPoints);
      if (newPoints.length >= requiredPoints) {
        const toolToType: Record<string, string> = { point: 'point', line: 'line', rectangle: 'rectangle', circle: 'circle', triangle: 'triangle', quadratic: 'quadratic', brush: 'brush' };
        const finalShape: Shape = {
          id: `shape_${Date.now()}`,
          groupId: activeGroupId || 'default',
          layerId: activeLayerId || layers[0]?.id,
          type: toolToType[currentTool] as any,
          points: newPoints,
          color: currentColor,
        };
        addShape(finalShape);
        saveHistory();
        setTempPoints([]);
        setPreviewPoint(null);
      }
    }
  }, [isPanning, isPanMode, currentTool, getCanvasCoords, canvasToWorldFn, snapToExistingPoint, tempPoints, activeGroupId, activeLayerId, layers, currentColor]);

  // 同步临时图形到 store
  useEffect(() => {
    if (currentTool === 'brush' && tempPoints.length > 0) {
      const toolToType: Record<string, string> = { point: 'point', line: 'line', rectangle: 'rectangle', circle: 'circle', triangle: 'triangle', quadratic: 'quadratic', brush: 'brush' };
      const newShape: Shape = {
        id: 'current_shape',
        groupId: activeGroupId || 'default',
        layerId: activeLayerId || layers[0]?.id,
        type: toolToType[currentTool] as any,
        points: tempPoints,
        color: currentColor,
      };
      useAppStore.setState(state => ({ shapes: state.shapes.filter(s => s.id !== 'current_shape').concat(newShape) }));
    }
  }, [tempPoints, currentTool, activeGroupId, activeLayerId, layers, currentColor]);

  const handleDoubleClick = useCallback(() => {
    if (currentTool === 'brush' && tempPoints.length >= 2) {
      const finalShape: Shape = {
        id: `shape_${Date.now()}`,
        groupId: activeGroupId || 'default',
        layerId: activeLayerId || layers[0]?.id,
        type: 'brush',
        points: tempPoints,
        color: currentColor,
      };
      useAppStore.setState(state => ({ shapes: state.shapes.filter(s => s.id !== 'current_shape').concat(finalShape) }));
      useAppStore.getState().saveHistory();
      setTempPoints([]);
      setPreviewPoint(null);
    }
  }, [currentTool, tempPoints, activeGroupId, activeLayerId, layers, currentColor]);

  // 点注释保存
  const handlePointAnnotationSave = useCallback((text: string) => {
    const editor = pointAnnotationEditor;
    if (!editor || editor.editorId !== currentEditorIdRef.current) return;
    if (editor.annotationId) {
      updatePointAnnotation(editor.annotationId, text);
    } else {
      addPointAnnotation({
        text,
        position: editor.position,
        layerId: activeLayerId || layers[0]?.id,
      });
    }
    saveHistory();
    setPointAnnotationEditor(null);
  }, [pointAnnotationEditor, updatePointAnnotation, addPointAnnotation, saveHistory, activeLayerId, layers]);

  // 区域注释保存
  const handleRegionAnnotationSave = useCallback((text: string) => {
    const editor = regionAnnotationEditor;
    
    if (!editor || editor.editorId !== currentEditorIdRef.current) {
      return;
    }
    
    // 直接更新 store
    if (editor.annotationId) {
      updateRegionAnnotationWithRegionId(editor.annotationId, text, editor.regionId);
    } else {
      addRegionAnnotation({
        text,
        polygon: editor.polygon,
        layerId: activeLayerId || layers[0]?.id,
        regionId: editor.regionId,
      });
    }
    
    setRegionAnnotationEditor(null);
  }, [regionAnnotationEditor, updateRegionAnnotationWithRegionId, addRegionAnnotation, activeLayerId, layers]);

  // 监听区域注释变化，保存到历史快照（不保存到 localStorage）
  // 使用 ref 标志阻止撤销/重做后的循环保存
  useEffect(() => {
    if (isRestoringRef.current) {
      // 如果是撤销/重做恢复，不保存
      return;
    }
    saveHistory();
  }, [regionAnnotations, saveHistory]);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', cursor: isPanning ? 'grabbing' : (isPanMode ? 'grab' : 'default') }}>
      <div style={{ width: '100%', height: '100%', maxWidth: '100%', maxHeight: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        {showDebugRegions && (
          <div style={{
            background: 'rgba(0,0,0,0.9)',
            color: '#fff',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
          }}>
            {/* 第一行：区域选择、外部ID选择、原始模式 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>区域:</span>
              <input
                type="number"
                min="0"
                value={debugRegionId}
                onChange={e => setDebugRegionId(Math.max(0, parseInt(e.target.value) || 0))}
                style={{ width: 50, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugRegionId(prev => prev - 1)} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugRegionId(prev => prev + 1)} style={{ padding: '2px 6px' }}>+</button>
              <span style={{ fontSize: 10, opacity: 0.7 }}>(0=全部)</span>
              <span style={{ marginLeft: 12 }}>外部ID:</span>
              <input
                type="number"
                value={debugOutsideId}
                onChange={e => setDebugOutsideId(parseInt(e.target.value) || -1)}
                style={{ width: 50, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugOutsideId(prev => prev - 1)} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugOutsideId(prev => prev + 1)} style={{ padding: '2px 6px' }}>+</button>
              <span style={{ fontSize: 10, opacity: 0.7 }}>(-1=全部)</span>
              <span style={{ marginLeft: 12 }}>原始:</span>
              <button
                onClick={() => setDebugShowOriginal(prev => !prev)}
                style={{
                  padding: '2px 6px',
                  background: debugShowOriginal ? '#4CAF50' : '#666',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  fontSize: 11,
                }}
              >{debugShowOriginal ? '是' : '否'}</button>
            </div>
            {/* 第二行：距离阈值、降采样、端点信息 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>欧式距离:</span>
              <input
                type="number"
                min="0"
                max="5"
                step="0.01"
                value={debugDistanceThreshold}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDebugDistanceThreshold(Math.max(0, Math.min(5, val)));
                }}
                style={{ width: 60, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugDistanceThreshold(prev => Math.max(0, prev - 0.1))} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugDistanceThreshold(prev => Math.min(5, prev + 0.1))} style={{ padding: '2px 6px' }}>+</button>
              <span style={{ marginLeft: 12 }}>径向距离:</span>
              <input
                type="number"
                min="0"
                max="5"
                step="0.01"
                value={debugRadialThreshold}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDebugRadialThreshold(Math.max(0, Math.min(5, val)));
                }}
                style={{ width: 60, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugRadialThreshold(prev => Math.max(0, prev - 0.1))} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugRadialThreshold(prev => Math.min(5, prev + 0.1))} style={{ padding: '2px 6px' }}>+</button>
              <span style={{ marginLeft: 12 }}>降采样:</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                value={debugDownsampleFactor}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDebugDownsampleFactor(Math.max(0, Math.min(1, val)));
                }}
                style={{ width: 60, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugDownsampleFactor(prev => Math.max(0, prev - 0.05))} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugDownsampleFactor(prev => Math.min(1, prev + 0.05))} style={{ padding: '2px 6px' }}>+</button>
            </div>
            {/* 第三行：环拼接阈值 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span>环拼接:</span>
              <span style={{ fontSize: 11 }}>欧氏</span>
              <input
                type="number"
                min="0"
                max="20"
                step="0.1"
                value={debugRingDistanceThreshold}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDebugRingDistanceThreshold(Math.max(0, Math.min(20, val)));
                }}
                style={{ width: 50, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugRingDistanceThreshold(prev => Math.max(0, prev - 0.5))} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugRingDistanceThreshold(prev => Math.min(20, prev + 0.5))} style={{ padding: '2px 6px' }}>+</button>
              <span style={{ fontSize: 11 }}>径向</span>
              <input
                type="number"
                min="0"
                max="20"
                step="0.1"
                value={debugRingRadialThreshold}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const val = parseFloat(e.target.value) || 0;
                  setDebugRingRadialThreshold(Math.max(0, Math.min(20, val)));
                }}
                style={{ width: 50, padding: '2px 4px', fontSize: 12 }}
              />
              <button onClick={() => setDebugRingRadialThreshold(prev => Math.max(0, prev - 0.5))} style={{ padding: '2px 6px' }}>-</button>
              <button onClick={() => setDebugRingRadialThreshold(prev => Math.min(20, prev + 0.5))} style={{ padding: '2px 6px' }}>+</button>
              <div style={{ marginLeft: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={debugShowEndpoints}
                    onChange={(e) => setDebugShowEndpoints(e.target.checked)}
                  />
                  <span>端点信息</span>
                </label>
              </div>
              <div style={{ marginLeft: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={debugShowRings}
                    onChange={(e) => setDebugShowRings(e.target.checked)}
                  />
                  <span>绘制环</span>
                </label>
              </div>
              <div style={{ marginLeft: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={debugShowSegments}
                    onChange={(e) => setDebugShowSegments(e.target.checked)}
                  />
                  <span>绘制片段</span>
                </label>
              </div>
              <div style={{ marginLeft: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={debugShowWallGrouped}
                    onChange={(e) => setDebugShowWallGrouped(e.target.checked)}
                  />
                  <span>墙分组点</span>
                </label>
              </div>
            </div>
          </div>
        )}
        <div ref={canvasWrapperRef} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', width: '100%', height: '100%', position: 'relative', boxShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasHeight}
            style={{ imageRendering: 'auto', display: 'block', maxWidth: '100%', maxHeight: '100%' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onClick={handleCanvasClick}
            onDoubleClick={handleDoubleClick}
          />
        </div>
      </div>
      {pointAnnotationEditor && (
        <AnnotationEditor
          x={pointAnnotationEditor.x}
          y={pointAnnotationEditor.y}
          annotationId={pointAnnotationEditor.annotationId}
          existingText={pointAnnotationEditor.existingText}
          onSave={handlePointAnnotationSave}
          onCancel={() => setPointAnnotationEditor(null)}
        />
      )}
      {regionAnnotationEditor && (
        <AnnotationEditor
          x={regionAnnotationEditor.x}
          y={regionAnnotationEditor.y}
          annotationId={regionAnnotationEditor.annotationId}
          existingText={regionAnnotationEditor.existingText}
          onSave={handleRegionAnnotationSave}
          onCancel={() => setRegionAnnotationEditor(null)}
        />
      )}
    </div>
  );
}