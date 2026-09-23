// ============================================================
// RoomDecor —— 基地 / 驾驶舱的房间布局与实体装饰（2026-09-16 · 极简改版）
// ============================================================
// 用户定调：「不用建模」= **不许从网上找 / 导入现成模型**；但**房间布局要有真的实体道具**，
//   改变布局的唯一手段就是 **自己写顶点**（RoomDecoGeo）+ **写 shader**（RoomSurfaceMaterial）。
//
// ★ 2026-09-16 极简改版（对齐经典实现：
//   nalbam/spaceship 的"少几何 + 好材质 + 接触阴影" / TheLongSilence 的"分区 + 灯光分层" /
//   SIGNALIS 的"大面积留白 + 功能位单点发光"）：
//   · 构件数量整体砍半：管道 6 根/间 → 2 根/间，百叶 4 组 → 1 组/侧，灯槽 3 条 → 2 条/间；
//   · 家具**对齐成组**（货箱矩阵、成排储物柜、对称工位），房间中轴留空——留白才是"简约"；
//   · 每件落地家具配一张软圆阴影（mats.shadow），把道具"焊"在地面上（GTAO 之外的第二层接触感）；
//   · 灯带只做功能位（踢脚 / 门楣 / 屏底 / 走道引导线），表面一律不发光。
//
// ★ 2026-09-16 动态化（用户定调："房间小，就要塞满可动元素，不然浪费性能"）：
//   每个 decorate* 都接收 anim 回调注册器 —— 房间里的**传送带 / 机械臂 / 行车 / 悬浮货箱 /
//   激光雷达 / 全息球 / 流水指示灯 / 蒸汽 / 数字抖动屏**等都由它驱动（共用 BaseScene 的时钟）。
//   动画一律是"小变换 + shader 时间 uniform"，几十个对象的矩阵更新可以忽略不计。
//
// add 回调由 BaseScene 注入：
//   · decorateShell —— 大厅级装饰（踢脚/腰线/桁架/管道/百叶/灯槽）
//   · decorate*     —— 单间内部布置（坐标为 bay 局部：x ∈ [-13.5, 13.5]，z ∈ [-9, 9]）
//
// ★ 碰撞（2026-09-16 用户定调）：**基地/舰内所有实体都有物理体积**——
//   房间建好后由 BaseScene.collectSolids 遍历场景自动收集（xz AABB），
//   角色与访客走动时用圆形推出解算；会动的道具（行车/小车/传送带工件/机械臂）
//   用 movable() 打标排除（它们位置每帧在变，静态 AABB 会对不上）。

import * as THREE from 'three';
import {
  arcLayout, chamferRectProfile, extrudeProfile, iBeamProfile,
  polyProfile, trapezoidProfile, wedgeProfile, type ArcSlot,
} from '../../services/render/RoomDecoGeo';
import type { KineticMover } from '../../services/physics/RoomPhysics';
import {
  createBlobShadowMaterial, createFlowMaterial, createHoloMaterial, createPadMaterial,
  createRoomSurfaceMaterial, createScreenMaterial, createSteamMaterial,
  createStripMaterial, createViewportMaterial, updateRoomTime,
} from '../../services/render/RoomSurfaceMaterial';

/** 每帧动画回调（t = 房间时钟秒，dt = 帧间隔秒） */
export type RoomAnimFn = (t: number, dt: number) => void;
/** 动画注册器（BaseScene 注入；进入房间时收集，update 每帧统一驱动） */
export type RegisterAnim = (fn: RoomAnimFn) => void;
/** 点击注册器（BaseScene 注入；双击命中该 mesh 时回调 —— 彩蛋 / 小交互用） */
export type RegisterClick = (mesh: THREE.Object3D, cb: () => void) => void;
/** ★ 运动学道具注册器（BaseScene 注入）：动画驱动的道具同时拥有物理实体，
 *  由 rapier 负责把沿途的 dynamic 家具推开（AGV 小车 / 行车吊箱）。 */
export type RegisterKinetic = (mover: KineticMover) => void;

// ★ 房间尺寸的唯一事实来源（BaseScene 与装饰件共用，不要各写一份）
export const ROOM_W = 27;
export const ROOM_H = 12.6;
export const ROOM_D = 18;
export const ROOM_GAP = 1.4;
export const WALL_T = 0.3;
/** 分界墙门洞半宽（沿进深 z；门高 3.0） */
export const DOOR_HALF = 1.1;
export const DOOR_H = 3.0;

export type AddFn = (
  geo: THREE.BufferGeometry, mat: THREE.Material,
  px: number, py: number, pz: number,
  rx?: number, ry?: number, rz?: number,
) => THREE.Mesh;

/** 房间用材质集合（BaseScene 建一次，全房共享） */
export interface DecorMats {
  floor: THREE.Material;
  wall: THREE.Material;
  ceil: THREE.Material;
  struct: THREE.Material;
  furn: THREE.Material;
  crate: THREE.Material;
  screen: THREE.Material;
  screenAlt: THREE.Material;
  strip: THREE.Material;
  stripWarm: THREE.Material;
  /** 竖向挤出的灯柱（行波沿 uv.y） */
  stripVert: THREE.Material;
  viewport: THREE.Material;
  /** 绿植（唯一的彩色实体：给灰色舱室一点生命感） */
  plant: THREE.Material;
  /** 家具接触阴影贴片 */
  shadow: THREE.Material;
  /** 管路 / 流水指示灯条的流光 */
  flow: THREE.Material;
  /** 蒸汽 / 热气面片 */
  steam: THREE.Material;
  /** 全息投影（光柱 / 悬浮地球） */
  holo: THREE.Material;
  /** 装饰用地面光圈（悬浮泊位 / 磁悬浮小物） */
  pad: THREE.Material;
  /** ★ 会被推动的墙/门框专用：wall 的**物体坐标**版本（否则推墙时格线钉在世界空间） */
  wallLocal: THREE.Material;
  /** ★ 同上：结构件（门柱/遮檐）的物体坐标版本 */
  structLocal: THREE.Material;
}

export function createDecorMats(cockpit: boolean): DecorMats {
  // ★ 极简色板：表面全部中性石墨灰，accent 只出现在功能位——
  //   基地 = 冷青（屏幕/灯带），舰内 = 琥珀（仪表/灯带）。
  const strip = cockpit ? 0xffc07a : 0xcfe6ff;
  const stripWarm = cockpit ? 0xffa84f : 0xffc98a;
  const stripVert = cockpit ? 0xffd6a0 : 0xa8d8f0;
  return {
    floor: createRoomSurfaceMaterial({ preset: cockpit ? 'cockpitFloor' : 'floor' }),
    wall: createRoomSurfaceMaterial({ preset: cockpit ? 'cockpit' : 'wall' }),
    ceil: createRoomSurfaceMaterial({ preset: 'ceil' }),
    struct: createRoomSurfaceMaterial({ preset: 'struct' }),
    furn: createRoomSurfaceMaterial({ preset: 'furn' }),
    crate: createRoomSurfaceMaterial({ preset: 'crate' }),
    screen: createScreenMaterial(cockpit ? 0xffb060 : 0x76d2ea, 0),
    screenAlt: createScreenMaterial(cockpit ? 0xff9840 : 0x63dcc0, 3.1),
    strip: createStripMaterial(strip, { speed: 0.9, bright: 0.92, axis: 0 }),
    stripWarm: createStripMaterial(stripWarm, { speed: 0.7, bright: 0.95, axis: 0 }),
    stripVert: createStripMaterial(stripVert, { speed: 0.5, bright: 0.88, axis: 1 }),
    viewport: createViewportMaterial(cockpit ? 0x8fb4ff : 0x7fb6ff),
    plant: new THREE.MeshStandardMaterial({ color: 0x4f6f55, roughness: 0.95, metalness: 0 }),
    shadow: createBlobShadowMaterial(cockpit ? 0.48 : 0.42),
    flow: createFlowMaterial(cockpit ? 0xffc98a : 0x8fd8ff, { speed: 0.5, dots: 3.0 }),
    steam: createSteamMaterial(0, 0.20, cockpit ? 0xcfd8de : 0xd8e2ea),
    holo: createHoloMaterial(cockpit ? 0xffc07a : 0x7fd8ff),
    pad: createPadMaterial(cockpit ? 0xffc98a : 0x8fd8ff, 0.35),
    wallLocal: createRoomSurfaceMaterial({ preset: cockpit ? 'cockpit' : 'wall', local: true }),
    structLocal: createRoomSurfaceMaterial({ preset: 'struct', local: true }),
  };
}

/** 每帧喂一次时间即可驱动全部房间材质（所有材质共享同一个 clock uniform） */
export { updateRoomTime };

/** 交互站地面光圈材质 */
export function createPadMaterialFor(color: number, seed: number): THREE.ShaderMaterial {
  return createPadMaterial(color, seed);
}

// ------------------------------------------------------------
// 通用小工具
// ------------------------------------------------------------

/** 沿 z 挤出的构件转成沿 x 摆放（flip=true 时把 xy 轮廓沿 z 镜像，用于斜面朝向）
 *  ⚠️ 只对 **extrudeProfile 产物** 用；BoxGeometry/Cylinder 的长轴要另算。 */
