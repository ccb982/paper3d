import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RayData } from '../../systems/shooting/interfaces/IShootingSystem';

interface MultiRayVisualizerProps {
  rayData: RayData[];
  color?: number;
  length?: number;
}

export const MultiRayVisualizer: React.FC<MultiRayVisualizerProps> = ({
  rayData,
  color = 0x00ffff,
  length = 100
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const linesRef = useRef<THREE.LineSegments | null>(null);

  useFrame(() => {
    if (!rayData || rayData.length === 0 || !groupRef.current) return;

    const positions: number[] = [];
    const colors: number[] = [];

    const baseColor = new THREE.Color(color);

    rayData.forEach((ray, index) => {
      const start = ray.origin.clone();
      const end = ray.origin.clone().add(ray.direction.clone().multiplyScalar(length));

      positions.push(start.x, start.y, start.z);
      positions.push(end.x, end.y, end.z);

      const alpha = 1 - (index * 0.15);
      colors.push(baseColor.r * alpha, baseColor.g * alpha, baseColor.b * alpha);
      colors.push(baseColor.r * alpha, baseColor.g * alpha, baseColor.b * alpha);
    });

    if (linesRef.current) {
      const geometry = linesRef.current.geometry;
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
    }
  });

  useEffect(() => {
    if (!groupRef.current) return;

    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8
    });

    linesRef.current = new THREE.LineSegments(geometry, material);
    groupRef.current.add(linesRef.current);

    return () => {
      if (linesRef.current) {
        linesRef.current.geometry.dispose();
        (linesRef.current.material as THREE.Material).dispose();
      }
    };
  }, []);

  return <group ref={groupRef} />;
};

export default MultiRayVisualizer;