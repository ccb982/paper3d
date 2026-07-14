import React from 'react';
import { hslToRgb } from '../utils/colorCompressor';

interface ColorItemProps {
  hsl: { h: number; s: number; l: number };
  index: number;
  isSelected: boolean;
  onSelect: (index: number) => void;
  onUpdate: (index: number, hsl: { h: number; s: number; l: number }) => void;
}

const ColorItem = React.memo(({ hsl, index, isSelected, onSelect, onUpdate }: ColorItemProps) => {
  const rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
  const hex = `#${rgb.r.toString(16).padStart(2, '0')}${rgb.g.toString(16).padStart(2, '0')}${rgb.b.toString(16).padStart(2, '0')}`;

  return (
    <div
      onClick={() => onSelect(index)}
      style={{
        marginBottom: '12px',
        padding: '8px',
        background: isSelected ? '#e6f7ff' : '#fff',
        borderRadius: '4px',
        border: isSelected ? '2px solid #1890ff' : '1px solid #e0e0e0',
        cursor: 'pointer',
        transition: 'all 0.2s',
        boxShadow: isSelected ? '0 0 0 2px rgba(24,144,255,0.2)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span style={{ minWidth: '28px', fontWeight: 'bold', color: isSelected ? '#1890ff' : '#333' }}>#{index + 1}</span>
        <div style={{ width: '28px', height: '28px', borderRadius: '4px', background: hex, border: '1px solid #ccc' }} />
        <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#666' }}>
          {hex.toUpperCase()}
        </span>
        {isSelected && <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#1890ff' }}>👁️ 高亮中</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
        <span style={{ width: '12px', fontSize: '10px', color: '#999' }}>H</span>
        <input
          type="range"
          min={0} max={360} step={1}
          value={hsl.h * 360}
          onChange={e => onUpdate(index, { ...hsl, h: Number(e.target.value) / 360 })}
          style={{ flex: 1, height: '4px' }}
        />
        <span style={{ width: '36px', textAlign: 'right', fontFamily: 'monospace', fontSize: '10px' }}>
          {(hsl.h * 360).toFixed(0)}°
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' }}>
        <span style={{ width: '12px', fontSize: '10px', color: '#999' }}>S</span>
        <input
          type="range"
          min={0} max={100} step={1}
          value={hsl.s * 100}
          onChange={e => onUpdate(index, { ...hsl, s: Number(e.target.value) / 100 })}
          style={{ flex: 1, height: '4px' }}
        />
        <span style={{ width: '36px', textAlign: 'right', fontFamily: 'monospace', fontSize: '10px' }}>
          {(hsl.s * 100).toFixed(0)}%
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ width: '12px', fontSize: '10px', color: '#999' }}>L</span>
        <input
          type="range"
          min={0} max={100} step={1}
          value={hsl.l * 100}
          onChange={e => onUpdate(index, { ...hsl, l: Number(e.target.value) / 100 })}
          style={{ flex: 1, height: '4px' }}
        />
        <span style={{ width: '36px', textAlign: 'right', fontFamily: 'monospace', fontSize: '10px' }}>
          {(hsl.l * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
});

export default ColorItem;