import { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';
import type { Point, Shape } from '../types';

const BASE_CANVAS_SIZE = 512;

export function MainCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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
  } = useAppStore();

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [tempPoints, setTempPoints] = useState<Point[]>([]);
  const [previewPoint, setPreviewPoint] = useState<Point | null>(null);
  const [canvasSize, setCanvasSize] = useState(BASE_CANVAS_SIZE);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const container = containerRef.current;
        const size = Math.min(container.clientWidth, container.clientHeight);
        setCanvasSize(size > 0 ? size : BASE_CANVAS_SIZE);
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const canvasToWorld = useCallback((canvasX: number, canvasY: number): Point => {
    const centerX = canvasSize / 2;
    const centerY = canvasSize / 2;

    const rawX = (canvasX - centerX - panOffset.x) / zoom + centerX;
    const rawY = (canvasY - centerY - panOffset.y) / zoom + centerY;

    const worldX = (rawX / canvasSize) * (axis.xMax - axis.xMin) + axis.xMin;
    const worldY = axis.yMax - (rawY / canvasSize) * (axis.yMax - axis.yMin);
    return { x: worldX, y: worldY };
  }, [axis, zoom, panOffset, canvasSize]);

  const worldToCanvas = useCallback((worldX: number, worldY: number): Point => {
    const px = ((worldX - axis.xMin) / (axis.xMax - axis.xMin)) * canvasSize;
    const py = ((axis.yMax - worldY) / (axis.yMax - axis.yMin)) * canvasSize;
    return { x: px, y: py };
  }, [axis]);

  const snapToExistingPoint = useCallback((
    point: Point,
    toolType: string,
    currentPointCount: number
  ): Point => {
    if (!snapEnabled) return point;

    const shouldSnapNow = (() => {
      if (toolType === 'rectangle') return false;
      if (toolType === 'quadratic' && currentPointCount === 2) return false;
      return true;
    })();

    if (!shouldSnapNow) return point;

    const canvasPoint = worldToCanvas(point.x, point.y);
    const checkAndSnap = (p: Point): Point | null => {
      const existingCanvasPoint = worldToCanvas(p.x, p.y);
      const distance = Math.hypot(
        canvasPoint.x - existingCanvasPoint.x,
        canvasPoint.y - existingCanvasPoint.y
      );
      if (distance < snapRadius) return p;
      return null;
    };

    const candidatePoints: Point[] = [];

    for (const shape of shapes) {
      if (shape.id === 'current_shape') continue;

      if (shape.type === 'quadratic') {
        candidatePoints.push(shape.points[0]);
        if (shape.points[1]) candidatePoints.push(shape.points[1]);
      } else {
        candidatePoints.push(...shape.points);
      }
    }

    if (toolType !== 'rectangle') {
      candidatePoints.push(...tempPoints);
    }

    for (const p of candidatePoints) {
      const snapped = checkAndSnap(p);
      if (snapped) return snapped;
    }

    return point;
  }, [snapEnabled, snapRadius, shapes, tempPoints, worldToCanvas]);

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

    if (layerVisibility.imageLayer && imageState.originalImage && imageState.imageSrc) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasSize, canvasSize);

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

    ctx.restore();
  }, [imageState, layerVisibility, axis, grid, zoom, panOffset, shapes, tempPoints, previewPoint, currentTool, drawShape]);

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
      }
    },
    [isPanMode]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
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

      const newShape: Shape = {
        id: `shape_${Date.now()}`,
        groupId: activeGroupId || 'default',
        layerId: activeLayerId || 'layer_1',
        type: toolToType[currentTool] as any,
        points: pointsToSave,
        color: '#ff0000',
      };

      useAppStore.getState().saveHistory();
      addShape(newShape);

      useAppStore.setState((state) => ({
        shapes: state.shapes.filter(s => s.id !== 'current_shape'),
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
    [isPanning, isPanMode, currentTool, getCanvasCoords, canvasToWorld, activeGroupId, activeLayerId, updateCurrentShape, finalizeShape]
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
    </div>
  );
}
