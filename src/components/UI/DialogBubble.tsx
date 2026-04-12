import React, { useState, useEffect, useRef } from 'react';
import { useGameStore } from '../../systems/state/gameStore';

export const DialogBubble: React.FC = () => {
  const { dialog, isLoading } = useGameStore();
  const [displayText, setDisplayText] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // 清理上一次的定时器
    if (intervalRef.current) {
      clearTimeout(intervalRef.current);
      intervalRef.current = null;
    }

    if (dialog.visible) {
      setIsVisible(true);
      setDisplayText('');

      // 获取安全的文本：排除 null/undefined/字符串"undefined"
      let rawText = dialog.text;
      if (rawText === undefined || rawText === null || rawText === 'undefined') {
        rawText = '';
      }
      const textToDisplay = String(rawText);

      // 使用递归 setTimeout 实现打字机效果
      const typeCharacter = (index: number, fullText: string) => {
        if (index < fullText.length) {
          setDisplayText(prev => prev + fullText[index]);
          intervalRef.current = setTimeout(() => typeCharacter(index + 1, fullText), 50);
        }
      };

      if (textToDisplay.length > 0) {
        setDisplayText('');
        typeCharacter(0, textToDisplay);
      }
    } else {
      setIsVisible(false);
      setDisplayText('');
    }

    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
      }
    };
  }, [dialog.visible, dialog.text, isLoading]); // 注意依赖项

  if (!isVisible) return null;

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
          <p>{displayText || ''}</p>
        )}
      </div>
    </div>
  );
};

export default DialogBubble;