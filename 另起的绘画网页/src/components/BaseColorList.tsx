import React, { useState, useCallback } from 'react';
import ColorItem from './ColorItem';

interface BaseColorListProps {
  colors: Array<{ id: number; h: number; s: number; l: number }>;
  selectedId: number | null;
  pickingId: number | null;
  onSelect: (id: number) => void;
  onUpdate: (id: number, hsl: { h: number; s: number; l: number }) => void;
  onDragEnd: () => void;
  onRecluster: () => void;
  onPickColor: (id: number) => void;
}

const PAGE_SIZE = 100;

const BaseColorList = React.memo(({ colors, selectedId, pickingId, onSelect, onUpdate, onDragEnd, onRecluster, onPickColor }: BaseColorListProps) => {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(colors.length / PAGE_SIZE));
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;
  const currentColors = colors.slice(startIdx, endIdx);

  const handleToggleExpand = useCallback((id: number) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage(prev => prev - 1);
      setExpandedId(null);
    }
  }, [currentPage]);

  const handleNextPage = useCallback(() => {
    if (currentPage < totalPages) {
      setCurrentPage(prev => prev + 1);
      setExpandedId(null);
    }
  }, [currentPage, totalPages]);

  const handleGoToPage = useCallback((page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
      setExpandedId(null);
    }
  }, [totalPages]);

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
      display: 'flex',
      flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexShrink: 0 }}>
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
      
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {currentColors.map((color) => (
          <ColorItem
            key={color.id}
            colorId={color.id}
            hsl={{ h: color.h, s: color.s, l: color.l }}
            isSelected={selectedId === color.id}
            isPicking={pickingId === color.id}
            isExpanded={expandedId === color.id}
            onSelect={onSelect}
            onUpdate={onUpdate}
            onDragEnd={onDragEnd}
            onPickColor={onPickColor}
            onToggleExpand={handleToggleExpand}
          />
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          gap: '4px',
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid #ddd',
          flexShrink: 0,
        }}>
          <button
            onClick={handlePrevPage}
            disabled={currentPage === 1}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              border: '1px solid #999',
              background: '#fff',
              color: '#333',
              borderRadius: '3px',
              cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
              opacity: currentPage === 1 ? 0.5 : 1,
            }}
          >
            上一页
          </button>
          <span style={{ fontSize: '11px', color: '#666' }}>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={handleNextPage}
            disabled={currentPage === totalPages}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              border: '1px solid #999',
              background: '#fff',
              color: '#333',
              borderRadius: '3px',
              cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
              opacity: currentPage === totalPages ? 0.5 : 1,
            }}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  );
});

export default BaseColorList;