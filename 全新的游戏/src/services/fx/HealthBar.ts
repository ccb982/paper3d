// ============================================================
// HealthBar —— 头顶血条（EntityEffect 实例，附属特效管线）
// ============================================================
// 挂在实体特效槽（attachEffect('health', ...)）：跟随实体头顶，
// 每帧读实体 hp 比例缩放前景条；全 billboard 面相机。
// 纯表现：不参与物理/索引/伤害逻辑。

import * as THREE from 'three';
import type { EntityEffect } from './EntityEffect';
import type { EntityBase } from '../../entity/EntityBase';

export interface HealthBarOptions {
  /** 条宽（世界单位，默认 0.8） */
  width?: number;
  /** 条高（默认 0.1） */
  height?: number;
  /** 头顶偏移（默认 2.3） */
  offsetY?: number;
  /** 颜色（默认红） */
  color?: number;
}

export class HealthBar implements EntityEffect {
  private group: THREE.Group;
  private fg: THREE.Mesh;
  private maxHp: number;
  private offsetY: number;
  private height: number;

  constructor(scene: THREE.Scene, private target: EntityBase, opts?: HealthBarOptions) {
    const w = opts?.width ?? 0.8;
    this.height = opts?.height ?? 0.1;
    this.offsetY = opts?.offsetY ?? 2.3;
    this.maxHp = target.hp; // 初始血量 = 最大值

    const bgGeo = new THREE.PlaneGeometry(w, this.height);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.7, depthTest: false });
    const bg = new THREE.Mesh(bgGeo, bgMat);

    const fgGeo = new THREE.PlaneGeometry(w, this.height);
    const fgMat = new THREE.MeshBasicMaterial({ color: opts?.color ?? 0xff3333, transparent: true, opacity: 0.9, depthTest: false });
    this.fg = new THREE.Mesh(fgGeo, fgMat);
    // ★ 锚点左端：几何平移到右侧 + 位置对齐背景左端 → scale.x 从左侧收缩
    this.fg.geometry.translate(w / 2, 0, 0);
    this.fg.position.x = -w / 2;
    this.fg.position.z = 0.01; // 前景在背景前（防 z-fighting）

    this.group = new THREE.Group();
    this.group.add(bg, this.fg);
    scene.add(this.group);
  }

  /** 每帧：跟随实体头顶 + 按 hp 比例缩放 */
  update(_dt: number, x: number, y: number, z: number): boolean {
    this.group.position.set(x, y + this.offsetY, z);
    const ratio = Math.max(0, Math.min(1, this.target.hp / this.maxHp));
    this.fg.scale.x = ratio;
    this.fg.visible = ratio > 0;
    return false; // 常驻（随实体销毁）
  }

  /** 渲染：全 billboard 面相机 */
  render(camera: THREE.Camera): void {
    this.group.quaternion.copy(camera.quaternion);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    });
  }
}
