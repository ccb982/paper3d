import { useAppStore } from '../stores/useAppStore';
import { useState } from 'react';
import type { ToolType } from '../types';

const tools: { type: ToolType; icon: string; label: string; hint?: string }[] = [
  { type: 'select', icon: '⬚', label: '选择' },
  { type: 'point', icon: '•', label: '点' },
  { type: 'line', icon: '/', label: '线段' },
  { type: 'rectangle', icon: '□', label: '矩形' },
  { type: 'circle', icon: '○', label: '圆形' },
  { type: 'triangle', icon: '△', label: '三角形' },
  { type: 'quadratic', icon: '⌒', label: '贝塞尔' },
  { type: 'brush', icon: '✎', label: '画笔' },
  { type: 'paintBrush', icon: '🖌️', label: '上色画笔', hint: '拖拽涂抹，自动提取区域' },
  { type: 'picker', icon: '🎨', label: '取色器', hint: '点击画布取色' },
  { type: 'eraser', icon: '✕', label: '橡皮' },
  { type: 'pointAnnotation', icon: '📍', label: '点注释' },
  { type: 'regionAnnotation', icon: '🗺️', label: '区域注释', hint: '完成绘图后再添加' },
];

// 预设颜色
const presetColors = [
  '#ff0000', '#ff6b6b', '#ffa502', '#ffd93d', '#26de81', 
  '#00b894', '#00cec9', '#74b9ff', '#0984e3', '#6c5ce7',
  '#a29bfe', '#fd79a8', '#e84393', '#636e72', '#2d3436'
];

