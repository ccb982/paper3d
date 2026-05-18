import * as THREE from 'three';

// ========== 性能优化：预创建的临时对象（避免每帧 GC）==========
const _tmpDirection = new THREE.Vector3();
const _tmpRawNDC = new THREE.Vector2();
const _tmpCorrectedNDC = new THREE.Vector2();
const _tmpRaycaster = new THREE.Raycaster();

export function getCameraPitch(camera: THREE.Camera): number {
  camera.updateMatrixWorld();
  camera.getWorldDirection(_tmpDirection);
  return Math.asin(_tmpDirection.y);
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

  _tmpRawNDC.set(
    Math.max(-1, Math.min(1, ndcX)),
    Math.max(-1, Math.min(1, ndcY))
  );

  const pitch = getCameraPitch(camera);

  const distanceToCamera = camera.position.distanceTo(characterPosition);
  const distanceCompensation = distanceToCamera > 25 ? 0 : Math.min(1.2, 20 / distanceToCamera);

  const pitchCompensation = 1.0 + Math.max(0, pitch) * 0.5;
  const totalCompensation = baseCompensation * distanceCompensation * pitchCompensation;
  const correction = -pitch * totalCompensation;

  _tmpCorrectedNDC.set(
    Math.max(-1, Math.min(1, ndcX)),
    Math.max(-1, Math.min(1, ndcY + correction))
  );

  // 返回新对象（外部会修改或存储这些值）
  return { raw: _tmpRawNDC.clone(), corrected: _tmpCorrectedNDC.clone() };
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

  _tmpRaycaster.setFromCamera(corrected.corrected, camera);

  return _tmpRaycaster.ray.direction.clone();
}
