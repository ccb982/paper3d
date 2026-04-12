import { useState, useEffect } from 'react';
import * as THREE from 'three';

interface Direction {
  x: number;
  z: number;
}

export const useKeyboard = (camera?: THREE.Camera): Direction => {
  const [direction, setDirection] = useState<Direction>({ x: 0, z: 0 });

  useEffect(() => {
    const keysPressed = new Set<string>();

    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.add(e.key.toLowerCase());
      updateDirection();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.delete(e.key.toLowerCase());
      updateDirection();
    };

    const updateDirection = () => {
      let x = 0;
      let z = 0;

      if (keysPressed.has('w')) z += 1;
      if (keysPressed.has('s')) z -= 1;
      if (keysPressed.has('a')) x -= 1;
      if (keysPressed.has('d')) x += 1;

      // 归一化向量，确保对角线移动速度与轴向移动速度一致
      const length = Math.sqrt(x * x + z * z);
      if (length > 0) {
        x /= length;
        z /= length;
      }

      // 如果提供了相机，将移动方向转换为相机坐标系
      if (camera) {
        // 计算相机位置
        const cameraPosition = camera.position.clone();
        
        // 计算相机到原点的向量
        const cameraToOrigin = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), cameraPosition);
        
        // 计算相机的前方向（从相机指向原点，移除Y分量）
        const cameraForward = new THREE.Vector3(cameraToOrigin.x, 0, cameraToOrigin.z).normalize();
        
        // 计算相机的右方向
        const cameraRight = new THREE.Vector3();
        cameraRight.crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();
        
        // 根据相机坐标系计算移动方向
        // W键：向相机前方向的反方向移动（远离相机）
        // S键：向相机前方向移动（靠近相机）
        // A键：向相机左方向移动
        // D键：向相机右方向移动
        const moveDirection = new THREE.Vector3(
          x * cameraRight.x + z * cameraForward.x,
          0,
          x * cameraRight.z + z * cameraForward.z
        );
        
        setDirection({ x: moveDirection.x, z: moveDirection.z });
      } else {
        setDirection({ x, z });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [camera]);

  return direction;
};