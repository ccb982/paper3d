import { useAppStore } from '../stores/useAppStore';
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
  } = useAppStore();

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
            min="0.01"
            max="0.2"
            step="0.01"
            value={paintBrushSize}
            onChange={(e) => setPaintBrushSize(parseFloat(e.target.value))}
            style={{
              width: '32px',
              height: '6px',
              cursor: 'pointer',
            }}
          />
          <span style={{ fontSize: '10px', color: '#666' }}>{(paintBrushSize * 100).toFixed(0)}%</span>
        </div>
      )}
    </div>
  );
}