function beamX(
  add: AddFn, geo: THREE.BufferGeometry, mat: THREE.Material,
  x: number, y: number, z: number, flip = false,
): THREE.Mesh {
  return add(geo, mat, x, y, z, 0, flip ? Math.PI / 2 : -Math.PI / 2, 0);
}

/** 在 yaw 朝向的本体系中放置部件（ox/oy/oz 为部件自身局部偏移） */
function place(
  add: AddFn, geo: THREE.BufferGeometry, mat: THREE.Material,
  slot: ArcSlot, ox: number, oy: number, oz: number, extraYaw = 0, extraPitch = 0,
): THREE.Mesh {
  const yaw = slot.yaw + extraYaw;
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return add(geo, mat, slot.x + ox * c + oz * s, oy, slot.z - ox * s + oz * c, extraPitch, yaw, 0);
}

/** 家具接触阴影：一块铺在底面的软圆影（rx/rz = 足迹半径；y 默认贴地） */
function shadow(
  add: AddFn, mats: DecorMats,
  x: number, z: number, rx: number, rz: number, y = 0.012, ry = 0,
): THREE.Mesh {
  return add(new THREE.PlaneGeometry(rx * 2, rz * 2), mats.shadow, x, y, z, -Math.PI / 2, ry, 0);
}

/** 绿植：陶盆 + 三团叶球（房间里唯一的高饱和实色，用来"点"一下构图） */
function plantPot(add: AddFn, mats: DecorMats, x: number, z: number, scale = 1): void {
  const s = scale;
  add(new THREE.CylinderGeometry(0.46 * s, 0.36 * s, 0.62 * s, 12, 1), mats.struct, x, 0.31 * s, z);
  add(new THREE.SphereGeometry(0.72 * s, 10, 8), mats.plant, x, 1.25 * s, z);
  add(new THREE.SphereGeometry(0.46 * s, 9, 7), mats.plant, x + 0.42 * s, 0.95 * s, z - 0.18 * s);
  add(new THREE.SphereGeometry(0.38 * s, 9, 7), mats.plant, x - 0.34 * s, 1.05 * s, z + 0.30 * s);
  shadow(add, mats, x, z, 0.72 * s, 0.72 * s);
}

/** 储物柜组（沿 ±x 侧墙；厢体 + 两条门缝 + 顶部指示灯） */
function lockerBank(
  add: AddFn, mats: DecorMats,
  side: -1 | 1, z: number, w = 1.8, h = 2.2, onPlatform = false,
): void {
  const x = side * (ROOM_W / 2 - 0.52);
  const y0 = onPlatform ? 0.7 : 0;
  add(extrudeProfile(chamferRectProfile(w, h, 0.08), 0.9), mats.furn, x, y0 + h / 2, z, 0, Math.PI / 2, 0);
  const faceX = x - side * 0.46;
  add(new THREE.BoxGeometry(0.05, h - 0.3, 0.05), mats.struct, faceX, y0 + h / 2, z);
  add(new THREE.BoxGeometry(0.05, 0.05, 0.5), mats.struct, faceX - side * 0.03, y0 + h * 0.55, z - 0.35);
  add(new THREE.BoxGeometry(0.05, 0.05, 0.5), mats.struct, faceX - side * 0.03, y0 + h * 0.55, z + 0.35);
  add(new THREE.BoxGeometry(0.06, 0.06, w * 0.86), mats.stripVert, faceX - side * 0.04, y0 + h - 0.14, z);
  shadow(add, mats, x - side * 0.3, z, 0.7, w * 0.6, y0 + 0.012);
}

// ------------------------------------------------------------
// 可动元素（2026-09-16 用户定调："房间小就要塞满可动的东西，不然浪费性能"）
// ------------------------------------------------------------

/** ★ 大屏数字贴图（彩蛋用）：0..9 × {冷色, 金色} 缓存（Canvas 画，不占外部资源） */
const digitTexCache = new Map<string, THREE.Texture>();
function digitTexture(d: number, gold: boolean): THREE.Texture {
  const key = d + (gold ? 'g' : 'c');
  const hit = digitTexCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#070b0f';
  g.fillRect(0, 0, 256, 256);
  // 底纹网格（屏幕质感）
  g.strokeStyle = gold ? 'rgba(255,190,90,0.22)' : 'rgba(130,200,225,0.16)';
  g.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i * 64); g.lineTo(256, i * 64); g.stroke();
  }
  const col = gold ? '#ffc44a' : '#8fe0ff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 170px "Consolas", "Courier New", monospace';
  g.shadowColor = col;
  g.shadowBlur = 38;
  g.fillStyle = col;
  g.fillText(String(d), 128, 140);
  g.fillText(String(d), 128, 140);   // 叠两遍加强辉光
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  // ★ 命中缓存的贴图**不随房间销毁**（跨房间复用；BaseScene.dispose 见 userData.keep 跳过）
  tex.userData.keep = true;
  digitTexCache.set(key, tex);
  return tex;
}

/** ★ 金色星芒光晕贴图（彩蛋闪光的"炫目"层）：径向渐变 + 十字星芒，缓存复用 */
let haloTexCache: THREE.Texture | null = null;
function haloTexture(): THREE.Texture {
  if (haloTexCache) return haloTexCache;
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 512;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, 512, 512);
  // 中心径向辉光
  const rad = g.createRadialGradient(256, 256, 0, 256, 256, 250);
  rad.addColorStop(0.0, 'rgba(255,244,214,1.00)');
  rad.addColorStop(0.18, 'rgba(255,214,120,0.85)');
  rad.addColorStop(0.45, 'rgba(255,186,72,0.35)');
  rad.addColorStop(1.0, 'rgba(255,170,40,0.00)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 512, 512);
  // 十字星芒（横 / 竖 / 两条斜向细芒）
  const flares: readonly [number, number, number][] = [
    [1, 0, 1.0], [0, 1, 0.9], [0.7071, 0.7071, 0.45], [0.7071, -0.7071, 0.45],
  ];
  for (const [dx, dy, k] of flares) {
    const grad = g.createLinearGradient(256 - dx * 256, 256 - dy * 256, 256 + dx * 256, 256 + dy * 256);
    grad.addColorStop(0.0, 'rgba(255,200,90,0.0)');
    grad.addColorStop(0.5, 'rgba(255,246,220,0.95)');
    grad.addColorStop(1.0, 'rgba(255,200,90,0.0)');
    g.save();
    g.translate(256, 256);
    g.rotate(Math.atan2(dy, dx));
    g.scale(1, k * 12 / 256);
    g.translate(-256, -256);
    g.fillStyle = grad;
    g.fillRect(0, 248, 512, 16);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.keep = true;
  haloTexCache = tex;
  return tex;
}

/** ★ 标记"会动的道具"：位置每帧在变 → 不参与实体碰撞收集（BaseScene.collectSolids） */
function movable(...objs: THREE.Object3D[]): void {
  for (const o of objs) o.userData.noSolid = true;
}

/** 流水指示灯条（流光沿长轴跑；沿 x 放） */
function flowBar(add: AddFn, mats: DecorMats, x: number, y: number, z: number, len: number): THREE.Mesh {
  return add(new THREE.BoxGeometry(len, 0.07, 0.07), mats.flow, x, y, z);
}

/** 全息球：自转线框球 + 双环（各挂一颗卫星看得出转动）+ 底部光锥 */
function holoGlobe(
  add: AddFn, mats: DecorMats, anim: RegisterAnim,
  x: number, y: number, z: number, r = 0.55,
): void {
  const core = add(new THREE.IcosahedronGeometry(r, 1), mats.holo, x, y, z);
  const ringA = add(new THREE.TorusGeometry(r * 1.5, 0.02, 6, 30), mats.holo, x, y, z);
  ringA.rotation.x = Math.PI / 2;                       // 水平环
  const satA = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.11), mats.strip);
  satA.position.set(r * 1.5, 0, 0);
  ringA.add(satA);
  const ringB = add(new THREE.TorusGeometry(r * 1.2, 0.015, 6, 26), mats.holo, x, y, z);
  ringB.rotation.set(1.0, 0.0, 0.35);
  const satB = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), mats.stripWarm);
  satB.position.set(r * 1.2, 0, 0);
  ringB.add(satB);
  const beam = add(
    new THREE.CylinderGeometry(r * 0.80, r * 0.14, r * 2.6, 12, 1, true), mats.holo,
    x, y - r * 1.8, z,
  );
  anim((t) => {
    core.rotation.y = t * 0.5;
    core.rotation.x = 0.22 * Math.sin(t * 0.31);
    ringA.rotation.y = t * 0.85;
    ringB.rotation.y = -t * 0.62;
    const pulse = 1 + 0.06 * Math.sin(t * 2.3);
    beam.scale.set(pulse, 1, pulse);
  });
}

/** 蒸汽 / 热气（竖面片自动向上翻滚；摆在炉口 / 排气管上方） */
function steamPuffs(
  add: AddFn, mats: DecorMats,
  x: number, y: number, z: number, w = 1.1, h = 1.7, n = 3,
): void {
  for (let i = 0; i < n; i++) {
    const p = add(
      new THREE.PlaneGeometry(w * (0.75 + i * 0.22), h * (0.75 + i * 0.18)), mats.steam,
      x + (i - 1) * 0.24, y + h * 0.42 + i * 0.30, z + i * 0.05,
    );
    p.rotation.z = (i - 1) * 0.22;
  }
}

