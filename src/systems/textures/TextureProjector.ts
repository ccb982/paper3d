import * as THREE from 'three';

export class TextureProjector {
  private scene: THREE.Scene;
  private decals: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * 在目标物体上投影纹理
   * @param texture 要投影的纹理
   * @param targetMesh 目标网格
   * @param position 投影中心（世界坐标）
   * @param rotation 投影方向（欧拉角，决定纹理朝向）
   * @param size 投影区域大小（宽、高、深）
   * @param opacity 贴花透明度
   */
  public projectTexture(
    texture: THREE.Texture,
    targetMesh: THREE.Mesh,
    position: THREE.Vector3,
    rotation: THREE.Euler,
    size: THREE.Vector3,
    opacity: number = 1.0
  ): THREE.Mesh {
    // 创建贴花材质
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      opacity: opacity,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    });

    // 生成 DecalGeometry
    const decalGeometry = new THREE.DecalGeometry(targetMesh, position, rotation, size);
    const decalMesh = new THREE.Mesh(decalGeometry, material);
    this.scene.add(decalMesh);
    this.decals.push(decalMesh);
    return decalMesh;
  }

  /**
   * 移除所有贴花
   */
  public clear(): void {
    this.decals.forEach(decal => {
      this.scene.remove(decal);
      decal.geometry.dispose();
      (decal.material as THREE.Material).dispose();
    });
    this.decals = [];
  }

  /**
   * 移除单个贴花
   */
  public removeDecal(decal: THREE.Mesh): void {
    const index = this.decals.indexOf(decal);
    if (index !== -1) {
      this.scene.remove(decal);
      decal.geometry.dispose();
      (decal.material as THREE.Material).dispose();
      this.decals.splice(index, 1);
    }
  }
}
