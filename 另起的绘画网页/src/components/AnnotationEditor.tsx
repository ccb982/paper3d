import { useState, useEffect, useRef } from 'react';

interface AnnotationEditorProps {
  x: number;
  y: number;
  shapeId: string;
  pointIndex?: number;
  existingAnnotation?: string;
  onSave: (annotation: string) => void;
  onCancel: () => void;
}

export function AnnotationEditor({
  x,
  y,
  shapeId,
  pointIndex,
  existingAnnotation = '',
  onSave,
  onCancel,
}: AnnotationEditorProps) {
  const [value, setValue] = useState(existingAnnotation);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSave = () => {
    onSave(value.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSave();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 1000,
        backgroundColor: '#fff',
        border: '1px solid #1890ff',
        borderRadius: '4px',
        padding: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        minWidth: '200px',
      }}
    >
      <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
        {pointIndex !== undefined ? `点 ${pointIndex + 1}` : '图形'} 注释
      </div>
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入注释内容..."
        style={{
          width: '100%',
          minHeight: '60px',
          border: '1px solid #e8e8e8',
          borderRadius: '2px',
          padding: '4px',
          fontSize: '12px',
          resize: 'vertical',
        }}
      />
      <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}>
        <button
          onClick={handleSave}
          style={{
            flex: 1,
            padding: '4px 8px',
            backgroundColor: '#1890ff',
            color: '#fff',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          确定
        </button>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '4px 8px',
            backgroundColor: '#f5f5f5',
            color: '#666',
            border: 'none',
            borderRadius: '2px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          取消
        </button>
      </div>
      <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
        Ctrl+Enter 保存 | Esc 取消
      </div>
    </div>
  );
}
