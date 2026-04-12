import { useRef, useEffect } from 'react';
import { useLoader, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TextureLoader, DoubleSide } from 'three';
import { FIXED_Y } from '../../utils/constants';
import { useGameStore } from '../state/gameStore';

interface PaperCharacterProps {
  characterId: string;
  onClick: (id: string) => void;
}

export const PaperCharacter = ({ characterId, onClick }: PaperCharacterProps) => {
  const meshRef = useRef<any>(null);
  const { camera } = useThree();
  
  // 使用 useLoader 加载纹理
  const texture = useLoader(TextureLoader, '/textures/character.png');

  // 每帧更新角色位置和朝向
  useFrame(() => {
    if (meshRef.current) {
      const { position, isMoving } = useGameStore.getState().character;
      
      // 更新位置
      meshRef.current.position.set(position.x, FIXED_Y, position.z);
      
      // 当角色在移动时，让角色时时刻刻面向相机
      if (isMoving) {
        // 计算相机位置相对于角色的方向
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        
        // 让角色面向相机
        meshRef.current.lookAt(camera.position);
        
        // 修正旋转，确保角色保持直立
        meshRef.current.rotation.x = 0;
        meshRef.current.rotation.z = 0;
      }
    }
  });

  return (
    <mesh 
      ref={meshRef} 
      position={[0, FIXED_Y, 0]}
      userData={{ characterId }}
      onPointerDown={() => onClick(characterId)}
    >
      <planeGeometry args={[2, 3]} />
      <meshBasicMaterial 
        map={texture} 
        transparent={true} 
        opacity={0.8}
        side={DoubleSide} // 支持双面渲染，确保从任何角度都能看到
      />
    </mesh>
  );
};