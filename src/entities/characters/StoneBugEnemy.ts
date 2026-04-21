import { EnemyEntity } from './EnemyEntity';
import * as THREE from 'three';

/**
 * 原石虫敌人类 - 半椭球形状，弧面在上，背上长着红色圆锥
 */
export class StoneBugEnemy extends EnemyEntity {
  private cones: THREE.Mesh[] = [];

  constructor(id: string, position: THREE.Vector3) {
    // 调用父类构造函数，使用空纹理路径
    super(id, '', position, false);
    
    // 设置原石虫的属性
    this.health = 50; // 比普通敌人更耐打
    this.maxHealth = 50;
    this.speed = 1.5; // 比普通敌人慢
    
    // 创建原石虫的自定义模型
    this.createStoneBugModel();
  }

  /**
   * 创建原石虫模型
   */
  private createStoneBugModel(): void {
    // 移除默认的平面网格（如果存在）
    if (this.mesh) {
      // 清理原网格
      if (this.mesh.geometry) {
        (this.mesh as THREE.Mesh).geometry.dispose();
      }
      if (this.mesh.material) {
        if (Array.isArray((this.mesh as THREE.Mesh).material)) {
          (this.mesh as THREE.Mesh).material.forEach(m => m.dispose());
        } else {
          (this.mesh as THREE.Mesh).material.dispose();
        }
      }
    }

    // 创建半椭球几何体（弧面在上）
    const halfEllipsoidGeometry = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    
    // 创建石头材质
    const stoneMaterial = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.8,
      metalness: 0.2
    });

    // 创建半椭球网格
    const bodyMesh = new THREE.Mesh(halfEllipsoidGeometry, stoneMaterial);
    bodyMesh.position.copy(this.position);
    bodyMesh.scale.set(1.2, 0.8, 1.2); // 调整为椭球形
    
    // 设置点击检测和可射击相关属性
    bodyMesh.userData = {
      characterId: this.id,
      isCharacter: true,
      isShootable: true,
      faction: this.faction
    };
    
    // 直接替换mesh
    this.mesh = bodyMesh;

    // 在背上添加红色圆锥
    this.addRedCones();

    // 添加光源以增强视觉效果
    const pointLight = new THREE.PointLight(0xff6600, 1, 3);
    pointLight.position.set(0, 0.5, 0);
    bodyMesh.add(pointLight);
  }

  /**
   * 在背上添加红色圆锥
   */
  private addRedCones(): void {
    if (!this.mesh) return;

    const coneGeometry = new THREE.ConeGeometry(0.2, 0.6, 8);
    const coneMaterial = new THREE.MeshStandardMaterial({
      color: 0xff4444,
      emissive: 0x440000,
      emissiveIntensity: 0.5
    });

    // 随机生成6-9根圆锥
    const coneCount = 6 + Math.floor(Math.random() * 4);
    
    // 创建并添加圆锥
    for (let i = 0; i < coneCount; i++) {
      // 随机生成圆锥位置（在半椭球表面）
      const theta = Math.random() * Math.PI * 2; // 方位角
      const phi = Math.random() * Math.PI / 2; // 极角（限制在半球范围内）
      const radius = 0.8 + Math.random() * 0.4; // 半径在0.8-1.2之间
      
      // 计算笛卡尔坐标
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const z = radius * Math.sin(phi) * Math.sin(theta);
      const y = radius * Math.cos(phi);
      
      const cone = new THREE.Mesh(coneGeometry, coneMaterial);
      cone.position.set(x, y, z);
      
      // 使圆锥指向外
      const direction = new THREE.Vector3(x, y, z).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      const quaternion = new THREE.Quaternion().setFromUnitVectors(up, direction);
      cone.quaternion.copy(quaternion);
      
      this.mesh.add(cone);
      this.cones.push(cone);
    }
  }

  /**
   * 更新方法
   */
  public update(delta: number): void {
    super.update(delta);
    
    // 让圆锥轻微摆动，增加动画效果
    if (this.cones.length > 0) {
      const time = Date.now() * 0.001;
      this.cones.forEach((cone, index) => {
        const offset = index * 0.1;
        cone.rotation.z = Math.sin(time + offset) * 0.1;
        cone.rotation.y = Math.cos(time + offset) * 0.1;
      });
    }
  }

  /**
   * 清理资源
   */
  public dispose(): void {
    // 清理圆锥
    for (const cone of this.cones) {
      if (cone.parent) {
        cone.parent.remove(cone);
      }
      if (cone.geometry) {
        cone.geometry.dispose();
      }
      if (cone.material) {
        if (Array.isArray(cone.material)) {
          cone.material.forEach(m => m.dispose());
        } else {
          cone.material.dispose();
        }
      }
    }
    this.cones = [];
    
    super.dispose();
  }
}
