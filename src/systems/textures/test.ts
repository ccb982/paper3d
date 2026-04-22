import * as THREE from 'three';
import { CanvasTextureGenerator } from './CanvasTextureGenerator';
import { TextureManager } from './TextureManager';
import { StoneBugEnemy } from '../../entities/characters/StoneBugEnemy';

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
