import React, { useEffect, useState } from 'react';
import { InventorySystem } from '../../systems/inventory/InventorySystem';

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
            {slots.map((slot, index) => (
              <div key={index} className="backpack-slot">
                {slot.item && (
                  <div className="item-container">
                    <img 
                      src={slot.item.icon} 
                      alt={slot.item.name} 
                      className="item-icon"
                    />
                    {slot.item.quantity > 1 && (
                      <div className="item-quantity">{slot.item.quantity}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
