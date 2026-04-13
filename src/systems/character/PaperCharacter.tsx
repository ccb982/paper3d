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
      const { position: charPos } = useGameStore.getState().character;
      meshRef.current.position.set(charPos.x, charPos.y, charPos.z);

      // 1. 获取相机位置和角色位置
      const cameraPos = camera.position.clone();
      const characterPos = meshRef.current.position.clone();

      // 2. 计算从角色指向相机的水平方向（忽略Y轴）
      const toCamera = new THREE.Vector3().subVectors(cameraPos, characterPos);
      toCamera.y = 0;               // 只取水平方向
      toCamera.normalize();

      // 3. 角色背面朝向相机 → 角色的正面方向 = 相机方向的相反数
      const targetDirection = toCamera.clone().negate();

      // 4. 计算目标旋转（只绕Y轴）
      const targetQuat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),   // 角色默认正面是 +Z
        targetDirection
      );

      // 5. 平滑旋转
      const rotationSpeed = 8.0;      // 弧度/秒
      meshRef.current.quaternion.rotateTowards(targetQuat, rotationSpeed * delta);
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