import React, { useState } from 'react';
import { Item, ItemType } from '../../entities/items/ItemData';
import './BoxUI.css';

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
    <div className="box-ui-overlay" onClick={onClose}>
      <div className="box-ui" onClick={(e) => e.stopPropagation()}>
        <div className="box-header">
          <h2>{boxName}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="box-content">
          {items.length === 0 ? (
            <div className="box-empty">箱子是空的</div>
          ) : (
            <>
              <div className="box-grid">
                {items.map((item, index) => (
                  <div
                    key={item.id}
                    className={`box-item ${hoveredIndex === index ? 'hovered' : ''}`}
                    style={{
                      backgroundColor: getColorForItemType(item.type),
                      borderColor: getRarityColor(item.rarity)
                    }}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    onClick={() => onTakeItem(index)}
                  >
                    <div className="box-item-name">{item.name}</div>
                    {item.quantity > 1 && (
                      <div className="box-item-quantity">×{item.quantity}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="box-actions">
                <button className="box-take-all" onClick={onTakeAll}>
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