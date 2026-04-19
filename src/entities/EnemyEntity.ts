import { CharacterEntity } from './CharacterEntity';
import { EntityManager } from '../core/EntityManager';
import { useGameStore, GameMode } from '../systems/state/gameStore';
import * as THREE from 'three';

/**
 * 敌方实体 - 敌方AI角色
 */
export class EnemyEntity extends CharacterEntity {
  private randomDirection: THREE.Vector3 = new THREE.Vector3();
  private directionChangeTimer: number = 0;
  private directionChangeInterval: number = 2;

  constructor(id: string, texturePath: string, position: THREE.Vector3) {
    super(id, 'enemy', texturePath, position);
    this.health = 30;
    this.maxHealth = 30;
    this.speed = 2;
    this.isPlayerControlled = false;
    this.randomDirection.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
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
