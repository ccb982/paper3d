// ============================================================
// SpaceBackdrop —— **基地**背景的舷外空间（2026-09-16）
// ============================================================
// 用户定调（修正版）：**基地**背景要星星和一颗不断转动的地球；
//   舰内（驾驶舱）背景保持灰色 —— 所以这里只在 BaseScene 里挂。
//
// 做法：
//   · 星空天穹 —— 半径 260 的大球（BackSide）：三层**圆点**星场（大小不一、
//     各自独立相位的闪烁），银河带 + 淡星云；星点在 shader 里靠 uTime 闪，
//     整片星空另外由 BaseScene 缓慢自转（"不停的动"）。
//   · 地球 —— 球体，地表/云层/极冠/昼夜/大气边缘全在 shader 里算，
//     自转 = 采样方向绕 y 轴转 uTime * ω（不需要 mesh.rotation）。
//
// 位置：基地大厅**下方**（大厅 83.8 × 12.6 × 18，地板在 y=0）→ 地球从地板前缘
//   下方"升"出来，只露出巨大的一段弧面（像站在行星轨道上看地平线），
//   上半球被地板挡住 —— 构图上是"基地悬浮在行星上方"。
//
// 生命周期：由 BaseScene 持有（挂在自己的 root 下 → 随房间一起回收）。

import * as THREE from 'three';
import { createEarthMaterial, createStarDomeMaterial } from './RoomSurfaceMaterial';

/** 空间背景句柄（dispose 释放几何与材质） */
export interface SpaceBackdrop {
  dome: THREE.Mesh;
  earth: THREE.Mesh;
  dispose(): void;
}

export interface SpaceBackdropOptions {
  /** 天穹星云色调 */
  nebula?: number;
  /** 地球位置（世界坐标） */
  earthPos?: [number, number, number];
  /** 地球半径 */
  earthRadius?: number;
}

export function createSpaceBackdrop(
  scene: THREE.Scene,
  opts: SpaceBackdropOptions = {},
): SpaceBackdrop {
  const [ex, ey, ez] = opts.earthPos ?? [0, -38, -35];
  const er = opts.earthRadius ?? 26.0;

  // ---- 星空天穹（最外层；不写深度，避免和远处几何互抢深度）----
  const domeGeo = new THREE.SphereGeometry(260, 48, 24);
  const domeMat = createStarDomeMaterial(opts.nebula ?? 0x5a7fd0);
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  // ---- 自转地球 ----
  const earthGeo = new THREE.SphereGeometry(er, 64, 40);
  const earthMat = createEarthMaterial();
  const earth = new THREE.Mesh(earthGeo, earthMat);
  earth.position.set(ex, ey, ez);
  earth.rotation.z = 0.41;         // 23.4° 轴倾角（顺手给一点）
  scene.add(earth);

  return {
    dome,
    earth,
    dispose(): void {
      domeGeo.dispose();
      domeMat.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      scene.remove(dome);
      scene.remove(earth);
    },
  };
}