/** 悬浮货箱（防重力泊位：地面光圈 + 上下浮动 + 轻微转向） */
function hoverCrate(
  add: AddFn, mats: DecorMats, anim: RegisterAnim,
  x: number, z: number, size = 1.1, hoverY = 0.78, phase = 0,
): void {
  const pad = add(new THREE.PlaneGeometry(size * 2.8, size * 2.8), mats.pad, x, 0.02, z, -Math.PI / 2, 0, 0);
  pad.renderOrder = 1;
  const box = add(new THREE.BoxGeometry(size, size * 0.8, size), mats.crate, x, hoverY, z);
  const sh = shadow(add, mats, x, z, size * 0.85, size * 0.85);
  movable(box);   // 自身在上下浮动 → 不做刚体家具
  anim((t) => {
    box.position.y = hoverY + Math.sin(t * 1.05 + phase) * 0.075;
    box.rotation.y = Math.sin(t * 0.22 + phase) * 0.14;
    const s = 1 + 0.05 * Math.sin(t * 1.05 + phase);
    sh.scale.set(s, s, 1);
  });
}

/** 自动导引小车（沿 z 往返；车上有货 + 底部流光） */
function agvCart(
  add: AddFn, mats: DecorMats, anim: RegisterAnim, kinetic: RegisterKinetic,
  x: number, z0: number, z1: number, speed = 0.20,
): void {
  const body = add(new THREE.BoxGeometry(1.5, 0.42, 2.3), mats.furn, x, 0.40, z0);
  const deck = add(new THREE.BoxGeometry(1.25, 0.10, 2.0), mats.crate, x, 0.66, z0);
  const box = add(new THREE.BoxGeometry(0.95, 0.85, 0.95), mats.crate, x, 1.13, z0);
  const glow = add(new THREE.BoxGeometry(1.55, 0.06, 2.35), mats.flow, x, 0.15, z0);
  const sh = shadow(add, mats, x, z0, 0.95, 1.35);
  movable(body, deck, box, glow);
  // ★ 物理实体：kinematic 盒随动画走，rapier 自动推挤沿途家具
  const pos = { x, y: 0.45, z: z0 };
  kinetic({ hx: 0.8, hy: 0.32, hz: 1.18, at: () => pos });
  anim((t) => {
    const k = 0.5 - 0.5 * Math.cos(t * speed);   // 平滑往返（端点自然减速）
    const z = z0 + (z1 - z0) * k;
    pos.z = z;
    body.position.z = z;
    deck.position.z = z;
    glow.position.z = z;
    sh.position.z = z;
    box.position.z = z;
    box.rotation.y = Math.sin(t * 0.5) * 0.05;
  });
}

/** 吊装行车（轨道 + 小车沿 x 往返 + 吊索升降 + 吊着货箱） */
function gantryCrane(
  add: AddFn, mats: DecorMats, anim: RegisterAnim, kinetic: RegisterKinetic,
  x0: number, x1: number, z: number, yTop: number, yLow: number,
): void {
  const mid = (x0 + x1) / 2;
  add(new THREE.BoxGeometry(x1 - x0, 0.16, 0.16), mats.struct, mid, yTop, z - 0.6);
  add(new THREE.BoxGeometry(x1 - x0, 0.16, 0.16), mats.struct, mid, yTop, z + 0.6);
  const trolley = add(new THREE.BoxGeometry(1.1, 0.30, 1.3), mats.furn, x0, yTop - 0.24, z);
  const cable = add(new THREE.CylinderGeometry(0.04, 0.04, 1, 6, 1), mats.struct, x0, yTop - 0.8, z);
  const hook = add(new THREE.BoxGeometry(1.0, 0.12, 1.0), mats.struct, x0, yTop - 1.4, z);
  const box = add(new THREE.BoxGeometry(0.95, 0.95, 0.95), mats.crate, x0, yTop - 2.0, z);
  movable(trolley, cable, hook, box);
  // ★ 吊箱也有物理实体（kinematic）：扫过去能把货堆撞开
  const hb = { x: x0, y: yTop - 2.0, z };
  kinetic({ hx: 0.55, hy: 0.55, hz: 0.55, at: () => hb });
  anim((t) => {
    const kx = 0.5 - 0.5 * Math.cos(t * 0.11);                  // 沿轨道慢速往返
    const x = x0 + (x1 - x0) * kx;
    const kd = 0.5 - 0.5 * Math.cos(t * 0.42 + 1.2);            // 吊索升降
    const hookY = yTop - 1.4 - kd * (yTop - 1.4 - yLow);
    const cLen = Math.max(0.12, (yTop - 0.39) - hookY);
    trolley.position.x = x;
    cable.scale.y = cLen;
    cable.position.set(x, yTop - 0.39 - cLen / 2, z);
    hook.position.set(x, hookY, z);
    box.position.set(x, hookY - 0.56, z);
    hb.x = x;
    hb.y = hookY - 0.56;
  });
}

/** 传送带：滚轴自转 + 工件沿线循环（x0 → x1） */
function beltLine(
  add: AddFn, mats: DecorMats, anim: RegisterAnim,
  x0: number, x1: number, z: number, y = 1.05, pkgs = 4, speed = 0.055,
): void {
  const len = x1 - x0;
  const mid = (x0 + x1) / 2;
  add(new THREE.BoxGeometry(len + 0.6, 0.30, 1.3), mats.struct, mid, y, z);
  for (const lx of [x0 + 0.7, mid, x1 - 0.7]) {
    add(new THREE.BoxGeometry(0.22, y - 0.18, 0.22), mats.struct, lx, (y - 0.18) / 2, z);
  }
  const rollerGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.2, 10, 1);
  rollerGeo.rotateX(Math.PI / 2);                       // 轴 → z，mesh.rotation.z 就是自转
  const rollers: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    rollers.push(add(rollerGeo, mats.furn, x0 + 0.55 + i * ((len - 1.1) / 7), y + 0.17, z));
  }
  const boxGeo = new THREE.BoxGeometry(0.82, 0.56, 0.82);
  const list: THREE.Mesh[] = [];
  for (let i = 0; i < pkgs; i++) {
    list.push(add(boxGeo, mats.crate, x0 + (i * len) / pkgs, y + 0.60, z));
  }
  movable(...list);
  anim((t) => {
    for (const r of rollers) r.rotation.z = -t * 2.4;
    for (let i = 0; i < list.length; i++) {
      const u = (i / list.length + t * speed) % 1;
      list[i].position.x = x0 + u * len;
      list[i].rotation.y = Math.sin(t * 1.4 + i) * 0.04;
    }
  });
}

/** 机械臂（取放循环：转台 + 肩 + 肘 + 夹爪 + 被搬运 / 已放置的货箱）
 *  ★ 关节长度按"够得到传送带面(≈1.6m)与托盘面(≈0.5m)"反算过：
 *     取件位 θ1=-0.27 θ2=-1.85 → 爪尖 y≈1.83；放件位 θ1=1.27 θ2=-1.32 → 爪尖 y≈0.89
 *  yawPick/yawPlace = 取 / 放两个方向的转台角度；landX/landZ = 放件落点（静态箱留在那） */
function robotArm(
  add: AddFn, mats: DecorMats, anim: RegisterAnim,
  x: number, z: number, yawPick: number, yawPlace: number, landX: number, landZ: number,
): void {
  const turret = add(new THREE.CylinderGeometry(0.34, 0.44, 1.6, 10, 1), mats.struct, x, 0.8, z);
  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.30, 12, 10), mats.struct);
  shoulder.position.set(0, 1.60, 0);                     // 肩关节（world y = 2.4）
  turret.add(shoulder);

  const upperGeo = new THREE.CylinderGeometry(0.15, 0.17, 1.2, 10, 1);
  upperGeo.translate(0, -0.6, 0);                        // 顶端 = 肩关节
  const upper = new THREE.Mesh(upperGeo, mats.struct);
  shoulder.add(upper);

  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mats.furn);
  elbow.position.set(0, -1.2, 0);
  upper.add(elbow);

  const foreGeo = new THREE.CylinderGeometry(0.12, 0.13, 1.15, 10, 1);
  foreGeo.translate(0, -0.575, 0);
  const fore = new THREE.Mesh(foreGeo, mats.struct);
  elbow.add(fore);

  const gripper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.34), mats.furn);
  gripper.position.set(0, -1.15, 0);
  fore.add(gripper);
  const fingerGeo = new THREE.BoxGeometry(0.08, 0.34, 0.26);
  const fL = new THREE.Mesh(fingerGeo, mats.struct);
  const fR = new THREE.Mesh(fingerGeo, mats.struct);
  fL.position.set(-0.17, -0.2, 0);
  fR.position.set(0.17, -0.2, 0);
  gripper.add(fL, fR);

  // 被抓着的货箱（挂在夹爪下；只有搬运段可见）
  const carried = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.8), mats.crate);
  carried.position.set(0, -0.45, 0);
  gripper.add(carried);

  // 放下的货箱：**独立静态件**留在托盘上（不跟着机械臂回去）
  const placed = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.8), mats.crate);
  placed.position.set(landX, 0.46, landZ);
  turret.parent?.add(placed);                            // 与转台同级（不随机械臂移动）

  movable(turret, shoulder, upper, elbow, fore, gripper, fL, fR, carried, placed);
  const T = 9.0;                                         // 一个取放循环（秒）
  anim((t) => {
    const p = (t % T) / T;
    const swing = 0.5 - 0.5 * Math.cos(Math.PI * 2 * p);   // 0→1→0 缓动
    turret.rotation.y = yawPick + (yawPlace - yawPick) * swing;
    shoulder.rotation.z = -0.27 + 1.54 * swing;
    elbow.rotation.z = -1.85 + 0.53 * swing;
    const carry = p > 0.16 && p < 0.62;                    // 抓着走的一段
    carried.visible = carry;
    placed.visible = p > 0.60;                             // 松手后留在托盘上
    const open = (p > 0.62 || p < 0.16) ? 0.05 : 0.0;      // 夹爪开合
    fL.position.x = -0.17 - open;
    fR.position.x = 0.17 + open;
  });
}

