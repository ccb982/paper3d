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
          <div className="backpack-grid">
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

              const renderedItems = new Set<string>();
              return slots.map((slot, index) => {
                if (!slot.item) {
                  return (
                    <div key={index} className="backpack-slot">
                    </div>
                  );
                }

                // 检查是否是物品的起始格子（左上角）
                const startSlot = itemStartSlots.get(slot.item.id);
                const isStartSlot = startSlot && slot.x === startSlot.x && slot.y === startSlot.y;
                
                // 对于非起始格子，如果物品已经被渲染过，不显示任何内容
                if (!isStartSlot && renderedItems.has(slot.item.id)) {
                  return (
                    <div key={index} className="backpack-slot">
                    </div>
                  );
                }

                // 标记物品为已渲染
                renderedItems.add(slot.item.id);

                // 显示颜色块，根据物品尺寸调整大小
                return (
                  <div key={index} className="backpack-slot">
                    <div className="item-container" style={{ position: 'relative' }}>
                      <div 
                        className="item-color-block" 
                        style={{ 
                          backgroundColor: getColorForItemType(slot.item.type),
                          width: `${slot.item.size.width * 100}%`,
                          height: `${slot.item.size.height * 100}%`,
                          position: 'absolute',
                          top: '0%',
                          left: '0%',
                          zIndex: 1
                        }}
                      />
                      {slot.item.quantity > 1 && (
                        <div className="item-quantity" style={{ position: 'absolute', bottom: '2px', right: '2px', zIndex: 2 }}>
                          {slot.item.quantity}
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};
