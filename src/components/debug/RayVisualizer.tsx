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
    if (lineRef.current) {
      scene.remove(lineRef.current);
    }

    const end = new THREE.Vector3().copy(origin).add(direction.clone().multiplyScalar(length));
    const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
    const material = new THREE.LineBasicMaterial({ color });
    const line = new THREE.Line(geometry, material);

    scene.add(line);
    lineRef.current = line;

    return () => {
      if (lineRef.current) {
        scene.remove(lineRef.current);
      }
    };
  }, [origin, direction, length, color, scene]);

  return null;
};

interface MultiRayVisualizerProps {
  origins: THREE.Vector3[];
  directions: THREE.Vector3[];
  length?: number;
  color?: number;
}

export const MultiRayVisualizer: React.FC<MultiRayVisualizerProps> = ({
  origins,
  directions,
  length = 100,
  color = 0xff0000
}) => {
  const { scene } = useThree();
  const linesRef = useRef<THREE.Line[]>([]);

  useEffect(() => {
    linesRef.current.forEach(line => scene.remove(line));
    linesRef.current = [];

    origins.forEach((origin, index) => {
      const direction = directions[index] || directions[0];
      const end = new THREE.Vector3().copy(origin).add(direction.clone().multiplyScalar(length));
      const geometry = new THREE.BufferGeometry().setFromPoints([origin, end]);
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 });
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      linesRef.current.push(line);
    });

    return () => {
      linesRef.current.forEach(line => scene.remove(line));
    };
  }, [origins, directions, length, color, scene]);

  return null;
};

export default RayVisualizer;