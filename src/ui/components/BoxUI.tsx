import React, { useEffect, useState } from 'react';
import { InventorySystem } from '../../systems/inventory/InventorySystem';
import { ItemType } from '../../entities/items/ItemData';
import { DragManager } from '../../systems/inventory/DragManager';

function getColorForItemType(type: string): string {
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
  const [slots, setSlots] = useState<any[]>([]);
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);
  const dragManager = DragManager.getInstance();

  useEffect(() => {
    if (!isVisible || !inventory) return;

    const updateSlots = () => {
      setSlots([...inventory.getSlots()]);
    };

    const updateDragState = () => {
      setSlots([...inventory.getSlots()]);
    };

    inventory.addListener(updateSlots);
    dragManager.addListener(updateDragState);
    dragManager.setBoxInventory(inventory);

    updateSlots();

    return () => {
      inventory.removeListener(updateSlots);
      dragManager.removeListener(updateDragState);
      dragManager.setBoxInventory(null);
    };
  }, [isVisible, inventory]);

  const [isHovered, setIsHovered] = useState(false);

  // 处理鼠标悬停
  const handleMouseEnter = (itemId: string | null) => {
    setHoveredItemId(itemId);
  };

  // 处理鼠标离开
  const handleMouseLeave = () => {
    setHoveredItemId(null);
  };

  // 处理箱子UI悬停
  const handleUIHover = () => {
    setIsHovered(true);
  };

  // 处理箱子UI离开
  const handleUILeave = () => {
    setIsHovered(false);
  };

  const handleDragStart = (slot: any) => {
    if (!inventory || !slot.item) return;
    
    console.log('[BoxUI] Starting drag from box:', slot.item.name, slot.x, slot.y);

    dragManager.startDrag(
      slot.item,
      inventory,
      { x: slot.x, y: slot.y }
    );
  };

  const handleDragEnd = () => {
    // 拖拽结束由DragManager全局处理
  };

  const handleMouseMove = () => {
    // 鼠标移动由DragManager全局处理
  };

  if (!isVisible) {
    return null;
  }

  const draggedItem = dragManager.getDraggedItem();

  return (
    <div
      id="box-ui"
      className="backpack-ui-overlay"
      onClick={onClose}
      style={{
        zIndex: isHovered ? 1000 : 999,
        justifyContent: 'flex-end',
        paddingRight: '20px',
        paddingLeft: 0
      }}
    >
      <div 
        className="backpack-ui" 
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={handleUIHover}
        onMouseLeave={handleUILeave}
        style={{
          right: '20px',
          left: 'auto',
          transform: 'none',
          zIndex: isHovered ? 2002 : 2000
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
              position: 'relative',
              width: 'fit-content'
            }}
            onMouseUp={handleDragEnd}
            onMouseMove={handleMouseMove}
          >
            {(() => {
              const itemStartSlots = new Map<string, { x: number, y: number }>();

              slots.forEach(slot => {
                if (slot.item) {
                  const currentStart = itemStartSlots.get(slot.item.id);
                  if (!currentStart || (slot.x < currentStart.x || (slot.x === currentStart.x && slot.y < currentStart.y))) {
                    itemStartSlots.set(slot.item.id, { x: slot.x, y: slot.y });
                  }
                }
              });

              const gridSlots = slots.map((slot, index) => {
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

              const itemElements = slots.map((slot, index) => {
                const startSlot = itemStartSlots.get(slot.itemId || '');
                const isStartSlot = slot.item && startSlot && slot.x === startSlot.x && slot.y === startSlot.y;

                if (slot.item && isStartSlot) {
                  return (
                    <div 
                      key={`item-${index}`} 
                      style={{
                        position: 'absolute',
                        left: `${10 + slot.x * 62}px`,
                        top: `${10 + slot.y * 62}px`,
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
                          boxShadow: 'inset 0 0 5px rgba(0, 0, 0, 0.3)',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <span style={{ 
                          fontSize: '12px', 
                          color: 'white',
                          textShadow: '1px 1px 2px rgba(0, 0, 0, 0.8)',
                          textAlign: 'center',
                          wordBreak: 'break-word',
                          padding: '2px'
                        }}>
                          {slot.item.name}
                        </span>
                      </div>
                    </div>
                  );
                }
                return null;
              }).filter(Boolean);

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
                      boxShadow: 'inset 0 0 5px rgba(0, 0, 0, 0.3)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <span style={{ 
                      fontSize: '12px', 
                      color: 'white',
                      textShadow: '1px 1px 2px rgba(0, 0, 0, 0.8)',
                      textAlign: 'center',
                      wordBreak: 'break-word',
                      padding: '2px'
                    }}>
                      {draggedItem.item.name}
                    </span>
                  </div>
                </div>
              ) : null;

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