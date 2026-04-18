import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { getWorldRayFromMouse } from '../../App';

interface RayVisualizerProps {
  mouseX: number;
  mouseY: number;
  length?: number;
  color?: THREE.Color;
  opacity?: number;
  lineWidth?: number;
}

const RayVisualizer: React.FC<RayVisualizerProps> = ({
  mouseX,
  mouseY,
  length = 100,
  color = new THREE.Color(0x00ffff),
  opacity = 0.8,
  lineWidth = 2,
}) => {
  const { camera, gl } = useThree();
  const canvas = gl.domElement;
  const lineRef = useRef<THREE.Line>(null);

  useEffect(() => {
    if (!lineRef.current || !camera || !canvas) return;

    // 使用getWorldRayFromMouse函数计算射线
    const { origin, direction } = getWorldRayFromMouse(mouseX, mouseY, camera, canvas);

    // 计算射线终点
    const end = origin.clone().add(direction.multiplyScalar(length));

    // 更新线段的顶点
    const geometry = lineRef.current.geometry as THREE.BufferGeometry;
    const positions = new Float32Array([
      origin.x, origin.y, origin.z,
      end.x, end.y, end.z,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.attributes.position.needsUpdate = true;
  }, [mouseX, mouseY, camera, canvas, length]);

  return (
    <line ref={lineRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={2}
          array={new Float32Array([0, 0, 0, 0, 0, 1])}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        linewidth={lineWidth}
      />
    </line>
  );
};

export default RayVisualizer;