/** 旋转雷达天线（碟面 + 天线杆，整体缓慢自转；带指示灯） */
function radarDish(add: AddFn, mats: DecorMats, anim: RegisterAnim, x: number, y: number, z: number): void {
  add(new THREE.CylinderGeometry(0.18, 0.24, 0.6, 10, 1), mats.struct, x, y - 0.3, z);
  const pivot = add(new THREE.CylinderGeometry(0.06, 0.06, 0.4, 8, 1), mats.struct, x, y + 0.2, z);
  const dish = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 1.1), mats.furn);
  dish.position.set(0, 0.26, 0.1);
  dish.rotation.x = -0.6;
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6, 1), mats.struct);
  rod.position.set(0, 0.5, 0.45);
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mats.stripWarm);
  led.position.set(0, 0.72, 0.62);
  pivot.add(dish, rod, led);
  anim((t) => { pivot.rotation.y = t * 0.55; });
}

/** 惰轮 / 飞轮（几何里把轴转到 z，mesh.rotation.z 即自转；轮上挂配重看得见转动） */
function flywheel(add: AddFn, mats: DecorMats, anim: RegisterAnim, x: number, y: number, z: number, r = 0.62): void {
  const geo = new THREE.CylinderGeometry(r, r, 0.16, 18, 1);
  geo.rotateX(Math.PI / 2);
  const wheel = add(geo, mats.struct, x, y, z);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(r * 1.7, 0.10, 0.06), mats.furn);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 10, 1), mats.furn);
  hub.rotation.x = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.92, 0.05, 6, 24), mats.stripVert);
  wheel.add(arm, hub, rim);
  anim((t) => { wheel.rotation.z = -t * 1.4; });
}

/** 磁悬浮小物（杯子 / 工具）：悬浮 + 底下光圈 */
function hoverProp(
  add: AddFn, mats: DecorMats, anim: RegisterAnim,
  x: number, y: number, z: number, geo: THREE.BufferGeometry, phase = 0,
): void {
  const pad = add(new THREE.PlaneGeometry(0.7, 0.7), mats.pad, x, y - 0.16, z, -Math.PI / 2, 0, 0);
  pad.renderOrder = 1;
  const prop = add(geo, mats.struct, x, y, z);
  movable(prop);  // 磁悬浮 → 不做刚体家具
  anim((t) => {
    prop.position.y = y + Math.sin(t * 1.7 + phase) * 0.035;
    prop.rotation.y = t * 0.4 + phase;
  });
}

// ------------------------------------------------------------
// 大厅壳体的通用装饰（三间打通，沿整条 hall 布置）
// ------------------------------------------------------------

export function decorateShell(
  addRaw: AddFn, mats: DecorMats, hallW: number, bays: number[], anim: RegisterAnim,
): void {
  // ★ 壳体级装饰（踢脚 / 腰线 / 桁架 / 管道 / 通风口 / 灯槽 / 灯柱）是**建筑**，
  //   不参与"可推家具"物理：否则沿墙一圈的踢脚线会与地台/管道等**串成一个
  //   覆盖整间房的大簇**（合簇是按 AABB 接触传递的）→ 角色被关在里面走不动。
  const add: AddFn = (geo, mat, x, y, z, rx, ry, rz) => {
    const m = addRaw(geo, mat, x, y, z, rx, ry, rz);
    m.userData.noSolid = true;
    return m;
  };
  const W = hallW;
  const halfW = W / 2;
  const zb = -ROOM_D / 2;       // 背墙内表面 z
  const yCeil = ROOM_H - 0.45;

  // ---- ① 墙脚斜面踢脚：把墙面和地面接起来，不再是一条直棱 ----
  const skirt = extrudeProfile(wedgeProfile(0.46, 0.40, 0.30), W);
  add(skirt, mats.struct, 0, 0.20, zb + 0.25, 0, -Math.PI / 2, 0);   // 背墙（斜面向 +z）
  const skirtSide = extrudeProfile(wedgeProfile(0.46, 0.40, 0.30), ROOM_D);
  add(skirtSide, mats.struct, -halfW + 0.25, 0.20, 0);               // 左墙（斜面向 +x）
  add(skirtSide, mats.struct, halfW - 0.25, 0.20, 0, 0, Math.PI, 0); // 右墙（斜面向 -x）

  // ---- ② 墙面结构腰线（y=3.0）：给 12.6m 高的墙分段，一条就够 ----
  const belt = extrudeProfile(chamferRectProfile(0.26, 0.34, 0.08), W);
  add(belt, mats.struct, 0, 3.0, zb + 0.15, 0, -Math.PI / 2, 0);
  const beltSide = extrudeProfile(chamferRectProfile(0.26, 0.34, 0.08), ROOM_D);
  add(beltSide, mats.struct, -halfW + 0.15, 3.0, 0);
  add(beltSide, mats.struct, halfW - 0.15, 3.0, 0, 0, Math.PI, 0);

  // ---- ③ 天花板桁架：每间 2 道横梁（z=±3.4）+ 分界处纵梁（数量砍半）----
  const truss = extrudeProfile(iBeamProfile(0.50, 0.34, 0.08), W);
  for (const dz of [-3.4, 3.4]) beamX(add, truss, mats.struct, 0, yCeil, dz);
  const trussZ = extrudeProfile(iBeamProfile(0.50, 0.34, 0.08), ROOM_D);
  const divs = bays.slice(0, -1).map((b) => b + (ROOM_W + ROOM_GAP) / 2);
  for (const dx of [-halfW + 0.35, ...divs, halfW - 0.35]) add(trussZ, mats.struct, dx, yCeil + 0.20, 0);

  // ---- ④ 背墙竖向管道 + 卡箍（每间 2 根；整条 hall 只留一条管线束）----
  const pipeGeo = new THREE.CylinderGeometry(0.20, 0.20, ROOM_H - 1.4, 10, 1);
  const clampGeo = extrudeProfile(chamferRectProfile(0.62, 0.18, 0.06), 0.30);
  for (const bx of bays) {
    for (const px of [-11.2, -9.9]) {
      add(pipeGeo, mats.struct, bx + px, ROOM_H / 2 - 0.35, zb + 0.22);
      for (const cy of [2.6, 6.4]) add(clampGeo, mats.struct, bx + px, cy, zb + 0.22);
    }
  }

  // ---- ⑤ 侧墙高处通风口（每侧 1 组：凹槽面板 + 5 道水平百叶）----
  //   旧版是 6 片斜叶片，正面看上去像一排黑色飞鸟（视觉噪声）→ 换成规整的格栅口
  const ventPanel = new THREE.BoxGeometry(0.10, 1.6, 2.8);
  const ventBlade = new THREE.BoxGeometry(0.12, 0.07, 2.5);
  for (const sx of [-halfW + 0.10, halfW - 0.10]) {
    add(ventPanel, mats.furn, sx, 9.0, 0);
    for (let i = 0; i < 5; i++) {
      add(ventBlade, mats.struct, sx - Math.sign(sx) * 0.06, 8.45 + i * 0.28, 0);
    }
  }

  // ---- ⑥ 背墙竖向灯柱（每间 2 根；挤出的长轴是局部 y → 行波走 uv.y）----
  const vStrip = extrudeProfile(chamferRectProfile(0.16, ROOM_H - 3.8, 0.05), 0.24);
  for (const bx of bays) {
    for (const px of [-12.7, 12.7]) add(vStrip, mats.stripVert, bx + px, ROOM_H / 2 + 0.3, zb + 0.13);
  }

  // ---- ⑦ 天花板灯槽（每间 2 条，对齐桁架）----
  const troughShell = extrudeProfile(chamferRectProfile(1.15, 0.24, 0.10), ROOM_W * 0.50);
  const tubeGeo = new THREE.BoxGeometry(ROOM_W * 0.46, 0.08, 0.26);
  for (const bx of bays) {
    for (const dz of [-3.4, 3.4]) {
      beamX(add, troughShell, mats.struct, bx, ROOM_H - 0.20, dz);
      add(tubeGeo, mats.strip, bx, ROOM_H - 0.36, dz);
    }
  }

  // ---- ⑧ 背墙贯通灯带（高位一条，压得比旧版暗：只是"墙面收边"）----
  add(new THREE.BoxGeometry(W * 0.88, 0.09, 0.06), mats.stripWarm, 0, ROOM_H * 0.74, zb + 0.05);

  // ---- ⑨ 可动：每间一条"流水指示灯条"（追灯）+ 门楣上的旋转警示灯 ----
  for (const bx of bays) flowBar(add, mats, bx, 9.6, zb + 0.12, ROOM_W * 0.40);
  for (const bx of bays.slice(0, -1)) {
    const doorX = bx + (ROOM_W + ROOM_GAP) / 2;
    const pivot = add(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 8, 1), mats.struct, doorX, DOOR_H + 1.02, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), mats.furn);
    arm.position.set(0.45, 0.02, 0);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mats.stripWarm);
    lamp.position.set(0.9, 0.02, 0);
    pivot.add(arm, lamp);
    anim((t) => { pivot.rotation.y = t * 1.6; });
  }
  void anim;
}

