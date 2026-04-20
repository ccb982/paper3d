// FlameContourWorld.ts
import * as THREE from 'three';

export class FlameContourWorld {
  private lineGroup: THREE.Group;
  private layers: number = 4;            // 垂直分层数量
  private radialSegments: number = 32;   // 水平角度分段数
  private updateInterval: number = 0.05;
  private lastUpdateTime: number = 0;
  private lineMeshes: THREE.LineLoop[] = [];

  constructor(scene: THREE.Scene) {
    this.lineGroup = new THREE.Group();
    this.lineGroup.name = 'FlameContourWorld';
    scene.add(this.lineGroup);
  }

  update(particles: THREE.Vector3[]) {
    const now = performance.now() * 0.001;
    if (now - this.lastUpdateTime < this.updateInterval) return;
    this.lastUpdateTime = now;

    if (particles.length < 20) return;

    // 1. 计算 Y 范围（垂直方向）
    const yValues = particles.map(p => p.y);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    const yRange = maxY - minY;
    if (yRange < 0.1) return;

    this.clearLines();

    // 2. 每层处理
    for (let layer = 0; layer < this.layers; layer++) {
      const yMin = minY + (layer / this.layers) * yRange;
      const yMax = minY + ((layer + 1) / this.layers) * yRange;
      const layerParticles = particles.filter(p => p.y >= yMin && p.y <= yMax);
      if (layerParticles.length < 8) continue;

      // 3. 按水平角度取极值
      const radialMap = new Array(this.radialSegments).fill(null).map(() => ({ radius: -1, point: null as THREE.Vector3 | null }));
      for (const p of layerParticles) {
        const angle = Math.atan2(p.z, p.x); // 注意：XZ 平面
        let seg = Math.floor((angle + Math.PI) / (Math.PI * 2) * this.radialSegments);
        seg = Math.min(this.radialSegments - 1, Math.max(0, seg));
        const radius = Math.hypot(p.x, p.z);
        if (radius > radialMap[seg].radius) {
          radialMap[seg].radius = radius;
          radialMap[seg].point = p.clone();
        }
      }

      // 收集有效点
      const contourPoints: THREE.Vector3[] = [];
      for (let i = 0; i < this.radialSegments; i++) {
        if (radialMap[i].point) {
          contourPoints.push(radialMap[i].point!);
        }
      }
      if (contourPoints.length < 8) continue;

      // 按角度排序
      contourPoints.sort((a, b) => {
        const angleA = Math.atan2(a.z, a.x);
        const angleB = Math.atan2(b.z, b.x);
        return angleA - angleB;
      });

      // 平滑曲线
      const curve = new THREE.CatmullRomCurve3(contourPoints);
      curve.curveType = 'centripetal';
      curve.closed = true;
      const smoothPoints = curve.getPoints(60);

      // 颜色随层变化
      const t = layer / this.layers;
      const color = new THREE.Color().setHSL(0.08 + t * 0.05, 1.0, 0.5 + (1 - t) * 0.3);
      const geometry = new THREE.BufferGeometry().setFromPoints(smoothPoints);
      const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
      const loop = new THREE.LineLoop(geometry, material);
      this.lineGroup.add(loop);
      this.lineMeshes.push(loop);
    }
  }

  private clearLines() {
    this.lineMeshes.forEach(line => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.lineGroup.remove(line);
    });
    this.lineMeshes = [];
  }

  public dispose() {
    this.clearLines();
    if (this.lineGroup.parent) this.lineGroup.parent.remove(this.lineGroup);
  }
}