import React from 'react';
import ColorItem from './ColorItem';

interface BaseColorListProps {
  colors: Array<{ h: number; s: number; l: number }>;
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onUpdate: (index: number, hsl: { h: number; s: number; l: number }) => void;
}

const BaseColorList = React.memo(({ colors, selectedIndex, onSelect, onUpdate }: BaseColorListProps) => {
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
      <h4 style={{ margin: '0 0 8px 0' }}>基础色列表 ({colors.length})</h4>
      {colors.map((hsl, index) => (
        <ColorItem
          key={index}
          hsl={hsl}
          index={index}
          isSelected={selectedIndex === index}
          onSelect={onSelect}
          onUpdate={onUpdate}
        />
      ))}
    </div>
  );
});

export default BaseColorList;