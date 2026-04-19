import { StaticEntity } from './StaticEntity';
import * as THREE from 'three';

export class TargetEntity extends StaticEntity {
  private originalMaterial: THREE.Material;
  private hitMaterial: THREE.Material;

  constructor(id: string, position: THREE.Vector3, size: { width: number; height: number } = { width: 2, height: 3 }) {
    // 创建平面几何体
    const geometry = new THREE.PlaneGeometry(size.width, size.height);
    const material = new THREE.MeshStandardMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    super(id, mesh, position);
    this.originalMaterial = material;
    this.hitMaterial = new THREE.MeshStandardMaterial({ color: 0x00ff00, side: THREE.DoubleSide });
  }

  protected onHit(): void {
    // 变色（红色 → 绿色）
    (this.mesh as THREE.Mesh).material = this.hitMaterial;
    // 可选：0.3 秒后恢复
    setTimeout(() => {
      if (this.isActive) {
        (this.mesh as THREE.Mesh).material = this.originalMaterial;
      }
    }, 300);
  }

  public onDestroy(): void {
    // 靶子被摧毁时从场景移除（也可播放爆炸特效）
    console.log(`Target ${this.id} destroyed`);
  }
}