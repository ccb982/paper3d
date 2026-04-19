import * as THREE from 'three';

// 子弹池管理类
export class BulletPool {
  private pool: Array<{ 
    mesh: THREE.Mesh; 
    position: THREE.Vector3; 
    velocity: THREE.Vector3; 
    direction: THREE.Vector3; 
    isActive: boolean; 
    creationTime: number; 
    lifeTime: number; 
    onExpire: (id: number) => void; 
    id: number 
  }> = [];
  private nextId = 0;
  private activeBullets = 0;
  private maxPoolSize = 100; // 最大池大小
  
  constructor() {
    // 预创建子弹对象
    this.preCreateBullets();
  }
  
  private preCreateBullets() {
    for (let i = 0; i < this.maxPoolSize; i++) {
      const geometry = new THREE.SphereGeometry(0.1, 8, 8);
      const material = new THREE.MeshStandardMaterial({ 
        color: 0xffff00, 
        emissive: 0xffff00, 
        emissiveIntensity: 0.5 
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      
      this.pool.push({
        mesh,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        isActive: false,
        creationTime: 0,
        lifeTime: 20000,
        onExpire: () => {},
        id: this.nextId++
      });
    }
  }
  
  // 获取一个子弹
  public getBullet(): { mesh: THREE.Mesh; id: number } | null {
    // 查找空闲子弹
    for (const bullet of this.pool) {
      if (!bullet.isActive) {
        bullet.isActive = true;
        bullet.mesh.visible = true;
        this.activeBullets++;
        return { mesh: bullet.mesh, id: bullet.id };
      }
    }
    
    // 如果没有空闲子弹且未达到最大池大小，创建新子弹
    if (this.pool.length < this.maxPoolSize) {
      const geometry = new THREE.SphereGeometry(0.1, 8, 8);
      const material = new THREE.MeshStandardMaterial({ 
        color: 0xffff00, 
        emissive: 0xffff00, 
        emissiveIntensity: 0.5 
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = true;
      
      const newBullet = {
        mesh,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        isActive: true,
        creationTime: 0,
        lifeTime: 20000,
        onExpire: () => {},
        id: this.nextId++
      };
      
      this.pool.push(newBullet);
      this.activeBullets++;
      return { mesh: newBullet.mesh, id: newBullet.id };
    }
    
    return null; // 达到最大池大小
  }
  
  // 更新子弹
  public update(delta: number, scene: THREE.Scene) {
    const currentTime = Date.now();
    const gravity = -0.05;
    
    for (const bullet of this.pool) {
      if (!bullet.isActive) continue;
      
      // 更新位置
      bullet.velocity.y += gravity * delta;
      bullet.position.add(bullet.velocity.clone().multiplyScalar(delta));
      bullet.mesh.position.copy(bullet.position);
      
      // 检查碰撞
      this.checkCollision(bullet, scene);
      
      // 检查是否过期
      if (currentTime - bullet.creationTime >= bullet.lifeTime) {
        this.releaseBullet(bullet.id);
      }
    }
  }
  
  // 检查碰撞
  private checkCollision(bullet: any, scene: THREE.Scene) {
    const bulletPos = bullet.position;
    const bulletRadius = 0.2;
    const targetHalfSize = 1.5;
    
    scene.traverse((object) => {
      if (!bullet.isActive) return;
      
      if (object instanceof THREE.Mesh && object.userData.isTarget && object !== bullet.mesh) {
        const distance = bulletPos.distanceTo(object.position);
        
        if (distance < bulletRadius + targetHalfSize) {
          if (object.userData.handleHit) {
            object.userData.handleHit();
          }
          this.releaseBullet(bullet.id);
        }
      }
    });
  }
  
  // 释放子弹
  public releaseBullet(id: number) {
    for (const bullet of this.pool) {
      if (bullet.id === id && bullet.isActive) {
        bullet.isActive = false;
        bullet.mesh.visible = false;
        this.activeBullets--;
        bullet.onExpire(id);
        break;
      }
    }
  }
  
  // 设置子弹属性
  public setBulletProperties(id: number, position: THREE.Vector3, direction: THREE.Vector3, velocity: number, onExpire: (id: number) => void) {
    for (const bullet of this.pool) {
      if (bullet.id === id) {
        bullet.position.copy(position);
        bullet.direction.copy(direction);
        bullet.velocity.copy(direction).multiplyScalar(velocity);
        bullet.creationTime = Date.now();
        bullet.onExpire = onExpire;
        bullet.mesh.position.copy(position);
        break;
      }
    }
  }
  
  // 获取活动子弹数量
  public getActiveBulletCount(): number {
    return this.activeBullets;
  }
  
  // 清理所有子弹
  public clear() {
    for (const bullet of this.pool) {
      if (bullet.isActive) {
        bullet.isActive = false;
        bullet.mesh.visible = false;
      }
    }
    this.activeBullets = 0;
  }
}