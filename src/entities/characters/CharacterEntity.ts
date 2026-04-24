import { Entity } from '../../core/Entity';
import * as THREE from 'three';
import { eventBus } from '../../core/eventBus';
import { PaperAnimator } from '../../core/PaperAnimator';
import { cameraStore } from '../../core/CameraStore';

/**
 * 角色实体基类 - 所有角色（玩家、敌人、NPC）的父类
 */
export abstract class CharacterEntity extends Entity {
  // 阵营: 'friendly' 或 'enemy'
  public faction: string;

  // 基础属性
  public health: number = 100;
  public maxHealth: number = 100;
  public speed: number = 5;
  public moveDirection: THREE.Vector3 = new THREE.Vector3(0, 0, 0);
  public isPlayerControlled: boolean = false;   // 是否由玩家手动控制
  public isMoving: boolean = false;

  // 攻击相关
  public attackCooldown: number = 0;
  public attackRate: number = 1.0;

  // 重力相关
  public isGrounded: boolean = true;
  public verticalVelocity: number = 0;
  public gravity: number = 9.8;
  public jumpForce: number = 7;
  public height: number = 1.5; // 角色高度，用于碰撞检测
  protected groundOffset: number = 0.1; // 地面偏移量

  // 纹理相关
  public texturePath: string;                     // 贴图路径
  protected defaultWidth: number = 2;             // 纸片人宽度
  protected defaultHeight: number = 3;            // 纸片人高度
  
  // 动画相关
  public animator: PaperAnimator | null = null;   // 动画器（可选）

  constructor(id: string, faction: string, texturePath: string, position?: THREE.Vector3) {
    // 临时创建占位网格（实际纹理异步加载后替换材质）
    const geometry = new THREE.PlaneGeometry(2, 3);
    const material = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(1, 1.5, 1);

    // 添加点击检测和可射击相关属性
    mesh.userData = {
      characterId: id,
      isCharacter: true,
      isShootable: true, // 添加可射击标志
      faction: faction
    };
    
    super(id, 'character', mesh);
    this.faction = faction;
    this.texturePath = texturePath;
    
    // 设置合适的碰撞半径
    this.radius = 1.0; // 角色的碰撞半径

    if (position) {
      this.position.copy(position);
      this.mesh.position.copy(position);
    }

    // 异步加载纹理
    this.loadTexture(texturePath);
  }

  /**
   * 加载纹理并应用到材质
   */
  protected loadTexture(path: string): void {
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(path, (texture) => {
      // 替换材质（保留原有几何体）
      const newMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true
      });
      (this.mesh as THREE.Mesh).material = newMaterial;
    }, undefined, (err) => {
      console.error(`Failed to load texture for ${this.id}: ${path}`, err);
    });
  }

  /**
   * 动态更换贴图
   */
  public setTexture(path: string): void {
    this.texturePath = path;
    this.loadTexture(path);
  }

  /**
   * 设置动画器（由子类调用）
   */
  public setAnimator(animator: PaperAnimator): void {
    this.animator = animator;
  }

  /**
   * 每帧更新（由 EntityManager 调用）
   */
  public update(delta: number): void {
    if (!this.isActive) return;

    if (this.isPlayerControlled) {
      this.handlePlayerInput();
    } else {
      this.updateAI(delta);
    }

    // 水平移动
    if (this.moveDirection.length() > 0) {
      this.moveDirection.normalize();
      this.position.x += this.moveDirection.x * this.speed * delta;
      this.position.z += this.moveDirection.z * this.speed * delta;
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }

    this.applyGravity(delta);
    this.mesh.position.copy(this.position);
    this.updateFacing(delta);

    if (this.attackCooldown > 0) {
      this.attackCooldown -= delta;
    } else {
      this.attack(delta);
    }

    // 动画更新（如果有动画器）
    if (this.animator) {
      const camera = cameraStore.getCamera();
      if (camera) {
        this.animator.updateDirection(this.position, camera.position);
        this.animator.update(delta);
      }
    }
  }

  protected handlePlayerInput(): void {
    // 由外部输入系统设置 moveDirection
  }

  protected abstract updateAI(delta: number): void;

  protected attack(_delta: number): void {
    // 子类可覆盖
  }

  // 地形高度获取函数（由外部设置）
  private getHeightAt: ((x: number, z: number) => number) | null = null;

  /**
   * 设置地形高度获取函数
   */
  public setHeightAtFunction(getHeightAt: (x: number, z: number) => number): void {
    this.getHeightAt = getHeightAt;
  }

  /**
   * 跳跃
   */
  public jump(): void {
    if (this.isGrounded) {
      this.verticalVelocity = this.jumpForce;
      this.isGrounded = false;
    }
  }

  /**
   * 应用重力和处理竖直碰撞
   */
  protected applyGravity(delta: number): void {
    // 应用重力
    if (!this.isGrounded) {
      this.verticalVelocity -= this.gravity * delta;
    }

    // 计算新位置
    const newY = this.position.y + this.verticalVelocity * delta;

    // 获取地面高度
    let groundHeight = 0;
    if (this.getHeightAt) {
      groundHeight = this.getHeightAt(this.position.x, this.position.z);
    }

    // 地面碰撞检测
    if (newY <= groundHeight + this.groundOffset) { // 使用可配置的地面偏移量
      this.position.y = groundHeight + this.groundOffset;
      this.verticalVelocity = 0;
      this.isGrounded = true;
    } else {
      this.position.y = newY;
      this.isGrounded = false;
    }
  }

  protected updateFacing(_delta: number): void {
    if (this.moveDirection.length() > 0) {
      const angle = Math.atan2(this.moveDirection.x, this.moveDirection.z);
      this.mesh.rotation.y = angle;
    }
  }

  public takeDamage(amount: number): void {
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.isActive = false;
      this.onDeath();
    }
  }

  public onDeath(): void {
    eventBus.emit('entity:death', { id: this.id, faction: this.faction });
  }

  public isEnemy(other: CharacterEntity): boolean {
    return (this.faction === 'friendly' && other.faction === 'enemy') ||
           (this.faction === 'enemy' && other.faction === 'friendly');
  }
}
