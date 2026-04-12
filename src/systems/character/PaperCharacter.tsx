import { useRef, useEffect } from 'react';
import { useLoader, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TextureLoader, DoubleSide } from 'three';
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
  useFrame((_, delta) => {
    if (meshRef.current) {
      const { position, isMoving } = useGameStore.getState().character;
      
      // 更新位置
      meshRef.current.position.set(position.x, position.y, position.z);
      
      // 当角色在移动时，让角色平滑面向相机的方向向量
      if (isMoving) {
        // 获取相机的方向向量
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        
        // 计算目标旋转四元数（面向相机的方向向量）
        const targetQuat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1), // 假设角色默认正面是 +Z
          cameraDirection
        );
        
        // 平滑插值，rotationSpeed 控制转速（弧度/秒）
        const rotationSpeed = 8.0; // 每秒转 8 弧度，约 460 度/秒，可调
        meshRef.current.quaternion.rotateTowards(targetQuat, rotationSpeed * delta);
        
        // 保持直立
        meshRef.current.rotation.x = 0;
        meshRef.current.rotation.z = 0;
      }
    }
  });

  return (
    <mesh 
      ref={meshRef} 
      position={[0, 1.5, 0]}
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