// ------------------------------------------------------------
// 指挥室：三联大屏 + 3 工位指挥弧 + 中央全息台 + 侧墙机柜 + 绿植
// ------------------------------------------------------------

export function decorateControl(add: AddFn, mats: DecorMats, anim: RegisterAnim, click: RegisterClick): void {
  const zb = -ROOM_D / 2; // -9

  // ---- 屏幕墙：3 块大屏（不是 7 块小板）—— 大面、留白、单点发光 ----
  const screenPanel = extrudeProfile(chamferRectProfile(4.9, 3.1, 0.22), 0.36);
  const screenFace = new THREE.PlaneGeometry(4.3, 2.55);
  // ★ 三块屏各一种动态内容：警戒雷达 / 示波器波形 / 频谱柱+包络（都不带无意义数字）
  const screenModes: THREE.Material[] = [
    createScreenMaterial(0x76d2ea, 0.0, 2),
    createScreenMaterial(0x8fe0ff, 0.0, 1),
    createScreenMaterial(0x63dcc0, 0.0, 3),
  ];
  // ★ 彩蛋（用户定调）：双击屏幕 → 显示 0，再双击 +1（0..9 循环）；
  //   三块屏读成 325 或 799 → 屏幕变金色且数字持续闪烁。
  const lockDigits = [-1, -1, -1];                       // -1 = 还在播动态内容
  const digitMats: THREE.MeshBasicMaterial[] = [];
  const digitFaces: THREE.Mesh[] = [];
  const halos: THREE.Mesh[] = [];
  const isLucky = (): boolean =>
    (lockDigits[0] === 3 && lockDigits[1] === 2 && lockDigits[2] === 5)
    || (lockDigits[0] === 7 && lockDigits[1] === 9 && lockDigits[2] === 9);
  const refreshDigits = (): void => {
    const gold = isLucky();
    for (let i = 0; i < 3; i++) {
      if (lockDigits[i] < 0) continue;
      const m = digitMats[i];
      m.map = digitTexture(lockDigits[i], gold);
      m.needsUpdate = true;
    }
  };
  for (let i = 0; i < 3; i++) {
    const sx = [-5.4, 0, 5.4][i];
    const yaw = sx === 0 ? 0 : (sx < 0 ? 0.10 : -0.10);
    add(screenPanel, mats.furn, sx, 3.5, zb + 0.40, 0, yaw, 0);
    const face = add(screenFace, screenModes[i], sx, 3.5, zb + 0.60, 0, yaw, 0);
    digitFaces.push(face);
    // 金色星芒光晕（加色混合；平时 opacity=0，中奖时过曝闪）
    const halo = add(
      new THREE.PlaneGeometry(5.8, 3.8),
      new THREE.MeshBasicMaterial({
        map: haloTexture(), color: 0xffc24a, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      }),
      sx, 3.5, zb + 0.52, 0, yaw, 0,
    );
    halos.push(halo);
    const dmat = new THREE.MeshBasicMaterial({ map: digitTexture(0, false), toneMapped: false });
    digitMats.push(dmat);
    click(face, () => {
      lockDigits[i] = lockDigits[i] < 0 ? 0 : (lockDigits[i] + 1) % 10;
      face.material = dmat;                              // 切到"数字锁"模式
      refreshDigits();
    });
  }
  // ★ 金色 = 炫目夸张的爆闪：数字本体过曝（>1 会被压成白心）+ 星芒光晕 + 抖屏缩放
  anim((t) => {
    if (lockDigits[0] < 0 && lockDigits[1] < 0 && lockDigits[2] < 0) return;
    const lucky = isLucky();
    if (!lucky) {
      for (let i = 0; i < 3; i++) {
        digitMats[i].color.setScalar(1.0);
        const face = digitFaces[i];
        // 抖动残留清零（位置 / 缩放都复原）
        face.position.set([-5.4, 0, 5.4][i], 3.5, zb + 0.60);
        face.scale.setScalar(1);
        const halo = halos[i];
        (halo.material as THREE.MeshBasicMaterial).opacity = 0;
        halo.scale.setScalar(1);
      }
      return;
    }
    // 方波爆闪（约 9Hz，带二次谐波 → 不均匀的"啪、啪"感）
    const w = Math.sin(t * 22.0) + 0.35 * Math.sin(t * 47.0);
    const on = w > -0.1;
    const v = on ? 2.9 : 0.28;                             // 过曝（白心金边）
    const haloA = on ? 0.95 : 0.10;
    const haloScale = on ? 1.12 : 0.94;
    // 抖屏：高频小幅位移 + 随机缩放（"不稳的高压闪光"）
    const jx = 0.035 * (Math.sin(t * 61.0) + 0.6 * Math.sin(t * 97.0));
    const jy = 0.030 * (Math.cos(t * 73.0) + 0.5 * Math.sin(t * 113.0));
    const sc = 1 + (on ? 0.055 : -0.02) + 0.012 * Math.sin(t * 89.0);
    for (let i = 0; i < 3; i++) {
      digitMats[i].color.setScalar(v);
      const face = digitFaces[i];
      const baseX = [-5.4, 0, 5.4][i];
      face.position.set(baseX - jx, 3.5 + jy, zb + 0.60);
      face.scale.setScalar(sc);
      const halo = halos[i];
      const h = halo.material as THREE.MeshBasicMaterial;
      h.opacity = haloA;
      halo.scale.setScalar(haloScale + 0.05 * Math.sin(t * 55.0 + i));
    }
  });
  flowBar(add, mats, 0, 1.82, zb + 0.16, 15.2); // 屏底流水灯带（可动）

  // ---- 指挥弧：3 个工位（旧版 5 个挤成一排；3 个才有"值班席"的呼吸感）----
  const desks = arcLayout(3, 7.4, 52, 0, -2.0, 64, false);
  const deskBody = extrudeProfile(trapezoidProfile(2.9, 2.5, 0.95), 1.5);
  const deskTop = extrudeProfile(chamferRectProfile(3.3, 0.16, 0.10), 1.7);
  const deskSeat = extrudeProfile(chamferRectProfile(0.82, 0.15, 0.05), 0.82);
  const deskBack = extrudeProfile(chamferRectProfile(0.82, 0.85, 0.09), 0.18);
  const deskScreen = new THREE.PlaneGeometry(1.8, 1.0);
  const deskWave = createScreenMaterial(0x8fe0ff, 4.2, 1);     // 工位 = 示波器波形
  const seatPost = new THREE.CylinderGeometry(0.06, 0.06, 0.70, 8, 1);
  for (const s of desks) {
    place(add, deskBody, mats.furn, s, 0, 0.48, 0);
    place(add, deskTop, mats.furn, s, 0, 1.02, 0.05);
    // 工位朝向：faceOut=false → 局部 +z 指向屏幕墙；-oz 一侧是操作者
    place(add, deskScreen, deskWave, s, 0, 1.56, 0.34, Math.PI, -0.46);
    place(add, deskSeat, mats.furn, s, 0, 0.82, -1.15);
    place(add, deskBack, mats.furn, s, 0, 1.26, -1.52);
    place(add, seatPost, mats.struct, s, 0, 0.34, -1.15);
    shadow(add, mats, s.x, s.z, 1.5, 1.4);
  }

  // ---- 中央全息台：八棱基座 + 悬浮星球 + 光环 + 光柱（全部可动）----
  add(extrudeProfile(polyProfile(8, 1.25), 0.9), mats.furn, 0, 0.45, -1.0);
  add(new THREE.CylinderGeometry(1.05, 1.15, 0.14, 8, 1), mats.struct, 0, 0.97, -1.0);
  const ringA = add(new THREE.TorusGeometry(0.85, 0.035, 8, 32), mats.strip, 0, 1.92, -1.0, Math.PI / 2, 0, 0);
  const satA = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), mats.stripWarm);
  satA.position.set(0.85, 0, 0);
  ringA.add(satA);
  holoGlobe(add, mats, anim, 0, 2.55, -1.0, 0.62);
  anim((t) => {
    ringA.rotation.z = t * 0.9;
    ringA.rotation.y = Math.sin(t * 0.4) * 0.2;
  });
  shadow(add, mats, 0, -1.0, 1.5, 1.5);

  // ---- 侧墙机柜：每侧 2 台（落地、成组；奇数台会显得堆杂物）----
  const rackBody = extrudeProfile(chamferRectProfile(1.5, 3.0, 0.14), 0.9);
  for (const sx of [-12.9, 12.9]) {
    for (const sz of [-3.6, 1.6]) {
      add(rackBody, mats.furn, sx, 1.5, sz);
      add(new THREE.BoxGeometry(0.06, 0.06, 1.2), mats.stripVert, sx - Math.sign(sx) * 0.48, 2.82, sz);
      shadow(add, mats, sx - Math.sign(sx) * 0.3, sz, 0.7, 1.0);
    }
  }

  // ---- 绿植（对称两盆，落在前景角落：给灰色舱室一点生气）----
  plantPot(add, mats, -11.4, 7.2, 1.0);
  plantPot(add, mats, 11.4, 7.2, 1.0);

  // ---- 地面引导线（流水线：往指挥区汇入的动线）+ 旋转雷达 + 侧墙指示灯 ----
  add(new THREE.BoxGeometry(16.0, 0.03, 0.12), mats.flow, 0, 0.012, 1.3);
  radarDish(add, mats, anim, 11.2, 9.6, zb + 2.2);
  add(new THREE.BoxGeometry(0.14, 3.3, 0.14), mats.struct, 11.2, 10.95, zb + 2.2); // 吊杆接到天花板
  for (const sx of [-12.9, 12.9]) {
    // 沿 z 向的流水指示灯条（追灯顺着侧墙跑）
    add(new THREE.BoxGeometry(0.07, 0.07, 16.0), mats.flow, sx - Math.sign(sx) * 0.10, 3.35, 0);
  }
}

