import React, { useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { PlaneGeometry, MeshStandardMaterial, Color, TextureLoader, RepeatWrapping, Vector3, BufferAttribute } from 'three';
import { generateTerrain } from './TerrainGenerator';
import Target from '../target/Target';

interface TerrainParams {
  width: number;
  depth: number;
  segments: number;
  seed?: number;
  heightScale: number;
  noiseScale: number;
  octaves?: number;
}

interface TerrainRendererProps {
  params: TerrainParams;
  characterPosition?: { x: number; y: number; z: number };
  onTerrainReady?: (getHeightAt: (x: number, z: number) => number) => void;
}

export const TerrainRenderer: React.FC<TerrainRendererProps> = ({ params, characterPosition, onTerrainReady }) => {
  const meshRef = useRef<any>(null);
  
  // 加载地面纹理
  const groundTexture = useLoader(TextureLoader, '/textures/大地图.png');
  groundTexture.wrapS = groundTexture.wrapT = RepeatWrapping;
  groundTexture.repeat.set(10, 10); // 每10单位重复一次纹理
  
  const terrainData = useMemo(() => {
    const data = generateTerrain(params);
    return data;
  }, [params]);
  
  // 使用 useLayoutEffect 来调用 onTerrainReady 回调，确保在渲染前同步执行
  useLayoutEffect(() => {
    if (onTerrainReady) {
      onTerrainReady(terrainData.getHeightAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainData]);
  
  const geometry = useMemo(() => {
    const geo = new PlaneGeometry(
      params.width,
      params.depth,
      params.segments,
      params.segments
    );
    
    const positions = geo.attributes.position.array as Float32Array;
    
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const worldZ = -positions[i + 1]; // 平面的 y 坐标旋转后变成世界的 -z 坐标
      positions[i + 2] = terrainData.getHeightAt(x, worldZ); // 设置地形高度
    }
    
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    
    // 添加颜色属性
    const colors = new Float32Array(positions.length);
    geo.setAttribute('color', new BufferAttribute(colors, 3, true));
    
    return geo;
  }, [terrainData, params]);
  
  const material = useMemo(() => {
    return new MeshStandardMaterial({
      map: groundTexture,
      roughness: 0.6,
      metalness: 0.1,
      flatShading: false,
      side: 2,
      vertexColors: true
    });
  }, [groundTexture]);
  
  // 更新地形颜色的函数
  const updateTerrainColors = () => {
    if (!characterPosition || !meshRef.current) return;
    
    const geo = meshRef.current.geometry;
    if (!geo || !geo.attributes.position || !geo.attributes.color) return;
    
    const positions = geo.attributes.position.array as Float32Array;
    const colors = geo.attributes.color.array as Float32Array;
    
    const characterY = characterPosition.y;
    const characterX = characterPosition.x;
    const characterZ = characterPosition.z;
    
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      
      const deltaY = y - characterY;
      const distance = Math.sqrt(Math.pow(x - characterX, 2) + Math.pow(z - characterZ, 2));
      
      let intensity: number;
      
      // 基础亮度计算（基于高度差）
      if (deltaY < -2.0) intensity = 1.0;
      else if (deltaY < -0.5) intensity = 3.0;
      else if (deltaY < 2.0) intensity = 5.0;
      else intensity = 5.8;
      
      // 远处地形亮度调整：远处的暗部调整为较暗
      if (distance > 30 && intensity < 3.0) {
        intensity = 3.0; // 远处的暗部调整为较暗
      }
      
      // 角色周围20格内的暗部区域提高亮度
      if (distance <= 20 && intensity < 2.0) {
        intensity = 2.0; // 角色周围的暗部调整为较暗
      }
      
      // 设置颜色（灰度）
      colors[i] = intensity;
      colors[i + 1] = intensity;
      colors[i + 2] = intensity;
    }
    
    geo.attributes.color.needsUpdate = true;
  };
  
  // 当角色位置变化时更新地形颜色
  useEffect(() => {
    updateTerrainColors();
  }, [characterPosition]);
  
  // 每帧更新地形颜色
  useFrame(() => {
    updateTerrainColors();
  });
  
  const targets = useMemo(() => {
    const targetPositions = [
      { x: 20, z: 0 },
      { x: -20, z: 0 },
      { x: 0, z: 20 },
      { x: 0, z: -20 }
    ];
    
    return targetPositions.map((pos, index) => {
      const height = terrainData.getHeightAt(pos.x, pos.z);
      const rotations = [
        { x: 0, y: -Math.PI / 2, z: 0 },
        { x: 0, y: Math.PI / 2, z: 0 },
        { x: 0, y: Math.PI, z: 0 },
        { x: 0, y: 0, z: 0 }
      ];
      
      return {
        position: { x: pos.x, y: height + 2, z: pos.z },
        rotation: rotations[index]
      };
    });
  }, [terrainData]);
  
  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        castShadow
        receiveShadow
      />
      
      {targets.map((target, index) => (
        <Target 
          key={index}
          position={target.position}
          rotation={target.rotation}
        />
      ))}
    </group>
  );
};
