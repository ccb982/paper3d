import * as THREE from 'three';

export function getCameraPitch(camera: THREE.Camera): number {
  camera.updateMatrixWorld();
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);
  return Math.asin(direction.y);
}

export interface CorrectedNDCResult {
  raw: THREE.Vector2;
  corrected: THREE.Vector2;
}

export function getCorrectedNDC(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  camera: THREE.Camera,
  characterPosition: THREE.Vector3,
  baseCompensation: number = 0.3
): CorrectedNDCResult {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

  const rawNDC = new THREE.Vector2(
    Math.max(-1, Math.min(1, ndcX)),
    Math.max(-1, Math.min(1, ndcY))
  );

  const pitch = getCameraPitch(camera);

  const distanceToCamera = camera.position.distanceTo(characterPosition);
  const distanceCompensation = distanceToCamera > 25 ? 0 : Math.min(1.2, 20 / distanceToCamera);

  const pitchCompensation = 1.0 + Math.max(0, pitch) * 0.5;
  const totalCompensation = baseCompensation * distanceCompensation * pitchCompensation;
  const correction = -pitch * totalCompensation;

  const correctedNDC = new THREE.Vector2(
    Math.max(-1, Math.min(1, ndcX)),
    Math.max(-1, Math.min(1, ndcY + correction))
  );

  return { raw: rawNDC, corrected: correctedNDC };
}

export function getBulletDirection(
  camera: THREE.Camera,
  mouseX: number,
  mouseY: number,
  canvas: HTMLCanvasElement,
  characterPosition?: THREE.Vector3
): THREE.Vector3 {
  const characterPos = characterPosition || new THREE.Vector3(0, 0, 0);
  const corrected = getCorrectedNDC(canvas, mouseX, mouseY, camera, characterPos, 0.3);

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(corrected.corrected, camera);

  return raycaster.ray.direction.clone();
}
