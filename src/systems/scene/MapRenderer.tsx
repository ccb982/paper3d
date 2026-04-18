import React from 'react';
import { useLoader } from '@react-three/fiber';
import { TextureLoader, RepeatWrapping, PlaneGeometry, MeshStandardMaterial } from 'three';

interface MapRendererProps {
  getHeightAt?: (x: number, z: number) => number;
}

export const MapRenderer: React.FC<MapRendererProps> = ({ getHeightAt }) => {
  // 加载草纹理
  const grassTexture = useLoader(TextureLoader, '/textures/草1.png');
  grassTexture.transparent = true;

  // 草丛位置
  const grassPositions = [
    { x: 5, z: 0 },
    { x: -5, z: 0 },
    { x: 0, z: 5 },
    { x: 0, z: -5 }
  ];

  return (
    <group>
      {/* 草丛 */}
      {grassPositions.map((pos, index) => {
        const terrainHeight = getHeightAt ? getHeightAt(pos.x, pos.z) : 0;
        return (
          <mesh key={index} position={[pos.x, terrainHeight + 1, pos.z]}>
            <planeGeometry args={[2, 2]} />
            <meshStandardMaterial map={grassTexture} transparent={true} side={2} />
          </mesh>
        );
      })}
    </group>
  );
};
