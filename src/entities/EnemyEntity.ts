import { CharacterEntity } from './CharacterEntity';
import { EntityManager } from '../core/EntityManager';
import * as THREE from 'three';

/**
 * 敌方实体 - 敌方AI角色
 */
export class EnemyEntity extends CharacterEntity {
  constructor(id: string, texturePath: string, position: THREE.Vector3) {
    super(id, 'enemy', texturePath, position);
    this.health = 30;
    this.speed = 2;
    this.isPlayerControlled = false;
  }

  protected updateAI(delta: number): void {
    const target = EntityManager.getInstance().getEntitiesByType('character')
      .find(e => (e as CharacterEntity).isPlayerControlled === true) as CharacterEntity;
    if (!target) return;
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
