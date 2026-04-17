import React, { useState, useEffect, useRef } from 'react';
import './Crosshair.css';

interface CrosshairProps {
  isLocking?: boolean;
  lockProgress?: number; // 0-1
}

const Crosshair: React.FC<CrosshairProps> = ({ isLocking = false, lockProgress = 0 }) => {
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const crosshairRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };

    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <div 
      ref={crosshairRef}
      className={`crosshair ${isLocking ? 'crosshair-locking' : ''}`}
      style={{
        left: `${mousePosition.x}px`,
        top: `${mousePosition.y}px`,
        transform: 'translate(-50%, -50%)'
      }}
    >
      <div className="crosshair-center"></div>
      <div className="crosshair-line crosshair-line-top"></div>
      <div className="crosshair-line crosshair-line-bottom"></div>
      <div className="crosshair-line crosshair-line-left"></div>
      <div className="crosshair-line crosshair-line-right"></div>
      
      {/* 锁定圆环 */}
      {isLocking && (
        <div className="crosshair-lock-ring">
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle 
              cx="20" 
              cy="20" 
              r="15" 
              fill="none" 
              stroke="#2196F3" 
              strokeWidth="2"
              opacity="0.5"
            />
            <circle 
              cx="20" 
              cy="20" 
              r="15" 
              fill="none" 
              stroke="#2196F3" 
              strokeWidth="2"
              strokeDasharray={`${2 * Math.PI * 15}`}
              strokeDashoffset={`${2 * Math.PI * 15 * (1 - Math.max(0, Math.min(1, lockProgress)))}`}
              strokeLinecap="round"
              transform="rotate(-90 20 20)"
              className="crosshair-lock-progress"
            />
          </svg>
        </div>
      )}
    </div>
  );
};

export default Crosshair;