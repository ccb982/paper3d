import * as THREE from 'three';

// 银河粒子生成器
export function generateGalaxyParticles(
  particleCount: number,
  arms: number = 3,            // 旋臂数量
  innerRadius: number = 0.5,
  outerRadius: number = 8,
  armSpread: number = 0.4,     // 旋臂的宽度（角度偏移范围）
  armTightness: number = 3,    // 螺旋紧密程度（对数螺旋的系数）
  heightRange: number = 1.2,   // 垂直方向范围
  baseColor?: THREE.Color      // 基础颜色
): { positions: Float32Array; colors: Float32Array; sizes: Float32Array } {
  const positions = new Float32Array(particleCount * 3);
  const colors = new Float32Array(particleCount * 3);
  const sizes = new Float32Array(particleCount);

  // 颜色映射函数：半径比例 -> 颜色 (HSL)
  const getColor = (r: number) => {
    if (baseColor) {
      // 使用指定的基础颜色，只调整亮度
      const t = (r - innerRadius) / (outerRadius - innerRadius);
      const hsl = baseColor.getHSL({});
      // 亮度：内圈亮，外圈暗
      const lightness = 0.6 + (1 - t) * 0.2;
      return new THREE.Color().setHSL(hsl.h, hsl.s, lightness);
    } else {
      // r 范围 innerRadius -> outerRadius，映射到 0..1
      const t = (r - innerRadius) / (outerRadius - innerRadius);
      // 色相：从 0.12 (橙黄) 到 0.6 (蓝紫)
      const hue = 0.12 + t * 0.48;
      // 饱和度：内圈高，外圈稍低
      const saturation = 0.6 - t * 0.2;
      // 亮度：内圈适中，外圈更暗
      const lightness = 0.4 + (1 - t) * 0.2;
      return new THREE.Color().setHSL(hue, saturation, lightness);
    }
  };

  for (let i = 0; i < particleCount; i++) {
    // 决定粒子属于哪条旋臂（均匀分配）
    const armIdx = Math.floor(Math.random() * arms);
    const armAngleOffset = (armIdx / arms) * Math.PI * 2;

    // 半径：使用平方分布，让更多粒子在外围（模拟旋臂延伸）
    let r = innerRadius + (outerRadius - innerRadius) * Math.pow(Math.random(), 1.5);
    // 对数螺旋角度：theta = k * ln(r / a)
    // 简化：theta = armTightness * (r - innerRadius) / (outerRadius - innerRadius) * 2pi
    const baseAngle = armTightness * (r - innerRadius) / (outerRadius - innerRadius) * Math.PI * 2;
    // 添加旋臂宽度随机偏移（使旋臂有厚度）
    const armOffset = (Math.random() - 0.5) * armSpread * (1 - (r - innerRadius)/(outerRadius - innerRadius)) * 1.5;
    // 随机扰动，增加自然感
    const randomJitter = (Math.random() - 0.5) * 0.3;
    const angle = baseAngle + armAngleOffset + armOffset + randomJitter;

    // 计算坐标
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    // 高度随半径增加而略微增加，但整体扁平，再添加随机偏移
    const z = (Math.random() - 0.5) * heightRange * (1 - (r - innerRadius)/(outerRadius - innerRadius) * 0.5);

    positions[i*3] = x;
    positions[i*3+1] = y;
    positions[i*3+2] = z;

    // 颜色基于半径和旋臂位置微调
    const baseColor = getColor(r);
    // 根据旋臂偏移微调色相
    let hueShift = (armOffset * 0.5);
    const finalColor = new THREE.Color().setHSL(
      Math.min(0.8, Math.max(0.0, baseColor.getHSL({}).h + hueShift)),
      baseColor.getHSL({}).s,
      baseColor.getHSL({}).l
    );
    colors[i*3] = finalColor.r;
    colors[i*3+1] = finalColor.g;
    colors[i*3+2] = finalColor.b;

    // 大小：内圈粒子稍大，外圈稍小，旋臂上粒子略大
    let size = 0.08 + Math.random() * 0.1;
    if (Math.abs(armOffset) < 0.2) size += 0.03;
    sizes[i] = size;
  }

  return { positions, colors, sizes };
}

// 顶点着色器 (galaxyVertexShader)
export const galaxyVertexShader = `
uniform float uTime;
attribute float size;
attribute vec3 color;
varying vec3 vColor;

void main() {
    vColor = color;
    vec3 pos = position;
    // 微小脉动：让粒子沿径向轻微运动
    float pulse = sin(uTime * 2.0 + length(pos) * 5.0) * 0.02;
    pos += normalize(pos) * pulse;
    
    // 粒子围绕中心点自旋
    float spinSpeed = uTime * 0.5; // 增大自旋速度
    float distance = length(pos);
    float angle = atan(pos.y, pos.x) + spinSpeed;
    pos.x = cos(angle) * distance;
    pos.y = sin(angle) * distance;
    
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = size * ( 300.0 / ( - mvPosition.z ) );
    gl_Position = projectionMatrix * mvPosition;
}
`;

// 片元着色器 (galaxyFragmentShader)
export const galaxyFragmentShader = `
uniform float uTime;
varying vec3 vColor;

void main() {
    vec2 coord = gl_PointCoord;
    float dist = length(coord - 0.5);
    if (dist > 0.5) discard;
    // 高斯光晕效果
    float alpha = (1.0 - smoothstep(0.0, 0.5, dist)) * 0.7;
    // 中心稍微亮一点，边缘带颜色
    vec3 finalColor = vColor + vec3(0.2, 0.1, 0.05) * (1.0 - dist * 1.5);
    gl_FragColor = vec4(finalColor, alpha);
}
`;

// 创建银河效果
export function createGalaxyEffect(parent: THREE.Group, color?: THREE.Color): THREE.Points {
  const particleCount = 15000;  // 粒子数量，可调整
  const { positions, colors, sizes } = generateGalaxyParticles(
    particleCount, 4,          // 4条旋臂
    0.4, 4.0, 0.45, 3.2, 0.5,  // 缩小初始大小
    color
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: galaxyVertexShader,
    fragmentShader: galaxyFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const galaxyPoints = new THREE.Points(geometry, material);
  parent.add(galaxyPoints);
  
  return galaxyPoints;
}

// 创建银河背景光晕（雾状粒子）
export function createGlowEffect(parent: THREE.Group): THREE.Points {
  const count = 3000;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 5 + Math.random() * 4;
    const angle = Math.random() * Math.PI * 2;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    const z = (Math.random() - 0.5) * 2.5;
    positions[i*3] = x;
    positions[i*3+1] = y;
    positions[i*3+2] = z;
    const color = new THREE.Color().setHSL(0.6, 0.6, 0.3);
    colors[i*3] = color.r;
    colors[i*3+1] = color.g;
    colors[i*3+2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ color: 0x8866ff, size: 0.005, transparent: true, opacity: 1, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geometry, material);
  parent.add(points);
  
  return points;
}

// 更新银河效果
export function updateGalaxyEffect(galaxyPoints: THREE.Points, elapsedTime: number): void {
  if (galaxyPoints && galaxyPoints.material instanceof THREE.ShaderMaterial) {
    galaxyPoints.material.uniforms.uTime.value = elapsedTime;
    // 不再自转，保持固定的y轴方向
  }
}
