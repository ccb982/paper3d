import * as THREE from 'three';
import { CanvasTextureGenerator } from './CanvasTextureGenerator';
import { TextureManager } from './TextureManager';
import { StoneBugEnemy } from '../../entities/characters/StoneBugEnemy';

const textureManager = new TextureManager();

const canvasGen = new CanvasTextureGenerator(512, 512, (ctx, w, h) => {
  ctx.fillStyle = '#442200';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 100; i++) {
    ctx.fillStyle = `hsl(${Math.random() * 60}, 100%, 50%)`;
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 10, 0, Math.PI * 2);
    ctx.fill();
  }
});
textureManager.register('stoneBugPattern', canvasGen);

const stoneBugPosition = new THREE.Vector3(0, 0, 0);
const stoneBug = new StoneBugEnemy('stoneBug1', stoneBugPosition);

const texture = textureManager.getTexture('stoneBugPattern');

if (texture && stoneBug.mesh) {
  const mesh = stoneBug.mesh as THREE.Mesh;

  if (mesh.material instanceof THREE.MeshStandardMaterial) {
    mesh.material.map = texture;
    mesh.material.needsUpdate = true;
  }

  const geometry = mesh.geometry as THREE.SphereGeometry;
  const uvAttribute = geometry.attributes.uv;
  const positionAttribute = geometry.attributes.position;

  const vertex = new THREE.Vector3();
  for (let i = 0; i < positionAttribute.count; i++) {
    vertex.fromBufferAttribute(positionAttribute, i);
    const phi = Math.acos(vertex.y / vertex.length());
    const normalizedPhi = phi / (Math.PI / 2);
    if (normalizedPhi > 0.5) {
      const theta = Math.atan2(vertex.z, vertex.x) / (2 * Math.PI) + 0.5;
      const u = (theta + 1) % 1;
      const v = (normalizedPhi - 0.5) * 2;
      uvAttribute.setXY(i, u, v);
    } else {
      uvAttribute.setXY(i, 0, 0);
    }
  }
  uvAttribute.needsUpdate = true;
}

console.log('原石虫纹理测试完成');
console.log('texture:', texture);
console.log('stoneBug.mesh:', stoneBug.mesh);
