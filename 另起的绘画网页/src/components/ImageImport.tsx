import { useRef, useCallback, useState, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';

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
  } = useAppStore();

  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ x: number; y: number } | null>(null);
  const [clippedImageSrc, setClippedImageSrc] = useState<string | null>(null);

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
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    },
    [setOriginalImage, setSelectionRect, setPreviewStage]
  );

  const handleClear = useCallback(() => {
    clearImage();
    setPreviewStage(false);
    setSelectionStart(null);
    setSelectionEnd(null);
    setClippedImageSrc(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [clearImage, setPreviewStage]);

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
    }
  }, [selectionStart, selectionEnd, imageState.originalImage, setSelectionRect, applySelectionToCanvas]);

  const handleBackToSelection = useCallback(() => {
    setPreviewStage(true);
    setSelectionStart(null);
    setSelectionEnd(null);
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

    if (selectionStart && selectionEnd) {
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
  }, [imageState.originalImage, selectionStart, selectionEnd]);

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
          <p style={{ fontSize: '11px', color: '#666', marginBottom: '8px' }}>
            在下方图片上拖动鼠标选择要导入的区域
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
              onMouseDown={handlePreviewMouseDown}
              onMouseMove={handlePreviewMouseMove}
              onMouseUp={handlePreviewMouseUp}
              onMouseLeave={handlePreviewMouseUp}
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
            <button
              onClick={handleConfirmSelection}
              className="btn btn-primary"
              style={{ flex: 1 }}
              disabled={!selectionStart || !selectionEnd}
            >
              确认选区
            </button>
          </div>
          {selectionStart && selectionEnd && (
            <p style={{ fontSize: '11px', color: '#1890ff', marginTop: '8px' }}>
              已选择: {Math.abs(selectionEnd.x - selectionStart.x).toFixed(0)} x{' '}
              {Math.abs(selectionEnd.y - selectionStart.y).toFixed(0)} 像素
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
    </div>
  );
}
