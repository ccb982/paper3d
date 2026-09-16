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
// add 回调由 BaseScene 注入：
//   · decorateShell —— 大厅级装饰（踢脚/腰线/桁架/管道/百叶/灯槽）
//   · decorate*     —— 单间内部布置（坐标为 bay 局部：x ∈ [-13.5, 13.5]，z ∈ [-9, 9]）
//
// ⚠️ 家具一律**不做碰撞**（沿用既有定调）——角色的 xz 只受房间外墙与分界墙钳制。

import * as THREE from 'three';
import {
  arcLayout, chamferRectProfile, extrudeProfile, iBeamProfile,
  polyProfile, trapezoidProfile, wedgeProfile, type ArcSlot,
} from '../../services/render/RoomDecoGeo';
import {
  createBlobShadowMaterial, createPadMaterial, createRoomSurfaceMaterial,
  createScreenMaterial, createStripMaterial, createViewportMaterial, updateRoomTime,
} from '../../services/render/RoomSurfaceMaterial';

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
// 大厅壳体的通用装饰（三间打通，沿整条 hall 布置）
// ------------------------------------------------------------

export function decorateShell(
  add: AddFn, mats: DecorMats, hallW: number, bays: number[],
): void {
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
}

// ------------------------------------------------------------
// 指挥室：三联大屏 + 3 工位指挥弧 + 中央全息台 + 侧墙机柜 + 绿植
// ------------------------------------------------------------

export function decorateControl(add: AddFn, mats: DecorMats): void {
  const zb = -ROOM_D / 2; // -9

  // ---- 屏幕墙：3 块大屏（不是 7 块小板）—— 大面、留白、单点发光 ----
  const screenPanel = extrudeProfile(chamferRectProfile(4.9, 3.1, 0.22), 0.36);
  const screenFace = new THREE.PlaneGeometry(4.3, 2.55);
  for (const sx of [-5.4, 0, 5.4]) {
    const yaw = sx === 0 ? 0 : (sx < 0 ? 0.10 : -0.10);
    add(screenPanel, mats.furn, sx, 3.5, zb + 0.40, 0, yaw, 0);
    add(screenFace, mats.screen, sx, 3.5, zb + 0.60, 0, yaw, 0);
  }
  add(new THREE.BoxGeometry(15.2, 0.10, 0.08), mats.strip, 0, 1.82, zb + 0.52); // 屏底灯带

  // ---- 指挥弧：3 个工位（旧版 5 个挤成一排；3 个才有"值班席"的呼吸感）----
  const desks = arcLayout(3, 7.4, 52, 0, -2.0, 64, false);
  const deskBody = extrudeProfile(trapezoidProfile(2.9, 2.5, 0.95), 1.5);
  const deskTop = extrudeProfile(chamferRectProfile(3.3, 0.16, 0.10), 1.7);
  const deskSeat = extrudeProfile(chamferRectProfile(0.82, 0.15, 0.05), 0.82);
  const deskBack = extrudeProfile(chamferRectProfile(0.82, 0.85, 0.09), 0.18);
  const deskScreen = new THREE.PlaneGeometry(1.8, 1.0);
  const seatPost = new THREE.CylinderGeometry(0.06, 0.06, 0.70, 8, 1);
  for (const s of desks) {
    place(add, deskBody, mats.furn, s, 0, 0.48, 0);
    place(add, deskTop, mats.furn, s, 0, 1.02, 0.05);
    // 工位朝向：faceOut=false → 局部 +z 指向屏幕墙；-oz 一侧是操作者
    place(add, deskScreen, mats.screenAlt, s, 0, 1.56, 0.34, Math.PI, -0.46);
    place(add, deskSeat, mats.furn, s, 0, 0.82, -1.15);
    place(add, deskBack, mats.furn, s, 0, 1.26, -1.52);
    place(add, seatPost, mats.struct, s, 0, 0.34, -1.15);
    shadow(add, mats, s.x, s.z, 1.5, 1.4);
  }

  // ---- 中央全息台：八棱基座 + 单环 + 光柱（去掉了双环/多余装饰）----
  add(extrudeProfile(polyProfile(8, 1.25), 0.9), mats.furn, 0, 0.45, -1.0);
  add(new THREE.CylinderGeometry(1.05, 1.15, 0.14, 8, 1), mats.struct, 0, 0.97, -1.0);
  add(new THREE.TorusGeometry(0.85, 0.035, 8, 32), mats.strip, 0, 1.92, -1.0, Math.PI / 2, 0, 0);
  add(new THREE.CylinderGeometry(0.42, 0.58, 0.95, 10, 1, true), mats.strip, 0, 1.45, -1.0);
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

  // ---- 地面引导线：一条冷色细线横在工位前（视觉上把"指挥区"框出来）----
  add(new THREE.BoxGeometry(16.0, 0.02, 0.10), mats.strip, 0, 0.012, 1.3);
}

