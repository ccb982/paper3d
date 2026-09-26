// ============================================================
// ui/ClimbPointsView —— 上坡点场景可视化（调试；用户定 2026-09-26）
// ============================================================
// 把可行性表预处理的上坡点画在**真实场景**里（不是小地图）：
//   · 绿点 = 上坡点（坡面正下方中心、坡面前 1m）；
//   · 红线 = 爬升法线（该向正对方向，长度 2m）；
//   · 黄线 = 该连续坡的宽度跨度（切向长度 = 宽 × 4m，画在坡基）。
// 开关：`?climbs=1` 或按键 H（H 切换）。数据源：PassTable.climbRuns（表重建后刷新）。
// ============================================================

import * as THREE from 'three';
import type { PassTable } from '../systems/swarm/nav/PassTable';
import { RasterMap } from '../services/map/RasterMap';

export class ClimbPointsView {
  private readonly group = new THREE.Group();
  private visible = false;
  private lastRuns = -1;

  constructor(scene: THREE.Scene, private readonly table: () => PassTable | null) {
    scene.add(this.group);
    this.group.visible = false;
  }

  get isVisible(): boolean { return this.visible; }

  setVisible(v: boolean): void {
    this.visible = v;
    this.group.visible = v;
    if (v) this.refresh(true);
  }

  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  /** 刷新（表重建/首次显示时调用；按 runs 数量做廉价判重） */
  refresh(force = false): void {
    if (!this.visible && !force) return;
    const t = this.table();
    if (!t || !t.ready) return;
    const runs = t.climbRuns ?? [];
    if (!force && runs.length === this.lastRuns) return;
    this.lastRuns = runs.length;
    this.rebuild(runs);
  }

  private rebuild(runs: readonly { x: number; z: number; ux: number; uz: number; width: number }[]): void {
    // 清旧
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry?.dispose?.();
    }
    const raster = RasterMap.current;
    const h = (x: number, z: number): number => (raster ? raster.surfaceHeightAt(x, z) : 0);

    const dotPos: number[] = [];
    const dotCol: number[] = [];
    const linePos: number[] = [];
    const lineCol: number[] = [];

    for (const r of runs) {
      const y = h(r.x, r.z) + 0.6;
      // 绿点
      dotPos.push(r.x, y, r.z);
      dotCol.push(0.2, 1.0, 0.3);
      // 红线：法线（爬升方向）2m
      linePos.push(r.x, y, r.z, r.x + r.ux * 2, y, r.z + r.uz * 2);
      lineCol.push(1, 0.25, 0.2, 1, 0.25, 0.2);
      // 黄线：坡宽跨度（切向）
      const tx = -r.uz, tz = r.ux;
      const half = Math.max(0.5, r.width * 2);
      const y2 = y - 0.35;
      linePos.push(r.x - tx * half, y2, r.z - tz * half, r.x + tx * half, y2, r.z + tz * half);
      lineCol.push(1, 0.9, 0.2, 1, 0.9, 0.2);
    }

    if (dotPos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(dotPos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(dotCol, 3));
      const m = new THREE.PointsMaterial({ size: 1.6, vertexColors: true, sizeAttenuation: true, depthTest: false, transparent: true });
      const pts = new THREE.Points(g, m);
      pts.renderOrder = 999;
      this.group.add(pts);
    }
    if (linePos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
      const m = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 });
      const lines = new THREE.LineSegments(g, m);
      lines.renderOrder = 999;
      this.group.add(lines);
    }
  }
}
