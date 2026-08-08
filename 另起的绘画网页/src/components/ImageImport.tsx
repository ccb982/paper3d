import { useRef, useCallback, useState, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { Point } from '../types';

export function ImageImport() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const {
    imageState,
    setOriginalImage,
    setSelectionRect,
    clearImage,
    isPreviewStage,
    setPreviewStage,
    applySelectionToCanvas,
  } = useAppStore(useShallow(s => ({
    imageState: s.imageState,
    setOriginalImage: s.setOriginalImage,
    setSelectionRect: s.setSelectionRect,
    clearImage: s.clearImage,
    isPreviewStage: s.isPreviewStage,
    setPreviewStage: s.setPreviewStage,
    applySelectionToCanvas: s.applySelectionToCanvas,
  })));
  const saveHistory = useCallback(() => {
    useAppStore.getState().saveHistory();
  }, []);

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  const [clippedImageSrc, setClippedImageSrc] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState<'rect' | 'polygon'>('rect');
  const [polygonPoints, setPolygonPoints] = useState<Point[]>([]);
  const [, setIsDrawingPolygon] = useState(false);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          setOriginalImage(img, event.target?.result as string);
          setSelectionRect(null);
          setClippedImageSrc(null);
          setPreviewStage(true);
          setSelectionStart(null);
          setSelectionEnd(null);
          setPolygonPoints([]);
          setIsDrawingPolygon(false);
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    },
    [setOriginalImage, setSelectionRect, setPreviewStage]
  );

  const handleClear = useCallback(() => {
    saveHistory();
    clearImage();
    setPreviewStage(false);
    setSelectionStart(null);
    setSelectionEnd(null);
    setClippedImageSrc(null);
    setPolygonPoints([]);
    setIsDrawingPolygon(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [clearImage, setPreviewStage, saveHistory]);

  const handleConfirmSelection = useCallback(() => {
    if (selectionStart && selectionEnd && imageState.originalImage) {
      const img = imageState.originalImage;
      const topLeft = {
        x: Math.min(selectionStart.x, selectionEnd.x),
        y: Math.min(selectionStart.y, selectionEnd.y),
      };
      const bottomRight = {
        x: Math.max(selectionStart.x, selectionEnd.x),
        y: Math.max(selectionStart.y, selectionEnd.y),
      };

      const width = bottomRight.x - topLeft.x;
      const height = bottomRight.y - topLeft.y;

      // 创建裁剪后的图片
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(
          img,
          topLeft.x, topLeft.y, width, height,
          0, 0, width, height
        );
        setClippedImageSrc(canvas.toDataURL('image/png'));
      }

      setSelectionRect({
        x: topLeft.x,
        y: topLeft.y,
        width,
        height,
      });
      applySelectionToCanvas();
      saveHistory();
    }
  }, [selectionStart, selectionEnd, imageState.originalImage, setSelectionRect, applySelectionToCanvas, saveHistory]);

  // 辅助函数：将预览画布坐标转换为原图像素坐标
  const previewToOriginal = useCallback((previewX: number, previewY: number) => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !imageState.originalImage) return null;
    const img = imageState.originalImage;
    const scaleX = img.width / canvas.width;
    const scaleY = img.height / canvas.height;
    return { x: previewX * scaleX, y: previewY * scaleY };
  }, [imageState.originalImage]);

  // 多边形绘制：鼠标点击添加顶点
  const handlePolygonMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imageState.originalImage || selectionMode !== 'polygon') return;
    const rect = previewCanvasRef.current!.getBoundingClientRect();
    const scaleX = previewCanvasRef.current!.width / rect.width;
    const scaleY = previewCanvasRef.current!.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    setPolygonPoints(prev => [...prev, { x, y }]);
    setIsDrawingPolygon(true);
  }, [imageState.originalImage, selectionMode]);

  // 完成多边形绘制（双击或按 Enter）
  const finishPolygon = useCallback(() => {
    if (polygonPoints.length < 3) {
      alert('至少需要3个顶点');
      return;
    }
    // 闭合多边形
    const closedPoints = [...polygonPoints, polygonPoints[0]];
    extractPolygonRegionByBFS(closedPoints);
    setIsDrawingPolygon(false);
    setPolygonPoints([]);
  }, [polygonPoints]);

  // BFS 提取多边形内部区域
  const extractPolygonRegionByBFS = useCallback((polygon: Point[]) => {
    const img = imageState.originalImage;
    if (!img) return;

    // 1. 计算多边形包围盒（原图坐标）
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of polygon) {
      const orig = previewToOriginal(p.x, p.y)!;
      minX = Math.min(minX, orig.x);
      minY = Math.min(minY, orig.y);
      maxX = Math.max(maxX, orig.x);
      maxY = Math.max(maxY, orig.y);
    }
    // 边界扩展1像素，避免锯齿
    const bbox = {
      x: Math.max(0, Math.floor(minX)),
      y: Math.max(0, Math.floor(minY)),
      w: Math.min(img.width, Math.ceil(maxX) + 1) - Math.max(0, Math.floor(minX)),
      h: Math.min(img.height, Math.ceil(maxY) + 1) - Math.max(0, Math.floor(minY))
    };
    if (bbox.w <= 0 || bbox.h <= 0) return;

    // 2. 创建临时网格（分辨率 = 包围盒尺寸，每个网格对应原图一个像素）
    const gridW = bbox.w;
    const gridH = bbox.h;
    const wallGrid: boolean[][] = Array(gridH).fill(null).map(() => Array(gridW).fill(false));

    // 3. 光栅化多边形边界（Bresenham 画线）
    const drawLine = (x0: number, y0: number, x1: number, y1: number) => {
      let x = x0, y = y0;
      const dx = Math.abs(x1 - x0);
      const dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      while (true) {
        if (x >= 0 && x < gridW && y >= 0 && y < gridH) wallGrid[y][x] = true;
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
      }
    };

    // 将多边形顶点转换为网格坐标（相对于包围盒）
    const gridPoly = polygon.map(p => {
      const orig = previewToOriginal(p.x, p.y)!;
      return { x: orig.x - bbox.x, y: orig.y - bbox.y };
    });
    for (let i = 0; i < gridPoly.length - 1; i++) {
      const a = gridPoly[i];
      const b = gridPoly[i+1];
      drawLine(Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y));
    }

    // 4. 找到多边形内部一点作为 BFS 种子（重心）
    let cx = 0, cy = 0;
    for (const p of gridPoly) { cx += p.x; cy += p.y; }
    cx /= gridPoly.length;
    cy /= gridPoly.length;
    const seedX = Math.floor(cx);
    const seedY = Math.floor(cy);
    if (seedX < 0 || seedX >= gridW || seedY < 0 || seedY >= gridH) return;

    // 5. BFS 填充内部（四连通，避开边界墙）
    const inside = Array(gridH).fill(null).map(() => Array(gridW).fill(false));
    const queue: [number, number][] = [[seedX, seedY]];
    inside[seedY][seedX] = true;
    const dirs = [[0,1],[1,0],[0,-1],[-1,0]];
    while (queue.length) {
      const [x, y] = queue.shift()!;
      for (const [dx, dy] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH && !wallGrid[ny][nx] && !inside[ny][nx]) {
          inside[ny][nx] = true;
          queue.push([nx, ny]);
        }
      }
    }

    // 6. 提取内部像素到新 Canvas
    const resultCanvas = document.createElement('canvas');
    resultCanvas.width = bbox.w;
    resultCanvas.height = bbox.h;
    const ctx = resultCanvas.getContext('2d')!;
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = img.width;
    srcCanvas.height = img.height;
    const srcCtx = srcCanvas.getContext('2d')!;
    srcCtx.drawImage(img, 0, 0);
    const srcData = srcCtx.getImageData(0, 0, img.width, img.height);
    const dstData = ctx.createImageData(bbox.w, bbox.h);

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        if (inside[y][x]) {
          const srcX = bbox.x + x;
          const srcY = bbox.y + y;
          const srcIdx = (srcY * img.width + srcX) * 4;
          const dstIdx = (y * bbox.w + x) * 4;
          dstData.data[dstIdx] = srcData.data[srcIdx];
          dstData.data[dstIdx+1] = srcData.data[srcIdx+1];
          dstData.data[dstIdx+2] = srcData.data[srcIdx+2];
          dstData.data[dstIdx+3] = srcData.data[srcIdx+3];
        } else {
          // 外部设为完全透明
          const dstIdx = (y * bbox.w + x) * 4;
          dstData.data[dstIdx+3] = 0;
        }
      }
    }
    ctx.putImageData(dstData, 0, 0);
    const clippedImageSrc = resultCanvas.toDataURL('image/png');

    // 7. 设置到 store（替换原有图片，并记录选区矩形为包围盒）
    const newImg = new Image();
    newImg.onload = () => {
      setOriginalImage(newImg, clippedImageSrc);
      // 对于多边形选区，selectionRect 应该是裁剪后图片的完整区域（从0,0开始）
      setSelectionRect({ x: 0, y: 0, width: bbox.w, height: bbox.h });
      applySelectionToCanvas();
      saveHistory();
      setPreviewStage(false);
    };
    newImg.src = clippedImageSrc;
  }, [imageState.originalImage, previewToOriginal, setOriginalImage, setSelectionRect, applySelectionToCanvas, saveHistory, setPreviewStage]);

  const handleBackToSelection = useCallback(() => {
    setPreviewStage(true);
    setSelectionStart(null);
    setSelectionEnd(null);
    setPolygonPoints([]);
    setIsDrawingPolygon(false);
  }, [setPreviewStage]);

  const handlePreviewMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!previewCanvasRef.current || !imageState.originalImage) return;
      const rect = previewCanvasRef.current.getBoundingClientRect();
      const scaleX = imageState.originalImage.width / rect.width;
      const scaleY = imageState.originalImage.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      setIsSelecting(true);
      setSelectionStart({ x, y });
      setSelectionEnd({ x, y });
    },
    [imageState.originalImage]
  );

  const handlePreviewMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isSelecting || !previewCanvasRef.current || !imageState.originalImage) return;
      const rect = previewCanvasRef.current.getBoundingClientRect();
      const scaleX = imageState.originalImage.width / rect.width;
      const scaleY = imageState.originalImage.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      setSelectionEnd({ x, y });
    },
    [isSelecting, imageState.originalImage]
  );

  const handlePreviewMouseUp = useCallback(() => {
    setIsSelecting(false);
  }, []);

  const drawPreviewCanvas = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !imageState.originalImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = imageState.originalImage;
    const maxSize = 400;
    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (selectionMode === 'rect' && selectionStart && selectionEnd) {
      const topLeft = {
        x: Math.min(selectionStart.x, selectionEnd.x) * scale,
        y: Math.min(selectionStart.y, selectionEnd.y) * scale,
      };
      const bottomRight = {
        x: Math.max(selectionStart.x, selectionEnd.x) * scale,
        y: Math.max(selectionStart.y, selectionEnd.y) * scale,
      };

      ctx.strokeStyle = '#1890ff';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        topLeft.x,
        topLeft.y,
        bottomRight.x - topLeft.x,
        bottomRight.y - topLeft.y
      );
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(24, 144, 255, 0.2)';
      ctx.fillRect(
        topLeft.x,
        topLeft.y,
        bottomRight.x - topLeft.x,
        bottomRight.y - topLeft.y
      );

      const width = bottomRight.x - topLeft.x;
      const height = bottomRight.y - topLeft.y;
      ctx.fillStyle = '#333';
      ctx.font = '12px monospace';
      ctx.fillText(
        `${Math.round(width / scale)} x ${Math.round(height / scale)}`,
        topLeft.x + 5,
        topLeft.y + 15
      );
    }

    // 绘制多边形预览
    if (selectionMode === 'polygon' && polygonPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#ff0000';
      ctx.fillStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      // 画线段
      for (let i = 0; i < polygonPoints.length - 1; i++) {
        ctx.beginPath();
        ctx.moveTo(polygonPoints[i].x, polygonPoints[i].y);
        ctx.lineTo(polygonPoints[i+1].x, polygonPoints[i+1].y);
        ctx.stroke();
      }
      // 画顶点
      for (const p of polygonPoints) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.fillStyle = '#ff0000';
      }
      ctx.setLineDash([]);
      ctx.restore();
    }
  }, [imageState.originalImage, selectionStart, selectionEnd, selectionMode, polygonPoints]);

  useEffect(() => {
    if (imageState.originalImage && isPreviewStage) {
      drawPreviewCanvas();
    }
  }, [imageState.originalImage, isPreviewStage, drawPreviewCanvas]);

  return (
    <div className="sidebar-section">
      <h3>图片导入</h3>
      <label>选择图片文件</label>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
      />

      {imageState.imageSrc && isPreviewStage && (
        <div style={{ marginTop: '12px' }}>
          <h4 style={{ fontSize: '13px', marginBottom: '8px' }}>步骤1：框选范围</h4>
          <div style={{ marginBottom: '8px' }}>
            <button
              onClick={() => setSelectionMode('rect')}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                backgroundColor: selectionMode === 'rect' ? '#1890ff' : '#f0f0f0',
                color: selectionMode === 'rect' ? '#fff' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
                marginRight: '4px',
              }}
            >
              矩形选区
            </button>
            <button
              onClick={() => setSelectionMode('polygon')}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                backgroundColor: selectionMode === 'polygon' ? '#1890ff' : '#f0f0f0',
                color: selectionMode === 'polygon' ? '#fff' : '#333',
                border: '1px solid #ddd',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              多边形选区
            </button>
          </div>
          <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
            {selectionMode === 'polygon' ? '单击添加顶点，双击完成' : '拖动鼠标选择矩形区域'}
          </p>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <canvas
              ref={previewCanvasRef}
              style={{
                maxWidth: '100%',
                border: '1px solid #ddd',
                cursor: 'crosshair',
                display: 'block',
              }}
              onMouseDown={selectionMode === 'polygon' ? handlePolygonMouseDown : handlePreviewMouseDown}
              onMouseMove={selectionMode === 'polygon' ? undefined : handlePreviewMouseMove}
              onMouseUp={selectionMode === 'polygon' ? undefined : handlePreviewMouseUp}
              onMouseLeave={selectionMode === 'polygon' ? undefined : handlePreviewMouseUp}
              onDoubleClick={selectionMode === 'polygon' ? finishPolygon : undefined}
            />
          </div>
          <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
            <button
              onClick={handleBackToSelection}
              className="btn btn-danger"
              style={{ flex: 1 }}
            >
              重新选择图片
            </button>
            {selectionMode === 'rect' && (
              <button
                onClick={handleConfirmSelection}
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!selectionStart || !selectionEnd}
              >
                确认选区
              </button>
            )}
            {selectionMode === 'polygon' && (
              <button
                onClick={finishPolygon}
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={polygonPoints.length < 3}
              >
                确认选区
              </button>
            )}
          </div>
          {selectionMode === 'rect' && selectionStart && selectionEnd && (
            <p style={{ fontSize: '11px', color: '#1890ff', marginTop: '8px' }}>
              已选择: {Math.abs(selectionEnd.x - selectionStart.x).toFixed(0)} x{' '}
              {Math.abs(selectionEnd.y - selectionStart.y).toFixed(0)} 像素
            </p>
          )}
          {selectionMode === 'polygon' && polygonPoints.length > 0 && (
            <p style={{ fontSize: '11px', color: '#1890ff', marginTop: '8px' }}>
              已添加 {polygonPoints.length} 个顶点
            </p>
          )}
        </div>
      )}

      {imageState.selectionRect && !isPreviewStage && (
        <div style={{ marginTop: '12px' }}>
          <h4 style={{ fontSize: '13px', marginBottom: '8px' }}>已应用选区</h4>
          {clippedImageSrc ? (
            <img
              src={clippedImageSrc}
              alt="已选区域"
              style={{
                width: '100%',
                borderRadius: '4px',
                border: '2px solid #1890ff',
              }}
            />
          ) : (
            <img
              src={imageState.imageSrc!}
              alt="已选区域"
              style={{
                width: '100%',
                borderRadius: '4px',
                border: '2px solid #1890ff',
              }}
            />
          )}
          <p style={{ fontSize: '11px', color: '#666', marginTop: '8px' }}>
            选区尺寸: {Math.round(imageState.selectionRect.width)} x{' '}
            {Math.round(imageState.selectionRect.height)} 像素
          </p>
          <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
            <button
              onClick={handleBackToSelection}
              className="btn btn-primary"
              style={{ flex: 1 }}
            >
              重新选区
            </button>
            <button
              onClick={handleClear}
              className="btn btn-danger"
              style={{ flex: 1 }}
            >
              清除图片
            </button>
          </div>
        </div>
      )}

      {!imageState.imageSrc && (
        <p style={{ fontSize: '11px', color: '#999', marginTop: '8px' }}>
          支持 JPG、PNG、GIF 等图片格式
        </p>
      )}

      {/* 导入多帧底图 */}
      <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed #ddd' }}>
        <input
          id="multi-frame-input"
          type="file"
          accept=".ftx3.gz,.ftx3"
          style={{ display: 'none' }}
          onChange={async (e) => {
            console.log('[多帧导入] onChange 触发');
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) {
              console.log('[多帧导入] 用户取消选择');
              return;
            }
            console.log('[多帧导入] 选择文件:', file.name, '大小:', file.size, '字节');
            try {
              const arrayBuffer = await file.arrayBuffer();
              const uint8Array = new Uint8Array(arrayBuffer);
              console.log('[多帧导入] 文件头:', uint8Array.slice(0, 8).join(','));
              const isGzipped = uint8Array.length >= 2 && uint8Array[0] === 0x1f && uint8Array[1] === 0x8b;
              console.log('[多帧导入] 是否Gzip压缩:', isGzipped);
              let dataBuffer = arrayBuffer;
              if (isGzipped) {
                const blob = new Blob([uint8Array]);
                const decompressedStream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
                const decompressedBlob = await new Response(decompressedStream).blob();
                dataBuffer = await decompressedBlob.arrayBuffer();
                console.log('[多帧导入] Gzip解压完成，大小:', dataBuffer.byteLength, '字节');
                const decompressedBytes = new Uint8Array(dataBuffer);
                console.log('[多帧导入] 解压后文件头:', decompressedBytes.slice(0, 8).join(','));
              }
              useAppStore.getState().importMultiFrameData(dataBuffer);
            } catch (err) {
              console.error('[多帧导入] 导入失败:', err);
              alert('导入失败: ' + (err as Error).message);
            }
            e.target.value = '';
          }}
        />
        <button
          onClick={() => {
            console.log('[多帧导入] 按钮被点击');
            (document.getElementById('multi-frame-input') as HTMLInputElement)?.click();
          }}
          style={{
            width: '100%',
            padding: '6px 10px',
            fontSize: '12px',
            backgroundColor: '#4caf50',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          📦 导入多帧底图
        </button>
        <p style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
          导入 FTX3 格式的多帧纹理数据
        </p>
      </div>
    </div>
  );
}