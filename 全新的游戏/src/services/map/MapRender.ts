// ============================================================
// MapRender —— 地图视觉层（3D 地形网格）
// ============================================================
// 读 MapQuery.heightmap → 构建 3D 地形网格（PlaneGeometry 细分 →
// 顶点抬升 → 法线 → UV）。当前平地（heightmap 全 0），架构支持起伏。
// 材质：占位纯绿；地面 ftx 纹理就位后 setTerrainTexture 替换。
// 只 import three，不碰 MapData 内部。

import * as THREE from 'three';
import type { MapQuery } from './MapQuery';

export class MapRender {
  private mesh: THREE.Mesh | null = null;
  private material: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, map: MapQuery) {
    this.material = new THREE.MeshStandardMaterial({
      color: 0x2d5a27,
      roughness: 0.9,
      metalness: 0,
    });

    this.mesh = this.buildTerrainMesh(map);
    scene.add(this.mesh);
  }

  /** 由 heightmap 构建 3D 地形网格（旋转到 XZ 平面 + 顶点抬升 + 法线 + UV 平铺） */
  private buildTerrainMesh(map: MapQuery): THREE.Mesh {
    const size = map.size;
    // 每个世界单位一个顶点（细分 = size）→ 64×64 地形 65×65 顶点
    const segments = size;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    // ★ 本地 XY 平面 → 世界 XZ 平面（水平地面，y 向上为高度）
    geometry.rotateX(-Math.PI / 2);
    const pos = geometry.attributes.position as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      // 旋转后：本地 x → 世界 x；-本地 y → 世界 z（-32..32 → 0..64）
      const wx = pos.getX(i) + size / 2;
      const wz = -pos.getZ(i) + size / 2;
      // ★ 世界 y = 地形高度（双线性采样 heightmap）
      pos.setY(i, map.getHeight(wx, wz));
    }
    geometry.computeVertexNormals();

    // UV 平铺（1 世界单位 = 1 纹理单元，未来 ftx 地面纹理按此平铺）
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const wx = pos.getX(i) + size / 2;
      const wz = -pos.getZ(i) + size / 2;
      uv.setXY(i, wx, wz);
    }
    uv.needsUpdate = true;
    pos.needsUpdate = true;

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.receiveShadow = true;
    return mesh;
  }

  /** ★ 地面纹理替换（ftx 地面素材就位后调用：材质贴图 or FTXQuad 合成图） */
  setTerrainTexture(texture: THREE.Texture | null): void {
    if (texture) {
      this.material.map = texture;
      this.material.needsUpdate = true;
    } else {
      this.material.map = null;
      this.material.needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.parent?.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.material.dispose();
    this.mesh = null;
  }
}
