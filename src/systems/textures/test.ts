import * as THREE from 'three';
import { CanvasTextureGenerator } from './CanvasTextureGenerator';
import { ShaderTextureGenerator } from './ShaderTextureGenerator';
import { TextureManager } from './TextureManager';
import { StoneBugEnemy } from '../../entities/characters/StoneBugEnemy';
import { createBulletTrailTexture } from './BulletTrailTexture';

const textureManager = new TextureManager();

// 创建一个更简单的纹理，确保能看到
const canvasGen = new CanvasTextureGenerator(512, 512, (ctx, w, h) => {
  // 填充背景
  ctx.fillStyle = '#442200';
  ctx.fillRect(0, 0, w, h);
  
  // 绘制明显的图案
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, w / 2, h / 2);
  
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(w / 2, 0, w / 2, h / 2);
  
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(0, h / 2, w / 2, h / 2);
  
  ctx.fillStyle = '#ffff00';
  ctx.fillRect(w / 2, h / 2, w / 2, h / 2);
});
textureManager.register('stoneBugPattern', canvasGen);

// 创建涟漪效果的着色器纹理
const rippleVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const rippleFragmentShader = `
  uniform float uTime;
  varying vec2 vUv;
  
  void main() {
    // 将 UV 坐标从 [0,1] 映射到 [-1,1]，使中心为 (0,0)
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float angle = atan(p.y, p.x);
    
    // 只显示半径在 0.2 到 0.9 之间的环形区域
    if (r < 0.2 || r > 0.9) discard;
    
    // 定义多层环的参数（半径、起始角度、结束角度、宽度）
    // 这里示例：3 个环，每个环只显示一段弧，且随时间旋转
    int ringCount = 3;
    bool show = false;
    for (int i = 0; i < ringCount; i++) {
      float ringRadius = 0.3 + float(i) * 0.2;
      float ringWidth = 0.03;
      float radiusDiff = abs(r - ringRadius);
      if (radiusDiff < ringWidth) {
        // 环的弧段：起始角度随时间偏移，每圈不同
        float startAngle = uTime * 0.5 + float(i) * 1.2;
        float arcLength = 0.8; // 弧度长度
        float endAngle = startAngle + arcLength;
        // 角度归一化到 [0, 2PI)
        float a = angle;
        if (a < 0.0) a += 6.28318;
        float start = mod(startAngle, 6.28318);
        float end = mod(endAngle, 6.28318);
        if (start < end) {
          if (a >= start && a <= end) show = true;
        } else {
          if (a >= start || a <= end) show = true;
        }
        if (show) break;
      }
    }
    
    if (!show) discard;
    
    // 颜色：蓝白色，根据半径微调
    vec3 color = vec3(0.3, 0.5, 0.9);
    float alpha = 0.8;
    gl_FragColor = vec4(color, alpha);
  }
`;

const rippleUniforms = {
  uTime: { value: 0.0 }
};

const rippleGen = new ShaderTextureGenerator(rippleUniforms, rippleVertexShader, rippleFragmentShader);
textureManager.register('rippleEffect', rippleGen);

// 创建子弹尾气纹理
createBulletTrailTexture(textureManager, 512, 512);

const stoneBugPosition = new THREE.Vector3(0, 0, 0);
const stoneBug = new StoneBugEnemy('stoneBug1', stoneBugPosition);

const texture = textureManager.getTexture('stoneBugPattern');

if (texture && stoneBug.mesh) {
  const mesh = stoneBug.mesh as THREE.Mesh;

  // 确保材质正确
  let material;
  if (mesh.material instanceof THREE.MeshStandardMaterial) {
    material = mesh.material;
  } else {
    // 如果不是MeshStandardMaterial，创建一个新的
    material = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.8,
      metalness: 0.2
    });
    mesh.material = material;
  }
  
  // 应用纹理
  material.map = texture;
  material.needsUpdate = true;

  // 简化UV映射，使用默认的UV坐标
  const geometry = mesh.geometry as THREE.SphereGeometry;
  // 确保几何体有UV属性
  if (!geometry.attributes.uv) {
    geometry.computeUVs();
  }
  
  // 强制更新
  geometry.attributes.uv.needsUpdate = true;
}

// 创建涟漪效果的圆环
const scene = new THREE.Scene();
const geometry = new THREE.CircleGeometry(5, 128);
const rippleMaterial = textureManager.getMaterial('rippleEffect') as THREE.ShaderMaterial;
const disc = new THREE.Mesh(geometry, rippleMaterial);
disc.position.set(10, 0, 0);
scene.add(disc);

// 动画循环中更新时间
function animate(time: number) {
  if (rippleMaterial) {
    rippleMaterial.uniforms.uTime.value = time * 0.001;
  }
  requestAnimationFrame(animate);
}
animate(0);

console.log('原石虫纹理测试完成');
console.log('texture:', texture);
console.log('stoneBug.mesh:', stoneBug.mesh);
if (stoneBug.mesh) {
  const mesh = stoneBug.mesh as THREE.Mesh;
  console.log('mesh.material:', mesh.material);
  if (mesh.material instanceof THREE.MeshStandardMaterial) {
    console.log('material.map:', mesh.material.map);
  }
  const geometry = mesh.geometry as THREE.SphereGeometry;
  console.log('geometry.attributes.uv:', geometry.attributes.uv);
}
console.log('涟漪效果已添加');

// 测试子弹尾气纹理
const bulletTrailTexture = textureManager.getTexture('bullet-trail');
console.log('子弹尾气纹理已创建:', bulletTrailTexture);

// 创建一个测试平面来显示子弹尾气纹理
const bulletTrailGeometry = new THREE.PlaneGeometry(2, 2);
const bulletTrailMaterial = new THREE.MeshBasicMaterial({ 
  map: bulletTrailTexture,
  transparent: true,
  side: THREE.DoubleSide
});
const bulletTrailPlane = new THREE.Mesh(bulletTrailGeometry, bulletTrailMaterial);
bulletTrailPlane.position.set(-10, 0, 0);
scene.add(bulletTrailPlane);

console.log('子弹尾气纹理测试完成');

