import React, { useRef, useState, useEffect } from 'react';
import * as THREE from 'three';

interface TargetProps {
  position: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
}

const Target: React.FC<TargetProps> = ({ position, rotation = { x: 0, y: 0, z: 0 } }) => {
  const [isHit, setIsHit] = useState(false);
  const meshRef = useRef<THREE.Mesh>(null);
  const handleHitRef = useRef<() => void>();

  // 重置靶子状态
  const resetTarget = () => {
    console.log('Target reset!');
    setIsHit(false);
  };

  // 处理被击中
  const handleHit = () => {
    if (!isHit) {
      console.log('Target hit!');
      setIsHit(true);
      // 3秒后重置靶子
      setTimeout(resetTarget, 3000);
    }
  };

  // 存储最新的handleHit函数到ref中
  handleHitRef.current = handleHit;

  // 当组件挂载或handleHit函数更新时，更新userData中的handleHit
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.userData = {
        ...meshRef.current.userData,
        isTarget: true,
        isShootable: true, // 添加可射击标志
        handleHit: () => handleHitRef.current?.()
      };
    }
  }, [handleHit]);

  return (
    <mesh 
      ref={meshRef}
      position={[position.x, position.y, position.z]}
      rotation={[rotation.x, rotation.y, rotation.z]}
      userData={{ isTarget: true, isShootable: true, handleHit }} // 添加可射击标志
    >
      <planeGeometry args={[2, 4]} />
      <meshStandardMaterial 
        color={isHit ? 0x00ff00 : 0xff0000} 
        emissive={isHit ? 0x003300 : 0x330000} 
        emissiveIntensity={0.5} 
        side={2} // 双面渲染
      />
    </mesh>
  );
};

export default Target;