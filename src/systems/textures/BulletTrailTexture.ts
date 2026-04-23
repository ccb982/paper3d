import * as THREE from 'three';
import { CanvasTextureGenerator } from './CanvasTextureGenerator';
import { TextureManager } from './TextureManager';

const rawPoints: [number, number][] = [
  [761.9299065420561, 438.68691588785043],
  [754.233644859813, 469.4719626168224],
  [743.9719626168223, 510.51869158878503],
  [743.9719626168223, 554.1308411214953],
  [743.9719626168223, 587.481308411215],
  [726.0140186915887, 620.8317757009345],
  [723.4485981308411, 664.4439252336448],
  [738.841121495327, 702.9252336448598],
  [754.233644859813, 736.2757009345794],
  [749.1028037383177, 690.0981308411215],
  [746.5373831775701, 656.7476635514018],
  [754.233644859813, 625.9626168224298],
  [777.322429906542, 602.8738317757009],
  [769.626168224299, 646.4859813084112],
  [774.7570093457944, 677.2710280373832],
  [774.7570093457944, 718.3177570093458],
  [764.4953271028037, 751.6682242990654],
  [743.9719626168223, 769.626168224299],
  [738.841121495327, 795.2803738317757],
  [746.5373831775701, 831.196261682243],
  [728.5794392523364, 869.6775700934579],
  [733.7102803738318, 905.5934579439252],
  [761.9299065420561, 946.6401869158877],
  [767.0607476635513, 985.1214953271027],
  [782.4532710280373, 1000.5140186915887],
  [802.9766355140187, 1033.8644859813082],
  [787.5841121495326, 1067.214953271028],
  [795.2803738317757, 1100.5654205607475],
  [787.5841121495326, 1162.1355140186915],
  [820.9345794392523, 1146.7429906542056],
  [826.0654205607476, 1103.1308411214952],
  [831.196261682243, 1056.9532710280373],
  [844.0233644859812, 1013.341121495327],
  [841.4579439252336, 967.1635514018691],
  [808.107476635514, 923.5514018691588],
  [790.1495327102804, 897.8971962616822],
  [795.2803738317757, 849.1542056074766],
  [810.6728971962616, 808.107476635514],
  [810.6728971962616, 767.0607476635513],
  [813.2383177570093, 726.0140186915887],
  [808.107476635514, 679.8364485981308],
  [805.5420560747663, 631.0934579439252],
  [826.0654205607476, 584.9158878504672],
  [859.4158878504672, 610.5700934579439],
  [877.3738317757009, 633.6588785046729],
  [892.7663551401869, 664.4439252336448],
  [890.2009345794391, 692.6635514018691],
  [879.9392523364486, 726.0140186915887],
  [877.3738317757009, 759.3644859813083],
  [877.3738317757009, 800.4112149532709],
  [877.3738317757009, 849.1542056074766],
  [885.0700934579438, 910.7242990654205],
  [908.1588785046729, 946.6401869158877],
  [933.8130841121495, 977.4252336448598],
  [923.5514018691588, 1013.341121495327],
  [908.1588785046729, 1051.822429906542],
  [908.1588785046729, 1080.0420560747664],
  [926.1168224299065, 1126.2196261682243],
  [938.9439252336448, 1146.7429906542056],
  [959.4672897196261, 1167.2663551401868],
  [951.7710280373831, 1131.3504672897195],
  [946.6401869158877, 1090.3037383177568],
  [959.4672897196261, 1054.3878504672896],
  [974.859813084112, 1013.341121495327],
  [990.252336448598, 982.5560747663551],
  [982.5560747663551, 931.2476635514018],
  [964.5981308411215, 879.9392523364486],
  [946.6401869158877, 856.8504672897195],
  [928.6822429906541, 846.588785046729],
  [938.9439252336448, 808.107476635514],
  [959.4672897196261, 764.4953271028037],
  [956.9018691588784, 718.3177570093458],
  [954.3364485981308, 664.4439252336448],
  [949.2056074766355, 628.5280373831775],
  [941.5093457943925, 584.9158878504672],
  [926.1168224299065, 536.1728971962616],
  [923.5514018691588, 507.95327102803736],
  [918.4205607476634, 474.60280373831773],
  [910.7242990654205, 428.42523364485976],
  [877.3738317757009, 389.94392523364485],
  [841.4579439252336, 377.1168224299065],
  [808.107476635514, 387.3785046728972],
  [774.7570093457944, 405.3364485981308],
];

function normalizePoints(points: [number, number][]): [number, number][] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  points.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  });
  
  const width = maxX - minX;
  const height = maxY - minY;
  
  return points.map(([x, y]) => [
    (x - minX) / width,
    (y - minY) / height
  ]);
}

const normalizedPoints = normalizePoints(rawPoints);

