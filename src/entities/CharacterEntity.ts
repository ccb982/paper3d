import { Entity } from '../core/Entity';
import * as THREE from 'three';
import { eventBus } from '../core/eventBus';

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

  // 纹理相关
  public texturePath: string;                     // 贴图路径
  protected defaultWidth: number = 2;             // 纸片人宽度
  protected defaultHeight: number = 3;            // 纸片人高度

  constructor(id: string, faction: string, texturePath: string, position?: THREE.Vector3) {
    // 临时创建占位网格（实际纹理异步加载后替换材质）
    const geometry = new THREE.PlaneGeometry(2, 3);
    const material = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    
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
  }

  protected handlePlayerInput(): void {
    // 由外部输入系统设置 moveDirection
  }

  protected abstract updateAI(delta: number): void;

  protected attack(delta: number): void {
    // 子类可覆盖
  }

  protected applyGravity(delta: number): void {
    if (!this.isGrounded) {
      this.verticalVelocity -= 9.8 * delta;
      this.position.y += this.verticalVelocity * delta;
      if (this.position.y <= 0) {
        this.position.y = 0;
        this.verticalVelocity = 0;
        this.isGrounded = true;
      }
    }
  }

  protected updateFacing(delta: number): void {
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

  protected onDeath(): void {
    eventBus.emit('entity:death', { id: this.id, faction: this.faction });
  }

  public isEnemy(other: CharacterEntity): boolean {
    return (this.faction === 'friendly' && other.faction === 'enemy') ||
           (this.faction === 'enemy' && other.faction === 'friendly');
  }
}
