import React, { useState } from 'react';
import { Item, ItemType } from '../../entities/items/ItemData';

interface BoxUIProps {
  isVisible: boolean;
  items: Item[];
  boxName: string;
  onClose: () => void;
  onTakeItem: (index: number) => void;
  onTakeAll: () => void;
}

export const BoxUI: React.FC<BoxUIProps> = ({
  isVisible,
  items,
  boxName,
  onClose,
  onTakeItem,
  onTakeAll
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (!isVisible) {
    return null;
  }

  const getColorForItemType = (type: string): string => {
    switch (type) {
      case ItemType.CONSUMABLE:
        return '#4CAF50';
      case ItemType.WEAPON:
        return '#FF5722';
      case ItemType.ARMOR:
        return '#2196F3';
      case ItemType.MATERIAL:
        return '#9C27B0';
      default:
        return '#607D8B';
    }
  };

  const getRarityColor = (rarity: string): string => {
    switch (rarity) {
      case 'common':
        return '#9E9E9E';
      case 'uncommon':
        return '#4CAF50';
      case 'rare':
        return '#2196F3';
      case 'epic':
        return '#9C27B0';
      case 'legendary':
        return '#FF9800';
      default:
        return '#9E9E9E';
    }
  };

  return (
    <div className="backpack-ui-overlay" onClick={onClose} style={{ justifyContent: 'flex-end', paddingRight: '5%' }}>
      <div className="backpack-ui" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '380px' }}>
        <div className="backpack-header">
          <h2>{boxName}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="backpack-content">
          {items.length === 0 ? (
            <div style={{ color: '#aaa', textAlign: 'center', padding: '30px' }}>箱子是空的</div>
          ) : (
            <>
              <div className="backpack-grid">
                {items.map((item, index) => (
                  <div
                    key={item.id}
                    className={`backpack-slot ${hoveredIndex === index ? 'backpack-slot-hovered' : ''}`}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onClick={() => onTakeItem(index)}
                    style={{
                      background: getColorForItemType(item.type),
                      borderColor: getRarityColor(item.rarity)
                    }}
                  >
                    <div className="item-container">
                      <div
                        className="item-color-block"
                        style={{
                          background: getColorForItemType(item.type),
                          border: `2px solid ${getRarityColor(item.rarity)}`
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '15px' }}>
                <button
                  onClick={onTakeAll}
                  style={{
                    background: '#4ecdc4',
                    color: '#1e3c72',
                    border: '2px solid #4ecdc4',
                    padding: '10px 20px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    transition: 'all 0.3s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#3aafaa';
                    e.currentTarget.style.transform = 'scale(1.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#4ecdc4';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  全部拿走
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};