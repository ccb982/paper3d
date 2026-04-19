import { CharacterEntity } from './CharacterEntity';
import { EntityManager } from '../core/EntityManager';
import * as THREE from 'three';
import { characterPositionStore } from '../systems/character/CharacterPositionStore';
import { PaperAnimator } from '../core/PaperAnimator';
import { AnimationLoader } from '../core/AnimationLoader';
import { cameraStore } from '../core/CameraStore';

/**
 * 友方实体 - 玩家控制或友方AI角色
 */
export class FriendlyEntity extends CharacterEntity {
  private cameraRef: THREE.Camera | null = null;

  constructor(id: string, texturePath: string, position: THREE.Vector3) {
    super(id, 'friendly', texturePath, position);
    this.health = 100;
    this.speed = 5;
    this.isPlayerControlled = true;
    
    // 确保材质是 MeshStandardMaterial，以便支持动画
    if (this.mesh && (this.mesh as THREE.Mesh).material instanceof THREE.MeshStandardMaterial) {
      const material = (this.mesh as THREE.Mesh).material;
      const animator = new PaperAnimator(material);
      this.setAnimator(animator);
      
      // 异步加载动画（使用占位路径，实际项目中需要替换为真实路径）
      this.loadAnimations(animator);
    }
  }
  
  /**
   * 加载动画
   */
  private async loadAnimations(animator: PaperAnimator): Promise<void> {
    try {
      // 加载实际的动画帧数
      const { frontClip, backClip } = await AnimationLoader.loadPaperAnimations(
        '/textures/characters/player',
        2,   // 正面帧数
        3,   // 背面帧数
        12   // 帧率
      );
      animator.setFrontClip(frontClip);
      animator.setBackClip(backClip);
    } catch (error) {
      console.warn('Failed to load animations for player:', error);
      // 动画加载失败不影响游戏运行，继续使用静态纹理
    }
  }

  public setCamera(camera: THREE.Camera): void {
    this.cameraRef = camera;
  }

  protected updateAI(delta: number): void {
    // 当不是玩家控制时，跟随玩家
    const player = EntityManager.getInstance().getEntitiesByType('character')
      .find(e => (e as CharacterEntity).isPlayerControlled === true) as CharacterEntity;
    if (player && player !== this) {
      const toPlayer = new THREE.Vector3().subVectors(player.position, this.position);
      if (toPlayer.length() > 2) {
        this.moveDirection.copy(toPlayer.clone().normalize());
      } else {
        this.moveDirection.set(0, 0, 0);
      }
    }
  }

  protected onDeath(): void {
    super.onDeath();
    console.log(`Friendly ${this.id} died`);
  }

  public update(delta: number): void {
    if (!this.isActive) return;

    if (this.isPlayerControlled) {
      // 从 characterPositionStore 获取玩家位置
      const storePos = characterPositionStore.position;
      this.position.copy(storePos);
      this.mesh.position.copy(this.position);
      this.isMoving = characterPositionStore.isMoving;
      
      // 让角色直面摄像机
      this.faceToCamera(delta);
    } else {
      super.update(delta);
    }

    if (this.attackCooldown > 0) {
      this.attackCooldown -= delta;
    } else {
      this.attack(delta);
    }

    // 动画更新（如果有动画器）
    if (this.animator) {
      const camera = this.cameraRef || cameraStore.getCamera();
      if (camera) {
        this.animator.updateDirection(this.position, camera.position);
        this.animator.update(delta);
      }
    }
  }

  private faceToCamera(delta: number): void {
    if (!this.cameraRef || !this.mesh) return;

    const cameraPos = this.cameraRef.position.clone();
    const characterPos = this.mesh.position.clone();

    // 计算从角色指向相机的水平方向
    const toCamera = new THREE.Vector3().subVectors(cameraPos, characterPos);
    toCamera.y = 0;
    toCamera.normalize();

    // 角色背面朝向相机 → 角色的正面方向 = 相机方向的相反数
    const targetDirection = toCamera.clone().negate();

    // 计算目标旋转（只绕Y轴）
    const targetQuat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),  // 角色默认正面是 +Z
      targetDirection
    );

    // 平滑旋转
    const rotationSpeed = 8.0;
    this.mesh.quaternion.rotateTowards(targetQuat, rotationSpeed * delta);
    this.mesh.quaternion.normalize();
  }
}
