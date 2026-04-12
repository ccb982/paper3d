import React, { useState, useEffect, useRef } from 'react';
import './Crosshair.css';

const Crosshair: React.FC = () => {
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
      className="crosshair"
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
    </div>
  );
};

export default Crosshair;