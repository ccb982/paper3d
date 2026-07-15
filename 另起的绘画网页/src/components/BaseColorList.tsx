import React, { useState, useCallback } from 'react';
import ColorItem from './ColorItem';

interface BaseColorListProps {
  colors: Array<{ id: number; h: number; s: number; l: number }>;
  selectedId: number | null;
  pickingId: number | null;
  onSelect: (id: number) => void;
  onUpdate: (id: number, hsl: { h: number; s: number; l: number }) => void;
  onRecluster: () => void;
  onPickColor: (id: number) => void;
}

const BaseColorList = React.memo(({ colors, selectedId, pickingId, onSelect, onUpdate, onRecluster, onPickColor }: BaseColorListProps) => {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const handleToggleExpand = useCallback((id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      right: 0,
      bottom: 0,
      width: '280px',
      padding: '12px',
      background: '#f5f5f5',
      borderLeft: '1px solid #ddd',
      overflowY: 'auto',
      overflowX: 'hidden',
      fontSize: '12px',
      zIndex: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <h4 style={{ margin: 0 }}>基础色列表 ({colors.length})</h4>
        <button
          onClick={onRecluster}
          style={{
            padding: '4px 8px',
            fontSize: '11px',
            border: '1px solid #52c41a',
            background: '#fff',
            color: '#52c41a',
            borderRadius: '3px',
            cursor: 'pointer',
          }}
        >
          重新聚类
        </button>
      </div>
      {colors.map((color) => (
        <ColorItem
          key={color.id}
          colorId={color.id}
          hsl={{ h: color.h, s: color.s, l: color.l }}
          isSelected={selectedId === color.id}
          isPicking={pickingId === color.id}
          isExpanded={expandedId === color.id}
          onSelect={onSelect}
          onUpdate={onUpdate}
          onRecluster={onRecluster}
          onPickColor={onPickColor}
          onToggleExpand={handleToggleExpand}
        />
      ))}
    </div>
  );
});

export default BaseColorList;