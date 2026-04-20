import * as THREE from 'three';

export class FlameContour {
  private lineGroup: THREE.Group;
  private layers: number = 5;
  private lineMeshes: THREE.LineLoop[] = [];
  private lastUpdateTime: number = 0;
  private updateInterval: number = 0.05; // 每50ms更新一次，降低性能消耗

  constructor(scene: THREE.Scene) {
    this.lineGroup = new THREE.Group();
    this.lineGroup.name = 'FlameContour';
    scene.add(this.lineGroup);
  }

  update(particles: THREE.Vector3[], camera: THREE.Camera): void {
    // 降低更新频率
    const currentTime = performance.now() * 0.001;
    if (currentTime - this.lastUpdateTime < this.updateInterval) {
      return;
    }
    this.lastUpdateTime = currentTime;

    if (particles.length === 0) return;

    // 1. 转换到相机空间
    const cameraMatrix = camera.matrixWorldInverse;
    const cameraSpacePts = particles.map(p => {
      const vec = p.clone().applyMatrix4(cameraMatrix);
      return vec;
    });

    // 2. 获取深度范围
    const depths = cameraSpacePts.map(p => p.z);
    if (depths.length === 0) return;
    
    const minZ = Math.min(...depths);
    const maxZ = Math.max(...depths);
    
    if (maxZ - minZ < 0.1) {
      // 粒子太薄，直接用所有粒子生成一个轮廓
      this.extractSingleContour(cameraSpacePts, (minZ + maxZ) / 2, camera);
      return;
    }
    
    const step = (maxZ - minZ) / this.layers;

    // 3. 清空旧的线框
    this.clearLines();

    // 4. 对每一层提取轮廓
    for (let i = 0; i < this.layers; i++) {
      const zMin = minZ + i * step;
      const zMax = zMin + step;
      const layerParticles = cameraSpacePts.filter(p => p.z >= zMin && p.z <= zMax);
      
      if (layerParticles.length < 3) continue;

      // 5. 将粒子投影到 XOY 平面（即屏幕平面），按角度排序
      const points2D = layerParticles.map(p => new THREE.Vector2(p.x, p.y));
      const contour = this.computeConvexHull2D(points2D);
      
      if (contour.length < 3) continue;

      // 6. 转换回世界坐标
      const invCameraMatrix = camera.matrixWorld;
      const worldPoints = contour.map(p2 => {
        const p3 = new THREE.Vector3(p2.x, p2.y, (zMin + zMax) / 2);
        return p3.applyMatrix4(invCameraMatrix);
      });

      // 7. 创建 LineLoop，颜色随高度变化（底部橙红，顶部暗红）
      const heightRatio = i / this.layers;
      const color = new THREE.Color().setHSL(0.05 + heightRatio * 0.05, 1.0, 0.5 + (1 - heightRatio) * 0.3);
      
      const geometry = new THREE.BufferGeometry().setFromPoints(worldPoints);
      const material = new THREE.LineBasicMaterial({ 
        color: color, 
        transparent: true, 
        opacity: 0.6 - heightRatio * 0.3 
      });
      const loop = new THREE.LineLoop(geometry, material);
      this.lineGroup.add(loop);
      this.lineMeshes.push(loop);
    }
  }

  private extractSingleContour(cameraSpacePts: THREE.Vector3[], zCenter: number, camera: THREE.Camera): void {
    this.clearLines();
    
    if (cameraSpacePts.length < 3) return;
    
    const points2D = cameraSpacePts.map(p => new THREE.Vector2(p.x, p.y));
    const contour = this.computeConvexHull2D(points2D);
    
    if (contour.length < 3) return;
    
    const invCameraMatrix = camera.matrixWorld;
    const worldPoints = contour.map(p2 => {
      const p3 = new THREE.Vector3(p2.x, p2.y, zCenter);
      return p3.applyMatrix4(invCameraMatrix);
    });
    
    const geometry = new THREE.BufferGeometry().setFromPoints(worldPoints);
    const material = new THREE.LineBasicMaterial({ 
      color: 0xff6600, 
      transparent: true, 
      opacity: 0.5 
    });
    const loop = new THREE.LineLoop(geometry, material);
    this.lineGroup.add(loop);
    this.lineMeshes.push(loop);
  }

  private clearLines(): void {
    this.lineMeshes.forEach(line => {
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
      this.lineGroup.remove(line);
    });
    this.lineMeshes = [];
  }

  private computeConvexHull2D(points: THREE.Vector2[]): THREE.Vector2[] {
    if (points.length < 3) return points;
    
    const sorted = points.slice();
    sorted.sort((a, b) => a.x - b.x || a.y - b.y);
    
    const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2): number => 
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    
    const hull: THREE.Vector2[] = [];
    
    for (const p of sorted) {
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
        hull.pop();
      }
      hull.push(p);
    }
    
    const lower = hull.slice();
    hull.length = 0;
    
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], p) <= 0) {
        hull.pop();
      }
      hull.push(p);
    }
    
    hull.pop();
    
    return hull;
  }

  public dispose(): void {
    this.clearLines();
    if (this.lineGroup.parent) {
      this.lineGroup.parent.remove(this.lineGroup);
    }
  }
}