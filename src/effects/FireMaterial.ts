import * as THREE from 'three';

export function createFireMaterial(color1?: THREE.Color, color2?: THREE.Color): THREE.ShaderMaterial {
  const vertexShader = `
    uniform float uTime;
    varying float vAlpha;
    varying vec2 vUv;

    void main() {
      vUv = uv;
      vec3 pos = position;
      
      // 火焰摇曳：Y 轴向上时，X 和 Z 的偏移随 Y 增大而增大（火苗顶部摆动更明显）
      float swayX = sin(uTime * 8.0 + pos.y * 10.0) * 0.05;
      float swayZ = cos(uTime * 7.0 + pos.y * 12.0) * 0.05;
      pos.x += swayX * (pos.y + 0.5);
      pos.z += swayZ * (pos.y + 0.5);
      
      // 纵向伸缩（火苗跳动）
      float stretch = 1.0 + sin(uTime * 15.0 + pos.y * 15.0) * 0.08;
      pos.y *= stretch;
      
      // 底部稍微收缩，使火焰根部更细
      pos.x *= (0.8 + pos.y * 0.4);
      pos.z *= (0.8 + pos.y * 0.4);
      
      vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
      gl_PointSize = 1.0;
      gl_Position = projectionMatrix * mvPosition;
      
      // 透明度随 Y 轴升高而降低（顶部透明），但整体更不透明
      vAlpha = 1.0 - smoothstep(0.1, 0.8, pos.y);
    }
  `;

  const fragmentShader = `
    uniform float uTime;
    uniform vec3 uColorBottom;
    uniform vec3 uColorTop;
    varying float vAlpha;
    varying vec2 vUv;
    
    void main() {
      // 基于 UV 的 V 坐标（从底到顶）进行颜色插值
      float t = vUv.y;
      // 添加火焰脉动：整体亮度随时间波动
      float pulse = 0.8 + 0.3 * sin(uTime * 12.0);
      vec3 color = mix(uColorBottom, uColorTop, t);
      color *= pulse;
      
      // 边缘羽化（基于 UV 的 U 坐标，中心亮边缘暗）
      float edge = 1.0 - abs(vUv.x - 0.5) * 1.5;
      // 不透明度100%，像子弹一样
      float alpha = 1.0;
      gl_FragColor = vec4(color, alpha);
    }
  `;

  const defaultBottom = color1 || new THREE.Color(0xff4422);
  const defaultTop = color2 || new THREE.Color(0xffaa33);

  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorBottom: { value: defaultBottom },
      uColorTop: { value: defaultTop },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide,   // 双面渲染，让火焰有体积感
    blending: THREE.AdditiveBlending, // 加法混合，增强光感
    depthWrite: false,
  });
}
