import { useState, useEffect } from 'react';
import * as THREE from 'three';

interface Direction {
  x: number;
  z: number;
  jump: boolean;
}

export const useKeyboard = (camera?: THREE.Camera): Direction => {
  const [direction, setDirection] = useState<Direction>({ x: 0, z: 0, jump: false });

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
      const jump = keysPressed.has(' ');

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
        // 获取相机的前方向（从相机指向场景）
        const cameraForward = new THREE.Vector3();
        camera.getWorldDirection(cameraForward);
        
        // 移除Y分量，只保留水平方向
        cameraForward.y = 0;
        cameraForward.normalize();
        
        // 计算相机的右方向
        const cameraRight = new THREE.Vector3();
        cameraRight.crossVectors(cameraForward, new THREE.Vector3(0, 1, 0)).normalize();
        
        // 根据相机坐标系计算移动方向
        // W键：向相机前方向移动
        // S键：向相机前方向的反方向移动
        // A键：向相机左方向移动（右方向的反方向）
        // D键：向相机右方向移动
        const moveDirection = new THREE.Vector3(
          x * cameraRight.x + z * cameraForward.x,
          0,
          x * cameraRight.z + z * cameraForward.z
        );
        
        setDirection({ x: moveDirection.x, z: moveDirection.z, jump });
      } else {
        setDirection({ x, z, jump });
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
