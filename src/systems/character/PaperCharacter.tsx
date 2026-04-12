import { useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import { TextureLoader, DoubleSide } from 'three';
import { FIXED_Y } from '../../utils/constants';

interface PaperCharacterProps {
  characterId: string;
  onClick: (id: string) => void;
}

export const PaperCharacter = ({ characterId, onClick }: PaperCharacterProps) => {
  const meshRef = useRef<any>(null);
  
  // 使用 useLoader 加载纹理
  const texture = useLoader(TextureLoader, '/textures/character.png');

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