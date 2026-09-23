// ============================================================
// SpaceBackdrop —— **基地**背景的舷外空间（2026-09-16）
// ============================================================
// 用户定调：**基地**背景要星星和一颗不断转动的地球；舰内保持灰底（所以只在 BaseScene 挂）。
//
// 组成：
//   ① 星空天穹（半径 260 的大球，BackSide）—— 只有近乎纯黑的底 + 若有若无的银河/星云；
//   ② **可点击星点云**（THREE.Points）—— 少量很小的圆点星，大小不一、各自闪烁；
//      鼠标点中某颗 → 把它的 aAlive 置 0（熄灭）。要点得中就必须是真几何，
//      ShaderMaterial 里画的"假星星"是点不到的 —— 这是这一版重做的原因。
//   ③ 地球 —— shader 里的自转（uTime × uSpin）；JS 侧用同一个 SPIN 常数累计"转了多少圈"，
//      给"转满 100 圈 → 普瑞赛思出现在地球上"的彩蛋用（见 BaseScene）。
//
// 生命周期：由 BaseScene 持有（挂在它自己的 root 下 → 随房间一起回收）。

import * as THREE from 'three';
import {
  createEarthMaterial,
  createStarDomeMaterial,
  createStarPointsMaterial,
} from './RoomSurfaceMaterial';

/** 地球自转角速度（rad/s）：约 14 秒一圈。★ JS 计数与 shader 必须共用这一个常数 */
export const EARTH_SPIN = 0.45;

/** 星空自转（整片星空缓慢转，"不停的动"） */
const DOME_SPIN = 0.0045;

/** 星点数量（球面均匀分布；视野锥只占 ~5% → 实际能看到的约 130~160 颗） */
const STAR_COUNT = 2800;
/** 星点云半径（略小于天穹，避免与天穹同半径打架） */
const STAR_RADIUS = 244;

export interface SpaceBackdrop {
  dome: THREE.Mesh;
  earth: THREE.Mesh;
  stars: THREE.Points;
  /** 地球自转角速度（rad/s） */
  spin: number;
  /** 让第 index 颗星熄灭（返回是否成功） */
  extinguish(index: number): boolean;
  dispose(): void;
}

export interface SpaceBackdropOptions {
  /** 天穹星云色调 */
  nebula?: number;
  /** 地球位置（世界坐标） */
  earthPos?: [number, number, number];
  /** 地球半径 */
  earthRadius?: number;
  /** 渲染器像素比（点精灵大小要乘它，保证高点屏上不糊） */
  pixelRatio?: number;
}

export function createSpaceBackdrop(
  scene: THREE.Scene,
  opts: SpaceBackdropOptions = {},
): SpaceBackdrop {
  const [ex, ey, ez] = opts.earthPos ?? [0, -38, -35];
  const er = opts.earthRadius ?? 26.0;

  // ---- ① 星空天穹（最外层；不写深度）----
  const domeGeo = new THREE.SphereGeometry(260, 48, 24);
  const domeMat = createStarDomeMaterial(opts.nebula ?? 0x5a7fd0);
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  dome.userData.noSolid = true;          // ★ 半径 260 的天穹不能当实体（否则角色被"关"在里面）
  scene.add(dome);

  // ---- ② 可点击星点云 ----
  const pos = new Float32Array(STAR_COUNT * 3);
  const size = new Float32Array(STAR_COUNT);
  const phase = new Float32Array(STAR_COUNT);
  const alive = new Float32Array(STAR_COUNT);
  const tint = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // 球面均匀分布（u 均匀 → 面积均匀）
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const rxz = Math.sqrt(Math.max(0, 1 - u * u));
    pos[i * 3] = Math.cos(th) * rxz * STAR_RADIUS;
    pos[i * 3 + 1] = u * STAR_RADIUS;
    pos[i * 3 + 2] = Math.sin(th) * rxz * STAR_RADIUS;
    // 大小：大部分小、少数偏大（"有大有小"）；整体比上一版再放大一档
    const big = Math.random() < 0.16;
    size[i] = big ? 4.2 + Math.random() * 3.0 : 1.8 + Math.random() * 1.8;
    phase[i] = Math.random();
    alive[i] = 1;
    // 星色：多数冷白，少数暖白
    const warm = Math.random() < 0.22;
    tint[i * 3] = warm ? 1.0 : 0.86;
    tint[i * 3 + 1] = warm ? 0.90 : 0.93;
    tint[i * 3 + 2] = warm ? 0.76 : 1.0;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  starGeo.setAttribute('aAlive', new THREE.BufferAttribute(alive, 1));
  starGeo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
  const starMat = createStarPointsMaterial(opts.pixelRatio ?? 1);
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  stars.userData.noSolid = true;         // 星点云（Points，本就不会被收集；标注以防万一）
  scene.add(stars);

  // ---- ③ 自转地球 ----
  const earthGeo = new THREE.SphereGeometry(er, 64, 40);
  const earthMat = createEarthMaterial(EARTH_SPIN);
  const earth = new THREE.Mesh(earthGeo, earthMat);
  earth.position.set(ex, ey, ez);
  earth.rotation.z = 0.41;         // 23.4° 轴倾角
  earth.userData.noSolid = true;   // ★ 星球也不能当实体（大球同理）
  scene.add(earth);

  return {
    dome,
    earth,
    stars,
    spin: EARTH_SPIN,
    extinguish(index: number): boolean {
      const attr = starGeo.getAttribute('aAlive') as THREE.BufferAttribute;
      if (index < 0 || index >= attr.count) return false;
      if (attr.getX(index) < 0.5) return false;      // 已经灭过了
      attr.setX(index, 0);
      attr.needsUpdate = true;
      return true;
    },
    dispose(): void {
      domeGeo.dispose();
      domeMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      earthGeo.dispose();
      earthMat.dispose();
      scene.remove(dome);
      scene.remove(stars);
      scene.remove(earth);
    },
  };
}

/** 整片星空的缓慢自转（BaseScene 每帧调；不改场景结构，只转天穹） */
export function spinDome(backdrop: SpaceBackdrop, dt: number): void {
  backdrop.dome.rotation.y -= dt * DOME_SPIN;
}
