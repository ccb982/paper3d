import { OrbitControls, Effects } from '@react-three/drei';
import { Bloom } from '@react-three/postprocessing';
import { ReinhardToneMapping, Color } from 'three';
import type { RayData } from '../shooting/interfaces/IShootingSystem';
import { MultiRayVisualizer } from '../../components/MultiRayVisualizer';
import { ShootDirectionVisualizer } from '../../components/ShootDirectionVisualizer';

interface SceneSetupProps {
  rayData?: RayData[];
  shootDirection?: { x: number; y: number; z: number } | null;
  characterPosition?: { x: number; y: number; z: number };
}

export const SceneSetup = ({ rayData, shootDirection, characterPosition }: SceneSetupProps) => {
  return (
    <>
      {/* 设置场景背景为蓝白色，模拟白天效果 */}
      <color args={['#87CEEB']} attach="background" />

      {/* 环境光：强度 0.4，提供柔和的基础照明 */}
      <ambientLight intensity={0.4} color="#f5f5f5" />

      {/* 方向光（太阳光）：增强自然光效果 */}
      <directionalLight
        position={[10, 15, 5]}
        intensity={0.3}
        color="#ffffff"
      />

      {/* 背光补光：增强立体感 */}
      <directionalLight
        position={[-5, 5, -5]}
        intensity={0.15}
        color="#a8cfff"
      />

      {/* 轨道控制（允许拖拽旋转视角） */}
      <OrbitControls
        enableDamping={true}
        dampingFactor={0.1}
        target={[0, 2, 0]}
      />

      {/* 后处理效果：色调映射 */}
      <Effects
        toneMapping={ReinhardToneMapping}
        toneMappingExposure={0.9}
      />

      {/* 模糊效果：为亮部区域添加柔和的模糊 */}
      <Bloom
        intensity={0.3}
        threshold={0.5}
        blur={2}
      />

      {/* 锁定式射线可视化 */}
      {rayData && rayData.length > 0 && (
        <MultiRayVisualizer rayData={rayData} color={0x00ffff} length={100} />
      )}

      {/* 射击方向可视化 */}
      {shootDirection && characterPosition && (
        <ShootDirectionVisualizer
          origin={{
            x: characterPosition.x,
            y: characterPosition.y + 1.2,
            z: characterPosition.z
          }}
          direction={shootDirection}
          color={0xff0000}
          length={10}
        />
      )}
    </>
  );
};