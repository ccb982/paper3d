// ============================================================
// RoomDecor —— 基地 / 驾驶舱的房间布局与实体装饰（2026-09-16）
// ============================================================
// 用户定调：「不用建模」= **不许从网上找 / 导入现成模型**；但**房间布局要有真的实体道具**，
//   改变布局的唯一手段就是 **自己写顶点**（RoomDecoGeo）+ **写 shader**（RoomSurfaceMaterial）。
//
// 本文件负责"摆什么、摆在哪"：几何顶点一律走 extrudeProfile 手写，材质一律走程序化 shader。
// add 回调由 BaseScene 注入：
//   · decorateShell —— 大厅级装饰（三间打通共用：踢脚/腰线/天花板桁架/背墙管道/百叶/灯槽）
//   · decorate*     —— 单间内部布置（坐标为 bay 局部：x ∈ [-13.5, 13.5]，z ∈ [-9, 9]）
//
// ⚠️ 家具一律**不做碰撞**（沿用既有定调：箱内 ASIN_GIFTING 通行）—— 角色的 xz 只受
//   房间外墙与分界墙钳制，可以从箱子里穿过去；这是既定行为，不是 bug。

import * as THREE from 'three';
import {
  arcLayout, chamferRectProfile, extrudeProfile, iBeamProfile,
  polyProfile, trapezoidProfile, wedgeProfile, type ArcSlot,
} from '../../services/render/RoomDecoGeo';
import {
  createPadMaterial, createRoomSurfaceMaterial, createScreenMaterial,
  createStripMaterial, createViewportMaterial, updateRoomTime,
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
}

