import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ShootDirectionVisualizerProps {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  color?: number;
  length?: number;
}

export const ShootDirectionVisualizer: React.FC<ShootDirectionVisualizerProps> = ({
  origin,
  direction,
  color = 0xff0000,
  length = 10
}) => {
  const lineRef = useRef<THREE.Line | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!lineRef.current || !groupRef.current) return;

    const startPos = new THREE.Vector3(origin.x, origin.y, origin.z);
    const endPos = new THREE.Vector3(
      origin.x + direction.x * length,
      origin.y + direction.y * length,
      origin.z + direction.z * length
    );

    const positions = new Float32Array([
      startPos.x, startPos.y, startPos.z,
      endPos.x, endPos.y, endPos.z
    ]);

    const geometry = lineRef.current.geometry;
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.attributes.position.needsUpdate = true;
  });

  useEffect(() => {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.LineBasicMaterial({
      color,
      linewidth: 2
    });

    lineRef.current = new THREE.Line(geometry, material);
    groupRef.current?.add(lineRef.current);

    return () => {
      if (lineRef.current) {
        lineRef.current.geometry.dispose();
        (lineRef.current.material as THREE.Material).dispose();
      }
    };
  }, [color]);

  return <group ref={groupRef} />;
};

export default ShootDirectionVisualizer;