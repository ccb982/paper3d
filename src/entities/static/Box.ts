import { StaticEntity } from './StaticEntity';
import * as THREE from 'three';

/**
 * 箱子类，继承自StaticEntity
 */
export class Box extends StaticEntity {
  /**
   * 创建一个箱子实例
   * @param id 箱子ID
   * @param position 箱子位置
   * @param size 箱子尺寸
   */
  constructor(id: string, position: THREE.Vector3, size: THREE.Vector3 = new THREE.Vector3(1, 1, 1)) {
    // 创建箱子的几何体
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    
    // 创建箱子的材质
    const material = new THREE.MeshPhongMaterial({
      color: 0x8B4513, // 棕色
      shininess: 30,
      specular: 0x111111
    });
    
    // 创建箱子的网格
    const mesh = new THREE.Mesh(geometry, material);
    
    // 调用父类构造函数
    super(id, mesh, position);
    
    // 设置箱子的碰撞半径
    this.radius = Math.max(size.x, size.y, size.z) / 2;
    
    // 增加箱子的生命值
    this.health = 50;
    this.maxHealth = 50;
    
    // 添加箱子特定的属性到userData
    mesh.userData = {
      ...mesh.userData,
      boxId: id,
      isBox: true
    };
  }
  
  /**
   * 命中时调用
   */
  protected onHit(): void {
    // 当箱子被击中时，稍微改变颜色
    if (this.mesh instanceof THREE.Mesh) {
      const material = this.mesh.material as THREE.MeshPhongMaterial;
      if (material) {
        // 暂时将颜色变为稍亮的棕色
        material.color.setHex(0xA0522D);
        
        // 一段时间后恢复原来的颜色
        setTimeout(() => {
          material.color.setHex(0x8B4513);
        }, 200);
      }
    }
  }
  
  /**
   * 销毁时调用
   */
  public onDestroy(): void {
    // 箱子被销毁时的逻辑
    console.log(`箱子 ${this.id} 被销毁了`);
    
    // 调用父类的销毁方法
    super.onDestroy();
  }
}