import { useAppStore } from '../stores/useAppStore';
import type { ToolType } from '../types';

const tools: { type: ToolType; icon: string; label: string }[] = [
  { type: 'select', icon: '⬚', label: '选择' },
  { type: 'point', icon: '•', label: '点' },
  { type: 'line', icon: '/', label: '线段' },
  { type: 'rectangle', icon: '□', label: '矩形' },
  { type: 'circle', icon: '○', label: '圆形' },
  { type: 'triangle', icon: '△', label: '三角形' },
  { type: 'quadratic', icon: '⌒', label: '贝塞尔' },
  { type: 'brush', icon: '✎', label: '画笔' },
  { type: 'eraser', icon: '✕', label: '橡皮' },
  { type: 'annotation', icon: '📝', label: '注释' },
];

export function Toolbar() {
  const {
    currentTool,
    setCurrentTool,
    snapRadius,
    setSnapRadius,
    snapEnabled,
    setSnapEnabled,
    undo,
    saveToStorage,
    loadFromStorage,
    exportToJson,
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
      }}
    >
      {tools.map((tool) => (
        <button
          key={tool.type}
          onClick={() => setCurrentTool(tool.type)}
          title={tool.label}
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
          }}
        >
          {tool.icon}
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
    </div>
  );
}

