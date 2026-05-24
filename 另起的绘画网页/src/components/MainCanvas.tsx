import { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { Point, Shape } from '../types';
import { AnnotationEditor } from './AnnotationEditor';

const BASE_CANVAS_SIZE = 512;

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
    setMousePosition,
    currentTool,
    shapes,
    addShape,
    activeGroupId,
    activeLayerId,
    layers,
    snapRadius,
    snapEnabled,
    updateShapeAnnotation,
    updatePointAnnotation,
  } = useAppStore();

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const [canvasSize, setCanvasSize] = useState(BASE_CANVAS_SIZE);
  
  const [annotationEditor, setAnnotationEditor] = useState<{
    x: number;
    y: number;
    shapeId: string;
    pointIndex?: number;
    annotation?: string;
  } | null>(null);

  const [highlightRegion, setHighlightRegion] = useState<{
    shapeIds: string[];
    bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
    type: 'closed';
    shape: Shape;
  } | null>(null);

  useEffect(() => {
    const updateSize = () => {
      if (canvasWrapperRef.current) {
        const wrapper = canvasWrapperRef.current;
        const rect = wrapper.getBoundingClientRect();
        const size = Math.min(rect.width, rect.height);
        setCanvasSize(size > 0 ? Math.floor(size) : BASE_CANVAS_SIZE);
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const canvasToWorld = useCallback((canvasX: number, canvasY: number): Point => {
    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;

    // Inverse of the canvas transform: translate(center+pan) -> scale(zoom) -> translate(-center)
    // First undo the final translation, then undo scale, then undo the initial translation
    const rawX = (canvasX - centerX - panOffset.x) / zoom + centerX;
    const rawY = (canvasY - centerY - panOffset.y) / zoom + centerY;

    // Convert from canvas coordinates to world coordinates
    const worldX = (rawX / canvasSize) * (axis.xMax - axis.xMin) + axis.xMin;
    const worldY = axis.yMax - (rawY / canvasSize) * (axis.yMax - axis.yMin);
    return { x: worldX, y: worldY };
  }, [axis, zoom, panOffset, canvasSize]);

  const worldToCanvas = useCallback((worldX: number, worldY: number): Point => {
    const px = ((worldX - axis.xMin) / (axis.xMax - axis.xMin)) * canvasSize;
    const py = ((axis.yMax - worldY) / (axis.yMax - axis.yMin)) * canvasSize;
    return { x: px, y: py };
  }, [axis, canvasSize]);

  const worldToCanvasForSnap = useCallback((worldX: number, worldY: number): Point => {
    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;

    const rawX = ((worldX - axis.xMin) / (axis.xMax - axis.xMin)) * canvasSize;
    const rawY = ((axis.yMax - worldY) / (axis.yMax - axis.yMin)) * canvasSize;

    const canvasX = (rawX - centerX) * zoom + centerX + panOffset.x;
    const canvasY = (rawY - centerY) * zoom + centerY + panOffset.y;
    return { x: canvasX, y: canvasY };
  }, [axis, zoom, panOffset, canvasSize]);

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

    const candidatePoints: Point[] = [];
    for (const shape of shapes) {
      if (shape.id === 'current_shape') continue;
      candidatePoints.push(...shape.points);
    }
    if (toolType !== 'rectangle') {
      candidatePoints.push(...tempPoints);
    }

    for (const p of candidatePoints) {
      const pCanvas = worldToCanvasForSnap(p.x, p.y);
      const dist = Math.hypot(canvasPoint.x - pCanvas.x, canvasPoint.y - pCanvas.y);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = p;
      }
    }

    if (bestMatch) return bestMatch;
    return point;
  }, [snapEnabled, snapRadius, shapes, tempPoints, worldToCanvasForSnap]);

  const findShapeAtPoint = useCallback((x: number, y: number) => {
    const hitRadius = snapRadius / zoom;
    
    for (const shape of shapes) {
      if (shape.id === 'current_shape') continue;
      
      for (let i = 0; i < shape.points.length; i++) {
        const p = shape.points[i];
        const distance = Math.hypot(x - p.x, y - p.y);
        if (distance < hitRadius) {
          return { shape, pointIndex: i };
        }
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
          if (distance < hitRadius) {
            return { shape, pointIndex: undefined };
          }
        }
      }
    }
    
    return null;
  }, [shapes, snapRadius, zoom]);

  const findAnnotationAtPoint = useCallback((canvasX: number, canvasY: number) => {
    for (const shape of shapes) {
      if (shape.id === 'current_shape') continue;
      
      if (shape.annotation && shape.points.length > 0) {
        const canvasPoints = shape.points.map(p => worldToCanvas(p.x, p.y));
        const centerX = canvasPoints.reduce((sum, p) => sum + p.x, 0) / canvasPoints.length;
        const centerY = canvasPoints.reduce((sum, p) => sum + p.y, 0) / canvasPoints.length;
        
        const markerX = centerX + 10;
        const markerY = centerY - 10;
        const distance = Math.hypot(canvasX - markerX, canvasY - markerY);
        if (distance < 8) {
          return { shape, pointIndex: undefined };
        }
      }

      for (let i = 0; i < shape.points.length; i++) {
        const p = shape.points[i];
        if (p.annotation) {
          const cp = worldToCanvas(p.x, p.y);
          const markerX = cp.x + 8;
          const markerY = cp.y - 8;
          const distance = Math.hypot(canvasX - markerX, canvasY - markerY);
          if (distance < 6) {
            return { shape, pointIndex: i };
          }
        }
      }
    }
    
    return null;
  }, [shapes, worldToCanvas]);

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
    if (['circle', 'rectangle', 'triangle'].includes(shape.type)) {
      return true;
    }
    if (['line', 'brush', 'quadratic'].includes(shape.type) && shape.points.length >= 3) {
      const first = shape.points[0];
      const last = shape.points[shape.points.length - 1];
      const dist = Math.hypot(first.x - last.x, first.y - last.y);
      return dist < 10;
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
          (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  };

  const getShapeVertices = (shape: Shape): Point[] => {
    switch (shape.type) {
      case 'circle': {
        const cx = shape.points[0].x;
        const cy = shape.points[0].y;
        const radius = Math.hypot(shape.points[1].x - cx, shape.points[1].y - cy);
        const vertices: Point[] = [];
        const segments = 32;
        for (let i = 0; i < segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          vertices.push({
            x: cx + radius * Math.cos(angle),
            y: cy + radius * Math.sin(angle),
          });
        }
        return vertices;
      }
      case 'rectangle': {
        const p1 = shape.points[0];
        const p2 = shape.points[1];
        return [
          { x: p1.x, y: p1.y },
          { x: p2.x, y: p1.y },
          { x: p2.x, y: p2.y },
          { x: p1.x, y: p2.y },
        ];
      }
      case 'triangle':
        return shape.points.slice(0, 3);
      default:
        return shape.points;
    }
  };

  const getShapeArea = (shape: Shape): number => {
    switch (shape.type) {
      case 'circle': {
        const cx = shape.points[0].x;
        const cy = shape.points[0].y;
        const radius = Math.hypot(shape.points[1].x - cx, shape.points[1].y - cy);
        return Math.PI * radius * radius;
      }
      case 'rectangle': {
        const p1 = shape.points[0];
        const p2 = shape.points[1];
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
      default:
        return isPointInPolygon(point, getShapeVertices(shape));
    }
  };

  const detectRegionAtPoint = useCallback((worldX: number, worldY: number) => {
    const currentLayerShapes = shapes.filter(s => s.layerId === activeLayerId && s.id !== 'current_shape');
    const closedShapes = currentLayerShapes.filter(s => isClosedShape(s));
    
    if (closedShapes.length === 0) {
      return null;
    }
    
    const hitShapes: Shape[] = [];
    
    for (const shape of closedShapes) {
      if (isPointInsideShape({ x: worldX, y: worldY }, shape)) {
        hitShapes.push(shape);
      }
    }
    
    if (hitShapes.length === 0) {
      return null;
    }
    
    hitShapes.sort((a, b) => getShapeArea(a) - getShapeArea(b));
    
    const targetShape = hitShapes[0];
    return {
      shapeIds: [targetShape.id],
      bounds: getShapeBounds(targetShape),
      type: 'closed' as const,
      shape: targetShape,
    };
  }, [shapes, activeLayerId]);

  const drawShapeHighlight = (ctx: CanvasRenderingContext2D, shape: Shape) => {
    const points = shape.points;
    
    switch (shape.type) {
      case 'circle':
        if (points.length >= 2) {
          const center = worldToCanvas(points[0].x, points[0].y);
          const edge = worldToCanvas(points[1].x, points[1].y);
          const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
          ctx.beginPath();
          ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        break;
        
      case 'rectangle':
        if (points.length >= 2) {
          const p1 = worldToCanvas(points[0].x, points[0].y);
          const p2 = worldToCanvas(points[1].x, points[1].y);
          ctx.fillRect(
            Math.min(p1.x, p2.x),
            Math.min(p1.y, p2.y),
            Math.abs(p2.x - p1.x),
            Math.abs(p2.y - p1.y)
          );
          ctx.strokeRect(
            Math.min(p1.x, p2.x),
            Math.min(p1.y, p2.y),
            Math.abs(p2.x - p1.x),
            Math.abs(p2.y - p1.y)
          );
        }
        break;
        
      case 'triangle':
        if (points.length >= 3) {
          ctx.beginPath();
          const p1 = worldToCanvas(points[0].x, points[0].y);
          ctx.moveTo(p1.x, p1.y);
          const p2 = worldToCanvas(points[1].x, points[1].y);
          ctx.lineTo(p2.x, p2.y);
          const p3 = worldToCanvas(points[2].x, points[2].y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        break;
        
      case 'quadratic':
        if (points.length >= 3) {
          const p1 = worldToCanvas(points[0].x, points[0].y);
          const p2 = worldToCanvas(points[1].x, points[1].y);
          const ctrl = worldToCanvas(points[2].x, points[2].y);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        break;
        
      default:
        if (points.length >= 2) {
          ctx.beginPath();
          const p1 = worldToCanvas(points[0].x, points[0].y);
          ctx.moveTo(p1.x, p1.y);
          for (let i = 1; i < points.length; i++) {
            const p = worldToCanvas(points[i].x, points[i].y);
            ctx.lineTo(p.x, p.y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        break;
    }
  };

  const drawShape = useCallback((ctx: CanvasRenderingContext2D, shape: Shape, isPreview = false) => {
    const points = shape.points;
    const color = isPreview ? '#666' : (shape.color || '#ff0000');

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;

    switch (shape.type) {
      case 'point':
        if (points.length > 0) {
          const p = worldToCanvas(points[0].x, points[0].y);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;

      case 'line':
        if (points.length >= 2) {
          const p1 = worldToCanvas(points[0].x, points[0].y);
          const p2 = worldToCanvas(points[1].x, points[1].y);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
        break;

      case 'rectangle':
        if (points.length >= 2) {
          const p1 = worldToCanvas(points[0].x, points[0].y);
          const p2 = worldToCanvas(points[1].x, points[1].y);
          ctx.strokeRect(
            Math.min(p1.x, p2.x),
            Math.min(p1.y, p2.y),
            Math.abs(p2.x - p1.x),
            Math.abs(p2.y - p1.y)
          );
        }
        break;

      case 'circle':
        if (points.length >= 2) {
          const center = worldToCanvas(points[0].x, points[0].y);
          const edge = worldToCanvas(points[1].x, points[1].y);
          const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
          ctx.beginPath();
          ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;

      case 'triangle':
        if (points.length >= 1) {
          const p1 = worldToCanvas(points[0].x, points[0].y);
          if (points.length === 1) {
            ctx.beginPath();
            ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2);
            ctx.fill();
          } else if (points.length === 2) {
            const p2 = worldToCanvas(points[1].x, points[1].y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          } else {
            const p2 = worldToCanvas(points[1].x, points[1].y);
            const p3 = worldToCanvas(points[2].x, points[2].y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.lineTo(p3.x, p3.y);
            ctx.closePath();
            ctx.stroke();
          }
        }
        break;

      case 'quadratic':
        if (points.length >= 1) {
          const p1 = worldToCanvas(points[0].x, points[0].y);
          if (points.length === 1) {
            ctx.beginPath();
            ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2);
            ctx.fill();
          } else if (points.length === 2) {
            const p2 = worldToCanvas(points[1].x, points[1].y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          } else {
            const p2 = worldToCanvas(points[1].x, points[1].y);
            const ctrl = worldToCanvas(points[2].x, points[2].y);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.quadraticCurveTo(ctrl.x, ctrl.y, p2.x, p2.y);
            ctx.stroke();
          }
        }
        break;

      case 'brush':
        if (points.length >= 2) {
          ctx.beginPath();
          const start = worldToCanvas(points[0].x, points[0].y);
          ctx.moveTo(start.x, start.y);
          for (let i = 1; i < points.length; i++) {
            const p = worldToCanvas(points[i].x, points[i].y);
            ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        } else if (points.length === 1) {
          const p = worldToCanvas(points[0].x, points[0].y);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
    }

    if (!isPreview) {
      if (shape.annotation) {
        let centerX = 0, centerY = 0;
        if (points.length > 0) {
          const canvasPoints = points.map(p => worldToCanvas(p.x, p.y));
          centerX = canvasPoints.reduce((sum, p) => sum + p.x, 0) / canvasPoints.length;
          centerY = canvasPoints.reduce((sum, p) => sum + p.y, 0) / canvasPoints.length;
        }
        
        ctx.save();
        ctx.fillStyle = '#1890ff';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(centerX + 10, centerY - 10, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('A', centerX + 10, centerY - 10);
        ctx.restore();
      }

      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (p.annotation) {
          const cp = worldToCanvas(p.x, p.y);
          ctx.save();
          ctx.fillStyle = '#52c41a';
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(cp.x + 8, cp.y - 8, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('a', cp.x + 8, cp.y - 8);
          ctx.restore();
        }
      }
    }
  }, [worldToCanvas]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasSize, canvasSize);

    ctx.save();
    ctx.translate(canvasSize / 2 + panOffset.x, canvasSize / 2 + panOffset.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-canvasSize / 2, -canvasSize / 2);

    if (imageState.originalImage && imageState.imageSrc) {
      const imageLayer = layers.find(l => l.id === imageState.imageLayerId);
      const isImageLayerVisible = imageLayer?.visible ?? false;
      
      if (isImageLayerVisible) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasSize, canvasSize);

        ctx.globalAlpha = imageLayer?.opacity ?? 0.5;
        const img = imageState.originalImage;

        if (imageState.selectionRect) {
          const sel = imageState.selectionRect;
          const scaleX = canvasSize / sel.width;
          const scaleY = canvasSize / sel.height;
          const scale = Math.min(scaleX, scaleY);

          const drawWidth = sel.width * scale;
          const drawHeight = sel.height * scale;
          const offsetX = (canvasSize - drawWidth) / 2;
          const offsetY = (canvasSize - drawHeight) / 2;

          ctx.drawImage(
            img,
            sel.x, sel.y, sel.width, sel.height,
            offsetX, offsetY, drawWidth, drawHeight
          );
        } else {
          const scale = Math.min(canvasSize / img.width, canvasSize / img.height);
          const drawWidth = img.width * scale;
          const drawHeight = img.height * scale;
          const offsetX = (canvasSize - drawWidth) / 2;
          const offsetY = (canvasSize - drawHeight) / 2;
          ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        }

        ctx.globalAlpha = 1;
      }
    }

    if (layerVisibility.axisLayer && grid.visible) {
      ctx.strokeStyle = '#d0d0d0';
      ctx.lineWidth = 1;
      for (let i = 0; i <= grid.cols; i++) {
        const pos = (i / grid.cols) * canvasSize;
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, canvasSize);
        ctx.stroke();
      }
      for (let i = 0; i <= grid.rows; i++) {
        const pos = (i / grid.rows) * canvasSize;
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(canvasSize, pos);
        ctx.stroke();
      }

      const centerX = (0 - axis.xMin) / (axis.xMax - axis.xMin) * canvasSize;
      const centerY = (axis.yMax - 0) / (axis.yMax - axis.yMin) * canvasSize;

      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(canvasSize, centerY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, canvasSize);
      ctx.stroke();

      ctx.fillStyle = '#666';
      ctx.font = '12px monospace';
      ctx.fillText(`X: ${axis.xMin.toFixed(2)}`, 5, 18);
      ctx.fillText(`X: ${axis.xMax.toFixed(2)}`, canvasSize - 45, 18);
      ctx.fillText(`Y: ${axis.yMax.toFixed(2)}`, 5, 20);
      ctx.fillText(`Y: ${axis.yMin.toFixed(2)}`, 5, canvasSize - 5);
    }

    if (layerVisibility.drawLayer) {
      layers.forEach((layer) => {
        if (layer.visible) {
          ctx.globalAlpha = layer.opacity;
          shapes.forEach((shape) => {
            if (shape.layerId === layer.id) {
              drawShape(ctx, shape);
            }
          });
        }
      });
      ctx.globalAlpha = 1;

      if (tempPoints.length > 0) {
        const tempShape: Shape = {
          id: 'temp',
          groupId: 'temp',
          type: currentTool as any,
          points: tempPoints,
          color: '#666',
        };
        drawShape(ctx, tempShape, true);

        if (previewPoint) {
          const previewShape: Shape = {
            id: 'preview',
            groupId: 'temp',
            type: currentTool as any,
            points: [...tempPoints, previewPoint],
            color: '#999',
          };
          drawShape(ctx, previewShape, true);
        }
      }
    }

    if (highlightRegion && highlightRegion.bounds && highlightRegion.shape) {
      ctx.save();
      ctx.strokeStyle = '#ff0000';
      ctx.fillStyle = 'rgba(255, 0, 0, 0.1)';
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([5 / zoom, 3 / zoom]);
      
      drawShapeHighlight(ctx, highlightRegion.shape);
      
      ctx.restore();
    }

    ctx.restore();
  }, [imageState, layerVisibility, axis, grid, zoom, panOffset, shapes, tempPoints, previewPoint, currentTool, drawShape, layers, highlightRegion, worldToCanvas]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getCanvasCoords = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvasSize / rect.width;
    const scaleY = canvasSize / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        const dx = e.clientX - panStart.x;
        const dy = e.clientY - panStart.y;
        setPanOffset({
          x: panOffset.x + dx,
          y: panOffset.y + dy,
        });
        setPanStart({ x: e.clientX, y: e.clientY });
        return;
      }

      const coords = getCanvasCoords(e);
      const worldCoords = canvasToWorld(coords.x, coords.y);
      setMousePosition(worldCoords);

      if (tempPoints.length > 0 && currentTool !== 'select') {
        setPreviewPoint(worldCoords);
      }
    },
    [isPanning, panStart, panOffset, getCanvasCoords, canvasToWorld, setMousePosition, setPanOffset, tempPoints, currentTool]
  );

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
    setMousePosition(null);
    setPreviewPoint(null);
  }, [setMousePosition]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(10, zoom * delta));
      setZoom(newZoom);
    },
    [zoom, setZoom]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && isPanMode)) {
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
        return;
      }

      const coords = getCanvasCoords(e);

      if (currentTool === 'annotation') {
        const worldCoords = canvasToWorld(coords.x, coords.y);
        
        const region = detectRegionAtPoint(worldCoords.x, worldCoords.y);
        if (region) {
          setHighlightRegion(region);
          
          const regionShapeId = region.shapeIds[0];
          const regionShape = shapes.find(s => s.id === regionShapeId);
          if (regionShape) {
            setAnnotationEditor({
              x: e.clientX,
              y: e.clientY,
              shapeId: regionShapeId,
              annotation: regionShape.annotation,
            });
          }
        }
        return;
      }

      const clickedAnnotation = findAnnotationAtPoint(coords.x, coords.y);
      if (clickedAnnotation) {
        const annotation = clickedAnnotation.pointIndex !== undefined
          ? clickedAnnotation.shape.points[clickedAnnotation.pointIndex].annotation
          : clickedAnnotation.shape.annotation;
        setAnnotationEditor({
          x: e.clientX,
          y: e.clientY,
          shapeId: clickedAnnotation.shape.id,
          pointIndex: clickedAnnotation.pointIndex,
          annotation: annotation,
        });
      }
    },
    [isPanMode, currentTool, getCanvasCoords, canvasToWorld, findAnnotationAtPoint, findShapeAtPoint, detectRegionAtPoint, shapes]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleAnnotationSave = useCallback((annotation: string) => {
    if (annotationEditor) {
      if (annotationEditor.pointIndex !== undefined) {
        updatePointAnnotation(annotationEditor.shapeId, annotationEditor.pointIndex, annotation);
      } else {
        updateShapeAnnotation(annotationEditor.shapeId, annotation);
      }
    }
    setAnnotationEditor(null);
    setHighlightRegion(null);
  }, [annotationEditor, updateShapeAnnotation, updatePointAnnotation]);

  const handleAnnotationCancel = useCallback(() => {
    setAnnotationEditor(null);
    setHighlightRegion(null);
  }, []);

  const finalizeShape = useCallback((pointsToSave: Point[]) => {
    if (pointsToSave.length >= 1) {
      const toolToType: Record<string, string> = {
        point: 'point',
        line: 'line',
        rectangle: 'rectangle',
        circle: 'circle',
        triangle: 'triangle',
        quadratic: 'quadratic',
        brush: 'brush',
      };

      const state = useAppStore.getState();
      const currentLayerId = state.activeLayerId || state.layers[0]?.id;
      if (!currentLayerId) return;

      const newShape: Shape = {
        id: `shape_${Date.now()}`,
        groupId: activeGroupId || 'default',
        layerId: currentLayerId,
        type: toolToType[currentTool] as any,
        points: pointsToSave,
        color: '#ff0000',
      };

      state.saveHistory();
      addShape(newShape);

      useAppStore.setState((s) => ({
        shapes: s.shapes.filter(sh => sh.id !== 'current_shape'),
      }));
    }
    setTempPoints([]);
    setPreviewPoint(null);
  }, [currentTool, addShape, activeGroupId]);

  const updateCurrentShape = useCallback((newPoints: Point[]) => {
    if (newPoints.length >= 1) {
      const toolToType: Record<string, string> = {
        point: 'point',
        line: 'line',
        rectangle: 'rectangle',
        circle: 'circle',
        triangle: 'triangle',
        quadratic: 'quadratic',
        brush: 'brush',
      };

      const newShape: Shape = {
        id: `current_shape`,
        groupId: activeGroupId || 'default',
        layerId: activeLayerId || 'layer_1',
        type: toolToType[currentTool] as any,
        points: newPoints,
        color: '#666',
      };

      useAppStore.setState((state) => {
        const filtered = state.shapes.filter(s => s.id !== 'current_shape');
        return { shapes: [...filtered, newShape] };
      });
    }
  }, [currentTool, activeGroupId, activeLayerId]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning || isPanMode || currentTool === 'select') return;

      const coords = getCanvasCoords(e);
      const worldCoords = canvasToWorld(coords.x, coords.y);

      if (currentTool === 'eraser') {
        const state = useAppStore.getState();
        const currentLayerId = state.activeLayerId || state.layers[0]?.id;
        if (!currentLayerId) return;

        const clickCanvas = getCanvasCoords(e);
        let shapeToRemove: string | null = null;

        for (const shape of state.shapes) {
          if (shape.id === 'current_shape') continue;
          if (shape.layerId !== currentLayerId) continue;

          for (const point of shape.points) {
            const pointCanvas = worldToCanvasForSnap(point.x, point.y);
            const dist = Math.hypot(pointCanvas.x - clickCanvas.x, pointCanvas.y - clickCanvas.y);
            if (dist < snapRadius) {
              shapeToRemove = shape.id;
              break;
            }
          }
          if (shapeToRemove) break;
        }

        if (shapeToRemove) {
          state.saveHistory();
          useAppStore.setState(s => ({
            shapes: s.shapes.filter(sh => sh.id !== shapeToRemove)
          }));
        }
        return;
      }

      const snappedCoords = snapToExistingPoint(
        worldCoords,
        currentTool,
        tempPoints.length
      );

      const toolPointsRequired: Record<string, number> = {
        point: 1,
        line: 2,
        rectangle: 2,
        circle: 2,
        triangle: 3,
        quadratic: 3,
        brush: Infinity,
      };

      const requiredPoints = toolPointsRequired[currentTool] || 1;

      if (currentTool === 'brush') {
        setTempPoints(prev => {
          const newPoints = [...prev, snappedCoords];
          updateCurrentShape(newPoints);
          return newPoints;
        });
      } else {
        setTempPoints(prev => {
          const newPoints = [...prev, snappedCoords];

          const toolToType: Record<string, string> = {
            point: 'point',
            line: 'line',
            rectangle: 'rectangle',
            circle: 'circle',
            triangle: 'triangle',
            quadratic: 'quadratic',
            brush: 'brush',
          };

          const newShape: Shape = {
            id: `current_shape`,
            groupId: activeGroupId || 'default',
            layerId: activeLayerId || 'layer_1',
            type: toolToType[currentTool] as any,
            points: newPoints,
            color: '#ff0000',
          };

          useAppStore.setState((state) => {
            const filtered = state.shapes.filter(s => s.id !== 'current_shape');
            return { shapes: [...filtered, newShape] };
          });

          if (newPoints.length >= requiredPoints) {
            setTimeout(() => finalizeShape(newPoints), 0);
          }

          return newPoints;
        });
      }
    },
    [isPanning, isPanMode, currentTool, getCanvasCoords, canvasToWorld, activeGroupId, activeLayerId, updateCurrentShape, finalizeShape, worldToCanvasForSnap, snapToExistingPoint, snapRadius]
  );

  const handleDoubleClick = useCallback(() => {
    if (currentTool === 'brush' && tempPoints.length >= 2) {
      finalizeShape(tempPoints);
    }
  }, [currentTool, tempPoints, finalizeShape]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        cursor: isPanning ? 'grabbing' : (isPanMode ? 'grab' : 'default'),
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          maxWidth: '100%',
          maxHeight: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          ref={canvasWrapperRef}
          style={{
            aspectRatio: '1 / 1',
            width: 'auto',
            height: 'auto',
            maxWidth: '100%',
            maxHeight: '100%',
            position: 'relative',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          }}
        >
          <canvas
            ref={canvasRef}
            width={canvasSize}
            height={canvasSize}
            style={{
              width: '100%',
              height: '100%',
              imageRendering: 'auto',
              display: 'block',
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onClick={handleCanvasClick}
            onDoubleClick={handleDoubleClick}
          />
        </div>
      </div>
      
      {annotationEditor && (
        <AnnotationEditor
          x={annotationEditor.x}
          y={annotationEditor.y}
          shapeId={annotationEditor.shapeId}
          pointIndex={annotationEditor.pointIndex}
          existingAnnotation={annotationEditor.annotation}
          onSave={handleAnnotationSave}
          onCancel={handleAnnotationCancel}
        />
      )}
    </div>
  );
}
