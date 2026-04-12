import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../systems/state/gameStore';

const DialogBubble: React.FC = () => {
  const { dialog, isLoading } = useGameStore();
  const [displayText, setDisplayText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (dialog.visible) {
      setIsVisible(true);
      setCurrentIndex(0);
      setDisplayText('');
      
      const typeInterval = setInterval(() => {
        setCurrentIndex((prevIndex) => {
          if (prevIndex < dialog.text.length) {
            setDisplayText((prevText) => prevText + dialog.text[prevIndex]);
            return prevIndex + 1;
          } else {
            clearInterval(typeInterval);
            return prevIndex;
          }
        });
      }, 30);

      return () => clearInterval(typeInterval);
    } else {
      setIsVisible(false);
      setTimeout(() => {
        setDisplayText('');
        setCurrentIndex(0);
      }, 300);
    }
  }, [dialog.visible, dialog.text]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="dialog-bubble" style={{ 
      animation: 'dialogAppear 0.3s ease-out forwards',
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? 'translateX(-50%) scale(1)' : 'translateX(-50%) scale(0.8)'
    }}>
      <div className="dialog-content">
        {isLoading ? (
          <div className="loading-text">
            <span>正在思考</span>
            <span className="ellipsis">...</span>
          </div>
        ) : (
          <p>{displayText}</p>
        )}
      </div>
    </div>
  );
};

export default DialogBubble;