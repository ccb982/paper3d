import React, { useEffect, useState } from 'react';
import { backpackManager } from '../../systems/inventory/BackpackManager';
import { ItemType } from '../../entities/items/ItemData';
import { DragManager } from '../../systems/inventory/DragManager';

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
  const [slots, setSlots] = useState(backpackManager.getInventory().getSlots());
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const dragManager = DragManager.getInstance();

  useEffect(() => {
    if (!isVisible) return;

    // 监听背包变化
    const updateSlots = () => {
      setSlots([...backpackManager.getInventory().getSlots()]);
    };

    // 监听拖拽状态变化
    const updateDragState = () => {
      setSlots([...backpackManager.getInventory().getSlots()]);
    };

    backpackManager.getInventory().addListener(updateSlots);
    dragManager.addListener(updateDragState);

    return () => {
      backpackManager.getInventory().removeListener(updateSlots);
      dragManager.removeListener(updateDragState);
    };
  }, [isVisible]);

  const [isHovered, setIsHovered] = useState(false);
  const [isTop, setIsTop] = useState(false);

  // 处理鼠标悬停
  const handleMouseEnter = (itemId: string | null) => {
    setHoveredItemId(itemId);
  };

  // 处理鼠标离开
  const handleMouseLeave = () => {
    setHoveredItemId(null);
  };

  // 处理背包UI悬停
  const handleUIHover = () => {
    setIsHovered(true);
    setIsTop(true);
  };

  // 处理背包UI离开
  const handleUILeave = () => {
    setIsHovered(false);
    setIsTop(false);
  };

  // 全局鼠标移动监听
  useEffect(() => {
    if (!isVisible) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      // 检测鼠标是否在屏幕左侧（背包区域）
      const screenWidth = window.innerWidth;
      const isLeftSide = e.clientX < screenWidth / 2;
      setIsTop(isLeftSide);
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
    };
  }, [isVisible]);

  // 处理拖拽开始
  const handleDragStart = (slot: any) => {
    if (slot.item) {
      dragManager.startDrag(
        slot.item,
        backpackManager.getInventory(),
        { x: slot.x, y: slot.y }
      );
    }
  };

  // 处理拖拽结束
  const handleDragEnd = () => {
    // 拖拽结束由DragManager全局处理
  };

  // 处理鼠标移动
  const handleMouseMove = () => {
    // 鼠标移动由DragManager全局处理
  };

  if (!isVisible) {
    return null;
  }

  const draggedItem = dragManager.getDraggedItem();

  return (
    <div id="backpack-ui" className="backpack-ui-overlay" style={{ zIndex: isTop ? 1001 : 999 }}>
      <div 
        className="backpack-ui" 
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={handleUIHover}
        onMouseLeave={handleUILeave}
        style={{ zIndex: isTop ? 2003 : 2000 }}
      >
        <div className="backpack-header">
          <h2>背包</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="backpack-content">
          <div 
            className="backpack-grid" 
            data-container="backpack"
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
                    </div>
                  );
                }
                return null;
              }).filter(Boolean);

              // 渲染临时物品（拖拽中的物品）
              const tempItemElement = draggedItem ? (
                <div 
                  style={{
                    position: 'absolute',
                    left: `${10 + draggedItem.currentPosition.x * 62}px`,
                    top: `${10 + draggedItem.currentPosition.y * 62}px`,
                    zIndex: 200,
                    width: `${draggedItem.item.size.width * 60}px`,
                    height: `${draggedItem.item.size.height * 60}px`,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    opacity: 0.8,
                    cursor: 'pointer'
                  }}
                >
                  <div 
                    style={{ 
                      backgroundColor: getColorForItemType(draggedItem.item.type),
                      width: '100%',
                      height: '100%',
                      borderRadius: '6px',
                      boxShadow: 'inset 0 0 5px rgba(0, 0, 0, 0.3)'
                    }}
                  />
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