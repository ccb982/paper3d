import { useRef, useEffect, useCallback, useState } from 'react';
import { useAppStore } from '../stores/useAppStore';

const CANVAS_SIZE = 512;

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
  } = useAppStore();

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    ctx.save();
    ctx.translate(CANVAS_SIZE / 2 + panOffset.x, CANVAS_SIZE / 2 + panOffset.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-CANVAS_SIZE / 2, -CANVAS_SIZE / 2);

    // 绘制图片图层（已裁剪的选区部分）
    if (layerVisibility.imageLayer && imageState.originalImage && imageState.imageSrc) {
      const img = imageState.originalImage;

      if (imageState.selectionRect) {
        const sel = imageState.selectionRect;
        const scaleX = CANVAS_SIZE / sel.width;
        const scaleY = CANVAS_SIZE / sel.height;
        const scale = Math.min(scaleX, scaleY);

        const drawWidth = sel.width * scale;
        const drawHeight = sel.height * scale;
        const offsetX = (CANVAS_SIZE - drawWidth) / 2;
        const offsetY = (CANVAS_SIZE - drawHeight) / 2;

        ctx.drawImage(
          img,
          sel.x, sel.y, sel.width, sel.height,
          offsetX, offsetY, drawWidth, drawHeight
        );
      } else {
        const scale = Math.min(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height);
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        const offsetX = (CANVAS_SIZE - drawWidth) / 2;
        const offsetY = (CANVAS_SIZE - drawHeight) / 2;
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
      }
    }

    // 绘制坐标轴网格
    if (layerVisibility.axisLayer && grid.visible) {
      ctx.strokeStyle = '#d0d0d0';
      ctx.lineWidth = 1;
      for (let i = 0; i <= grid.cols; i++) {
        const pos = (i / grid.cols) * CANVAS_SIZE;
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, CANVAS_SIZE);
        ctx.stroke();
      }
      for (let i = 0; i <= grid.rows; i++) {
        const pos = (i / grid.rows) * CANVAS_SIZE;
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(CANVAS_SIZE, pos);
        ctx.stroke();
      }

      // 主坐标轴
      const centerX = (0 - axis.xMin) / (axis.xMax - axis.xMin) * CANVAS_SIZE;
      const centerY = (axis.yMax - 0) / (axis.yMax - axis.yMin) * CANVAS_SIZE;

      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(CANVAS_SIZE, centerY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, CANVAS_SIZE);
      ctx.stroke();

      // 坐标轴标签
      ctx.fillStyle = '#666';
      ctx.font = '12px monospace';
      ctx.fillText(`X: ${axis.xMin.toFixed(2)}`, 5, 18);
      ctx.fillText(`X: ${axis.xMax.toFixed(2)}`, CANVAS_SIZE - 45, 18);
      ctx.fillText(`Y: ${axis.yMax.toFixed(2)}`, 5, 20);
      ctx.fillText(`Y: ${axis.yMin.toFixed(2)}`, 5, CANVAS_SIZE - 5);
    }

    ctx.restore();
  }, [imageState, layerVisibility, axis, grid, zoom, panOffset]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const getCanvasCoords = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, []);

  const getWorldCoords = useCallback((canvasX: number, canvasY: number) => {
    const centerX = CANVAS_SIZE / 2;
    const centerY = CANVAS_SIZE / 2;
    const worldX = (canvasX - centerX - panOffset.x) / zoom - centerX;
    const worldY = (canvasY - centerY - panOffset.y) / zoom - centerY;

    const axisX = axis.xMin + ((worldX + CANVAS_SIZE) / CANVAS_SIZE) * (axis.xMax - axis.xMin);
    const axisY = axis.yMax - ((worldY + CANVAS_SIZE) / CANVAS_SIZE) * (axis.yMax - axis.yMin);
    return { x: axisX, y: axisY };
  }, [axis, zoom, panOffset]);

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
      const worldCoords = getWorldCoords(coords.x, coords.y);
      setMousePosition(worldCoords);
    },
    [isPanning, panStart, panOffset, getCanvasCoords, getWorldCoords, setMousePosition, setPanOffset]
  );

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
    setMousePosition(null);
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
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        style={{
          maxWidth: '100%',
          maxHeight: '100%',
          imageRendering: 'auto',
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      />
    </div>
  );
}
