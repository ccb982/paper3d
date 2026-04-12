import { OrbitControls } from '@react-three/drei';
import { GridHelper } from 'three';

export const SceneSetup = () => {
  return (
    <>
      {/* 环境光 */}
      <ambientLight intensity={0.6} />
      {/* 定向光（模拟太阳光） */}
      <directionalLight position={[5, 10, 5]} intensity={0.8} />
      {/* 辅助网格（地面参考） */}
      <gridHelper args={[20, 20]} />
      {/* 轨道控制（允许拖拽旋转视角） */}
      <OrbitControls 
        enableDamping={true} 
        dampingFactor={0.1}
        target={[0, 2, 0]} // 设置目标点为角色头部位置（Y轴3的位置）
      />
    </>
  );
};