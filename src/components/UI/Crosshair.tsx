import React, { useState, useEffect, useRef } from 'react';
import './Crosshair.css';

interface CrosshairProps {
  isLockMode: boolean;
  isLocking?: boolean;
  lockCountdown?: number;
}

const Crosshair: React.FC<CrosshairProps> = ({ isLockMode, isLocking = false, lockCountdown = 0 }) => {
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

  const progress = lockCountdown / 1000;
  const circumference = 2 * Math.PI * 15;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <div
      ref={crosshairRef}
      className="crosshair"
      style={{
        left: `${mousePosition.x}px`,
        top: `${mousePosition.y}px`,
        transform: 'translate(-50%, -50%)',
        display: isLockMode ? 'block' : 'none'
      }}
    >
      <div className="crosshair-center"></div>
      <div className="crosshair-line crosshair-line-top"></div>
      <div className="crosshair-line crosshair-line-bottom"></div>
      <div className="crosshair-line crosshair-line-left"></div>
      <div className="crosshair-line crosshair-line-right"></div>
      {isLocking && (
        <svg className="lock-progress" width="50" height="50" viewBox="0 0 50 50">
          <circle
            className="lock-progress-bg"
            cx="25"
            cy="25"
            r="15"
            fill="none"
            stroke="#333"
            strokeWidth="3"
          />
          <circle
            className="lock-progress-bar"
            cx="25"
            cy="25"
            r="15"
            fill="none"
            stroke="#2196F3"
            strokeWidth="3"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform="rotate(-90 25 25)"
          />
        </svg>
      )}
    </div>
  );
};

export default Crosshair;