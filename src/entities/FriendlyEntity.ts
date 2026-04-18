import { CharacterEntity } from './CharacterEntity';
import { EntityManager } from '../core/EntityManager';
import * as THREE from 'three';
import { characterPositionStore } from '../systems/character/CharacterPositionStore';

/**
 * 友方实体 - 玩家控制或友方AI角色
 */
export class FriendlyEntity extends CharacterEntity {
  constructor(id: string, texturePath: string, position: THREE.Vector3) {
    super(id, 'friendly', texturePath, position);
    this.health = 100;
    this.speed = 5;
    this.isPlayerControlled = true;
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
    } else {
      super.update(delta);
    }

    if (this.attackCooldown > 0) {
      this.attackCooldown -= delta;
    } else {
      this.attack(delta);
    }
  }
}
