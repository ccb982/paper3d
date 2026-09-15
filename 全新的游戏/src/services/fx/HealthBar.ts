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
    // ★ 上限取实体的 maxHp；实体尚未写 maxHp 时（= 0）回退当时 hp。
    //   ⚠ 不能只写 `= target.hp`：蜂群升格路径（WorldMode.createEnemyEntity）是
    //   「先 new EnemyBase(hp=受损值) 挂血条 → 再补 enemey.maxHp = 真实上限」，
    //   构造那一刻 target.hp 已是残血 → 快照当上限 → 比例恒 = 1（永远满血）。
    this.maxHp = target.maxHp > 0 ? target.maxHp : target.hp;

    const bgGeo = new THREE.PlaneGeometry(w, this.height);
    // ★ 与子弹同款层级（BulletRenderer）：水面 renderOrder=10 先画，血条排 20 后画；
    //   不写深度（透明排序安全）→ 不会被远处的水无差别盖住；
    //   depthTest 仍读地形/角色深度 → 被地形挡住的遮挡关系保持正确。
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a1a, transparent: true, opacity: 0.7,
      depthTest: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    const bg = new THREE.Mesh(bgGeo, bgMat);
    bg.renderOrder = 20;

    const fgGeo = new THREE.PlaneGeometry(w, this.height);
    const fgMat = new THREE.MeshBasicMaterial({
      color: opts?.color ?? 0xff3333, transparent: true, opacity: 0.9,
      depthTest: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    });
    this.fg = new THREE.Mesh(fgGeo, fgMat);
    // ★ 前景排背景之后（同层内保证前景条盖在暗底上）
    this.fg.renderOrder = 21;
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
    // ★ 上限每帧从实体读（含"构造后才写入 maxHp"的升格路径 / 上限被 buff 改动）
    const maxHp = this.target.maxHp > 0 ? this.target.maxHp : this.maxHp;
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, this.target.hp / maxHp)) : 0;
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
