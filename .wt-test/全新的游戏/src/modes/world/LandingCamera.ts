// ============================================================
// LandingCamera —— 降落相机（一次性取景 + 观察机位步进 + 下机点）
// ============================================================
// 从 WorldMode 拆出（2026-09-21）。只持有"观察机位"这一份状态：
//   tryStartLandingShot：到起调高度 → 一次算好机位/朝向/注视点（装下"飞机→预测落点"）
//   updateLandingShot ：缓入缓出 + 绕注视点球面弧过去，之后钉死不动
//   playerExitPoint   ：玩家下机点（舰船右舷侧旁，只避坑）
// ============================================================

import * as THREE from 'three';
import type { ShipEntity } from '../../entity/ShipEntity';
import type { RasterMap } from '../../services/map/RasterMap';
import { RasterMap as RasterMapValue } from '../../services/map/RasterMap';
import { resolveDockSpawn } from '../../services/ship/DockResolver';
import travelConfig from '../../config/travel.json';
import { interpCamPose, _camMat, _camEye, _camUp } from './WorldConfig';

/** ★ 观察机位（触发瞬间算好，之后只插值过去） */
export interface LandingCamShot {
  t: number;
  fromPos: THREE.Vector3; fromQuat: THREE.Quaternion;
  shotPos: THREE.Vector3; shotQuat: THREE.Quaternion;
  /** 注视点（也是弧线插值中心） */
  pivot: THREE.Vector3;
}

/** 观察机位状态（WorldMode 与本模块共享的唯一状态） */
export const landingCamera = {
  shot: null as LandingCamShot | null,
};

/** 调参：起调高度 / 过渡时长 / 下机点侧向偏移 */
export const LANDING_CAM = {
  START_ALT: 45,
  BLEND: 1.2,
  EXIT_OFFSET: 13,
};

/** ★ 玩家下机点：舰船右舷侧旁偏移（右向量 = (f.z, -f.x)），只避坑 */
export function playerExitPoint(
  ship: ShipEntity | null, raster: RasterMap | null, shipX: number, shipZ: number,
): { x: number; y: number; z: number } {
  const f = ship?.forward ?? { x: 0, y: 0, z: 1 };
  if (!raster) return { x: shipX, y: 0, z: shipZ };
  const rx = f.z, rz = -f.x;
  const safe = resolveDockSpawn(
    raster,
    shipX + rx * LANDING_CAM.EXIT_OFFSET,
    shipZ + rz * LANDING_CAM.EXIT_OFFSET,
  );
  return { x: safe.x, y: raster.surfaceHeightAt(safe.x, safe.z), z: safe.z };
}

/** ★ 起调判定（降到起调高度）→ 一次性取景（固定镜头不抖） */
export function tryStartLandingShot(camera: THREE.Camera | null, ship: ShipEntity | null): void {
  if (!camera || !ship || landingCamera.shot) return;
  const raster = RasterMapValue.current;
  const gy0 = raster?.surfaceHeightAt(ship.position.x, ship.position.z) ?? 0;
  const alt0 = ship.position.y - gy0;
  if (alt0 > LANDING_CAM.START_ALT) return;
  // ★ 落点预测 = 与 landingStep 同模型的离散推进（收油 16 m/s²、sink=clamp(alt×0.4,2,8)）
  const f = ship.forward;
  let px = ship.position.x, pz = ship.position.z;
  let alt = alt0, v = ship.speedValue;
  for (let t = 0; t < 30 && alt > 0; t += 0.25) {
    px += f.x * v * 0.25;
    pz += f.z * v * 0.25;
    const sink = Math.min(
      travelConfig.flightLandingSinkMax,
      Math.max(travelConfig.flightLandingSink, alt * 0.4),
    );
    alt -= sink * 0.25;
    v = Math.max(travelConfig.flightLandingSpeed, v - 16 * 0.25);
  }
  const lgy = raster?.surfaceHeightAt(px, pz) ?? 0;
  const ax = ship.position.x, ay = ship.position.y, az = ship.position.z;
  const dx = px - ax, dz = pz - az;
  const hspan = Math.hypot(dx, dz);
  const hl = hspan || 1;
  const dirX = dx / hl, dirZ = dz / hl;
  const sideX = dirZ, sideZ = -dirX; // 进近方向右侧
  // ★ 机位基准 = A→B 整段【中点】（侧向取景；不再相对落点前移 → 修"只能看到机头"）
  const mx = (ax + px) * 0.5, mz = (az + pz) * 0.5;
  const span3 = Math.hypot(hspan, ay - lgy);
  const D = Math.min(140, Math.max(70, span3 * 0.55));
  const H = Math.min(50, Math.max(18, span3 * 0.25));
  // 正侧方（略向 A 偏 10%：从侧后方看，能看到完整机身而非迎面机头）
  const sx = mx + sideX * D - dirX * D * 0.1;
  const sz = mz + sideZ * D - dirZ * D * 0.1;
  const sgy = raster?.surfaceHeightAt(sx, sz) ?? 0;
  const midY = (ay + lgy) * 0.5;
  const shotPos = new THREE.Vector3(sx, Math.max(midY + H, sgy + 8), sz);
  const pivot = new THREE.Vector3(mx, midY + span3 * 0.06, mz);
  _camMat.lookAt(_camEye.copy(shotPos), pivot, _camUp);
  const shotQuat = new THREE.Quaternion().setFromRotationMatrix(_camMat);
  landingCamera.shot = {
    t: 0,
    fromPos: camera.position.clone(),
    fromQuat: camera.quaternion.clone(),
    shotPos, shotQuat, pivot,
  };
}

/** ★ 观察机位步进：缓入缓出 + 绕注视点球面弧；到位后钉死（飞机独立降入画面） */
export function updateLandingShot(camera: THREE.Camera | null, dt: number): void {
  const S = landingCamera.shot;
  if (!S || !camera) return;
  S.t += dt;
  const k = Math.min(1, S.t / LANDING_CAM.BLEND);
  const e = k * k * (3 - 2 * k);
  interpCamPose(S.fromPos, S.fromQuat, S.shotPos, S.shotQuat, e, S.pivot, camera.position, camera.quaternion);
  if (k >= 1) {
    camera.position.copy(S.shotPos);
    camera.quaternion.copy(S.shotQuat);
  }
}
