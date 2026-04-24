import React, { useMemo, useRef, useEffect, useLayoutEffect, useState } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { PlaneGeometry, ShaderMaterial, Color, TextureLoader, RepeatWrapping, Vector3, BufferAttribute } from 'three';
import { generateTerrain } from './TerrainGenerator';

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
  
  // 涟漪效果的顶点着色器
  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vPosition;
    varying vec3 vNormal;
    void main() {
      vUv = uv;
      vPosition = position;
      vNormal = normal;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  
  // 涟漪效果的片元着色器
  const fragmentShader = `
    uniform float uTime;
    uniform sampler2D uGroundTexture;
    varying vec2 vUv;
    varying vec3 vPosition;
    varying vec3 vNormal;
    
    void main() {
      // 地面纹理采样
      vec4 groundColor = texture2D(uGroundTexture, vUv * 10.0);
      
      // 涟漪效果
      vec2 p = vUv - 0.5;
      float r = length(p);
      float angle = atan(p.y, p.x);
      
      // 只显示半径在 0.1 到 0.4 之间的环形区域
      float ripple = 0.0;
      if (r < 0.4 && r > 0.1) {
        // 定义多层环的参数
        int ringCount = 3;
        for (int i = 0; i < ringCount; i++) {
          float ringRadius = 0.15 + float(i) * 0.1;
          float ringWidth = 0.02;
          float radiusDiff = abs(r - ringRadius);
          if (radiusDiff < ringWidth) {
            // 环的弧段：起始角度随时间偏移
            float startAngle = uTime * 0.5 + float(i) * 1.2;
            float arcLength = 0.6;
            float endAngle = startAngle + arcLength;
            // 角度归一化
            float a = angle;
            if (a < 0.0) a += 6.28318;
            float start = mod(startAngle, 6.28318);
            float end = mod(endAngle, 6.28318);
            if ((start < end && a >= start && a <= end) || (start >= end && (a >= start || a <= end))) {
              ripple = 1.0;
              break;
            }
          }
        }
      }
      
      // 涟漪颜色
      vec3 rippleColor = vec3(0.3, 0.5, 0.9);
      float rippleAlpha = 0.8 * ripple;
      
      // 混合地面纹理和涟漪效果
      vec3 finalColor = mix(groundColor.rgb, rippleColor, rippleAlpha);
      
      // 基础光照计算
      vec3 lightDirection = normalize(vec3(1.0, 1.0, 0.5));
      float diffuse = max(dot(vNormal, lightDirection), 0.0);
      
      // 环境光
      vec3 ambient = vec3(0.4);
      
      // 计算最终颜色
      finalColor = finalColor * (ambient + diffuse);
      
      gl_FragColor = vec4(finalColor, 1.0);
    }
  `;
  
  // 材质状态
  const [material, setMaterial] = useState<ShaderMaterial>();
  
  // 创建材质
  useEffect(() => {
    const mat = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uGroundTexture: { value: groundTexture }
      },
      vertexShader,
      fragmentShader,
      side: 2,
      transparent: false
    });
    setMaterial(mat);
    return () => {
      mat.dispose();
    };
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
  
  // 每帧更新地形颜色和涟漪效果
  useFrame((_, delta) => {
    updateTerrainColors();
    // 更新涟漪效果的时间
    if (material) {
      material.uniforms.uTime.value += delta;
    }
  });
  
  return (
    <group>
      <mesh
        ref={meshRef}
        geometry={geometry}
        material={material}
        castShadow
        receiveShadow
      />
    </group>
  );
};
