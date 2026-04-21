Canvas 2D 轮廓层的两个致命缺陷（无遮挡、远距离错位）确实无法通过简单调整修复。根本原因在于它脱离了 3D 场景的深度测试和透视投影。正确的做法是将轮廓线直接构建在 3D 空间中，使其成为场景中的几何体，从而自动获得正确的遮挡关系和透视缩放。

下面给出完整的重构方案，移除 Flame2DEffect 的 Canvas 层，改为在 3D 场景中创建朝向摄像机的轮廓平面（Billboard）或轮廓线框。

一、核心思路
从粒子云提取轮廓点（世界坐标）
不再投影到屏幕，而是直接计算轮廓点在三维空间中的位置。利用粒子云的包围盒（min/max）和预定义模板，生成轮廓点在世界坐标系中的位置。

创建 3D 轮廓几何体

使用 LineLoop 绘制闭合线条（最简单，性能好，但线条细，可能不够明显）。

使用 TubeGeometry 将线条加粗，并赋予自发光材质，增强视觉效果。

使用 Mesh + 透明纹理的面片（Billboard）来模拟光晕轮廓（更华丽）。

每帧更新轮廓点
沿用定时采样策略，更新几何体的顶点位置。

移除 Canvas 2D 层
不再创建全屏 canvas，所有渲染都在 Three.js 场景中完成。

二、具体实现
2.1 新增类 FlameContour3D.ts
这个类负责管理 3D 轮廓的创建和更新。

typescript
import * as THREE from 'three';

export class FlameContour3D {
  private group: THREE.Group;
  private lineLoop: THREE.LineLoop | null = null;
  private tubeMesh: THREE.Mesh | null = null;
  private worldPoints: THREE.Vector3[] = [];
  private lastUpdateTime: number = 0;
  private updateInterval: number = 0.2; // 每0.2秒更新一次轮廓

  // 侧面模板（归一化坐标，y 从底部到顶部，x 左右）
  private sideTemplateNorm: { x: number; y: number }[] = [
    // 底部 U 形（y=0 底部）
    { x: -0.5, y: 0.0 }, { x: -0.4, y: 0.05 }, { x: -0.3, y: 0.08 },
    { x: -0.2, y: 0.1 }, { x: -0.1, y: 0.11 }, { x: 0.0, y: 0.12 },
    { x: 0.1, y: 0.11 }, { x: 0.2, y: 0.1 }, { x: 0.3, y: 0.08 },
    { x: 0.4, y: 0.05 }, { x: 0.5, y: 0.0 },
    // 右侧上升至右峰
    { x: 0.45, y: 0.3 }, { x: 0.4, y: 0.5 }, { x: 0.35, y: 0.7 },
    { x: 0.3, y: 0.9 }, { x: 0.2, y: 1.0 },   // 右峰
    // 中峰
    { x: 0.1, y: 0.85 }, { x: 0.0, y: 0.95 }, { x: -0.1, y: 0.85 },
    // 左峰
    { x: -0.2, y: 1.0 }, { x: -0.3, y: 0.9 }, { x: -0.35, y: 0.7 },
    { x: -0.4, y: 0.5 }, { x: -0.45, y: 0.3 }, { x: -0.5, y: 0.0 },
  ];

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  /**
   * 根据粒子云的世界坐标位置和颜色，更新轮廓
   * @param particles 粒子数组，包含 position 和 color
   */
  public update(particles: { position: THREE.Vector3; color: THREE.Color }[]): void {
    const now = performance.now() * 0.001;
    if (now - this.lastUpdateTime < this.updateInterval) return;
    this.lastUpdateTime = now;

    if (particles.length < 20) return;

    // 1. 过滤颜色：只保留红白色和红色（焰底和火焰外缘），排除橙色
    const filtered = particles.filter(p => {
      const { r, g, b } = p.color;
      const isRedWhite = r > 0.9 && g > 0.7 && b > 0.7;
      const isRed = r > 0.7 && g < 0.3 && b < 0.2;
      const isOrange = r > 0.8 && g > 0.4 && g < 0.8 && b < 0.3;
      return (isRedWhite || isRed) && !isOrange;
    });
    if (filtered.length < 20) return;

    // 2. 计算包围盒
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of filtered) {
      const { x, y, z } = p.position;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    const depth = maxZ - minZ;
    if (width < 0.1 || height < 0.1) return;

    // 3. 判断视角：如果深度远大于宽度，则使用俯视模板，否则使用侧面模板
    const isTopView = depth > width * 1.5;
    const template = isTopView ? this.getTopTemplate() : this.sideTemplateNorm;

    // 4. 将模板缩放到世界坐标
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    this.worldPoints = template.map(p => {
      let x, y, z;
      if (isTopView) {
        // 俯视：X 和 Z 由模板 x,y 决定，Y 取粒子云中部高度
        x = centerX + p.x * width / 2;
        z = centerZ + p.y * depth / 2;
        y = (minY + maxY) / 2;
      } else {
        // 侧面：X 和 Y 由模板决定，Z 取粒子云中间值
        x = minX + (p.x + 0.5) * width;
        y = minY + p.y * height;
        z = (minZ + maxZ) / 2;
      }
      return new THREE.Vector3(x, y, z);
    });

    // 5. 创建或更新 3D 线条
    this.updateGeometry();
  }