// ------------------------------------------------------------
// 仓库：2 组货架 + 货箱矩阵 + 托盘 + 料桶 + 居中卷帘门 + 安全黄线
// ------------------------------------------------------------

export function decorateStorage(add: AddFn, mats: DecorMats): void {
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

  // ---- 地面安全黄线（仓库的"功能标线"，唯一暖色）----
  add(new THREE.BoxGeometry(17.0, 0.02, 0.10), mats.stripWarm, 0, 0.012, 6.6);
}

// ------------------------------------------------------------
// 加工站：主工作台 + 熔炉 + 管道束 + 传送带 + 机械臂 + 零件柜 + 工具车
// ------------------------------------------------------------

export function decorateWorkshop(add: AddFn, mats: DecorMats): void {
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

  // ---- 传送带（左区；槽体 + 3 组支腿 + 滚轴 + 工件）----
  //   ★ 长轴 = 轮廓宽（9.0）→ 不能走 beamX（那把长轴转到 z 去了，滚轴/工件就悬空了）
  add(extrudeProfile(chamferRectProfile(9.0, 0.30, 0.12), 1.3), mats.struct, -4.2, 1.05, 2.4);
  for (const lx of [-8.2, -4.2, -0.2]) {
    add(extrudeProfile(chamferRectProfile(0.22, 0.9, 0.05), 0.22), mats.struct, lx, 0.46, 2.4);
  }
  const roller = new THREE.CylinderGeometry(0.15, 0.15, 1.2, 10, 1);
  for (let i = 0; i < 7; i++) add(roller, mats.furn, -7.6 + i * 1.15, 1.22, 2.4, Math.PI / 2, 0, 0);
  add(new THREE.BoxGeometry(0.9, 0.6, 0.9), mats.crate, -6.4, 1.57, 2.4);
  add(new THREE.BoxGeometry(0.8, 0.5, 0.8), mats.crate, -2.6, 1.52, 2.4);
  shadow(add, mats, -4.2, 2.4, 4.8, 1.0);

  // ---- 机械臂（右后；单台，两节 + 关节球 + 夹爪）----
  add(new THREE.CylinderGeometry(0.28, 0.34, 1.8, 10, 1), mats.struct, 10.8, 0.9, zb + 3.2);
  add(new THREE.SphereGeometry(0.26, 12, 10), mats.struct, 10.72, 1.62, zb + 3.2);
  add(new THREE.CylinderGeometry(0.14, 0.14, 3.0, 10, 1), mats.struct, 9.5, 2.3, zb + 3.7, 0, 0, 0.95);
  add(new THREE.BoxGeometry(0.55, 0.34, 0.55), mats.furn, 8.4, 3.1, zb + 3.9);
  add(new THREE.CylinderGeometry(0.10, 0.10, 0.42, 8, 1), mats.strip, 10.8, 1.95, zb + 3.2);
  shadow(add, mats, 10.4, zb + 3.4, 1.0, 1.0);

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
}

// ------------------------------------------------------------
// 驾驶舱：抬高地台 + 环形舷窗 + 三联操纵台 + 航行终端 + 生活角 + 储物柜
// ------------------------------------------------------------

