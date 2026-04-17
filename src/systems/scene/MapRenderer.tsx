import React from 'react';
import { useLoader } from '@react-three/fiber';
import { TextureLoader, RepeatWrapping, PlaneGeometry, BoxGeometry, MeshStandardMaterial } from 'three';
import Target from '../target/Target';

export const MapRenderer: React.FC = () => {
  // 加载地面纹理
  const groundTexture = useLoader(TextureLoader, '/textures/大地图.png');
  groundTexture.wrapS = groundTexture.wrapT = RepeatWrapping;
  groundTexture.repeat.set(1, 1);
  
  // 加载草纹理
  const grassTexture = useLoader(TextureLoader, '/textures/草1.png');
  grassTexture.transparent = true;

  return (
    <group>
      {/* 地面 */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial map={groundTexture} />
      </mesh>
      
      {/* 草丛 */}
      <mesh position={[5, 1, 0]}>
        <planeGeometry args={[2, 2]} />
        <meshStandardMaterial map={grassTexture} transparent={true} side={2} />
      </mesh>
      
      <mesh position={[-5, 1, 0]}>
        <planeGeometry args={[2, 2]} />
        <meshStandardMaterial map={grassTexture} transparent={true} side={2} />
      </mesh>
      
      <mesh position={[0, 1, 5]}>
        <planeGeometry args={[2, 2]} />
        <meshStandardMaterial map={grassTexture} transparent={true} side={2} />
      </mesh>
      
      <mesh position={[0, 1, -5]}>
        <planeGeometry args={[2, 2]} />
        <meshStandardMaterial map={grassTexture} transparent={true} side={2} />
      </mesh>
      
      {/* 靶子 */}
      <Target position={{ x: 20, y: 2, z: 0 }} rotation={{ x: 0, y: -Math.PI / 2, z: 0 }} />
      <Target position={{ x: -20, y: 2, z: 0 }} rotation={{ x: 0, y: Math.PI / 2, z: 0 }} />
      <Target position={{ x: 0, y: 2, z: 20 }} rotation={{ x: 0, y: Math.PI, z: 0 }} />
      <Target position={{ x: 0, y: 2, z: -20 }} rotation={{ x: 0, y: 0, z: 0 }} />
    </group>
  );
};