// ------------------------------------------------------------
// 仓库：2 组货架 + 货箱矩阵 + 托盘 + 料桶 + 居中卷帘门 + 安全黄线
// ------------------------------------------------------------

export function decorateStorage(add: AddFn, mats: DecorMats, anim: RegisterAnim, kinetic: RegisterKinetic): void {
  const zb = -ROOM_D / 2;

  // ---- 2 组货架塔（对称靠后；立柱 + 4 层横梁层板）----
  const post = extrudeProfile(chamferRectProfile(0.22, 3.6, 0.05), 0.22);
  const shelf = extrudeProfile(chamferRectProfile(6.6, 0.16, 0.05), 1.3);
  const tote = new THREE.BoxGeometry(1.35, 0.85, 1.05);
  for (const bx of [-8.2, 8.2]) {
    for (const pz of [zb + 0.8, zb + 2.1]) {
      add(post, mats.struct, bx - 3.0, 1.8, pz);
      add(post, mats.struct, bx + 3.0, 1.8, pz);
    }
    for (const sy of [0.55, 1.55, 2.55, 3.45]) {
      add(shelf, mats.struct, bx, sy, zb + 1.45);
      if (sy < 3.4) {
        for (const cx of [-2.15, 0, 2.15]) {
          add(tote, mats.crate, bx + cx, sy + 0.51, zb + 1.45);
        }
      }
    }
    shadow(add, mats, bx, zb + 1.45, 3.6, 0.9);
  }

  // ---- 货箱矩阵（房间中区整齐码放；同尺寸、同朝向 = 极简的秩序感）----
  const boxA = new THREE.BoxGeometry(1.5, 1.2, 1.5);
  for (const [cx, cz] of [[-0.85, 0.6], [0.85, 0.6], [-0.85, 2.3], [0.85, 2.3]] as const) {
    add(boxA, mats.crate, cx, 0.6, cz);
  }
  add(boxA, mats.crate, -0.85, 1.8, 0.6);
  add(boxA, mats.crate, 0.85, 1.8, 0.6);
  shadow(add, mats, 0, 1.45, 2.1, 1.9);

  // ---- 托盘 + 货箱（左区）----
  add(extrudeProfile(chamferRectProfile(2.4, 0.18, 0.06), 1.7), mats.crate, -4.6, 0.09, 4.6);
  add(new THREE.BoxGeometry(2.0, 1.2, 1.4), mats.crate, -4.6, 0.78, 4.6);
  add(new THREE.BoxGeometry(1.7, 0.9, 1.2), mats.crate, -4.6, 1.83, 4.6);
  shadow(add, mats, -4.6, 4.6, 1.3, 1.0);

  // ---- 料桶（两侧各 3 只，成排；桶盖统一）----
  const drum = new THREE.CylinderGeometry(0.48, 0.48, 1.25, 14, 1);
  const drumLid = new THREE.CylinderGeometry(0.50, 0.50, 0.09, 14, 1);
  for (const [dx, dz] of [
    [-11.4, 4.4], [-10.3, 5.1], [-11.4, 6.0],
    [10.4, 4.6], [11.5, 5.3], [10.4, 6.2],
  ] as const) {
    add(drum, mats.crate, dx, 0.62, dz);
    add(drumLid, mats.struct, dx, 1.29, dz);
  }
  shadow(add, mats, -10.9, 5.2, 1.5, 1.3);
  shadow(add, mats, 10.9, 5.4, 1.5, 1.3);

  // ---- 背墙居中卷帘门（对称构图的视觉锚点）----
  add(new THREE.BoxGeometry(8.4, 4.4, 0.22), mats.furn, 0, 2.4, zb + 0.16);
  for (let i = 0; i < 6; i++) {
    add(new THREE.BoxGeometry(8.4, 0.08, 0.08), mats.struct, 0, 0.75 + i * 0.60, zb + 0.30);
  }
  add(extrudeProfile(chamferRectProfile(0.30, 4.8, 0.06), 0.5), mats.struct, -4.35, 2.4, zb + 0.24);
  add(extrudeProfile(chamferRectProfile(0.30, 4.8, 0.06), 0.5), mats.struct, 4.35, 2.4, zb + 0.24);
  add(new THREE.BoxGeometry(9.3, 0.30, 0.5), mats.struct, 0, 4.72, zb + 0.24);
  add(new THREE.BoxGeometry(8.0, 0.10, 0.10), mats.stripWarm, 0, 4.44, zb + 0.48);

  // ---- 地面安全标线（流水动线：货箱从卷帘门进来一路流向货架）----
  add(new THREE.BoxGeometry(17.0, 0.03, 0.12), mats.flow, 0, 0.012, 6.6);

  // ---- ★ 可动元素：吊装行车 / 导引小车 / 悬浮货箱 / 进货传送带 ----
  gantryCrane(add, mats, anim, kinetic, -11.0, 11.0, zb + 2.9, ROOM_H - 1.2, 1.7);
  agvCart(add, mats, anim, kinetic, 6.4, -3.0, 5.6, 0.22);
  hoverCrate(add, mats, anim, -3.4, -6.4, 1.15, 0.82, 0.0);
  hoverCrate(add, mats, anim, 3.4, -6.4, 1.15, 0.82, 2.1);
  beltLine(add, mats, anim, -1.6, 9.6, -5.2, 1.0, 4, 0.06);
  flowBar(add, mats, 0, 4.98, zb + 0.5, 7.6);   // 卷帘门楣追灯
}

// ------------------------------------------------------------
// 加工站：主工作台 + 熔炉 + 管道束 + 传送带 + 机械臂 + 零件柜 + 工具车
// ------------------------------------------------------------