export function decorateCockpit(add: AddFn, mats: DecorMats): void {
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
  add(new THREE.BoxGeometry(11.6, 0.05, 0.08), mats.strip, 0, PLAT_Y + 0.90, zb + 0.72);

  // ---- ③ 三联操纵台（地台中段）：机体 + 台面 + 倾斜主屏 + 操纵杆 + 座椅 ----
  const body = extrudeProfile(trapezoidProfile(3.2, 2.8, 0.90), 1.6);
  const top = extrudeProfile(chamferRectProfile(3.6, 0.16, 0.09), 1.9);
  const scr = new THREE.PlaneGeometry(2.5, 1.10);
  const seat = extrudeProfile(chamferRectProfile(0.95, 0.16, 0.05), 0.95);
  const back = extrudeProfile(chamferRectProfile(0.95, 1.00, 0.10), 0.20);
  const postGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.44, 8, 1);
  for (const px of [-4.6, 0, 4.6]) {
    add(body, mats.furn, px, PLAT_Y + 0.25, -4.8);
    add(top, mats.furn, px, PLAT_Y + 0.58, -4.8);
    add(scr, mats.screen, px, PLAT_Y + 1.25, -5.5, -0.42, 0, 0);
    add(new THREE.BoxGeometry(2.7, 0.06, 0.08), mats.stripWarm, px, PLAT_Y + 0.72, -3.92);
    // 操纵杆 + 油门推杆
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.70, 8, 1), mats.struct, px - 0.95, PLAT_Y + 0.95, -4.3);
    add(new THREE.SphereGeometry(0.16, 12, 10), mats.stripWarm, px - 0.95, PLAT_Y + 1.35, -4.3);
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
  add(new THREE.TorusGeometry(0.90, 0.045, 8, 30), mats.strip, termX, 2.20, termZ, Math.PI / 2, 0, 0);
  add(new THREE.CylinderGeometry(0.46, 0.62, 1.00, 10, 1, true), mats.strip, termX, 1.75, termZ);
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
  add(new THREE.PlaneGeometry(1.4, 0.85), mats.screenAlt, benchX + 1.6, 1.62, benchZ - 0.30, -0.42, 0, 0);
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
  add(new THREE.PlaneGeometry(0.62, 0.42), mats.screenAlt, tblX + 0.5, 0.84, tblZ, -Math.PI / 2, 0, 0);
  shadow(add, mats, tblX, tblZ, 1.6, 1.5);

  // ---- ⑦ 货箱（舱门两侧成对；出舱口的"物资感"）----
  add(new THREE.BoxGeometry(1.3, 1.1, 1.3), mats.crate, 4.9, 0.55, 6.6);
  add(new THREE.BoxGeometry(1.3, 1.1, 1.3), mats.crate, 4.9, 1.65, 6.6);
  add(new THREE.BoxGeometry(1.3, 1.1, 1.3), mats.crate, -4.9, 0.55, 6.7);
  shadow(add, mats, 4.9, 6.6, 1.0, 1.0);
  shadow(add, mats, -4.9, 6.7, 0.95, 0.95);

  // ---- ⑧ 地面引导线：舱门 → 地台的主走道 + 通往左右两站的分支 ----
  add(new THREE.BoxGeometry(0.14, 0.02, 8.6), mats.strip, 0, 0.012, 3.2);
  add(new THREE.BoxGeometry(17.0, 0.02, 0.14), mats.strip, 0, 0.012, 5.6);

  // ---- ⑨ 顶部灯槽（2 条，沿房间长轴；不再挂氛围环）----
  const troughShell = extrudeProfile(chamferRectProfile(1.15, 0.24, 0.10), ROOM_W * 0.5);
  const tubeGeo = new THREE.BoxGeometry(ROOM_W * 0.46, 0.08, 0.26);
  for (const dz of [-4.5, 1.5]) {
    beamX(add, troughShell, mats.struct, 0, ROOM_H - 0.20, dz);
    add(tubeGeo, mats.strip, 0, ROOM_H - 0.36, dz);
  }
}
