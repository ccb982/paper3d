import * as THREE from 'three';

export class FlameContour3D {
  private static instance: FlameContour3D | null = null;
  private group: THREE.Group;
  private worldPoints: THREE.Vector3[] = [];
  private lastUpdateTime: number = 0;
  private updateInterval: number = 0.2; // 每0.2秒更新一次轮廓
  private camera: THREE.Camera | null = null;
  private scene: THREE.Scene | null = null;

  // 侧面模板（归一化坐标，y 从底部到顶部，x 左右）
  private sideTemplateNorm: { x: number; y: number }[] = [
    // 底部 U 形（y=0 底部，两端高中间低）
    { x: -0.5, y: 0.08 },   // 底部左端高
    { x: -0.4, y: 0.05 },
    { x: -0.3, y: 0.03 },
    { x: -0.2, y: 0.01 },
    { x: -0.1, y: 0.00 },
    { x: 0.0, y: 0.00 },    // 底部中心最低（凹陷）
    { x: 0.1, y: 0.00 },
    { x: 0.2, y: 0.01 },
    { x: 0.3, y: 0.03 },
    { x: 0.4, y: 0.05 },
    { x: 0.5, y: 0.08 },    // 底部右端高
    // 右侧上升至右峰
    { x: 0.45, y: 0.3 }, { x: 0.4, y: 0.5 }, { x: 0.35, y: 0.7 },
    { x: 0.3, y: 0.9 }, { x: 0.2, y: 1.0 },   // 右峰
    // 中峰
    { x: 0.1, y: 0.85 }, { x: 0.0, y: 0.95 }, { x: -0.1, y: 0.85 },
    // 左峰
    { x: -0.2, y: 1.0 }, { x: -0.3, y: 0.9 }, { x: -0.35, y: 0.7 },
    { x: -0.4, y: 0.5 }, { x: -0.45, y: 0.3 }, { x: -0.5, y: 0.08 },
  ];

  private constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  public static getInstance(scene: THREE.Scene): FlameContour3D {
    if (!FlameContour3D.instance) {
      FlameContour3D.instance = new FlameContour3D(scene);
    }
    return FlameContour3D.instance;
  }

  /**
   * 设置相机，用于billboard效果
   * @param camera THREE.Camera实例
   */
  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
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

    // 3. 根据摄像机角度判断视角
    let isTopView = false;
    if (this.camera) {
      const cameraDirection = new THREE.Vector3();
      this.camera.getWorldDirection(cameraDirection);
      // 只有当相机向下看角度超过一定阈值时才使用俯视模板
      isTopView = cameraDirection.y < -0.7; // 向下看角度较大时使用俯视
    } else {
      // 回退到基于宽深比的判断
      isTopView = depth > width * 1.5;
    }
    const template = isTopView ? this.getTopTemplate() : this.sideTemplateNorm;

    // 4. 将模板缩放到世界坐标
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    
    this.worldPoints = template.map(p => {
      let x, y, z;
      if (isTopView) {
        // 俯视：X 和 Z 由模板 x,y 决定，Y 取粒子云中部高度
        x = centerX + p.x * width / 2;
        z = centerZ + p.y * depth / 2;
        y = centerY;
      } else {
        // 侧面：X 和 Y 由模板决定，Z 取粒子云中间值
        x = minX + (p.x + 0.5) * width;
        y = minY + p.y * height;
        z = centerZ;
      }
      return new THREE.Vector3(x, y, z);
    });

    // 5. 创建或更新 3D 线条
    this.updateGeometry();
  }

  /**
   * 更新几何体并应用billboard效果（保持水平方向）
   */
  public updateBillboard(): void {
    if (!this.camera) return;
    
    // 保持轮廓水平，只在水平方向面向相机
    const cameraQuaternion = this.camera.quaternion.clone();
    // 去除垂直旋转，只保留水平旋转
    cameraQuaternion.x = 0;
    cameraQuaternion.z = 0;
    cameraQuaternion.normalize();
    
    this.group.quaternion.copy(cameraQuaternion);
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

    // 清理所有子对象，确保不会有残留的几何体
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      // 清理几何体和材质
      if (child instanceof THREE.Mesh && child.geometry) {
        child.geometry.dispose();
      }
      if (child instanceof THREE.Line && child.geometry) {
        child.geometry.dispose();
      }
    }

    // 使用 LineLoop（简单，性能好）
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(smoothPoints);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff6600, linewidth: 2 }); // linewidth not supported everywhere, but ok
    const lineLoop = new THREE.LineLoop(lineGeometry, lineMaterial);
    this.group.add(lineLoop);
  }

  public dispose(): void {
    // 清理所有子对象
    while (this.group.children.length > 0) {
      const child = this.group.children[0];
      this.group.remove(child);
      if (child instanceof THREE.Mesh && child.geometry) {
        child.geometry.dispose();
      }
      if (child instanceof THREE.Line && child.geometry) {
        child.geometry.dispose();
      }
    }
    
    if (this.scene && this.group.parent) {
      this.scene.remove(this.group);
    }
    
    // 重置单例
    FlameContour3D.instance = null;
  }
}