export function decorateWorkshop(add: AddFn, mats: DecorMats, anim: RegisterAnim): void {
  const zb = -ROOM_D / 2;

  // ---- 主工作台（居中靠后）----
  add(extrudeProfile(trapezoidProfile(7.0, 6.4, 0.9), 1.6), mats.furn, 0, 0.45, zb + 1.4);
  add(extrudeProfile(chamferRectProfile(7.6, 0.18, 0.08), 1.9), mats.furn, 0, 0.94, zb + 1.4);
  add(new THREE.BoxGeometry(7.2, 0.08, 0.08), mats.strip, 0, 1.06, zb + 2.32);
  add(new THREE.BoxGeometry(1.0, 0.6, 0.9), mats.crate, -2.2, 1.36, zb + 1.4);
  add(new THREE.CylinderGeometry(0.30, 0.30, 0.6, 12, 1), mats.struct, 0.4, 1.33, zb + 1.4);
  add(new THREE.BoxGeometry(1.5, 0.10, 0.8), mats.struct, 2.6, 1.08, zb + 1.4);
  shadow(add, mats, 0, zb + 1.4, 3.8, 1.2);

  // ---- 工具挂板（背墙左段）----
  add(new THREE.BoxGeometry(4.6, 2.4, 0.24), mats.wall, -4.8, 2.5, zb + 0.12);
  add(new THREE.BoxGeometry(4.0, 0.08, 0.08), mats.stripWarm, -4.8, 3.86, zb + 0.26);
  const tool = new THREE.CylinderGeometry(0.07, 0.07, 0.62, 8, 1);
  for (let i = 0; i < 4; i++) {
    add(tool, mats.struct, -6.2 + i * 0.95, 2.55, zb + 0.34, Math.PI / 2, 0, 0);
  }
  // 挂板右侧：工序波形屏（示波器）+ 下方流水灯
  add(new THREE.PlaneGeometry(1.5, 1.1), createScreenMaterial(0x8fe0ff, 1.7, 1), -2.55, 2.6, zb + 0.28);
  flowBar(add, mats, -4.8, 1.18, zb + 0.30, 4.4);

  // ---- 熔炉（八棱炉体 + 观火口 + 顶盖 + 烟囱）----
  add(extrudeProfile(polyProfile(8, 1.8), 3.2), mats.struct, 6.9, 1.6, zb + 1.9);
  add(new THREE.CylinderGeometry(1.95, 1.95, 0.30, 8, 1), mats.struct, 6.9, 3.35, zb + 1.9);
  add(new THREE.TorusGeometry(0.58, 0.12, 8, 18), mats.stripWarm, 6.9, 1.6, zb + 3.55);
  add(new THREE.CylinderGeometry(0.34, 0.34, 0.44, 12, 1), mats.stripWarm, 6.9, 1.6, zb + 3.68, Math.PI / 2, 0, 0);
  add(new THREE.CylinderGeometry(0.50, 0.50, 4.5, 12, 1), mats.struct, 6.9, 5.75, zb + 1.9);
  // 烟囱顶部一段弯头接到背墙（不许悬空）
  add(new THREE.CylinderGeometry(0.34, 0.34, 1.7, 10, 1), mats.struct, 6.9, 8.0, zb + 1.05, Math.PI / 2, 0, 0);
  add(new THREE.CylinderGeometry(0.44, 0.44, 0.22, 10, 1), mats.struct, 6.9, 8.0, zb + 0.34, Math.PI / 2, 0, 0);
  shadow(add, mats, 6.9, zb + 1.9, 2.1, 2.1);
  steamPuffs(add, mats, 6.9, 8.1, zb + 1.9, 1.0, 1.5, 3);   // 烟囱口热气（可动）

  // ---- 管道束（左后角：**背板 + 落地立管 + 高位横管**；不允许任何东西浮空）----
  //   设备背板（原来这里有块板子，被删掉后立管成了悬空的"一堆东西" → 加回来）
  add(new THREE.BoxGeometry(6.4, 4.4, 0.20), mats.furn, -8.6, 5.9, zb + 0.10);
  add(new THREE.BoxGeometry(6.0, 0.08, 0.08), mats.stripVert, -8.6, 8.02, zb + 0.22);
  const riser = new THREE.CylinderGeometry(0.24, 0.24, 9.0, 10, 1);   // 0.9 → 9.9（穿到顶梁）
  const clamp = extrudeProfile(chamferRectProfile(0.72, 0.16, 0.05), 0.44);
  for (const px of [-10.6, -9.5, -8.4]) {
    add(riser, mats.struct, px, 5.4, zb + 0.62);
    for (const cy of [1.6, 4.6, 7.6]) add(clamp, mats.struct, px, cy, zb + 0.62);
  }
  // 立管顶端接一段横管（沿墙走），中段横管 + 下引支管落到工具挂板顶
  add(new THREE.CylinderGeometry(0.24, 0.24, 7.6, 10, 1), mats.struct, -6.8, 8.9, zb + 0.62, 0, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.24, 0.24, 5.2, 10, 1), mats.struct, -4.6, 6.3, zb + 0.62);
  add(new THREE.CylinderGeometry(0.36, 0.36, 0.20, 10, 1), mats.struct, -4.6, 8.9, zb + 0.62);
  // 立管上的流光指示（能看到"介质在流动"）
  for (const px of [-10.6, -9.5, -8.4]) {
    add(new THREE.BoxGeometry(0.09, 2.6, 0.09), mats.flow, px, 6.2, zb + 0.62);
  }

  // ---- 传送带（可动：滚轴自转 + 工件循环流动）----
  beltLine(add, mats, anim, -8.8, 0.8, 2.4, 1.05, 4, 0.055);
  shadow(add, mats, -4.0, 2.4, 5.0, 1.0);

  // ---- 机械臂（取放循环：从传送带取件 → 放到右侧托盘）----
  robotArm(add, mats, anim, 2.6, 3.4, -0.51, -1.41, 2.78, 4.48);
  // 放件托盘（机械臂把货放在这上面）
  add(extrudeProfile(chamferRectProfile(2.2, 0.18, 0.06), 1.6), mats.crate, 2.8, 0.09, 4.5);
  add(new THREE.BoxGeometry(0.9, 0.55, 0.9), mats.crate, 2.8, 1.03, 4.5);
  shadow(add, mats, 2.8, 4.5, 1.3, 1.0);

  // ---- 零件柜（右墙：柜体 + 5 道抽屉缝 + 把手）----
  add(extrudeProfile(chamferRectProfile(1.7, 2.9, 0.10), 0.8), mats.furn, 12.2, 1.45, 2.4);
  for (let i = 0; i < 5; i++) {
    add(new THREE.BoxGeometry(1.5, 0.04, 0.05), mats.struct, 12.2, 0.55 + i * 0.52, 2.82);
    add(new THREE.BoxGeometry(0.42, 0.05, 0.05), mats.struct, 12.2, 0.75 + i * 0.52, 2.86);
  }
  add(new THREE.BoxGeometry(1.5, 0.06, 0.06), mats.stripVert, 12.2, 2.86, 2.84);
  shadow(add, mats, 12.2, 2.4, 0.7, 1.0);

  // ---- 工具车（右前；两层 + 四轮）----
  add(new THREE.BoxGeometry(1.1, 0.72, 0.7), mats.furn, 4.6, 0.62, 5.0);
  add(new THREE.BoxGeometry(1.1, 0.06, 0.7), mats.struct, 4.6, 0.24, 5.0);
  add(new THREE.BoxGeometry(1.0, 0.05, 0.6), mats.strip, 4.6, 1.0, 5.0);
  const wheel = new THREE.CylinderGeometry(0.09, 0.09, 0.08, 8, 1);
  for (const [wx, wz] of [[4.15, 4.72], [5.05, 4.72], [4.15, 5.28], [5.05, 5.28]] as const) {
    add(wheel, mats.struct, wx, 0.09, wz, 0, 0, Math.PI / 2);
  }
  shadow(add, mats, 4.6, 5.0, 0.75, 0.55);

  // ---- 可动：墙面飞轮（皮带传动感）+ 地面流水动线 ----
  add(new THREE.BoxGeometry(1.7, 1.7, 0.16), mats.furn, -11.9, 4.4, zb + 0.16);  // 飞轮底座板（贴墙）
  flywheel(add, mats, anim, -11.9, 4.4, zb + 0.34, 0.66);
  add(new THREE.BoxGeometry(17.0, 0.03, 0.12), mats.flow, 0, 0.012, 6.9);
  void anim;
}

// ------------------------------------------------------------
// 驾驶舱：抬高地台 + 环形舷窗 + 三联操纵台 + 航行终端 + 生活角 + 储物柜
// ------------------------------------------------------------

