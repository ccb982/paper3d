import React, { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface ShootDirectionVisualizerProps {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  length?: number;
  color?: number;
  thickness?: number;
}

export const ShootDirectionVisualizer: React.FC<ShootDirectionVisualizerProps> = ({
  origin,
  direction,
  length = 5,
  color = 0x00ff00,
  thickness = 0.1
}) => {
  const { scene } = useThree();
  const arrowRef = useRef<THREE.ArrowHelper | null>(null);

  useEffect(() => {
    // 移除旧的箭头
    if (arrowRef.current) {
      scene.remove(arrowRef.current);
    }

    // 创建箭头辅助器
    const arrow = new THREE.ArrowHelper(
      direction,
      origin,
      length,
      color,
      thickness * 2,
      thickness
    );

    // 添加到场景
    scene.add(arrow);
    arrowRef.current = arrow;

    // 清理
    return () => {
      if (arrowRef.current) {
        scene.remove(arrowRef.current);
      }
    };
  }, [origin, direction, length, color, thickness, scene]);

  return null;
};

export default ShootDirectionVisualizer;