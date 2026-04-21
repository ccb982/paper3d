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

  // 处理拖拽开始
  const handleDragStart = (slot: any) => {
    if (slot.item) {
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
      InventorySystem.getInstance().removeItemAt(slot.x, slot.y);
    }
  };

  // 处理拖拽结束
  const handleDragEnd = () => {
    if (tempItem && draggedItem) {
      // 尝试放置物品
      const inventory = InventorySystem.getInstance();
      const success = inventory.addItem(tempItem.item, tempItem.startPosition.x, tempItem.startPosition.y);
      
      if (!success) {
        // 如果放置失败，将物品放回原位置
        inventory.addItem(tempItem.item, draggedItem.startPosition.x, draggedItem.startPosition.y);
      }
    }
    
    // 重置拖拽状态
    setDraggedItem(null);
    setTempItem(null);
    setIsDragging(false);
  };

  // 处理鼠标移动
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && tempItem) {
      // 计算鼠标在背包网格中的位置
      const backpackElement = e.currentTarget;
      const rect = backpackElement.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left - 10) / 62); // 10px padding + 60px 格子宽度 + 2px 间距
      const y = Math.floor((e.clientY - rect.top - 10) / 62); // 10px padding + 60px 格子高度 + 2px 间距
      
      // 检查位置是否有效
      if (x >= 0 && x < 5 && y >= 0 && y < 10) {
        setTempItem(prev => prev ? {
          ...prev,
          startPosition: { x, y }
        } : null);
      }
    }
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
          <div 
            className="backpack-grid" 
            style={{ position: 'relative' }}
            onMouseUp={handleDragEnd}
            onMouseMove={handleMouseMove}
          >
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
                    onMouseDown={() => handleDragStart(slot)}
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
                        alignItems: 'center',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={() => handleMouseEnter(slot.itemId)}
                      onMouseLeave={handleMouseLeave}
                      onMouseDown={() => handleDragStart(slot)}
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

              // 渲染临时物品（拖拽中的物品）
              const tempItemElement = tempItem ? (
                <div 
                  style={{
                    position: 'absolute',
                    left: `${10 + tempItem.startPosition.x * 62}px`,
                    top: `${10 + tempItem.startPosition.y * 62}px`,
                    zIndex: 200,
                    width: `${tempItem.item.size.width * 60}px`,
                    height: `${tempItem.item.size.height * 60}px`,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    opacity: 0.8,
                    cursor: 'pointer'
                  }}
                >
                  <div 
                    style={{ 
                      backgroundColor: getColorForItemType(tempItem.item.type),
                      width: '100%',
                      height: '100%',
                      borderRadius: '6px',
                      boxShadow: 'inset 0 0 5px rgba(0, 0, 0, 0.3)'
                    }}
                  />
                  {tempItem.item.quantity > 1 && (
                    <div style={{ position: 'absolute', bottom: '2px', right: '2px', zIndex: 2, background: 'rgba(0, 0, 0, 0.7)', color: 'white', fontSize: '12px', fontWeight: 'bold', padding: '1px 4px', borderRadius: '3px', minWidth: '16px' }}>
                      {tempItem.item.quantity}
                    </div>
                  )}
                </div>
              ) : null;

              // 组合格子、物品和临时物品
              return (
                <>
                  {gridSlots}
                  {itemElements}
                  {tempItemElement}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
};
