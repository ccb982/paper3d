import { useRef, useEffect, useState } from 'react';
import { useLoader, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TextureLoader, DoubleSide, MeshBasicMaterial } from 'three';
import { characterPositionStore } from './CharacterPositionStore';
import { PaperAnimator } from '../../core/PaperAnimator';
import { AnimationLoader } from '../../core/AnimationLoader';
import { AnimationClip } from '../../core/AnimationClip';

interface PaperCharacterProps {
  characterId: string;
  onClick: (id: string) => void;
}

export const PaperCharacter = ({ characterId, onClick }: PaperCharacterProps) => {
  const meshRef = useRef<any>(null);
  const materialRef = useRef<MeshBasicMaterial | null>(null);
  const animatorRef = useRef<PaperAnimator | null>(null);
  const { camera } = useThree();
  const [isLoaded, setIsLoaded] = useState(false);
  const [manualAnimation, setManualAnimation] = useState<'front' | 'back' | null>(null);
  const [keysPressed, setKeysPressed] = useState<Set<string>>(new Set());

  // 初始化动画系统
  useEffect(() => {
    const loadAnimations = async () => {
      try {
        // 创建材质
        const material = new MeshBasicMaterial({
          color: 0xcccccc,
          transparent: true,
          opacity: 0.8,
          side: DoubleSide
        });
        materialRef.current = material;

        // 创建动画器
        const animator = new PaperAnimator(material);
        animatorRef.current = animator;

        // 加载动画
        const { frontClip, backClip } = await AnimationLoader.loadPaperAnimations(
          '/textures/characters/player',
          2,   // 正面帧数
          3,   // 背面帧数
          12   // 帧率
        );
        animator.setFrontClip(frontClip);
        animator.setBackClip(backClip);

        setIsLoaded(true);
      } catch (error) {
        console.warn('Failed to load animations for paper character:', error);
        setIsLoaded(true); // 即使加载失败也继续显示
      }
    };

    loadAnimations();
  }, []);

  // 键盘事件监听
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      setKeysPressed(prev => {
        const newSet = new Set(prev);
        newSet.add(event.key.toLowerCase());
        return newSet;
      });
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      setKeysPressed(prev => {
        const newSet = new Set(prev);
        newSet.delete(event.key.toLowerCase());
        return newSet;
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // 每帧更新角色位置、朝向和动画
  useFrame((_, delta) => {
    if (meshRef.current) {
      const charPos = characterPositionStore.position;
      meshRef.current.position.copy(charPos);

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
      // 归一化四元数，避免精度问题导致旋转停止
      meshRef.current.quaternion.normalize();

      // 6. 处理按键控制动画
      let animationMode: 'front' | 'back' | null = null;
      if (keysPressed.has('w')) {
        animationMode = 'front'; // 按W键播放正面动画
      } else if (keysPressed.has('s')) {
        animationMode = 'back'; // 按S键播放后背动画
      }

      // 7. 更新动画
      if (animatorRef.current) {
        if (animationMode) {
          // 手动控制动画方向
          // 这里需要修改 PaperAnimator 以支持手动设置动画方向
          // 暂时使用相机位置模拟
          if (animationMode === 'back') {
            // 模拟相机在角色前方，显示后背动画
            const frontCameraPos = characterPos.clone().add(new THREE.Vector3(0, 0, 10));
            animatorRef.current.updateDirection(characterPos, frontCameraPos);
          } else {
            // 模拟相机在角色后方，显示正面动画
            const backCameraPos = characterPos.clone().add(new THREE.Vector3(0, 0, -10));
            animatorRef.current.updateDirection(characterPos, backCameraPos);
          }
        } else {
          // 默认根据相机位置自动切换动画
          animatorRef.current.updateDirection(characterPos, cameraPos);
        }
        animatorRef.current.update(delta);
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
      {materialRef.current && (
        <meshBasicMaterial
          attach="material"
          transparent={true}
          opacity={0.8}
          side={DoubleSide}
          map={materialRef.current.map}
        />
      )}
    </mesh>
  );
};