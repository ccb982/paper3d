import React, { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface RayVisualizerProps {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  length?: number;
  color?: number;
}

export const RayVisualizer: React.FC<RayVisualizerProps> = ({
  origin,
  direction,
  length = 100,
  color = 0xff0000
}) => {
  const { scene } = useThree();
  const lineRef = useRef<THREE.Line | null>(null);

  useEffect(() => {
    // 移除旧的线
    if (lineRef.current) {
      scene.remove(lineRef.current);
    }

    // 计算射线终点
    const end = new THREE.Vector3().copy(origin).add(direction.multiplyScalar(length));

    // 创建线段
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const material = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geometry, material);

    // 添加到场景
    scene.add(line);
    lineRef.current = line;

    // 清理
    return () => {
      if (lineRef.current) {
        scene.remove(lineRef.current);
      }
    };
  }, [origin, direction, length, color, scene]);

  return null;
};

export default RayVisualizer;