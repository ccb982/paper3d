import * as THREE from 'three';
import { EntityManager } from '../core/EntityManager';
import { characterPositionStore } from '../systems/character/CharacterPositionStore';

export type InteractiveObject = {
  id: string;
  name: string;
  type: 'box' | 'npc' | 'door' | 'chest' | 'other';
  position: THREE.Vector3;
  distance: number;
  entity: any;
};

export const INTERACTION_RADIUS = 3;

export function getNearbyInteractiveObjects(): InteractiveObject[] {
  const playerPos = characterPositionStore.getPositionCopy();
  const entityManager = EntityManager.getInstance();
  const allEntities = entityManager.getAllEntities();

  const interactiveObjects: InteractiveObject[] = [];

  for (const entity of allEntities) {
    if (!entity.isActive) continue;

    let isInteractive = false;
    let objectType: InteractiveObject['type'] = 'other';
    let objectName = entity.id;

    if (entity.type === 'static') {
      const mesh = entity.mesh;
      if (mesh?.userData?.isBox) {
        isInteractive = true;
        objectType = 'box';
        objectName = '箱子';
      }
    }

    if (isInteractive) {
      const playerPosVec = new THREE.Vector3(playerPos.x, playerPos.y, playerPos.z);
      const distance = playerPosVec.distanceTo(entity.position);

      if (distance <= INTERACTION_RADIUS) {
        interactiveObjects.push({
          id: entity.id,
          name: objectName,
          type: objectType,
          position: entity.position.clone(),
          distance,
          entity
        });
      }
    }
  }

  interactiveObjects.sort((a, b) => a.distance - b.distance);

  return interactiveObjects;
}

export function getClosestInteractiveObject(): InteractiveObject | null {
  const nearby = getNearbyInteractiveObjects();
  return nearby.length > 0 ? nearby[0] : null;
}