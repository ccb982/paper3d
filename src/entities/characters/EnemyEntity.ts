import { CharacterEntity } from './CharacterEntity';
import { EntityManager } from '../../core/EntityManager';
import { useGameStore, GameMode } from '../../systems/state/gameStore';
import * as THREE from 'three';
import { PaperAnimator } from '../../core/PaperAnimator';
import { AnimationLoader } from '../../core/AnimationLoader';
import { cameraStore } from '../../core/CameraStore';

/**
 * 敌方实体 - 敌方AI角色
 */
export class EnemyEntity extends CharacterEntity {
  private randomDirection: THREE.Vector3 = new THREE.Vector3();
  private directionChangeTimer: number = 0;
  private directionChangeInterval: number = 2;

  constructor(id: string, texturePath: string, position: THREE.Vector3, enableAnimation: boolean = false) {
    super(id, 'enemy', texturePath, position);
    this.health = 30;
    this.maxHealth = 30;
    this.speed = 2;
    this.isPlayerControlled = false;
    this.randomDirection.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    
    // 可选启用动画系统
    if (enableAnimation && this.mesh && (this.mesh as THREE.Mesh).material instanceof THREE.MeshStandardMaterial) {
      const material = (this.mesh as THREE.Mesh).material;
      const animator = new PaperAnimator(material);
      this.setAnimator(animator);
      
      // 异步加载动画（使用占位路径）
      this.loadAnimations(animator);
    }
  }
  
  /**
   * 加载动画
   */
  private async loadAnimations(animator: PaperAnimator): Promise<void> {
    try {
      // 这里使用占位路径，实际项目中需要替换为真实路径
      const { frontClip, backClip } = await AnimationLoader.loadPaperAnimations(
        '/textures/characters/enemy',
        8,   // 正面帧数
        8,   // 背面帧数
        10   // 帧率
      );
      animator.setFrontClip(frontClip);
      animator.setBackClip(backClip);
    } catch (error) {
      console.warn('Failed to load animations for enemy:', error);
      // 动画加载失败不影响游戏运行
    }
  }

  protected updateAI(delta: number): void {
    const mode = useGameStore.getState().mode;

    if (mode !== GameMode.BATTLE) {
      this.updateRandomMovement(delta);
    } else {
      this.updateChaseMovement(delta);
    }
  }

  private updateRandomMovement(delta: number): void {
    this.directionChangeTimer += delta;
    if (this.directionChangeTimer >= this.directionChangeInterval) {
      this.directionChangeTimer = 0;
      this.directionChangeInterval = 2 + Math.random() * 3;
      this.randomDirection.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    }
    this.moveDirection.copy(this.randomDirection);
  }

  private updateChaseMovement(delta: number): void {
    const target = EntityManager.getInstance().getEntitiesByType('character')
      .find(e => (e as CharacterEntity).isPlayerControlled === true) as CharacterEntity;
    if (!target) {
      this.moveDirection.set(0, 0, 0);
      return;
    }

    const direction = new THREE.Vector3().subVectors(target.position, this.position);
    direction.y = 0;
    if (direction.length() > 0.01) {
      this.moveDirection.copy(direction);
    } else {
      this.moveDirection.set(0, 0, 0);
    }
  }

  protected onDeath(): void {
    super.onDeath();
    console.log(`Enemy ${this.id} died`);
  }
}
