import React, { useEffect, useState, useRef } from 'react';
import { InventorySystem } from '../../systems/inventory/InventorySystem';
import { Item, ItemType } from '../../entities/items/ItemData';

interface CombinedStorageUIProps {
  isVisible: boolean;
  isBoxOpened: boolean;
  boxItems: Item[];
  onCloseBox: () => void;
  onTakeItemFromBox: (index: number) => void;
  onPutItemToBox: (item: Item, fromX: number, fromY: number) => void;
}

export const CombinedStorageUI: React.FC<CombinedStorageUIProps> = ({
  isVisible,
  isBoxOpened,
  boxItems,
  onCloseBox,
  onTakeItemFromBox,
  onPutItemToBox
}) => {
  const [slots, setSlots] = useState(InventorySystem.getInstance().getSlots());
  const [draggedItem, setDraggedItem] = useState<{
    item: Item;
    source: 'backpack' | 'box';
    sourcePos: { x: number; y: number };
  } | null>(null);
  const [tempTargetPos, setTempTargetPos] = useState<{ x: number; y: number; source: 'backpack' | 'box' } | null>(null);

  useEffect(() => {
    if (!isVisible) return;
    const updateSlots = () => {
      setSlots([...InventorySystem.getInstance().getSlots()]);
    };
    InventorySystem.getInstance().addListener(updateSlots);
    return () => {
      InventorySystem.getInstance().removeListener(updateSlots);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  const getColorForItemType = (type: string): string => {
    switch (type) {
      case ItemType.CONSUMABLE: return '#4CAF50';
      case ItemType.WEAPON: return '#FF5722';
      case ItemType.ARMOR: return '#2196F3';
      case ItemType.MATERIAL: return '#9C27B0';
      default: return '#607D8B';
    }
  };

  const getRarityColor = (rarity: string): string => {
    switch (rarity) {
      case 'common': return '#9E9E9E';
      case 'uncommon': return '#4CAF50';
      case 'rare': return '#2196F3';
      case 'epic': return '#9C27B0';
      case 'legendary': return '#FF9800';
      default: return '#9E9E9E';
    }
  };

  const handleBackpackDragStart = (slot: any, x: number, y: number) => {
    if (slot.item) {
      setDraggedItem({
        item: slot.item,
        source: 'backpack',
        sourcePos: { x, y }
      });
      InventorySystem.getInstance().removeItemAt(x, y);
    }
  };

  const handleBoxDragStart = (item: Item, index: number) => {
    setDraggedItem({
      item,
      source: 'box',
      sourcePos: { x: index, y: 0 }
    });
    onTakeItemFromBox(index);
  };

  const handleDropOnBackpack = (x: number, y: number) => {
    if (!draggedItem) return;

    if (draggedItem.source === 'box') {
      InventorySystem.getInstance().addItem(draggedItem.item, x, y);
    }
    setDraggedItem(null);
    setTempTargetPos(null);
  };

  const handleDropOnBox = () => {
    if (!draggedItem) return;

    if (draggedItem.source === 'backpack') {
      onPutItemToBox(draggedItem.item, draggedItem.sourcePos.x, draggedItem.sourcePos.y);
    }
    setDraggedItem(null);
    setTempTargetPos(null);
  };

  const handleCancelDrag = () => {
    if (!draggedItem) return;

    if (draggedItem.source === 'backpack') {
      InventorySystem.getInstance().addItem(
        draggedItem.item,
        draggedItem.sourcePos.x,
        draggedItem.sourcePos.y
      );
    } else if (draggedItem.source === 'box') {
      onTakeItemFromBox(draggedItem.sourcePos.x);
    }
    setDraggedItem(null);
    setTempTargetPos(null);
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 2000,
      gap: '20px'
    }}>
      {/* 背包区域 */}
      <div className="backpack-ui">
        <div className="backpack-header">
          <h2>背包</h2>
        </div>
        <div className="backpack-content">
          <div
            className="backpack-grid"
            onMouseUp={() => {
              if (tempTargetPos && tempTargetPos.source === 'backpack') {
                handleDropOnBackpack(tempTargetPos.x, tempTargetPos.y);
              }
            }}
            onMouseLeave={handleCancelDrag}
          >
            {slots.map((slot, index) => {
              const isHighlighted = tempTargetPos?.source === 'backpack' &&
                tempTargetPos?.x === slot.x &&
                tempTargetPos?.y === slot.y;
              const isDragSource = draggedItem?.source === 'backpack' &&
                draggedItem?.sourcePos.x === slot.x &&
                draggedItem?.sourcePos.y === slot.y;

              return (
                <div
                  key={index}
                  className={`backpack-slot ${isHighlighted ? 'backpack-slot-hovered' : ''}`}
                  style={{
                    opacity: isDragSource ? 0.3 : 1,
                    background: slot.item ? getColorForItemType(slot.item.type) : undefined,
                    borderColor: slot.item ? getRarityColor(slot.item.rarity) : undefined
                  }}
                  onMouseEnter={() => {
                    if (draggedItem && draggedItem.source === 'box') {
                      setTempTargetPos({ x: slot.x, y: slot.y, source: 'backpack' });
                    }
                  }}
                  onMouseDown={() => {
                    if (slot.item && !draggedItem) {
                      handleBackpackDragStart(slot, slot.x, slot.y);
                    }
                  }}
                >
                  {slot.item && (
                    <div className="item-container">
                      <div
                        className="item-color-block"
                        style={{
                          background: getColorForItemType(slot.item.type),
                          border: `2px solid ${getRarityColor(slot.item.rarity)}`
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 箱子区域 */}
      {isBoxOpened && (
        <div className="backpack-ui">
          <div className="backpack-header">
            <h2>箱子</h2>
            <button className="close-button" onClick={onCloseBox}>×</button>
          </div>
          <div className="backpack-content">
            <div
              className="backpack-grid"
              onMouseUp={() => {
                if (draggedItem && draggedItem.source === 'backpack') {
                  handleDropOnBox();
                }
              }}
              onMouseLeave={handleCancelDrag}
            >
              {boxItems.map((item, index) => (
                <div
                  key={item.id}
                  className="backpack-slot"
                  style={{
                    background: getColorForItemType(item.type),
                    borderColor: getRarityColor(item.rarity)
                  }}
                  onMouseDown={() => {
                    if (!draggedItem) {
                      handleBoxDragStart(item, index);
                    }
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
              {/* 空格子用于放置物品 */}
              {boxItems.length < 12 && (
                <div
                  className="backpack-slot"
                  style={{ borderStyle: 'dashed', borderColor: '#4ecdc4' }}
                  onMouseEnter={() => {
                    if (draggedItem && draggedItem.source === 'backpack') {
                      setTempTargetPos({ x: -1, y: -1, source: 'box' });
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* 拖拽预览 */}
      {draggedItem && (
        <div
          style={{
            position: 'fixed',
            pointerEvents: 'none',
            zIndex: 3000,
            width: '54px',
            height: '54px',
            background: getColorForItemType(draggedItem.item.type),
            border: `2px solid ${getRarityColor(draggedItem.item.rarity)}`,
            borderRadius: '6px',
            transform: 'translate(-50%, -50%)',
            opacity: 0.8
          }}
        />
      )}
    </div>
  );
};