export function Toolbar() {
  const {
    currentTool,
    setCurrentTool,
    snapRadius,
    setSnapRadius,
    snapEnabled,
    setSnapEnabled,
    lineWidth,
    setLineWidth,
    undo,
    saveToStorage,
    loadFromStorage,
    exportToJson,
    currentColor,
    setCurrentColor,
    paintBrushSize,
    setPaintBrushSize,
    colorExtractMode,
    setColorExtractMode,
    colorExtractTool,
    setColorExtractTool,
    colorExtractPoints,
    clearColorExtractPoints,
  } = useAppStore();

  const [showColorExtractMenu, setShowColorExtractMenu] = useState(false);

  const handleSave = () => {
    saveToStorage();
    alert('已保存');
  };

  const handleLoad = () => {
    loadFromStorage();
    alert('已加载');
  };

  const handleExport = () => {
    exportToJson();
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: '10px',
        top: '50%',
        transform: 'translateY(-50%)',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        padding: '8px',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        zIndex: 100,
        maxHeight: '80vh',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      {tools.map((tool) => (
        <button
          key={tool.type}
          onClick={() => setCurrentTool(tool.type)}
          title={tool.hint ? `${tool.label}\n${tool.hint}` : tool.label}
          style={{
            width: '36px',
            height: '36px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: currentTool === tool.type ? '#1890ff' : 'transparent',
            color: currentTool === tool.type ? '#fff' : '#333',
            fontSize: '18px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s',
            position: 'relative',
          }}
        >
          {tool.icon}
          {tool.hint && currentTool === tool.type && (
            <div
              style={{
                position: 'absolute',
                left: '100%',
                marginLeft: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                backgroundColor: '#333',
                color: '#fff',
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                whiteSpace: 'nowrap',
                zIndex: 200,
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              ⚠️ {tool.hint}
            </div>
          )}
        </button>
      ))}

      <div style={{ height: '8px' }} />

      {/* 颜色提取按钮 */}
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowColorExtractMenu(!showColorExtractMenu)}
          title="颜色提取"
          style={{
            width: '36px',
            height: '36px',
            border: 'none',
            borderRadius: '6px',
            backgroundColor: colorExtractMode ? '#faad14' : 'transparent',
            color: colorExtractMode ? '#fff' : '#333',
            fontSize: '18px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          🎨
        </button>

        {showColorExtractMenu && (
          <div style={{
            position: 'fixed',  // 改为 fixed，避免被 overflow 裁剪
            left: '56px',      // 相对于视口定位，稍微偏移
            top: '50%',        // 垂直居中
            marginTop: '-40px',// 向上偏移一点，让菜单居中
            backgroundColor: '#fff',
            border: '1px solid #d9d9d9',
            borderRadius: '6px',
            padding: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            zIndex: 2000,      // 最高层级
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}>
            <button
              onClick={() => {
                setColorExtractTool('polygon');
                setColorExtractMode(true);
                clearColorExtractPoints();
                setShowColorExtractMenu(false);
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: colorExtractTool === 'polygon' && colorExtractMode ? '#1890ff' : '#f5f5f5',
                color: colorExtractTool === 'polygon' && colorExtractMode ? '#fff' : '#333',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              折线
            </button>
            <button
              onClick={() => {
                setColorExtractTool('bezier');
                setColorExtractMode(true);
                clearColorExtractPoints();
                setShowColorExtractMenu(false);
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: colorExtractTool === 'bezier' && colorExtractMode ? '#1890ff' : '#f5f5f5',
                color: colorExtractTool === 'bezier' && colorExtractMode ? '#fff' : '#333',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              贝塞尔曲线
            </button>
            <button
              onClick={() => {
                if (colorExtractPoints.length < 3) {
                  alert('请至少绘制3个点');
                } else {
                  console.log('[颜色提取] 提取区域，控制点:', colorExtractPoints);
                  alert('颜色提取算法待实现，控制台已打印点集');
                }
                setShowColorExtractMenu(false);
              }}
              style={{
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: '#52c41a',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              提取颜色
            </button>
          </div>
        )}
      </div>

      <div style={{ height: '8px' }} />

      <button
        onClick={undo}
        title="撤销"
        style={{
          width: '36px',
          height: '36px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: 'transparent',
          color: '#333',
          fontSize: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ↩
      </button>

      <button
        onClick={handleSave}
        title="保存"
        style={{
          width: '36px',
          height: '36px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: 'transparent',
          color: '#333',
          fontSize: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        💾
      </button>

      <button
        onClick={handleLoad}
        title="加载"
        style={{
          width: '36px',
          height: '36px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: 'transparent',
          color: '#333',
          fontSize: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        📂
      </button>

      <button
        onClick={handleExport}
        title="导出JSON"
        style={{
          width: '36px',
          height: '36px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: 'transparent',
          color: '#333',
          fontSize: '16px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        📥
      </button>

      <div style={{ height: '8px' }} />

      <button
        onClick={() => setSnapEnabled(!snapEnabled)}
        title={snapEnabled ? '关闭吸附' : '开启吸附'}
        style={{
          width: '36px',
          height: '36px',
          border: 'none',
          borderRadius: '6px',
          backgroundColor: snapEnabled ? '#52c41a' : '#ddd',
          color: snapEnabled ? '#fff' : '#666',
          fontSize: '14px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s',
        }}
      >
        ◉
      </button>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          padding: '4px 0',
        }}
      >
        <span style={{ fontSize: '10px', color: '#666' }}>吸附半径</span>
        <input
          type="range"
          min="1"
          max="50"
          value={snapRadius}
          onChange={(e) => setSnapRadius(parseInt(e.target.value))}
          disabled={!snapEnabled}
          style={{
            width: '32px',
            height: '6px',
            cursor: snapEnabled ? 'pointer' : 'not-allowed',
          }}
        />
        <span style={{ fontSize: '10px', color: '#666' }}>{snapRadius}px</span>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2px',
          padding: '4px 0',
        }}
      >
        <span style={{ fontSize: '10px', color: '#666' }}>线条粗细</span>
        <input
          type="range"
          min="0"
          max="5"
          step="0.1"
          value={lineWidth}
          onChange={(e) => setLineWidth(parseFloat(e.target.value))}
          style={{
            width: '32px',
            height: '6px',
            cursor: 'pointer',
          }}
        />
        <span style={{ fontSize: '10px', color: '#666' }}>{lineWidth === 0 ? '无' : lineWidth + 'px'}</span>
      </div>

      {/* 颜色选择器 */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 0',
        }}
      >
        <span style={{ fontSize: '10px', color: '#666' }}>颜色</span>
        {/* 当前颜色预览 */}
        <div
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: currentColor,
            border: '2px solid #ccc',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }}
          title="点击选择颜色"
        />
        {/* 预设颜色网格 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: '2px',
            padding: '2px',
          }}
        >
          {presetColors.map((color) => (
            <button
              key={color}
              onClick={() => setCurrentColor(color)}
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '3px',
                backgroundColor: color,
                border: currentColor === color ? '2px solid #333' : '1px solid #ddd',
                cursor: 'pointer',
                padding: '0',
              }}
              title={color}
            />
          ))}
        </div>
        {/* 自定义颜色输入 */}
        <input
          type="color"
          value={currentColor}
          onChange={(e) => setCurrentColor(e.target.value)}
          style={{
            width: '32px',
            height: '20px',
            cursor: 'pointer',
            border: 'none',
            borderRadius: '4px',
          }}
          title="自定义颜色"
        />
      </div>

      {/* 上色画笔大小（仅在上色画笔工具时显示） */}
      {currentTool === 'paintBrush' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
            padding: '4px 0',
          }}
        >
          <span style={{ fontSize: '10px', color: '#666' }}>画笔大小</span>
          <input
            type="range"
            min="0.002"
            max="0.2"
            step="0.001"
            value={paintBrushSize}
            onChange={(e) => setPaintBrushSize(parseFloat(e.target.value))}
            style={{
              width: '32px',
              height: '6px',
              cursor: 'pointer',
            }}
          />
          <span style={{ fontSize: '10px', color: '#666' }}>{(paintBrushSize * 100).toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}

