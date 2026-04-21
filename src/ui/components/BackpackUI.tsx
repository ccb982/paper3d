import React from 'react';

interface BackpackUIProps {
  isVisible: boolean;
  onClose: () => void;
}

export const BackpackUI: React.FC<BackpackUIProps> = ({ isVisible, onClose }) => {
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
            {/* 背包格子，暂时用占位符 */}
            {Array.from({ length: 40 }).map((_, index) => (
              <div key={index} className="backpack-slot">
                {/* 物品槽位 */}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
