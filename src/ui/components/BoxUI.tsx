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

interface BoxUIProps {
  isVisible: boolean;
  inventory: InventorySystem;
  boxName: string;
  onClose: () => void;
}

export const BoxUI: React.FC<BoxUIProps> = ({ 
  isVisible, 
  inventory, 
  boxName, 
  onClose 
}) => {
  const [slots, setSlots] = useState(inventory?.getSlots() || []);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const [draggedItem, setDraggedItem] = useState<{
    item: any;
    startPosition: { x: number; y: number };
  } | null>(null);
  const [tempItem, setTempItem] = useState<{
    item: any;
    startPosition: { x: number; y: number };
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    console.log('[BoxUI] useEffect triggered, isVisible:', isVisible, 'inventory:', inventory);
    if (!isVisible || !inventory) return;

    // 监听背包变化
    const updateSlots = () => {
      const currentSlots = inventory.getSlots();
      console.log('[BoxUI] Updating slots, count:', currentSlots.length);
      currentSlots.forEach((slot, i) => {
        if (slot.item) {
          console.log(`[BoxUI] Slot ${i}: item=${slot.item.name}`);
        }
      });
      setSlots([...currentSlots]);
    };

    inventory.addListener(updateSlots);
    updateSlots(); // 立即更新一次

    return () => {
      inventory.removeListener(updateSlots);
    };
  }, [isVisible, inventory]);

  // 处理鼠标悬停
  const handleMouseEnter = (itemId: string | null) => {
    setHoveredItemId(itemId);
  };

  // 处理鼠标离开
  const handleMouseLeave = () => {
    setHoveredItemId(null);
  };

  // 处理拖拽开始
  const handleDragStart = (slot: any) => {
    if (!inventory || !slot.item) return;
    
    // 记录拖拽的物品和起始位置
    setDraggedItem({
      item: slot.item,
      startPosition: { x: slot.x, y: slot.y }
    });
    setTempItem({
      item: slot.item,
      startPosition: { x: slot.x, y: slot.y }
    });
    setIsDragging(true);
    
    // 从背包中移除物品
    inventory.removeItemAt(slot.x, slot.y);
  };

  // 处理拖拽结束
  const handleDragEnd = () => {
    if (!inventory || !tempItem || !draggedItem) {
      // 重置拖拽状态
      setDraggedItem(null);
      setTempItem(null);
      setIsDragging(false);
      return;
    }
    
    // 尝试放置物品
    const success = inventory.addItem(tempItem.item, tempItem.startPosition.x, tempItem.startPosition.y);
    
    if (!success) {
      // 如果放置失败，将物品放回原位置
      inventory.addItem(tempItem.item, draggedItem.startPosition.x, draggedItem.startPosition.y);
    }
    
    // 重置拖拽状态
    setDraggedItem(null);
    setTempItem(null);
    setIsDragging(false);
  };

  // 处理鼠标移动
  const handleMouseMove = (e: React.MouseEvent, slot: any) => {
    if (isDragging && tempItem) {
      setTempItem({
        ...tempItem,
        startPosition: { x: slot.x, y: slot.y }
      });
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div 
      className="backpack-ui-overlay" 
      onClick={onClose}
      style={{
        zIndex: 998
      }}
    >
      <div 
        className="backpack-ui" 
        onClick={(e) => e.stopPropagation()}
        style={{
          left: 'auto',
          right: '20px',
          transform: 'translateY(-50%)'
        }}
      >
        <div className="backpack-header">
          <h2>{boxName}</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="backpack-content">
          <div 
            className="backpack-grid"
            style={{ 
              gridTemplateColumns: 'repeat(4, 60px)',
              width: 'fit-content'
            }}
          >
            {slots.map((slot, index) => {
              const isHovered = slot.item?.id === hoveredItemId;
              const isBeingDragged = tempItem?.item.id === slot.item?.id;
              
              return (
                <div
                  key={index}
                  className={`backpack-slot ${slot.item ? 'occupied' : ''} ${isHovered ? 'hovered' : ''}`}
                  onMouseEnter={() => handleMouseEnter(slot.item?.id || null)}
                  onMouseLeave={handleMouseLeave}
                  onMouseDown={() => handleDragStart(slot)}
                  onMouseUp={handleDragEnd}
                  onMouseMove={(e) => handleMouseMove(e, slot)}
                  style={{
                    position: 'relative',
                    width: '60px',
                    height: '60px',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    backgroundColor: slot.item ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: slot.item ? 'grab' : 'default',
                    zIndex: 1
                  }}
                >
                  {slot.item && (
                    <div
                      className="item"
                      style={{
                        width: '100%',
                        height: '100%',
                        backgroundColor: getColorForItemType(slot.item.type),
                        borderRadius: '4px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        position: 'relative',
                        zIndex: 100,
                        userSelect: 'none'
                      }}
                    >
                      <span style={{ 
                        fontSize: '14px', 
                        color: 'white',
                        textShadow: '1px 1px 2px rgba(0, 0, 0, 0.8)',
                        textAlign: 'center',
                        wordBreak: 'break-word',
                        padding: '2px'
                      }}>
                        {slot.item.name}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};