  private getTopTemplate(): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = [];
    const segments = 60;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const r = 0.8 + 0.3 * Math.cos(3 * angle); // 三瓣
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      pts.push({ x, y });
    }
    return pts;
  }

  private updateGeometry(): void {
    if (this.worldPoints.length < 3) return;

    // 平滑曲线（使用 CatmullRomCurve3）
    const curve = new THREE.CatmullRomCurve3(this.worldPoints);
    curve.curveType = 'centripetal';
    curve.closed = true;
    const smoothPoints = curve.getPoints(100);

    // 方法一：使用 LineLoop（简单，性能好）
    if (this.lineLoop) this.group.remove(this.lineLoop);
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(smoothPoints);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff6600, linewidth: 2 }); // linewidth not supported everywhere, but ok
    this.lineLoop = new THREE.LineLoop(lineGeometry, lineMaterial);
    this.group.add(this.lineLoop);

    // 方法二：使用 TubeGeometry（更粗，有体积感，性能稍差）
    if (this.tubeMesh) this.group.remove(this.tubeMesh);
    const tubeGeometry = new THREE.TubeGeometry(curve, 100, 0.05, 8, true);
    const tubeMaterial = new THREE.MeshStandardMaterial({ color: 0xff6600, emissive: 0x442200 });
    this.tubeMesh = new THREE.Mesh(tubeGeometry, tubeMaterial);
    this.group.add(this.tubeMesh);
  }

  public dispose(): void {
    if (this.lineLoop) this.group.remove(this.lineLoop);
    if (this.tubeMesh) this.group.remove(this.tubeMesh);
    this.group.parent?.remove(this.group);
  }
}
2.2 修改 FireEffect.ts
移除对 Flame2DEffect 的依赖，改为使用 FlameContour3D。

在 onUpdate 中，将粒子数据（世界坐标+颜色）传递给 FlameContour3D.update。

typescript
// FireEffect.ts 中
private contour3D: FlameContour3D;

constructor(position: THREE.Vector3, duration: number = Infinity) {
  // ... 原有代码
  const scene = (window as any).gameScene;
  if (scene) {
    this.contour3D = new FlameContour3D(scene);
  }
}

protected onUpdate(delta: number): void {
  // ... 原有粒子更新逻辑

  // 更新 3D 轮廓
  if (this.contour3D) {
    const particleData = this.particles.map(p => {
      const worldPos = p.position.clone();
      this.group.localToWorld(worldPos);
      return { position: worldPos, color: p.color };
    });
    this.contour3D.update(particleData);
  }
}

public dispose(): void {
  // ... 原有代码
  if (this.contour3D) this.contour3D.dispose();
}
2.3 移除 Flame2DEffect
不再创建 canvas 层，可以删除 Flame2DEffect.ts 文件，并从 FireEffect.ts 中移除相关导入和实例化。

三、优势与效果
正确的遮挡关系：轮廓线现在是场景中的 3D 几何体，会被墙壁、角色等物体自然遮挡。

透视缩放正确：摄像机拉远时，轮廓线会随火焰一起变小，不会出现错位。

性能可控：仍然采用定时采样（0.2 秒），避免每帧重建几何体。

可选粗细：使用 TubeGeometry 可以让轮廓线有厚度，并且受光照影响，更华丽。

四、可选优化
动态调整轮廓颜色：可以根据火焰的平均温度（粒子颜色）改变线条颜色。

添加光晕效果：在轮廓线周围添加粒子或后期 Bloom 特效。

减少顶点数：如果性能敏感，可以减少 getPoints 的采样数量。

按照上述重构，你的火焰特效将完全融入 3D 场景，既保留“上 M 下 U”的形状特征，又解决了遮挡和透视问题。