export function createBulletTrailTexture(textureManager: TextureManager, width: number = 512, height: number = 512): void {
  
  const generator = new CanvasTextureGenerator(width, height, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    
    // 绘制填充区域
    ctx.beginPath();
    const firstPoint = normalizedPoints[0];
    ctx.moveTo(firstPoint[0] * w, (1 - firstPoint[1]) * h);
    
    for (let i = 1; i < normalizedPoints.length; i++) {
      const [x, y] = normalizedPoints[i];
      ctx.lineTo(x * w, (1 - y) * h);
    }
    
    ctx.closePath();
    
    // 创建渐变效果：上半部分保持原样，下半部分使用#a31827基色，中间添加过渡，最底部添加#fe7a91
    const gradient = ctx.createLinearGradient(w * 0.5, 0, w * 0.5, h);
    gradient.addColorStop(0, 'rgba(1, 1, 3, 1)'); // 头部（末尾）：接近黑色
    gradient.addColorStop(0.5, 'rgba(20, 25, 40, 1)'); // 上半部分结束
    gradient.addColorStop(0.55, 'rgba(60, 25, 40, 1)'); // 过渡开始
    gradient.addColorStop(0.6, 'rgba(127, 24, 39, 1)'); // 过渡中
    gradient.addColorStop(0.65, 'rgba(163, 27, 43, 1)'); // 过渡继续
    gradient.addColorStop(0.7, 'rgba(200, 30, 48, 1)'); // 下半部分开始（更亮的#a31827）
    gradient.addColorStop(0.95, 'rgba(200, 30, 48, 1)'); // 下半部分
    gradient.addColorStop(1, 'rgba(254, 122, 145, 1)'); // 最底部：#fe7a91
    
    ctx.fillStyle = gradient;
    ctx.fill();
    
    // 添加更强的噪点效果
    ctx.save();
    ctx.clip(); // 只在路径内绘制噪点
    
    for (let i = 0; i < w * h * 0.05; i++) { // 5% 的像素点，增加噪点数量
      const x = Math.random() * w;
      const y = Math.random() * h;
      const normalizedY = y / h; // 归一化Y坐标，0是头部，1是尾部
      
      let r, g, b;
      
      // 根据Y坐标选择不同的颜色范围
      if (normalizedY < 0.5) {
        // 上半部分：蓝色到紫色
        const t = Math.random();
        r = Math.floor(10 + t * 30); // 10-40
        g = Math.floor(15 + t * 10); // 15-25
        b = Math.floor(25 + t * 35); // 25-60
      } else {
        // 下半部分：检查是否在圆形区域内
        const circleCenterX = w * 0.5;
        const circleCenterY = h * 0.9;
        const circleRadius = Math.min(w, h) * 0.25;
        const dist = Math.sqrt((x - circleCenterX) ** 2 + (y - circleCenterY) ** 2);
        
        // 检查是否在最底部区域（0.95-1.0）
        const isBottomArea = normalizedY > 0.95;
        
        if (dist < circleRadius && !isBottomArea) {
          // 圆形区域内：#fe3362附近，颜色有随机变化（更亮）
          const t = Math.random();
          r = Math.floor(230 + t * 25); // 230-255
          g = Math.floor(60 + t * 50); // 60-110
          b = Math.floor(90 + t * 50); // 90-140
        } else if (isBottomArea) {
          // 最底部区域：#fe7a91附近
          const t = Math.random();
          r = Math.floor(220 + t * 35); // 220-255
          g = Math.floor(100 + t * 60); // 100-160
          b = Math.floor(130 + t * 60); // 130-190
        } else {
          // 下半部分其他区域：更亮的#a31827附近
          const t = Math.random();
          r = Math.floor(150 + t * 100); // 150-250
          g = Math.floor(20 + t * 30); // 20-50
          b = Math.floor(40 + t * 30); // 40-70
        }
      }
      
      const brightness = 0.5 + Math.random() * 1.5; // 0.5-2.0 的亮度，增加随机性
      const alpha = 0.4 + Math.random() * 0.6; // 0.4-1.0 的透明度
      
      ctx.fillStyle = `rgba(${Math.min(255, Math.floor(r * brightness))}, ${Math.min(255, Math.floor(g * brightness))}, ${Math.min(255, Math.floor(b * brightness))}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2); // 增大噪点大小
      ctx.fill();
    }
    
    ctx.restore();
    
    // 绘制边框以确保边缘清晰
    ctx.strokeStyle = 'rgba(40, 20, 60, 1)'; // 紫色边框
    ctx.lineWidth = 2;
    ctx.stroke();
  });
  
  textureManager.register('bullet-trail', generator);
}

export { normalizedPoints as bulletTrailPoints };

export function createBulletTrailGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  
  const vertices = [];
  const uvs = [];
  const layerIndices = []; // 用于区分不同层
  
  const layerOffset = 0.1; // 两层之间的距离
  
  // 创建两层尾气（厚度为0，平面结构）
  for (let layer = 0; layer < 2; layer++) {
    const zOffset = layer * layerOffset;
    
    // 使用原始的三角形拼接几何体
    // 从中心点到每个顶点创建三角形
    for (let i = 1; i < normalizedPoints.length - 1; i++) {
      const center = normalizedPoints[0];
      const current = normalizedPoints[i];
      const next = normalizedPoints[i + 1];
      
      // 三角形 - 将原本的 Y 轴映射到 Z 轴，但反转Z坐标
      // 原始数据中第一个点（尾部）的Y最小，映射到Z=1
      // 最后一个点（头部）的Y最大，映射到Z=0
      // 这样Z=0是头部，Z=1是尾部，与着色器定义一致
    vertices.push(
      center[0], 0, 1.0 - center[1] + zOffset,  // X 不变，Y 设为 0（平面），Z 使用 1.0 - 原 Y
      current[0], 0, 1.0 - current[1] + zOffset,
      next[0], 0, 1.0 - next[1] + zOffset
    );
      
      // UVs
      uvs.push(
        center[0], center[1],
        current[0], current[1],
        next[0], next[1]
      );
      
      // 层索引（1个三角形 × 3个顶点 = 3个顶点）
      for (let j = 0; j < 3; j++) {
        layerIndices.push(layer);
      }
    }
  }
  
  const vertexBuffer = new Float32Array(vertices);
  geometry.setAttribute('position', new THREE.BufferAttribute(vertexBuffer, 3));
  
  const uvBuffer = new Float32Array(uvs);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvBuffer, 2));
  
  // 添加层索引属性
  const layerBuffer = new Float32Array(layerIndices);
  geometry.setAttribute('layer', new THREE.BufferAttribute(layerBuffer, 1));
  
  geometry.computeVertexNormals();
  
  return geometry;
}

export function createBulletTrailMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  
  const vertexShader = `
    uniform float uTime;
    uniform float uWobbleIntensity;
    uniform float uWobbleSpeed;
    varying vec2 vUv;
    attribute float layer;
    
    void main() {
      vUv = uv;
      vec3 pos = position;
      
      // 头部固定，尾部摆动
      // position.z 范围是 0 到 1，0 是头部，1 是尾部
      float tailFactor = position.z;
      // 使用二次函数使尾部摆动幅度更大
      float wobbleAmplitude = tailFactor * tailFactor * uWobbleIntensity * 2.0;
      
      // 根据层索引创建不同的摆动效果
      if (layer == 0.0) {
        // 第一层：快速小幅摆动
        // X轴摆动
        float wobbleX = sin(uTime * uWobbleSpeed * 1.5 + position.z * 12.0) * wobbleAmplitude * 0.8;
        wobbleX += sin(uTime * uWobbleSpeed * 2.0 + position.z * 18.0) * wobbleAmplitude * 0.4;
        
        // Y轴摆动（立体效果）
        float wobbleY = cos(uTime * uWobbleSpeed * 1.2 + position.z * 10.0) * wobbleAmplitude * 0.6;
        wobbleY += cos(uTime * uWobbleSpeed * 1.6 + position.z * 14.0) * wobbleAmplitude * 0.3;
        
        pos.x += wobbleX;
        pos.y += wobbleY;
      } else {
        // 第二层：慢速大幅摆动
        // X轴摆动
        float wobbleX = sin(uTime * uWobbleSpeed * 0.8 + position.z * 8.0) * wobbleAmplitude * 1.2;
        wobbleX += sin(uTime * uWobbleSpeed * 1.0 + position.z * 12.0) * wobbleAmplitude * 0.6;
        
        // Y轴摆动（立体效果）
        float wobbleY = cos(uTime * uWobbleSpeed * 0.6 + position.z * 6.0) * wobbleAmplitude * 1.0;
        wobbleY += cos(uTime * uWobbleSpeed * 0.8 + position.z * 10.0) * wobbleAmplitude * 0.5;
        
        pos.x += wobbleX;
        pos.y += wobbleY;
      }
      
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;
  
  const fragmentShader = `
    uniform sampler2D uTexture;
    uniform float uTime;
    varying vec2 vUv;
    
    void main() {
      vec4 texColor = texture2D(uTexture, vUv);
      
      // 确保完全透明的区域被正确处理
      if (texColor.a < 0.1) {
        discard;
      }
      
      gl_FragColor = texColor;
    }
  `;
  
  return new THREE.ShaderMaterial({
    uniforms: {
      uTexture: { value: texture },
      uTime: { value: 0 },
      uWobbleIntensity: { value: 0.1 },
      uWobbleSpeed: { value: 4.0 }
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    side: THREE.DoubleSide
  });
}