export function createDecorMats(cockpit: boolean): DecorMats {
  return {
    floor: createRoomSurfaceMaterial({ preset: cockpit ? 'cockpitFloor' : 'floor' }),
    wall: createRoomSurfaceMaterial({ preset: cockpit ? 'cockpit' : 'wall' }),
    ceil: createRoomSurfaceMaterial({ preset: 'ceil' }),
    struct: createRoomSurfaceMaterial({ preset: 'struct' }),
    furn: createRoomSurfaceMaterial({ preset: 'furn' }),
    crate: createRoomSurfaceMaterial({ preset: 'crate' }),
    screen: createScreenMaterial(cockpit ? 0xffb867 : 0x62d6ff, 0),
    screenAlt: createScreenMaterial(cockpit ? 0xff9d4d : 0x7ce0c8, 3.1),
    strip: createStripMaterial(cockpit ? 0xffc98a : 0xbfe8ff, { speed: 2.0, axis: 0 }),
    stripWarm: createStripMaterial(cockpit ? 0xffb04d : 0xffd6a0, { speed: 1.4, bright: 1.05, axis: 0 }),
    stripVert: createStripMaterial(cockpit ? 0xffcf96 : 0x9fe2ff, { speed: 1.1, bright: 1.1, axis: 1 }),
    viewport: createViewportMaterial(cockpit ? 0xffc48a : 0x7fb6ff),
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

// ------------------------------------------------------------
// 大厅壳体的通用装饰（三间打通，沿整条 hall 布置）
// ------------------------------------------------------------

export function decorateShell(
  add: AddFn, mats: DecorMats, hallW: number, bays: number[],
): void {
  const W = hallW;
  const halfW = W / 2;
  const zb = -ROOM_D / 2;       // 背墙内表面 z
  const yCeil = ROOM_H - 0.5;

  // ---- ① 墙脚斜面踢脚：把墙面和地面接起来，不再是一条直棱 ----
  const skirt = extrudeProfile(wedgeProfile(0.52, 0.44, 0.36), W);
  add(skirt, mats.struct, 0, 0.22, zb + 0.26, 0, -Math.PI / 2, 0);   // 背墙（斜面向 +z）
  const skirtSide = extrudeProfile(wedgeProfile(0.52, 0.44, 0.36), ROOM_D);
  add(skirtSide, mats.struct, -halfW + 0.26, 0.22, 0);               // 左墙（斜面向 +x）
  add(skirtSide, mats.struct, halfW - 0.26, 0.22, 0, 0, Math.PI, 0); // 右墙（斜面向 -x）

  // ---- ② 墙面结构腰线（y=3.1）：给 12.6m 高的墙分段，不再是一面平板 ----
  const belt = extrudeProfile(chamferRectProfile(0.42, 0.5, 0.12), W);
  add(belt, mats.struct, 0, 3.1, zb + 0.15, 0, -Math.PI / 2, 0);
  const beltSide = extrudeProfile(chamferRectProfile(0.42, 0.5, 0.12), ROOM_D);
  add(beltSide, mats.struct, -halfW + 0.15, 3.1, 0);
  add(beltSide, mats.struct, halfW - 0.15, 3.1, 0);

  // ---- ③ 天花板桁架：横向工字梁 + 纵向主梁 ----
  //   ⚠️ 三间房在**进深 z 方向完全对齐**（共用地面/背墙/天花板），所以横向梁是沿整条
  //   hall（x）通长的，只需按房间的 z 分布；**不能再叠加 bays[i]** —— 那是 x 方向的房间
  //   中心，叠上去会把梁甩到 z=±34 的房间外（2026-09-16 修）。
  const truss = extrudeProfile(iBeamProfile(0.62, 0.46, 0.10), W);
  for (const dz of [-5.6, -1.9, 1.9, 5.6]) beamX(add, truss, mats.struct, 0, yCeil, dz);
  const trussZ = extrudeProfile(iBeamProfile(0.62, 0.46, 0.10), ROOM_D);
  const divs = bays.slice(0, -1).map((b) => b + (ROOM_W + ROOM_GAP) / 2);
  for (const dx of [-halfW + 0.4, ...divs, halfW - 0.4]) add(trussZ, mats.struct, dx, yCeil + 0.62, 0);

  // ---- ④ 背墙竖向管道 + 卡箍（每间 6 根，通到顶）----
  const pipeGeo = new THREE.CylinderGeometry(0.22, 0.22, ROOM_H - 1.0, 12, 1);
  const clampGeo = extrudeProfile(chamferRectProfile(0.72, 0.22, 0.08), 0.34);
  for (const bx of bays) {
    for (const px of [-11.4, -9.6, -6.2, 6.2, 9.6, 11.4]) {
      add(pipeGeo, mats.struct, bx + px, ROOM_H / 2 - 0.2, zb + 0.34);
      for (const cy of [2.2, 5.4, 8.6]) add(clampGeo, mats.struct, bx + px, cy, zb + 0.34);
    }
  }

  // ---- ⑤ 侧墙高处通风百叶（每侧 4 组 × 6 片倾斜叶片）----
  const louver = extrudeProfile(trapezoidProfile(0.46, 0.30, 0.075), 2.6);
  for (const sx of [-halfW + 0.28, halfW - 0.28]) {
    for (const sz of [-6.0, -2.0, 2.0, 6.0]) {
      for (let i = 0; i < 6; i++) add(louver, mats.struct, sx, 8.4 + i * 0.42, sz, -0.55, 0, 0);
    }
  }

  // ---- ⑥ 背墙竖向灯柱（每间 2 根；挤出的长轴是局部 y → 行波走 uv.y）----
  const vStrip = extrudeProfile(chamferRectProfile(0.20, ROOM_H - 3.4, 0.06), 0.30);
  for (const bx of bays) {
    for (const px of [-12.6, 12.6]) add(vStrip, mats.stripVert, bx + px, ROOM_H / 2 + 0.2, zb + 0.16);
  }

  // ---- ⑦ 天花板灯槽（每间 3 条：外壳用切角板手搓，灯管是大长 Box）----
  const troughShell = extrudeProfile(chamferRectProfile(1.5, 0.30, 0.14), ROOM_W * 0.62);
  const tubeGeo = new THREE.BoxGeometry(ROOM_W * 0.60, 0.10, 0.34); // 长轴已是 x，不要旋转
  for (const bx of bays) {
    for (const dz of [-5.2, 0, 5.2]) {
      beamX(add, troughShell, mats.struct, bx, ROOM_H - 0.22, dz);
      add(tubeGeo, mats.strip, bx, ROOM_H - 0.44, dz);
    }
  }

  // ---- ⑧ 背墙贯通灯带（原中央灯带保留，改走 strip shader）----
  add(new THREE.BoxGeometry(W * 0.9, 0.14, 0.08), mats.stripWarm, 0, ROOM_H * 0.72, zb + 0.06);
}

// ------------------------------------------------------------
// 指挥室：微弧屏幕墙 + 弧形指挥台 + 中央全息台 + 落地机柜
// ------------------------------------------------------------

export function decorateControl(add: AddFn, mats: DecorMats): void {
  const zb = -ROOM_D / 2 + 0.5;   // 背墙前一点点

  // ---- 屏幕墙：7 块手搓梯形板沿微弧排布，板前贴发光屏 ----
  //   弧心放在房间外侧（0, 44.33）、半径 52.83 → 中间最深(-8.5)、两端前移(-7.0)，
  //   形成"屏幕把人包起来"的环抱感（faceOut=false = 朝弧心 = 朝房间）
  const screenPanel = extrudeProfile(trapezoidProfile(4.0, 3.7, 4.4), 0.42);
  const screenFace = new THREE.PlaneGeometry(3.3, 3.9);
  const arc = arcLayout(7, 52.83, 27.4, 0, 44.33, -103.7, false);
  for (const s of arc) {
    place(add, screenPanel, mats.furn, s, 0, 3.4, 0.10);
    place(add, screenFace, mats.screen, s, 0, 3.4, 0.34);
  }
  // 屏幕墙发光底座
  add(new THREE.BoxGeometry(ROOM_W * 0.92, 0.16, 0.9), mats.strip, 0, 1.16, zb + 0.5);

  // ---- 弧形指挥台：5 个工位，面向屏幕（弧心在屏幕与控制台之间）----
  const desks = arcLayout(5, 6.5, 70, 0, -3.0, 55, false);
  const deskBody = extrudeProfile(trapezoidProfile(2.7, 2.3, 1.0), 1.6);
  const deskTop = extrudeProfile(chamferRectProfile(3.1, 0.16, 0.10), 1.8);
  const deskSeat = extrudeProfile(chamferRectProfile(0.86, 0.16, 0.06), 0.86);
  const deskBack = extrudeProfile(chamferRectProfile(0.86, 0.9, 0.10), 0.18);
  const deskScreen = new THREE.PlaneGeometry(1.9, 1.05);
  const seatPost = new THREE.CylinderGeometry(0.07, 0.07, 0.72, 8, 1);
  for (const s of desks) {
    place(add, deskBody, mats.furn, s, 0, 0.5, 0);
    place(add, deskTop, mats.furn, s, 0, 1.06, 0.05);
    // ★ 工位朝向：faceOut=false → 局部 +z 指向屏幕墙。因此器件沿 oz 的排布是
    //   +oz = 靠屏幕墙那一侧（副屏在这，但屏幕要转 180° 朝操作者），
    //   -oz = 靠操作者一侧（座椅、靠背在这）。
    place(add, deskScreen, mats.screenAlt, s, 0, 1.62, 0.35, Math.PI, -0.48);
    place(add, deskSeat, mats.furn, s, 0, 0.86, -1.20);
    place(add, deskBack, mats.furn, s, 0, 1.32, -1.60);
    place(add, seatPost, mats.struct, s, 0, 0.36, -1.20);
  }

  // ---- 中央全息台：八棱柱基座 + 悬浮双环 + 光柱 ----
  add(extrudeProfile(polyProfile(8, 1.5), 1.1), mats.furn, 0, 0.55, -1.2);
  add(new THREE.CylinderGeometry(1.25, 1.35, 0.16, 8, 1), mats.struct, 0, 1.16, -1.2);
  add(new THREE.TorusGeometry(1.0, 0.05, 8, 32), mats.strip, 0, 2.35, -1.2, Math.PI / 2, 0, 0);
  add(new THREE.TorusGeometry(0.72, 0.035, 8, 28), mats.strip, 0, 2.9, -1.2, Math.PI / 2, 0.3, 0);
  add(new THREE.CylinderGeometry(0.55, 0.75, 1.3, 10, 1, true), mats.strip, 0, 1.85, -1.2);

  // ---- 侧墙落地机柜：每侧 3 台 + 状态灯柱 ----
  const rackBody = extrudeProfile(chamferRectProfile(1.5, 3.4, 0.18), 1.0);
  const rackLamp = extrudeProfile(chamferRectProfile(0.10, 2.2, 0.04), 0.10);
  for (const sx of [-11.8, 11.8]) {
    for (const sz of [-4.5, 0.5, 5.5]) {
      add(rackBody, mats.furn, sx, 1.7, sz);
      add(rackLamp, mats.stripVert, sx + (sx < 0 ? 0.55 : -0.55), 1.9, sz);
    }
  }
}

// ------------------------------------------------------------
// 仓库：4 组货架塔 + 货箱堆 + 托盘料桶 + 背墙卷帘门
// ------------------------------------------------------------

export function decorateStorage(add: AddFn, mats: DecorMats): void {
  const zb = -ROOM_D / 2 + 1.2;

  // ---- 4 组货架塔：立柱 + 横梁层板 + 侧向斜撑（全是手搓挤出件）----
  const post = extrudeProfile(chamferRectProfile(0.26, 5.2, 0.06), 0.26);
  const shelf = extrudeProfile(chamferRectProfile(7.2, 0.20, 0.06), 1.5);
  const brace = extrudeProfile(trapezoidProfile(1.5, 0.16, 0.5), 0.14);
  const tote = new THREE.BoxGeometry(1.5, 1.1, 1.3);
  for (const bx of [-9.8, -3.3, 3.3, 9.8]) {
    for (const pz of [zb, zb + 1.2]) {
      add(post, mats.struct, bx - 3.2, 2.6, pz);
      add(post, mats.struct, bx + 3.2, 2.6, pz);
    }
    for (const sy of [0.7, 2.1, 3.5, 4.9]) {
      add(shelf, mats.struct, bx, sy, zb + 0.6);
      for (const cx of [-2.4, 0, 2.4]) add(tote, mats.crate, bx + cx, sy + 0.66, zb + 0.6);
    }
    add(brace, mats.struct, bx - 3.2, 2.6, zb + 1.3, 0, 0, 0.9);
    add(brace, mats.struct, bx + 3.2, 2.6, zb + 1.3, 0, 0, -0.9);
  }

  // ---- 中区：托盘 + 料桶 ----
  const pallet = extrudeProfile(chamferRectProfile(2.6, 0.20, 0.08), 1.9);
  for (const [px, pz] of [[-6.5, 2.2], [0.5, 4.4], [7.5, 1.0]] as const) {
    add(pallet, mats.crate, px, 0.10, pz);
    add(new THREE.BoxGeometry(2.0, 1.3, 1.5), mats.crate, px, 0.85, pz);
    add(new THREE.BoxGeometry(1.9, 0.9, 1.4), mats.crate, px + 0.15, 1.95, pz - 0.1);
  }
  const drum = new THREE.CylinderGeometry(0.52, 0.52, 1.3, 14, 1);
  const drumLid = new THREE.CylinderGeometry(0.54, 0.54, 0.10, 14, 1);
  for (const [dx, dz] of [[-11.5, 6.5], [-10.3, 6.9], [-10.9, 5.3], [11.6, 6.2], [12.5, 6.8]] as const) {
    add(drum, mats.crate, dx, 0.65, dz);
    add(drumLid, mats.struct, dx, 1.31, dz);
  }

  // ---- 背墙卷帘门 + 轨道 + 门楣灯（视觉锚点，让"仓库"读得出来）----
  const doorX = -ROOM_W / 2 + 9.5;
  const doorZ = zb - 0.3;
  add(new THREE.BoxGeometry(9.0, 4.6, 0.30), mats.furn, doorX, 2.5, doorZ);
  add(new THREE.BoxGeometry(9.4, 0.16, 0.44), mats.stripWarm, doorX, 4.9, doorZ);
  for (let i = 0; i < 8; i++) {
    add(new THREE.BoxGeometry(9.0, 0.10, 0.10), mats.struct, doorX, 0.6 + i * 0.55, doorZ - 0.14);
  }
}

// ------------------------------------------------------------
// 加工站：工作台 + 熔炉 + 管道群 + 传送带 + 机械臂
// ------------------------------------------------------------

export function decorateWorkshop(add: AddFn, mats: DecorMats): void {
  const zb = -ROOM_D / 2 + 2.6; // ★ 2.6：熔炉半径 1.9 + 留墙距，别穿出背墙

  // ---- 主工作台（梯形控制台 + 切角台面板 + 前沿灯条）----
  add(extrudeProfile(trapezoidProfile(7.4, 6.8, 1.0), 1.7), mats.furn, 0, 0.5, zb);
  add(extrudeProfile(chamferRectProfile(8.0, 0.20, 0.10), 2.0), mats.furn, 0, 1.06, zb);
  add(new THREE.BoxGeometry(7.6, 0.10, 0.10), mats.strip, 0, 1.20, zb + 0.9);
  add(new THREE.BoxGeometry(1.1, 0.8, 1.1), mats.crate, -1.6, 1.56, zb);
  add(new THREE.CylinderGeometry(0.42, 0.42, 0.7, 12, 1), mats.struct, 1.8, 1.51, zb);

  // ---- 熔炉：八棱柱炉体 + 发光观火口 + 顶盖 + 烟囱 ----
  add(extrudeProfile(polyProfile(8, 1.9), 3.4), mats.struct, 6.6, 1.7, zb - 0.4);
  add(new THREE.CylinderGeometry(2.05, 2.05, 0.34, 8, 1), mats.struct, 6.6, 3.55, zb - 0.4);
  add(new THREE.TorusGeometry(0.62, 0.14, 8, 18), mats.stripWarm, 6.6, 1.7, zb + 1.55);
  add(new THREE.CylinderGeometry(0.36, 0.36, 0.5, 12, 1), mats.stripWarm, 6.6, 1.7, zb + 1.7, Math.PI / 2, 0, 0);
  add(new THREE.CylinderGeometry(0.55, 0.55, 3.2, 12, 1), mats.struct, 6.6, 5.6, zb - 0.4);

  // ---- 管道群：竖向立管 + 法兰 + 顶部横向输送管 + 下引支管 ----
  const riser = new THREE.CylinderGeometry(0.30, 0.30, 4.2, 12, 1);
  const header = new THREE.CylinderGeometry(0.30, 0.30, 9.6, 12, 1); // 长轴 y → 用 rz=π/2 转平到 x
  const flange = extrudeProfile(chamferRectProfile(0.86, 0.20, 0.06), 0.86);
  for (const px of [-9.4, -8.2, -7.0]) {
    add(riser, mats.struct, px, 6.2, zb - 0.6);
    for (const fy of [5.0, 6.4, 7.8]) add(flange, mats.struct, px, fy, zb - 0.6);
  }
  add(header, mats.struct, -4.6, 8.85, zb - 0.6, 0, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.30, 0.30, 2.4, 12, 1), mats.struct, 0.2, 7.65, zb - 0.6);

  // ---- 传送带：长槽体 + 支腿 + 滚轴 + 工件 ----
  beamX(add, extrudeProfile(chamferRectProfile(11.0, 0.34, 0.14), 1.5), mats.struct, -1.0, 1.15, 3.4);
  for (const lx of [-6.0, -3.4, 1.4, 4.0]) {
    add(extrudeProfile(chamferRectProfile(0.24, 1.0, 0.06), 0.24), mats.struct, lx, 0.5, 3.4);
  }
  const roller = new THREE.CylinderGeometry(0.16, 0.16, 1.4, 10, 1); // 长轴 y → rx=π/2 转到 z
  for (let i = 0; i < 9; i++) add(roller, mats.furn, -5.6 + i * 1.25, 1.34, 3.4, Math.PI / 2, 0, 0);
  add(new THREE.BoxGeometry(1.0, 0.7, 1.0), mats.crate, -4.2, 1.67, 3.4);
  add(new THREE.BoxGeometry(0.9, 0.6, 0.9), mats.crate, 1.6, 1.62, 3.4);

  // ---- 机械臂（两节 + 夹爪 + 关节灯）----
  add(new THREE.CylinderGeometry(0.20, 0.30, 2.6, 10, 1), mats.struct, 9.4, 2.5, zb + 0.6);
  add(new THREE.CylinderGeometry(0.15, 0.15, 3.2, 10, 1), mats.struct, 7.6, 4.4, zb + 1.1, 0, 0, 1.05);
  add(new THREE.BoxGeometry(0.66, 0.40, 0.66), mats.furn, 6.1, 5.1, zb + 1.3);
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8, 1), mats.strip, 9.4, 3.9, zb + 0.6);
}

