import React, { useEffect, useState } from 'react';
import { InventorySystem } from '../../systems/inventory/InventorySystem';
import { ItemType } from '../../entities/items/ItemData';

// 根据物品类型返回颜色
function getColorForItemType(type: string): string {
  switch (type) {
    case ItemType.CONSUMABLE:
      return '#4CAF50'; // 绿色
    case ItemType.WEAPON:
      return '#FF5722'; // 橙色
    case ItemType.ARMOR:
      return '#2196F3'; // 蓝色
    case ItemType.MATERIAL:
      return '#9C27B0'; // 紫色
    default:
      return '#607D8B'; // 灰色
  }
}

interface BackpackUIProps {
  isVisible: boolean;
  onClose: () => void;
}

export const BackpackUI: React.FC<BackpackUIProps> = ({ isVisible, onClose }) => {
  const [slots, setSlots] = useState(InventorySystem.getInstance().getSlots());
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!isVisible) return;

    // 监听背包变化
    const updateSlots = () => {
      setSlots(InventorySystem.getInstance().getSlots());
    };

    InventorySystem.getInstance().addListener(updateSlots);

    return () => {
      InventorySystem.getInstance().removeListener(updateSlots);
    };
  }, [isVisible]);

  // 处理鼠标悬停
  const handleMouseEnter = (itemId: string | null) => {
    setHoveredItemId(itemId);
  };

  // 处理鼠标离开
  const handleMouseLeave = () => {
    setHoveredItemId(null);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="backpack-ui-overlay">
      <div className="backpack-ui">
        <div className="backpack-header">
          <h2>背包</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="backpack-content">
          <div className="backpack-grid" style={{ position: 'relative' }}>
            {(() => {
              // 找到每个物品的起始格子（左上角）
              const itemStartSlots = new Map<string, { x: number, y: number }>();
              
              // 第一次遍历，找到每个物品的起始格子
              slots.forEach(slot => {
                if (slot.item) {
                  const currentStart = itemStartSlots.get(slot.item.id);
                  if (!currentStart || (slot.x < currentStart.x || (slot.x === currentStart.x && slot.y < currentStart.y))) {
                    itemStartSlots.set(slot.item.id, { x: slot.x, y: slot.y });
                  }
                }
              });

              // 首先渲染所有格子
              const gridSlots = slots.map((slot, index) => {
                // 检查是否需要高亮显示
                const isHovered = hoveredItemId && slot.itemId === hoveredItemId;
                
                return (
                  <div 
                    key={`slot-${index}`} 
                    className={`backpack-slot ${isHovered ? 'backpack-slot-hovered' : ''}`}
                    onMouseEnter={() => handleMouseEnter(slot.itemId)}
                    onMouseLeave={handleMouseLeave}
                    style={{ position: 'relative', zIndex: 1 }}
                  >
                  </div>
                );
              });

              // 然后渲染所有物品
              const itemElements = slots.map((slot, index) => {
                // 检查是否是物品的起始格子（左上角）
                const startSlot = itemStartSlots.get(slot.itemId || '');
                const isStartSlot = slot.item && startSlot && slot.x === startSlot.x && slot.y === startSlot.y;
                
                if (slot.item && isStartSlot) {
                  return (
                    <div 
                      key={`item-${index}`} 
                      style={{
                        position: 'absolute',
                        left: `${10 + slot.x * 62}px`, // 10px padding + 60px 格子宽度 + 2px 间距
                        top: `${10 + slot.y * 62}px`, // 10px padding + 60px 格子高度 + 2px 间距
                        zIndex: 100,
                        width: `${slot.item.size.width * 60}px`,
                        height: `${slot.item.size.height * 60}px`,
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center'
                      }}
                    >
                      <div 
                        style={{ 
                          backgroundColor: getColorForItemType(slot.item.type),
                          width: '100%',
                          height: '100%',
                          borderRadius: '6px',
                          boxShadow: 'inset 0 0 5px rgba(0, 0, 0, 0.3)'
                        }}
                      />
                      {slot.item.quantity > 1 && (
                        <div style={{ position: 'absolute', bottom: '2px', right: '2px', zIndex: 2, background: 'rgba(0, 0, 0, 0.7)', color: 'white', fontSize: '12px', fontWeight: 'bold', padding: '1px 4px', borderRadius: '3px', minWidth: '16px' }}>
                          {slot.item.quantity}
                        </div>
                      )}
                    </div>
                  );
                }
                return null;
              }).filter(Boolean);

              // 组合格子和物品
              return (
                <>
                  {gridSlots}
                  {itemElements}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};