export function decorateCockpit(add: AddFn, mats: DecorMats, anim: RegisterAnim): void {
  const zb = -ROOM_D / 2;          // -9
  const PLAT_Y = 0.70;             // 地台面高度（后区整体抬高）

  // ---- ① 抬高地台：两级踏步 + 平台（平台 z ∈ [-9, -1.5]）----
  add(extrudeProfile(chamferRectProfile(ROOM_W - 2.0, PLAT_Y, 0.45), 7.5), mats.floor, 0, PLAT_Y / 2, zb + 3.75);
  add(extrudeProfile(chamferRectProfile(ROOM_W - 2.0, 0.35, 0.30), 0.75), mats.floor, 0, 0.175, zb + 8.05);
  add(new THREE.BoxGeometry(ROOM_W - 2.4, 0.08, 0.10), mats.stripWarm, 0, PLAT_Y + 0.01, zb + 7.48);

  // ---- ② 环形舷窗：窗框铆接环 + 6 根辐射窗棂 + viewport shader 星空 ----
  const winR = 4.4;
  const winY = 5.5;
  add(new THREE.TorusGeometry(winR, 0.30, 10, 48), mats.struct, 0, winY, zb + 0.34);
  add(new THREE.TorusGeometry(winR + 0.80, 0.15, 8, 48), mats.furn, 0, winY, zb + 0.30);
  const mullion = new THREE.BoxGeometry(0.46, 0.30, 0.16); // 长轴 x → rotZ 转成径向
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    add(mullion, mats.struct,
      Math.cos(a) * (winR + 0.22), winY + Math.sin(a) * (winR + 0.22), zb + 0.30, 0, 0, a);
  }
  add(new THREE.CircleGeometry(winR, 48), mats.viewport, 0, winY, zb + 0.42);
  // 窗下仪表条（地台上的设备带）
  add(new THREE.BoxGeometry(12.4, 0.80, 0.30), mats.furn, 0, PLAT_Y + 0.45, zb + 0.55);
  flowBar(add, mats, 0, PLAT_Y + 0.88, zb + 0.55, 11.6);   // 仪表条上的流水灯（在扫描）

  // ---- ③ 三联操纵台（地台中段）：机体 + 台面 + 倾斜主屏 + 操纵杆 + 座椅 ----
  const body = extrudeProfile(trapezoidProfile(3.2, 2.8, 0.90), 1.6);
  const top = extrudeProfile(chamferRectProfile(3.6, 0.16, 0.09), 1.9);
  const scr = new THREE.PlaneGeometry(2.5, 1.10);
  const scrMat = createScreenMaterial(0xffb060, 2.3, 1);   // 主屏 = 示波器波形（飞行员看信号，不看数字）
  const seat = extrudeProfile(chamferRectProfile(0.95, 0.16, 0.05), 0.95);
  const back = extrudeProfile(chamferRectProfile(0.95, 1.00, 0.10), 0.20);
  const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.44, 8, 1);
  for (const px of [-4.6, 0, 4.6]) {
    add(body, mats.furn, px, PLAT_Y + 0.25, -4.8);
    add(top, mats.furn, px, PLAT_Y + 0.58, -4.8);
    add(scr, scrMat, px, PLAT_Y + 1.25, -5.5, -0.42, 0, 0);
    add(new THREE.BoxGeometry(2.7, 0.06, 0.08), mats.stripWarm, px, PLAT_Y + 0.72, -3.92);
    // 操纵杆 + 油门推杆
    const stick = add(new THREE.CylinderGeometry(0.05, 0.05, 0.70, 8, 1), mats.struct, px - 0.95, PLAT_Y + 0.95, -4.3);
    const knob = add(new THREE.SphereGeometry(0.16, 12, 10), mats.stripWarm, px - 0.95, PLAT_Y + 1.35, -4.3);
    // ★ 操纵杆被"气流"顶得微微抖（可动）
    anim((t) => {
      const jx = Math.sin(t * 6.7 + px) * 0.022 + Math.sin(t * 13.1 + px) * 0.008;
      const jz = Math.cos(t * 5.3 + px) * 0.018;
      stick.rotation.set(jz, 0, jx);
      knob.position.set(px - 0.95, PLAT_Y + 1.35, -4.3);
    });
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.50, 8, 1), mats.struct, px + 0.90, PLAT_Y + 0.88, -4.3);
    add(new THREE.BoxGeometry(0.26, 0.09, 0.20), mats.stripWarm, px + 0.90, PLAT_Y + 1.16, -4.3);
    // 座椅
    add(seat, mats.furn, px, PLAT_Y + 0.45, -3.35);
    add(back, mats.furn, px, PLAT_Y + 1.00, -2.92);
    add(postGeo, mats.struct, px, PLAT_Y + 0.22, -3.35);
    shadow(add, mats, px, -4.4, 1.6, 1.5, PLAT_Y + 0.012);
  }

  // ---- ④ 航行终端台座（【起飞 / 返回罗德岛号】的实体交互对象）----
  const termX = 9.8;
  const termZ = 5.6;
  add(extrudeProfile(polyProfile(6, 1.4), 1.1), mats.furn, termX, 0.55, termZ);
  add(new THREE.CylinderGeometry(1.25, 1.45, 0.16, 6, 1), mats.struct, termX, 1.18, termZ);
  const termRing = add(new THREE.TorusGeometry(0.90, 0.045, 8, 30), mats.strip, termX, 2.20, termZ, Math.PI / 2, 0, 0);
  const termSat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.10, 0.16), mats.stripWarm);
  termSat.position.set(0.90, 0, 0);
  termRing.add(termSat);
  anim((t) => { termRing.rotation.z = -t * 1.1; });
  holoGlobe(add, mats, anim, termX, 3.35, termZ, 0.42);   // 终端上方的航行全息球
  for (let i = 0; i < 4; i++) {   // 四角定位柱：视觉上圈出"可交互点"
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    add(new THREE.CylinderGeometry(0.09, 0.12, 0.40, 8, 1), mats.struct,
      termX + Math.cos(a) * 2.2, 0.20, termZ + Math.sin(a) * 2.2);
  }
  shadow(add, mats, termX, termZ, 1.7, 1.7);

  // ---- ④-b 物资加工位（左侧；【加工台】交互站的实体承载）----
  const benchX = -9.8;
  const benchZ = 5.6;
  add(extrudeProfile(trapezoidProfile(4.2, 3.8, 0.90), 1.5), mats.furn, benchX, 0.45, benchZ);
  add(extrudeProfile(chamferRectProfile(4.6, 0.16, 0.08), 1.8), mats.furn, benchX, 0.95, benchZ);
  add(new THREE.BoxGeometry(4.2, 0.06, 0.08), mats.strip, benchX, 1.06, benchZ + 0.83);
  add(new THREE.BoxGeometry(0.85, 0.65, 0.85), mats.crate, benchX - 1.1, 1.36, benchZ);
  add(new THREE.CylinderGeometry(0.30, 0.30, 0.55, 12, 1), mats.struct, benchX + 0.5, 1.31, benchZ);
  // 台面小屏 + 底座（原来这块屏悬空 → 补底座与立柱）
  add(new THREE.BoxGeometry(0.62, 0.06, 0.42), mats.struct, benchX + 1.6, 1.06, benchZ - 0.30);
  add(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 8, 1), mats.struct, benchX + 1.6, 1.25, benchZ - 0.30);
  add(new THREE.PlaneGeometry(1.4, 0.85), createScreenMaterial(0xff9840, 5.5, 1), benchX + 1.6, 1.62, benchZ - 0.30, -0.42, 0, 0);
  shadow(add, mats, benchX, benchZ, 2.3, 1.2);
  // 墙上工具挂板
  add(new THREE.BoxGeometry(5.0, 2.6, 0.26), mats.wall, benchX, 2.4, zb + 0.13);
  add(new THREE.BoxGeometry(4.4, 0.08, 0.08), mats.stripWarm, benchX, 3.82, zb + 0.27);
  const tool = new THREE.CylinderGeometry(0.065, 0.065, 0.58, 8, 1);
  for (let i = 0; i < 4; i++) {
    add(tool, mats.struct, benchX - 1.5 + i * 1.0, 2.45, zb + 0.34, Math.PI / 2, 0, 0);
  }

  // ---- ④-c 舱门（前方剖切面；【下船】交互站的实体承载）----
  const hatchZ = 7.6;
  add(extrudeProfile(chamferRectProfile(0.30, 3.4, 0.08), 0.60), mats.wall, -2.6, 1.7, hatchZ);
  add(extrudeProfile(chamferRectProfile(0.30, 3.4, 0.08), 0.60), mats.wall, 2.6, 1.7, hatchZ);
  add(new THREE.BoxGeometry(5.8, 0.34, 0.60), mats.struct, 0, 3.55, hatchZ);
  add(new THREE.BoxGeometry(5.2, 0.10, 0.12), mats.stripWarm, 0, 3.30, hatchZ - 0.24);
  add(new THREE.BoxGeometry(4.6, 0.06, 0.30), mats.strip, 0, 0.08, hatchZ);
  for (const sx of [-2.6, 2.6]) {
    add(new THREE.CylinderGeometry(0.08, 0.08, 3.0, 8, 1), mats.struct, sx, 1.7, hatchZ - 0.34, 0.35, 0, 0);
  }

  // ---- ⑤ 侧墙储物柜（每侧 2 组；旧版"导流叶片"是纯装饰噪声，换成功能柜）----
  lockerBank(add, mats, -1, 1.3);
  lockerBank(add, mats, -1, 3.4);
  lockerBank(add, mats, 1, 1.3);
  lockerBank(add, mats, 1, 3.4);

  // ---- ⑥ 生活角（左前）：船员桌 + 两条长凳 + 桌面终端 ----
  const tblX = -4.9;
  const tblZ = 1.5;
  add(extrudeProfile(chamferRectProfile(2.6, 0.14, 0.06), 1.0), mats.furn, tblX, 0.76, tblZ);
  for (const lx of [-1.05, 1.05]) {
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.72, 8, 1), mats.struct, tblX + lx, 0.36, tblZ);
  }
  add(new THREE.BoxGeometry(2.4, 0.42, 0.42), mats.furn, tblX, 0.21, tblZ - 0.85);
  add(new THREE.BoxGeometry(2.4, 0.42, 0.42), mats.furn, tblX, 0.21, tblZ + 0.85);
  add(new THREE.PlaneGeometry(0.62, 0.42), createScreenMaterial(0xffb060, 7.1, 1), tblX + 0.5, 0.84, tblZ, -Math.PI / 2, 0, 0);
  hoverProp(add, mats, anim, tblX - 0.7, 1.02, tblZ, new THREE.CylinderGeometry(0.09, 0.07, 0.16, 10, 1), 1.3);
  shadow(add, mats, tblX, tblZ, 1.6, 1.5);

  // ---- ⑦ 货箱（舱门两侧成对；出舱口的"物资感"）----
  add(new THREE.BoxGeometry(1.3, 1.1, 1.3), mats.crate, 4.9, 0.55, 6.6);
  add(new THREE.BoxGeometry(1.3, 1.1, 1.3), mats.crate, 4.9, 1.65, 6.6);
  add(new THREE.BoxGeometry(1.3, 1.1, 1.3), mats.crate, -4.9, 0.55, 6.7);
  shadow(add, mats, 4.9, 6.6, 1.0, 1.0);
  shadow(add, mats, -4.9, 6.7, 0.95, 0.95);

  // ---- ⑧ 地面引导线：舱门 → 地台的主走道 + 通往左右两站的分支 ----
  add(new THREE.BoxGeometry(0.14, 0.03, 8.6), mats.flow, 0, 0.012, 3.2);
  add(new THREE.BoxGeometry(17.0, 0.03, 0.14), mats.flow, 0, 0.012, 5.6);
  // 顶部流水指示灯（沿舱顶跑，强化"舰体在运转"）
  for (const dz of [-4.5, 1.5]) {
    add(new THREE.BoxGeometry(ROOM_W * 0.30, 0.07, 0.07), mats.flow, 0, ROOM_H - 0.36, dz);
  }
  void anim;

  // ---- ⑨ 顶部灯槽（2 条，沿房间长轴；不再挂氛围环）----
  const troughShell = extrudeProfile(chamferRectProfile(1.15, 0.24, 0.10), ROOM_W * 0.5);
  const tubeGeo = new THREE.BoxGeometry(ROOM_W * 0.46, 0.08, 0.26);
  for (const dz of [-4.5, 1.5]) {
    beamX(add, troughShell, mats.struct, 0, ROOM_H - 0.20, dz);
    add(tubeGeo, mats.strip, 0, ROOM_H - 0.36, dz);
  }
}
