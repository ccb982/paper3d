// ============================================================
// ShipScene —— 3D 舰船场景构建与销毁
// ============================================================
// 从 ShipMode 抽取（2026-08-23 拆分 Phase1①，纯搬运零行为变更）：
//   - 甲板 / 网格 / 边界墙 / 四房间 / 全息桌 / 补光
//   - 相机机位设置
//   - 资源销毁（traverse 释放 geometry/material）
// 不含任何业务逻辑；ShipMode 只做创建与销毁调用。
// ============================================================

import * as THREE from 'three';

// ============================================================
// 舰船场景布局（简单占位地图）
// ============================================================

const SHIP_SIZE = 24;
const WALL_HEIGHT = 3;
const ROOM_LAYOUT = {
  rooms: [
    { x: -8, z: -8, w: 6, d: 6, color: 0x4a4a6a, label: 'L1 仓库' },
    { x: 2, z: -8, w: 6, d: 6, color: 0x6a4a4a, label: '出口' },
    { x: -8, z: 2, w: 6, d: 6, color: 0x4a6a4a, label: '招募区' },
    { x: 2, z: 2, w: 6, d: 6, color: 0x6a6a4a, label: '休息区' },
  ],
  center: { x: -3, z: -3 },
};

export class ShipScene {
  readonly group: THREE.Group;

  constructor(private scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.build();
    this.scene.add(this.group);
  }

  /** 设置舰船观察机位 */
  setupCamera(camera: THREE.PerspectiveCamera): void {
    camera.position.set(0, 18, 14);
    camera.lookAt(ROOM_LAYOUT.center.x, 0, ROOM_LAYOUT.center.z);
    camera.updateProjectionMatrix();
  }

  /** 销毁全部场景资源 */
  dispose(): void {
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    this.group.clear();
  }

  // ============================================================
  // 构建（原 ShipMode.buildShipScene 系列，逐行搬运）
  // ============================================================

  private build(): void {
    // 甲板
    const deckGeo = new THREE.PlaneGeometry(SHIP_SIZE, SHIP_SIZE);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x3a3a5a, roughness: 0.8, metalness: 0.3 });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.y = -0.05;
    deck.receiveShadow = true;
    this.group.add(deck);

    // 网格线
    const gridHelper = new THREE.GridHelper(SHIP_SIZE, 12, 0x6a6a8a, 0x4a4a6a);
    gridHelper.position.y = 0.01;
    this.group.add(gridHelper);

    // 边界墙
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x4a4a8a, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
    for (const wp of [
      { x: 0, z: -SHIP_SIZE / 2, ry: 0 },
      { x: 0, z: SHIP_SIZE / 2, ry: 0 },
      { x: -SHIP_SIZE / 2, z: 0, ry: Math.PI / 2 },
      { x: SHIP_SIZE / 2, z: 0, ry: Math.PI / 2 },
    ]) {
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(SHIP_SIZE, WALL_HEIGHT), wallMat);
      wall.position.set(wp.x, WALL_HEIGHT / 2, wp.z);
      wall.rotation.y = wp.ry;
      this.group.add(wall);
    }

    // 房间
    for (const room of ROOM_LAYOUT.rooms) {
      this.buildRoom(room.x, room.z, room.w, room.d, room.color, room.label);
    }

    // 全息投影桌
    this.buildCenterTable();

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(0, 10, 0);
    this.group.add(fillLight);
  }

  private buildRoom(x: number, z: number, w: number, d: number, color: number, label: string): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 0.4, d - 0.4),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, 0.02, z);
    this.group.add(floor);

    const edgeMat = new THREE.LineBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.5 });
    const edgePoints = [
      new THREE.Vector3(x - w / 2, 0.05, z - d / 2),
      new THREE.Vector3(x + w / 2, 0.05, z - d / 2),
      new THREE.Vector3(x + w / 2, 0.05, z + d / 2),
      new THREE.Vector3(x - w / 2, 0.05, z + d / 2),
      new THREE.Vector3(x - w / 2, 0.05, z - d / 2),
    ];
    const edgeGeo = new THREE.BufferGeometry().setFromPoints(edgePoints);
    const edgeLine = new THREE.Line(edgeGeo, edgeMat);
    this.group.add(edgeLine);

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x88aaff, emissive: 0x4466aa, emissiveIntensity: 0.3, transparent: true, opacity: 0.5 });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.5, 8), pillarMat);
    pillar.position.set(x - w / 2 + 0.5, 0.25, z - d / 2 + 0.5);
    this.group.add(pillar);
  }

  private buildCenterTable(): void {
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x6688cc, emissive: 0x224488, emissiveIntensity: 0.2, metalness: 0.8, roughness: 0.2 });
    const table = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.5, 0.3, 24), tableMat);
    table.position.set(ROOM_LAYOUT.center.x, 0.15, ROOM_LAYOUT.center.z);
    this.group.add(table);

    const ringMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.3, wireframe: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.03, 8, 32), ringMat);
    ring.position.set(ROOM_LAYOUT.center.x, 0.5, ROOM_LAYOUT.center.z);
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);

    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.03, 8, 32), ringMat);
    ring2.position.set(ROOM_LAYOUT.center.x, 0.5, ROOM_LAYOUT.center.z);
    this.group.add(ring2);
  }
}

/** 创建文字标签精灵（当前无调用点，随原码保留备用） */
export function createLabel(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  // 背景
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.roundRect(0, 0, 256, 64, 8);
  ctx.fill();
  // 边框
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  ctx.strokeStyle = `rgb(${r},${g},${b})`;
  ctx.lineWidth = 2;
  ctx.roundRect(0, 0, 256, 64, 8);
  ctx.stroke();
  // 文字
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 34);
  // 创建纹理
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.4, 0.1, 1);
  return sprite;
}
