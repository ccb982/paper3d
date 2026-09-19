// ============================================================
// DeployPreview —— 投送落点预览（祖宗 / 城墙 / 墙 统一）
// ============================================================
// 用途：选中「祖宗 / 掩体」弹药时，在准星落点显示投放预览：
//   · circle —— 祖宗（半径圈 + 半透明底盘）
//   · rect   —— 城墙/墙（4×0.8 足迹 + 描边，随发射方向旋转）
// 纯表现：贴地摆放、不写深度、renderOrder 高于水面（与子弹/血条同档）。
// ============================================================

import * as THREE from 'three';

function makeFlatDisc(radius: number, color: number, opacity: number): THREE.Mesh {
  const geo = new THREE.CircleGeometry(radius, 40);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 19;
  return m;
}

function makeRing(radius: number, width: number, color: number): THREE.Mesh {
  const geo = new THREE.RingGeometry(Math.max(0.05, radius - width), radius, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.95, depthWrite: false, depthTest: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 20;
  return m;
}

export class DeployPreview {
  private readonly circleGroup = new THREE.Group();
  private readonly rectGroup = new THREE.Group();
  private readonly disc: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly rectPlane: THREE.Mesh;
  private readonly rectEdge: THREE.LineSegments;

  constructor(scene: THREE.Scene) {
    // 祖宗：蓝圈
    this.disc = makeFlatDisc(1.6, 0x66ccff, 0.18);
    this.ring = makeRing(1.6, 0.12, 0x8fdcff);
    this.circleGroup.add(this.disc, this.ring);
    // 掩体：白足迹 + 描边
    this.rectPlane = makeFlatDisc(0.5, 0xffffff, 0.14); // 占位（构造时替换几何）
    this.rectPlane.geometry.dispose();
    this.rectPlane.geometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.rectEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 }),
    );
    this.rectEdge.renderOrder = 20;
    this.rectGroup.add(this.rectPlane, this.rectEdge);
    scene.add(this.circleGroup, this.rectGroup);
    this.hide();
  }

  /** 祖宗落点：圆形（半径 r） */
  showCircle(x: number, y: number, z: number, r = 1.6, color = 0x8fdcff): void {
    this.circleGroup.visible = true;
    this.rectGroup.visible = false;
    this.circleGroup.position.set(x, y, z);
    this.circleGroup.scale.setScalar(r / 1.6);
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  /** 城墙/墙落点：矩形足迹（宽 w × 厚 l，随 heading 旋转；color 区分变体） */
  showRect(x: number, y: number, z: number, w: number, l: number, heading: number, color = 0xffffff): void {
    this.circleGroup.visible = false;
    this.rectGroup.visible = true;
    this.rectGroup.position.set(x, y, z);
    this.rectGroup.rotation.y = heading;
    this.rectPlane.scale.set(w, 1, l);
    this.rectEdge.scale.set(w, 1, l);
    (this.rectPlane.material as THREE.MeshBasicMaterial).color.setHex(color);
    (this.rectEdge.material as THREE.LineBasicMaterial).color.setHex(color);
  }

  hide(): void {
    this.circleGroup.visible = false;
    this.rectGroup.visible = false;
  }

  dispose(): void {
    for (const g of [this.circleGroup, this.rectGroup]) {
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = (mesh as unknown as { material?: THREE.Material }).material;
        mat?.dispose?.();
      });
      g.parent?.remove(g);
    }
  }
}
