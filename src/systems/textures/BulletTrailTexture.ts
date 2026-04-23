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
  
  const xMid = (minX + maxX) / 2;
  const xRange = maxX - minX || 1; // 防止除以零
  const yRange = maxY - minY || 1; // 防止除以零
  
  // 归一化：以X中点为原点，Y最高点为原点
  // X: (x - xMid) / xRange → 范围从 -0.5 到 0.5
  // Y: (y - maxY) / yRange → 范围从 -1 到 0
  return points.map(([x, y]) => [
    (x - xMid) / xRange,
    (y - maxY) / yRange
  ]);
}

const normalizedPoints = normalizePoints(rawPoints);

// 找到Y值最大的点作为中心点（Y值最大意味着在归一化后Y值最接近0）
function findMaxYPoint(points: [number, number][]): [number, number] {
  let maxYPoint = points[0];
  let maxY = points[0][1];
  
  for (const point of points) {
    if (point[1] > maxY) {
      maxY = point[1];
      maxYPoint = point;
    }
  }
  
  return maxYPoint;
}

const maxYPoint = findMaxYPoint(rawPoints);
const normalizedMaxYPoint = normalizePoints([maxYPoint])[0];

export function createBulletTrailTexture(textureManager: TextureManager, width: number = 512, height: number = 512): void {
  
  const generator = new CanvasTextureGenerator(width, height, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    
    // 绘制填充区域
    ctx.beginPath();
    const firstPoint = normalizedPoints[0];
    // 转换归一化坐标到画布坐标：X以中心为原点，Y以顶部为原点
    ctx.moveTo((firstPoint[0] + 0.5) * w, (-firstPoint[1]) * h);
    
    for (let i = 1; i < normalizedPoints.length; i++) {
      const [x, y] = normalizedPoints[i];
      ctx.lineTo((x + 0.5) * w, (-y) * h);
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
      if (normalizedY < 0.6) {
        // 上半部分：蓝色到紫色 - 不添加红色噪点
        const t = Math.random();
        r = Math.floor(10 + t * 30); // 10-40
        g = Math.floor(15 + t * 10); // 15-25
        b = Math.floor(25 + t * 35); // 25-60
      } else {
        // 下半部分（前40%）：红色有亮光的部分
        // 检查是否在最底部区域（0.95-1.0）
        const isBottomArea = normalizedY > 0.95;
        
        if (isBottomArea) {
          // 最底部区域（z=0）：黑色噪点
          const t = Math.random();
          r = Math.floor(0 + t * 30); // 0-30（接近黑色）
          g = Math.floor(0 + t * 20); // 0-20（接近黑色）
          b = Math.floor(0 + t * 30); // 0-30（接近黑色）
        } else {
          // 红色有亮光的部分：#fe0036附近
          const t = Math.random();
          r = Math.floor(230 + t * 25); // 230-255（接近#fe0036的红色）
          g = Math.floor(0 + t * 20); // 0-20（接近0）
          b = Math.floor(20 + t * 16); // 20-36（接近36）
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
  
  const layerOffset = 0; // 两层之间无距离，完全对齐
  const scaleFactor = 0.7; // 缩放因子，控制尾气大小（小于1时缩小）
  
  // 创建两层尾气（厚度为0，平面结构）
  for (let layer = 0; layer < 2; layer++) {
    const zOffset = layer * layerOffset;
    
    // 使用原始的三角形拼接几何体
    // 从Y值最大的点到每个顶点创建三角形
    for (let i = 1; i < normalizedPoints.length - 1; i++) {
      const center = normalizedMaxYPoint; // 使用Y值最大的点作为中心点
      const current = normalizedPoints[i];
      const next = normalizedPoints[i + 1];
      
      // 三角形 - 将Y轴映射到Z轴，但反转Z坐标
      // 归一化后：X范围 -0.5 到 0.5，Y范围 -1 到 0
      // 映射到3D空间：X保持不变，Y=0，Z=3 + Y（这样Z范围 2 到 3，0是尾部，1是头部，整体长度增加）
      // 这样子弹头（+Z方向）指向尾气头部（Z=3）
      const centerZ = 3 + center[1] + zOffset;
      const currentZ = 3 + current[1] + zOffset;
      const nextZ = 3 + next[1] + zOffset;
      
      // 确保没有NaN值
      if (!isNaN(center[0]) && !isNaN(centerZ) &&
          !isNaN(current[0]) && !isNaN(currentZ) &&
          !isNaN(next[0]) && !isNaN(nextZ)) {
        vertices.push(
          center[0] * scaleFactor, 0, centerZ,  // X 缩放，Y 设为 0（平面），Z = 1 + Y
          current[0] * scaleFactor, 0, currentZ,
          next[0] * scaleFactor, 0, nextZ
        );
        
        // UVs - 转换回0-1范围
        uvs.push(
          center[0] + 0.5, -center[1],
          current[0] + 0.5, -current[1],
          next[0] + 0.5, -next[1]
        );
        
        // 层索引（1个三角形 × 3个顶点 = 3个顶点）
        for (let j = 0; j < 3; j++) {
          layerIndices.push(layer);
        }
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
  
  // 计算法线，跳过computeBoundingSphere以避免NaN错误
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
    varying float vPositionZ;
    attribute float layer;
    
    void main() {
      vUv = uv;
      vPositionZ = position.z;
      vec3 pos = position;
      
      // 头部固定，尾部摆动
      // position.z 范围是 2 到 3，2 是尾部，3 是头部
      float normalizedZ = position.z - 2.0; // 归一化到0-1范围
      float tailFactor = 1.0 - normalizedZ;
      // 调整摆动幅度，减小底部的晃动
      // 使用更平缓的曲线，让底部摆动减小
      float wobbleAmplitude = pow(tailFactor, 3.0) * uWobbleIntensity * 1.5;
      
      // 根据层索引创建不同的摆动效果
      if (layer == 0.0) {
        // 第一层：快速小幅摆动
        // X轴摆动
        float wobbleX = sin(uTime * uWobbleSpeed * 1.5 + (1.0 - position.z) * 12.0) * wobbleAmplitude * 0.8;
        wobbleX += sin(uTime * uWobbleSpeed * 2.0 + (1.0 - position.z) * 18.0) * wobbleAmplitude * 0.4;
        
        // Y轴摆动（立体效果）
        float wobbleY = cos(uTime * uWobbleSpeed * 1.2 + (1.0 - position.z) * 10.0) * wobbleAmplitude * 0.6;
        wobbleY += cos(uTime * uWobbleSpeed * 1.6 + (1.0 - position.z) * 14.0) * wobbleAmplitude * 0.3;
        
        pos.x += wobbleX;
        pos.y += wobbleY;
      } else {
        // 第二层：慢速大幅摆动
        // X轴摆动
        float wobbleX = sin(uTime * uWobbleSpeed * 0.8 + (1.0 - position.z) * 8.0) * wobbleAmplitude * 1.2;
        wobbleX += sin(uTime * uWobbleSpeed * 1.0 + (1.0 - position.z) * 12.0) * wobbleAmplitude * 0.6;
        
        // Y轴摆动（立体效果）
        float wobbleY = cos(uTime * uWobbleSpeed * 0.6 + (1.0 - position.z) * 6.0) * wobbleAmplitude * 1.0;
        wobbleY += cos(uTime * uWobbleSpeed * 0.8 + (1.0 - position.z) * 10.0) * wobbleAmplitude * 0.5;
        
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
    varying float vPositionZ;
    
    void main() {
      vec4 texColor = texture2D(uTexture, vUv);
      
      // 确保完全透明的区域被正确处理
      if (texColor.a < 0.1) {
        discard;
      }
      
      // 为尾气前5%的部分添加发光效果，只在中心区域
      float normalizedZ = vPositionZ - 2.0; // 归一化到0-1范围
      if (normalizedZ > 0.95 && abs(vUv.x - 0.5) < 0.1) {
        float glowIntensity = (normalizedZ - 0.95) * 20.0; // 从0到1的强度
        // 中心区域强度更高，边缘逐渐减弱
        float widthIntensity = 1.0 - abs(vUv.x - 0.5) / 0.1;
        vec3 glowColor = vec3(0.8, 0.6, 0.8); // 粉色发光（降低亮度）
        texColor.rgb = mix(texColor.rgb, glowColor, glowIntensity * widthIntensity * 0.5);
        texColor.a = mix(texColor.a, 1.0, glowIntensity * widthIntensity * 0.3);
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
