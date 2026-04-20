// FlameContourSimple.ts
import * as THREE from 'three';

export class FlameContourSimple {
  private lineGroup: THREE.Group;
  private layers: number = 4;            // 分层数量
  private radialSegments: number = 36;   // 圆周分段数
  private updateInterval: number = 0.05; // 秒
  private lastUpdateTime: number = 0;
  private lineMeshes: THREE.LineLoop[] = [];

  constructor(scene: THREE.Scene) {
    this.lineGroup = new THREE.Group();
    this.lineGroup.name = 'FlameContourSimple';
    scene.add(this.lineGroup);
  }

  update(particles: THREE.Vector3[], camera: THREE.Camera) {
    // 节流
    const now = performance.now() * 0.001;
    if (now - this.lastUpdateTime < this.updateInterval) return;
    this.lastUpdateTime = now;

    if (particles.length < 10) return;

    // 1. 转换到相机空间
    const cameraMatrix = camera.matrixWorldInverse;
    const cameraSpace = particles.map(p => p.clone().applyMatrix4(cameraMatrix));

    // 2. 深度范围
    const depths = cameraSpace.map(p => p.z);
    const minZ = Math.min(...depths);
    const maxZ = Math.max(...depths);
    const zRange = maxZ - minZ;
    if (zRange < 0.1) return;

    // 3. 清空旧线条
    this.clearLines();

    // 4. 每层处理
    for (let layer = 0; layer < this.layers; layer++) {
      const zMin = minZ + (layer / this.layers) * zRange;
      const zMax = minZ + ((layer + 1) / this.layers) * zRange;
      const layerParticles = cameraSpace.filter(p => p.z >= zMin && p.z <= zMax);
      if (layerParticles.length < 8) continue; // 粒子太少跳过

      // 5. 按角度取极值
      const radialMap = new Array(this.radialSegments).fill(null).map(() => ({ radius: -1, point: null as THREE.Vector3 | null }));
      for (const p of layerParticles) {
        const angle = Math.atan2(p.y, p.x);
        let seg = Math.floor((angle + Math.PI) / (Math.PI * 2) * this.radialSegments);
        seg = Math.min(this.radialSegments - 1, Math.max(0, seg));
        const radius = Math.hypot(p.x, p.y);
        if (radius > radialMap[seg].radius) {
          radialMap[seg].radius = radius;
          radialMap[seg].point = p.clone();
        }
      }

      // 收集有效点（必须按角度顺序）
      const contourPoints: THREE.Vector3[] = [];
      for (let i = 0; i < this.radialSegments; i++) {
        if (radialMap[i].point) {
          contourPoints.push(radialMap[i].point!);
        }
      }
      if (contourPoints.length < 5) continue;

      // 按角度排序（确保顺序正确）
      contourPoints.sort((a, b) => {
        const angleA = Math.atan2(a.y, a.x);
        const angleB = Math.atan2(b.y, b.x);
        return angleA - angleB;
      });

      // 将点转换回世界坐标
      const invCameraMatrix = camera.matrixWorld;
      const worldPoints = contourPoints.map(p => p.clone().applyMatrix4(invCameraMatrix));

      // 创建平滑曲线（可选）
      const curve = new THREE.CatmullRomCurve3(worldPoints);
      curve.curveType = 'centripetal';
      curve.closed = true;
      const divisions = 50;
      const smoothPoints = curve.getPoints(divisions);

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