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
];

export function Toolbar() {
  const { currentTool, setCurrentTool } = useAppStore();

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
    </div>
  );
}