// ------------------------------------------------------------
// 驾驶舱：抬高地台 + 环形舷窗 + 三联操纵台 + 航行终端台座 + 导流叶片
// ------------------------------------------------------------

export function decorateCockpit(add: AddFn, mats: DecorMats): void {
  const zb = -ROOM_D / 2;          // -9
  const halfW = ROOM_W / 2;        // 13.5

  // ---- ① 抬高地台：两级踏步 + 平台，把驾驶舱后半抬起来，彻底改变房间剖面 ----
  //   平台高 0.70（z ∈ [-9, -1.5]）；前方一级踏步高 0.35。
  add(extrudeProfile(chamferRectProfile(ROOM_W - 2.0, 0.70, 0.45), 7.5), mats.furn, 0, 0.35, zb + 3.75);
  add(extrudeProfile(chamferRectProfile(ROOM_W - 2.0, 0.35, 0.30), 0.75), mats.furn, 0, 0.175, zb + 8.05);
  add(new THREE.BoxGeometry(ROOM_W - 2.4, 0.10, 0.14), mats.strip, 0, 0.72, zb + 7.35);
  add(new THREE.BoxGeometry(ROOM_W - 2.4, 0.10, 0.14), mats.stripWarm, 0, 0.72, zb + 0.2);
  for (const sx of [-halfW + 1.2, halfW - 1.2]) {
    add(new THREE.BoxGeometry(0.14, 0.12, 7.4), mats.strip, sx, 0.72, zb + 3.75);
  }

  // ---- ② 环形舷窗：窗框铆接环 + 8 根辐射窗棂 + viewport shader 星空 ----
  const winR = 4.6;
  const winY = 5.6;
  add(new THREE.TorusGeometry(winR, 0.38, 10, 48), mats.struct, 0, winY, zb + 0.34);
  add(new THREE.TorusGeometry(winR + 0.85, 0.20, 8, 48), mats.furn, 0, winY, zb + 0.30);
  const mullion = new THREE.BoxGeometry(0.5, 0.34, 0.18); // 长轴 x → rotZ 转成径向
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    add(mullion, mats.struct,
      Math.cos(a) * (winR + 0.3), winY + Math.sin(a) * (winR + 0.3), zb + 0.30, 0, 0, a);
  }
  add(new THREE.CircleGeometry(winR, 48), mats.viewport, 0, winY, zb + 0.42);
  // 窗下仪表条
  add(new THREE.BoxGeometry(13.0, 0.9, 0.34), mats.furn, 0, 1.05, zb + 0.55);
  add(new THREE.BoxGeometry(12.4, 0.06, 0.10), mats.strip, 0, 1.52, zb + 0.72);

  // ---- ③ 三联操纵台（地台中段；梯形挤出 + 台面，中间三块倾斜主屏）----
  const pilot = extrudeProfile(trapezoidProfile(3.4, 3.0, 1.0), 1.8);
  const pilotTop = extrudeProfile(chamferRectProfile(3.8, 0.18, 0.10), 2.1);
  const pilotScreen = new THREE.PlaneGeometry(2.6, 1.25);
  const pilotSeat = extrudeProfile(chamferRectProfile(1.0, 0.18, 0.06), 1.0);
  const pilotBack = extrudeProfile(chamferRectProfile(1.0, 1.2, 0.12), 0.22);
  for (const px of [-4.6, 0, 4.6]) {
    add(pilot, mats.furn, px, 1.20, zb + 4.2);
    add(pilotTop, mats.furn, px, 1.76, zb + 4.2);
    // 倾斜主屏：面朝 +z（角色从房间这侧看）
    add(pilotScreen, mats.screen, px, 2.55, zb + 3.55, -0.42, 0, 0);
    add(new THREE.BoxGeometry(2.8, 0.08, 0.10), mats.stripWarm, px, 2.02, zb + 5.05);
    // 操纵杆 + 油门推杆
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8, 1), mats.struct, px - 1.0, 2.18, zb + 4.6);
    add(new THREE.SphereGeometry(0.20, 12, 10), mats.stripWarm, px - 1.0, 2.60, zb + 4.6);
    add(new THREE.CylinderGeometry(0.05, 0.05, 0.55, 8, 1), mats.struct, px + 1.0, 2.05, zb + 4.6);
    add(new THREE.BoxGeometry(0.30, 0.10, 0.24), mats.stripWarm, px + 1.0, 2.34, zb + 4.6);
    // 座椅
    add(pilotSeat, mats.furn, px, 1.36, zb + 6.0);
    add(pilotBack, mats.furn, px, 2.00, zb + 6.5);
    add(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8, 1), mats.struct, px, 1.10, zb + 6.0);
  }

  // ---- ④ 航行终端台座（【起飞 / 返回罗德岛号】的实体交互对象）----
  const termX = 9.8;
  const termZ = 5.6;
  add(extrudeProfile(polyProfile(6, 1.5), 1.15), mats.furn, termX, 0.575, termZ);
  add(new THREE.CylinderGeometry(1.35, 1.55, 0.18, 6, 1), mats.struct, termX, 1.22, termZ);
  add(new THREE.TorusGeometry(0.95, 0.055, 8, 30), mats.strip, termX, 2.30, termZ, Math.PI / 2, 0, 0);
  add(new THREE.TorusGeometry(0.62, 0.04, 8, 26), mats.stripWarm, termX, 2.78, termZ, Math.PI / 2, 0.4, 0);
  add(new THREE.CylinderGeometry(0.5, 0.68, 1.15, 10, 1, true), mats.strip, termX, 1.85, termZ);
  for (let i = 0; i < 4; i++) {   // 四角定位柱：视觉上圈出"可交互点"
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    add(new THREE.CylinderGeometry(0.10, 0.14, 0.5, 8, 1), mats.struct,
      termX + Math.cos(a) * 2.3, 0.25, termZ + Math.sin(a) * 2.3);
  }

  // ---- ④-b 物资加工位（左侧；【加工台】交互站的实体承载）----
  const benchX = -9.8;
  const benchZ = 5.6;
  add(extrudeProfile(trapezoidProfile(4.4, 4.0, 1.0), 1.6), mats.furn, benchX, 0.5, benchZ);
  add(extrudeProfile(chamferRectProfile(4.8, 0.18, 0.10), 1.9), mats.furn, benchX, 1.06, benchZ);
  add(new THREE.BoxGeometry(4.4, 0.08, 0.10), mats.strip, benchX, 1.20, benchZ + 0.86);
  // 台上的料件 + 小显示器
  add(new THREE.BoxGeometry(0.9, 0.7, 0.9), mats.crate, benchX - 1.2, 1.50, benchZ);
  add(new THREE.CylinderGeometry(0.34, 0.34, 0.6, 12, 1), mats.struct, benchX + 0.4, 1.45, benchZ);
  add(new THREE.PlaneGeometry(1.6, 1.0), mats.screenAlt, benchX + 1.6, 1.72, benchZ - 0.35, -0.42, 0, 0);
  // 墙上的工具挂板（让"加工位"有背景，不悬空）
  add(new THREE.BoxGeometry(5.6, 3.2, 0.30), mats.wall, benchX, 1.9, -ROOM_D / 2 + 0.35);
  add(new THREE.BoxGeometry(5.0, 0.10, 0.10), mats.stripWarm, benchX, 3.3, -ROOM_D / 2 + 0.52);
  const tool = new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8, 1);
  for (let i = 0; i < 6; i++) {
    add(tool, mats.struct, benchX - 1.8 + i * 0.72, 2.4, -ROOM_D / 2 + 0.55, Math.PI / 2, 0, 0);
  }

  // ---- ④-c 舱门（前方剖切面；【下船】交互站的实体承载）----
  const hatchZ = 7.6;
  add(extrudeProfile(chamferRectProfile(0.30, 3.4, 0.08), 0.60), mats.wall, -2.6, 1.7, hatchZ);
  add(extrudeProfile(chamferRectProfile(0.30, 3.4, 0.08), 0.60), mats.wall, 2.6, 1.7, hatchZ);
  add(new THREE.BoxGeometry(5.8, 0.34, 0.60), mats.struct, 0, 3.55, hatchZ);
  add(new THREE.BoxGeometry(5.2, 0.10, 0.12), mats.stripWarm, 0, 3.30, hatchZ - 0.24);
  add(new THREE.BoxGeometry(4.6, 0.06, 0.30), mats.strip, 0, 0.10, hatchZ);
  for (const sx of [-2.6, 2.6]) {
    add(new THREE.CylinderGeometry(0.09, 0.09, 3.0, 8, 1), mats.struct, sx, 1.7, hatchZ - 0.34, 0.35, 0, 0);
  }

  // ---- ⑤ 侧壁导流叶片 + 顶部氛围环 ----
  const vane = extrudeProfile(wedgeProfile(1.5, 0.30, 0.9), 2.4);
  for (const sx of [-halfW + 0.35, halfW - 0.35]) {
    for (const sz of [-5.5, -1.0, 3.5, 7.0]) {
      add(vane, mats.furn, sx, 4.2, sz, 0, 0, sx < 0 ? -0.35 : 0.35);
    }
    add(new THREE.BoxGeometry(0.12, 0.10, 15.0), mats.stripWarm, sx, 7.6, 0);
  }
  add(new THREE.TorusGeometry(4.2, 0.10, 8, 40), mats.strip, 0, 9.4, zb + 5.0, Math.PI / 2, 0, 0);
}
