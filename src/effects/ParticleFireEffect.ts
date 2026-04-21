import * as THREE from 'three';

class FireParticle {
  public position: THREE.Vector3;
  public velocity: THREE.Vector3;
  public color: THREE.Color;
  public size: number;
  public lifetime: number;
  public maxLifetime: number;
  public seed: number; // 随机种子，用于湍流相位

  constructor(position: THREE.Vector3, velocity: THREE.Vector3, color: THREE.Color, size: number, lifetime: number, seed: number) {
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.color = color.clone();
    this.size = size;
    this.lifetime = lifetime;
    this.maxLifetime = lifetime;
    this.seed = seed;
  }
}

export class ParticleFireEffect {
  public isActive: boolean = true;
  private group: THREE.Group;
  private particles: FireParticle[] = [];
  private points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.ShaderMaterial;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private maxParticles: number = 1000;
  private emitRate: number = 50;
  private emitAccumulator: number = 0;
  private elapsed: number = 0;
  private contour3D: FlameContour3D | null = null;
  private stencilMesh: THREE.Mesh | null = null;
  private duration: number;

  constructor(position: THREE.Vector3, duration: number = Infinity) {
    this.duration = duration;
    // console.log('ParticleFireEffect created at position:', position.x, position.y, position.z);
    this.group = new THREE.Group();
    this.group.position.copy(position);
    
    // 初始化几何体和材质
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(this.maxParticles * 3);
    this.colors = new Float32Array(this.maxParticles * 3);
    this.sizes = new Float32Array(this.maxParticles);
    
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    
    // 使用自定义着色器实现圆形粒子
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        pointSize: { value: 9.0 } // 基本粒子大小（减小）
      },
      vertexShader: `
        uniform float pointSize;
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = pointSize * size * (100.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        
        void main() {
          // 绘制圆形粒子
          float r = 0.5;
          vec2 cxy = 2.0 * gl_PointCoord - 1.0;
          float ll = dot(cxy, cxy);
          if (ll > 1.0) discard;
          
          // 径向渐变
          float alpha = 1.0 - ll;
          gl_FragColor = vec4(vColor, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      stencilWrite: false, // 粒子只测试模板，不写入
      stencilFunc: THREE.EqualStencilFunc, // 只在模板值为1的区域绘制
      stencilRef: 1,
      stencilFuncMask: 0xff
    });
    
    // 创建粒子系统
    this.points = new THREE.Points(this.geometry, this.material);
    this.group.add(this.points);
    
    const scene = (window as any).gameScene;
    if (scene) {
      scene.add(this.group);
      // 为每个火焰特效创建独立的 FlameContour3D 实例，并将轮廓添加到火焰特效的group中
      this.contour3D = new FlameContour3D(this.group);
    }
  }

  private emitParticle() {
    if (this.particles.length >= this.maxParticles) return;
    
    // 发射位置：增大半径，让火焰根部变宽
    const position = new THREE.Vector3(
      (Math.random() - 0.5) * 0.8,
      0,
      (Math.random() - 0.5) * 0.8
    );
    
    // 初始速度：从整个半球发射，而不是竖直向上
    // 生成半球范围内的随机方向
    const phi = Math.random() * Math.PI * 2; // 方位角 0-360度
    const theta = Math.random() * Math.PI / 2; // 极角 0-90度（上半球）
    const speed = 1.2 + Math.random() * 0.4; // 速度大小
    
    const velocity = new THREE.Vector3(
      Math.sin(theta) * Math.cos(phi) * speed,
      Math.cos(theta) * speed, // y方向始终向上
      Math.sin(theta) * Math.sin(phi) * speed
    );
    
    // 存储随机种子用于湍流相位
    const seed = Math.random();
    
    // 初始颜色：白热
    const color = new THREE.Color(1.0, 0.9, 0.6);
    
    // 粒子大小
    const size = 0.08;
    
    // 粒子寿命：1.0 ~ 1.8 秒
    const lifetime = 1.0 + Math.random() * 0.8;
    
    this.particles.push(new FireParticle(position, velocity, color, size, lifetime, seed));
  }

  public update(delta: number): void {
    if (!this.isActive) return;
    
    this.elapsed += delta;
    
    // 发射粒子（仍然需要粒子数据来计算轮廓和填充效果）
    this.emitAccumulator += delta * this.emitRate;
    while (this.emitAccumulator >= 1.0) {
      this.emitParticle();
      this.emitAccumulator -= 1.0;
    }
    
    // 更新粒子（仍然需要粒子数据来计算轮廓和填充效果）
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      const lifeFactor = particle.lifetime / particle.maxLifetime; // 1 → 0
      const height = particle.position.y;

      // 1. 上升浮力：随高度递减，模拟热空气上升后冷却
      let upwardForce = 1.2 * (1 - height / 3.0);
      if (upwardForce < 0.2) upwardForce = 0.2;
      particle.velocity.y += upwardForce * delta;

      // 2. 水平扩散：底部强，随高度衰减
      let spreadStrength = 1.2 * Math.max(0, 1 - height / 2.0);
      // 生命后期也略微增加扩散，模拟火焰消散
      spreadStrength += 0.3 * (1 - lifeFactor);

      // 随机方向
      const angle = Math.random() * Math.PI * 2;
      particle.velocity.x += Math.cos(angle) * spreadStrength * delta;
      particle.velocity.z += Math.sin(angle) * spreadStrength * delta;

      // 3. 湍流：让火焰摇曳（使用正弦波 + 随机相位）
      const time = performance.now() * 0.001;
      const phase = particle.seed * 100;
      const turbX = Math.sin(time * 3.0 + phase) * 1.2;
      const turbZ = Math.cos(time * 2.3 + phase) * 1.2;
      particle.velocity.x += turbX * delta;
      particle.velocity.z += turbZ * delta;

      // 3.5 顶部收缩力：让火焰顶部收窄
      const radius = Math.hypot(particle.position.x, particle.position.z);
      if (height > 1.0 && radius > 0.1) {
        const inwardStrength = 0.5 * (height - 1.0);
        particle.velocity.x -= (particle.position.x / radius) * inwardStrength * delta;
        particle.velocity.z -= (particle.position.z / radius) * inwardStrength * delta;
      }

      // 4. 阻力：使速度不会过快
      particle.velocity.multiplyScalar(0.99); // 增大阻力，使火焰更高更飘

      // 5. 位置更新
      particle.position.x += particle.velocity.x * delta;
      particle.position.y += particle.velocity.y * delta;
      particle.position.z += particle.velocity.z * delta;

      // 6. 寿命减少
      particle.lifetime -= delta;

      // 7. 颜色与大小随生命期变化（模拟火焰颜色变化：红白色 → 橙色 → 红色）
      if (lifeFactor > 0.7) {
        // 初始：红白色
        particle.color.setRGB(1.0, 0.8, 0.8);
        particle.size = 0.2; // 增大3D粒子大小
      } else if (lifeFactor > 0.3) {
        // 中期：橙色
        particle.color.setRGB(1.0, 0.6, 0.0);
        particle.size = 0.25; // 增大3D粒子大小
      } else {
        // 后期：红色
        particle.color.setRGB(0.8, 0.1, 0.0);
        particle.size = 0.15; // 增大3D粒子大小
      }

      // 移除死亡粒子
      if (particle.lifetime <= 0) {
        this.particles.splice(i, 1);
      }
    }
    
    // 更新粒子几何体
    this.updateGeometry();
    
    // 更新 3D 火焰轮廓效果
    if (this.contour3D) {
      // 使用粒子的局部坐标，因为轮廓现在是火焰特效group的子对象
      const particleData = this.particles.map(p => {
        return {
          position: p.position.clone(), // 使用局部坐标
          color: p.color
        };
      });
      
      // 获取相机并传递给轮廓
      const camera = (window as any).cameraStore?.getCamera();
      if (camera) {
        this.contour3D.setCamera(camera);
        // 每帧更新 billboard 效果，保持轮廓面向相机
        this.contour3D.updateBillboard();
      }
      
      // 强制更新轮廓位置，确保始终覆盖火焰
      this.contour3D.update(particleData);
      
      // 更新模板网格，传递粒子数据以支持视角变化时的重新计算
      this.updateStencilMesh(particleData);
    }
    
    // 检查是否达到持续时间
    if (this.duration !== Infinity && this.elapsed >= this.duration) {
      this.isActive = false;
    }
  }

  private updateGeometry() {
    // 清空数组
    this.positions.fill(0);
    this.colors.fill(0);
    this.sizes.fill(0);
    
    // 填充粒子数据
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      const index = i * 3;
      
      this.positions[index] = particle.position.x;
      this.positions[index + 1] = particle.position.y;
      this.positions[index + 2] = particle.position.z;
      
      this.colors[index] = particle.color.r;
      this.colors[index + 1] = particle.color.g;
      this.colors[index + 2] = particle.color.b;
      
      this.sizes[i] = particle.size;
    }
    
    // 标记需要更新
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.attributes.size.needsUpdate = true;
  }

  /**
   * 更新模板网格和填充网格
   * @param particles 粒子数据，用于在视角变化时重新计算填充网格
   */
  private updateStencilMesh(particles?: { position: THREE.Vector3; color: THREE.Color }[]): void {
    if (!this.contour3D) return;
    
    // 清理旧的模板网格
    if (this.stencilMesh && this.stencilMesh.parent === this.group) {
      this.group.remove(this.stencilMesh);
      if (this.stencilMesh.geometry) {
        this.stencilMesh.geometry.dispose();
      }
      if (this.stencilMesh.material) {
        this.stencilMesh.material.dispose();
      }
      this.stencilMesh = null;
    }
    
    // 获取新的模板网格
    const newStencilMesh = this.contour3D.getStencilMesh();
    if (newStencilMesh) {
      // 为模板网格设置材质属性，用于写入模板
      newStencilMesh.material = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        depthWrite: false,
        colorWrite: false, // 不写入颜色缓冲
        stencilWrite: true, // 写入模板缓冲
        stencilFunc: THREE.AlwaysStencilFunc, // 总是通过模板测试
        stencilRef: 1, // 写入值为1
        stencilFuncMask: 0xff
      });
      
      // 将模板网格添加到火焰特效的 group 中
      this.group.add(newStencilMesh);
      this.stencilMesh = newStencilMesh;
    }
    
    // 获取新的填充网格，传递粒子数据以支持视角变化时的重新计算
    const newFillMesh = this.contour3D.getFillMesh(particles);
    if (newFillMesh) {
      // 将填充网格添加到轮廓的 group 中，这样会继承 billboard 效果
      this.contour3D.addFillMesh(newFillMesh);
    }
  }

  public dispose(): void {
    const scene = (window as any).gameScene;
    if (scene && this.group.parent) scene.remove(this.group);
    
    // 清理模板网格
    if (this.stencilMesh) {
      if (this.stencilMesh.parent === this.group) {
        this.group.remove(this.stencilMesh);
      }
      if (this.stencilMesh.geometry) {
        this.stencilMesh.geometry.dispose();
      }
      if (this.stencilMesh.material) {
        this.stencilMesh.material.dispose();
      }
      this.stencilMesh = null;
    }
    
    // 清理 3D 火焰轮廓效果
    if (this.contour3D) {
      this.contour3D.dispose();
    }
    
    this.geometry.dispose();
    this.material.dispose();
  }
}

class FlameContour3D {
  private group: THREE.Group;
  private worldPoints: THREE.Vector3[] = [];
  private lastUpdateTime: number = 0;
  private updateInterval: number = 0.2; // 每0.2秒更新一次轮廓
  private camera: THREE.Camera | null = null;
  private parentGroup: THREE.Group;
  private currentLineLoop: THREE.LineLoop | null = null;

  // 侧面模板（归一化坐标，y 从底部到顶部，x 左右，以中心为0）
  private sideTemplateNorm: { x: number; y: number }[] = [
    { x: -0.43, y: 0.08 },
    { x: -0.49, y: 0.23 },
    { x: -0.50, y: 0.38 },
    { x: -0.48, y: 0.52 },
    { x: -0.46, y: 0.69 },
    { x: -0.40, y: 0.81 },
    { x: -0.33, y: 0.92 },
    { x: -0.21, y: 1.00 },
    { x: -0.05, y: 1.00 },
    { x: 0.11, y: 0.99 },
    { x: 0.21, y: 0.97 },
    { x: 0.33, y: 0.89 },
    { x: 0.39, y: 0.80 },
    { x: 0.45, y: 0.66 },
    { x: 0.44, y: 0.55 },
    { x: 0.38, y: 0.38 },
    { x: 0.32, y: 0.27 },
    { x: 0.26, y: 0.14 },
    { x: 0.21, y: 0.24 },
    { x: 0.17, y: 0.35 },
    { x: 0.16, y: 0.41 },
    { x: 0.06, y: 0.26 },
    { x: 0.07, y: 0.15 },
    { x: -0.01, y: 0.06 },
    { x: -0.06, y: 0.00 },
    { x: -0.12, y: 0.07 },
    { x: -0.18, y: 0.19 },
    { x: -0.21, y: 0.31 },
    { x: -0.24, y: 0.45 },
    { x: -0.27, y: 0.35 },
    { x: -0.29, y: 0.21 },
    { x: -0.35, y: 0.09 },
    { x: -0.38, y: 0.00 },
  ];

  constructor(parentGroup: THREE.Group) {
    this.parentGroup = parentGroup;
    this.group = new THREE.Group();
    parentGroup.add(this.group);
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
    // 移除更新间隔限制，确保每次调用都能更新
    // const now = performance.now() * 0.001;
    // if (now - this.lastUpdateTime < this.updateInterval) return;
    // this.lastUpdateTime = now;

    if (particles.length < 10) return;

    // 1. 减少颜色过滤的严格性，确保有足够的粒子用于生成轮廓
    const filtered = particles.filter(p => {
      const { r, g, b } = p.color;
      // 放宽条件，只要不是纯蓝色或绿色的粒子都可以用于生成轮廓
      return r > 0.3; // 只要红色通道大于0.3就保留
    });
    if (filtered.length < 10) return;

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
    const time = performance.now() * 0.001;
    
    this.worldPoints = template.map((p, index) => {
      let x, y, z;
      if (isTopView) {
        // 俯视：X 和 Z 由模板 x,y 决定，Y 取粒子云中部高度
        x = centerX + p.x * width / 2;
        z = centerZ + p.y * depth / 2;
        y = centerY;
      } else {
        // 侧面：X 和 Y 由模板决定，Z 取粒子云中间值
        let templateX = p.x;
        
        // 增加侧面的流动性，特别是顶部
        if (p.y > 0.7) { // 顶部30%区域
          // 顶部区域的动态效果
          const topFactor = (p.y - 0.7) / 0.3;
          templateX += 0.15 * Math.sin(time * 3 + index * 0.1) * topFactor;
          templateX += 0.1 * Math.cos(time * 2 + index * 0.15) * topFactor;
        } else if (p.y > 0.4) { // 中部区域
          const midFactor = (p.y - 0.4) / 0.3;
          templateX += 0.08 * Math.sin(time * 2 + index * 0.2) * midFactor;
        }
        
        x = minX + (templateX + 0.5) * width;
        // 修正 y 映射：模板 y=0 是底部，y=1 是顶部，所以需要反转
        y = maxY - p.y * height; // maxY 是顶部，minY 是底部
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
    const time = performance.now() * 0.001;
    
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      
      // 基础半径
      let r = 0.6;
      
      // 多波叠加增加流动性
      r += 0.2 * Math.sin(3 * angle + time * 2);
      r += 0.15 * Math.cos(5 * angle - time * 1.5);
      r += 0.1 * Math.sin(7 * angle + time * 3);
      
      // 顶部区域额外的动态效果
      const topAngle = Math.abs(((angle + Math.PI) % (Math.PI * 2)) - Math.PI);
      if (topAngle < Math.PI / 3) { // 顶部120度范围
        r += 0.3 * Math.sin(time * 4) * Math.cos(topAngle * 3);
      }
      
      // 确保半径不为负
      r = Math.max(0.3, r);
      
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

    // 清理group中所有旧的LineLoop对象
    const oldLineLoops = this.group.children.filter(child => child instanceof THREE.LineLoop);
    for (const lineLoop of oldLineLoops) {
      this.group.remove(lineLoop);
      if ((lineLoop as THREE.LineLoop).geometry) {
        (lineLoop as THREE.LineLoop).geometry.dispose();
      }
      if ((lineLoop as THREE.LineLoop).material) {
        (lineLoop as THREE.LineLoop).material.dispose();
      }
    }
    this.currentLineLoop = null;

    // 使用 LineLoop（简单，性能好）
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(smoothPoints);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff6600, linewidth: 2 }); // linewidth not supported everywhere, but ok
    const lineLoop = new THREE.LineLoop(lineGeometry, lineMaterial);
    this.group.add(lineLoop);
    this.currentLineLoop = lineLoop;
  }

  public dispose(): void {
    // 清理group中所有旧的LineLoop对象
    const oldLineLoops = this.group.children.filter(child => child instanceof THREE.LineLoop);
    for (const lineLoop of oldLineLoops) {
      this.group.remove(lineLoop);
      if ((lineLoop as THREE.LineLoop).geometry) {
        (lineLoop as THREE.LineLoop).geometry.dispose();
      }
      if ((lineLoop as THREE.LineLoop).material) {
        (lineLoop as THREE.LineLoop).material.dispose();
      }
    }
    
    // 清理填充网格
    const oldFillMeshes = this.group.children.filter(child => 
      child instanceof THREE.Mesh && !(child instanceof THREE.LineLoop)
    );
    for (const mesh of oldFillMeshes) {
      this.group.remove(mesh);
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        mesh.material.dispose();
      }
    }
    
    this.currentLineLoop = null;
    
    if (this.parentGroup && this.group.parent) {
      this.parentGroup.remove(this.group);
    }
  }

  /**
   * 获取用于模板缓冲的闭合网格
   * @returns THREE.Mesh | null
   */
  public getStencilMesh(): THREE.Mesh | null {
    if (this.worldPoints.length < 3) return null;
    
    // 将轮廓点投影到 XZ 平面（y=0）
    const points2D = this.worldPoints.map(p => new THREE.Vector2(p.x, p.z));
    
    // 构建 Shape
    const shape = new THREE.Shape();
    shape.moveTo(points2D[0].x, points2D[0].y);
    for (let i = 1; i < points2D.length; i++) {
      shape.lineTo(points2D[i].x, points2D[i].y);
    }
    shape.closePath();
    
    const geometry = new THREE.ShapeGeometry(shape);
    
    // 材质不重要，因为只用于写入模板
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    
    // 放置在火焰的中间高度
    const centerY = (this.worldPoints.reduce((sum, p) => sum + p.y, 0) / this.worldPoints.length);
    mesh.position.y = centerY;
    
    return mesh;
  }

  /**
   * 获取基于粒子颜色的填充平面
   * @param particles 粒子数据，用于计算填充颜色
   * @returns THREE.Mesh | null
   */
  public getFillMesh(particles?: { position: THREE.Vector3; color: THREE.Color }[]): THREE.Mesh | null {
    let worldPointsToUse = this.worldPoints;
    
    // 如果提供了粒子数据，重新计算 worldPoints（用于视角变化时）
    if (particles && particles.length >= 10) {
      // 过滤粒子
      const filtered = particles.filter(p => {
        const { r, g, b } = p.color;
        return r > 0.3;
      });
      
      if (filtered.length >= 10) {
        // 计算包围盒
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
        
        if (width >= 0.1 && height >= 0.1) {
          // 根据摄像机角度判断视角
          let isTopView = false;
          if (this.camera) {
            const cameraDirection = new THREE.Vector3();
            this.camera.getWorldDirection(cameraDirection);
            isTopView = cameraDirection.y < -0.7;
          } else {
            isTopView = depth > width * 1.5;
          }
          
          const template = isTopView ? this.getTopTemplate() : this.sideTemplateNorm;
          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;
          const centerZ = (minZ + maxZ) / 2;
          const time = performance.now() * 0.001;
          
          // 重新计算 worldPoints
          worldPointsToUse = template.map((p, index) => {
            let x, y, z;
            if (isTopView) {
              x = centerX + p.x * width / 2;
              z = centerZ + p.y * depth / 2;
              y = centerY;
            } else {
              let templateX = p.x;
              if (p.y > 0.7) {
                const topFactor = (p.y - 0.7) / 0.3;
                templateX += 0.15 * Math.sin(time * 3 + index * 0.1) * topFactor;
                templateX += 0.1 * Math.cos(time * 2 + index * 0.15) * topFactor;
              } else if (p.y > 0.4) {
                const midFactor = (p.y - 0.4) / 0.3;
                templateX += 0.08 * Math.sin(time * 2 + index * 0.2) * midFactor;
              }
              x = minX + (templateX + 0.5) * width;
              y = maxY - p.y * height;
              z = centerZ;
            }
            return new THREE.Vector3(x, y, z);
          });
        }
      }
    }
    
    if (worldPointsToUse.length < 3) return null;
    
    // 检查是否是侧面视图（所有点的 z 坐标相同）
    const zValues = worldPointsToUse.map(p => p.z);
    const isSideView = zValues.every(z => Math.abs(z - zValues[0]) < 0.01);
    
    let points2D: THREE.Vector2[];
    if (isSideView) {
      // 侧面视图：使用 x 和 y 坐标
      points2D = worldPointsToUse.map(p => new THREE.Vector2(p.x, p.y));
    } else {
      // 俯视图：使用 x 和 z 坐标
      points2D = worldPointsToUse.map(p => new THREE.Vector2(p.x, p.z));
    }
    
    // 构建 Shape
    const shape = new THREE.Shape();
    shape.moveTo(points2D[0].x, points2D[0].y);
    for (let i = 1; i < points2D.length; i++) {
      shape.lineTo(points2D[i].x, points2D[i].y);
    }
    shape.closePath();
    
    const geometry = new THREE.ShapeGeometry(shape);
    
    // 计算基于粒子的分区颜色（只在y轴分层）
    let topColor1 = new THREE.Color(0xffffff);
    let topColor2 = new THREE.Color(0xffffcc);
    let upperColor1 = new THREE.Color(0xffff99);
    let upperColor2 = new THREE.Color(0xffff66);
    let middleColor1 = new THREE.Color(0xffff00);
    let middleColor2 = new THREE.Color(0xffdd00);
    let lowerColor1 = new THREE.Color(0xffcc00);
    let lowerColor2 = new THREE.Color(0xffaa00);
    let bottomColor1 = new THREE.Color(0xff8800);
    let bottomColor2 = new THREE.Color(0xff6600);
    
    if (particles && particles.length > 0) {
      // 计算包围盒的高度范围
      let minY = Infinity, maxY = -Infinity;
      for (const p of particles) {
        if (p.position.y < minY) minY = p.position.y;
        if (p.position.y > maxY) maxY = p.position.y;
      }
      const heightRange = maxY - minY;
      
      // 分区粒子（只在y轴方向）
      const topParticles1 = [];
      const topParticles2 = [];
      const upperParticles1 = [];
      const upperParticles2 = [];
      const middleParticles1 = [];
      const middleParticles2 = [];
      const lowerParticles1 = [];
      const lowerParticles2 = [];
      const bottomParticles1 = [];
      const bottomParticles2 = [];
      
      for (const particle of particles) {
        const normalizedY = (particle.position.y - minY) / heightRange;
        
        if (normalizedY > 0.9) {
          topParticles1.push(particle);
        } else if (normalizedY > 0.8) {
          topParticles2.push(particle);
        } else if (normalizedY > 0.65) {
          upperParticles1.push(particle);
        } else if (normalizedY > 0.5) {
          upperParticles2.push(particle);
        } else if (normalizedY > 0.35) {
          middleParticles1.push(particle);
        } else if (normalizedY > 0.2) {
          middleParticles2.push(particle);
        } else if (normalizedY > 0.1) {
          lowerParticles1.push(particle);
        } else if (normalizedY > 0.05) {
          lowerParticles2.push(particle);
        } else if (normalizedY > 0.02) {
          bottomParticles1.push(particle);
        } else {
          bottomParticles2.push(particle);
        }
      }
      
      // 计算各分区颜色
      const calculateColor = (particles: any[], brightness: number) => {
        if (particles.length > 0) {
          let r = 0, g = 0, b = 0;
          for (const p of particles) {
            r += p.color.r;
            g += p.color.g;
            b += p.color.b;
          }
          const count = particles.length;
          r = (r / count) * brightness;
          g = (g / count) * brightness;
          b = (b / count) * brightness;
          return new THREE.Color(Math.min(1, r), Math.min(1, g), Math.min(1, b));
        }
        return null;
      };
      
      // 只在y轴方向改变亮度（顶部亮，底部暗）- 降低整体亮度
      const baseBrightness = 1.2; // 降低基础亮度系数
      const topColor1Col = calculateColor(topParticles1, baseBrightness * 1.3); // 顶部最亮
      if (topColor1Col) topColor1 = topColor1Col;
      const topColor2Col = calculateColor(topParticles2, baseBrightness * 1.25);
      if (topColor2Col) topColor2 = topColor2Col;
      const upperColor1Col = calculateColor(upperParticles1, baseBrightness * 1.2);
      if (upperColor1Col) upperColor1 = upperColor1Col;
      const upperColor2Col = calculateColor(upperParticles2, baseBrightness * 1.15);
      if (upperColor2Col) upperColor2 = upperColor2Col;
      const middleColor1Col = calculateColor(middleParticles1, baseBrightness * 1.1);
      if (middleColor1Col) middleColor1 = middleColor1Col;
      const middleColor2Col = calculateColor(middleParticles2, baseBrightness * 1.05);
      if (middleColor2Col) middleColor2 = middleColor2Col;
      const lowerColor1Col = calculateColor(lowerParticles1, baseBrightness * 1.0);
      if (lowerColor1Col) lowerColor1 = lowerColor1Col;
      const lowerColor2Col = calculateColor(lowerParticles2, baseBrightness * 0.95);
      if (lowerColor2Col) lowerColor2 = lowerColor2Col;
      const bottomColor1Col = calculateColor(bottomParticles1, baseBrightness * 0.9);
      if (bottomColor1Col) bottomColor1 = bottomColor1Col;
      const bottomColor2Col = calculateColor(bottomParticles2, baseBrightness * 0.85); // 底部最暗
      if (bottomColor2Col) bottomColor2 = bottomColor2Col;
    }
    
    // 创建分区渐变材质
    const material = new THREE.ShaderMaterial({
      uniforms: {
        topColor1: { value: topColor1 },
        topColor2: { value: topColor2 },
        upperColor1: { value: upperColor1 },
        upperColor2: { value: upperColor2 },
        middleColor1: { value: middleColor1 },
        middleColor2: { value: middleColor2 },
        lowerColor1: { value: lowerColor1 },
        lowerColor2: { value: lowerColor2 },
        bottomColor1: { value: bottomColor1 },
        bottomColor2: { value: bottomColor2 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor1;
        uniform vec3 topColor2;
        uniform vec3 upperColor1;
        uniform vec3 upperColor2;
        uniform vec3 middleColor1;
        uniform vec3 middleColor2;
        uniform vec3 lowerColor1;
        uniform vec3 lowerColor2;
        uniform vec3 bottomColor1;
        uniform vec3 bottomColor2;
        varying vec2 vUv;
        
        void main() {
          // 根据 Y 坐标（UV 的 y 分量）进行颜色插值
          float y = vUv.y;
          vec3 finalColor;
          
          if (y > 0.9) {
            // 顶部区域1：最亮
            float t = (y - 0.9) / 0.1;
            finalColor = mix(topColor2, topColor1, t);
          } else if (y > 0.8) {
            // 顶部区域2
            float t = (y - 0.8) / 0.1;
            finalColor = mix(upperColor1, topColor2, t);
          } else if (y > 0.65) {
            // 上部区域1
            float t = (y - 0.65) / 0.15;
            finalColor = mix(upperColor2, upperColor1, t);
          } else if (y > 0.5) {
            // 上部区域2
            float t = (y - 0.5) / 0.15;
            finalColor = mix(middleColor1, upperColor2, t);
          } else if (y > 0.35) {
            // 中部区域1
            float t = (y - 0.35) / 0.15;
            finalColor = mix(middleColor2, middleColor1, t);
          } else if (y > 0.2) {
            // 中部区域2
            float t = (y - 0.2) / 0.15;
            finalColor = mix(lowerColor1, middleColor2, t);
          } else if (y > 0.1) {
            // 下部区域1
            float t = (y - 0.1) / 0.1;
            finalColor = mix(lowerColor2, lowerColor1, t);
          } else if (y > 0.05) {
            // 下部区域2
            float t = (y - 0.05) / 0.05;
            finalColor = mix(bottomColor1, lowerColor2, t);
          } else if (y > 0.02) {
            // 底部区域1
            float t = (y - 0.02) / 0.03;
            finalColor = mix(bottomColor2, bottomColor1, t);
          } else {
            // 底部区域2：最暗
            finalColor = bottomColor2;
          }
          
          gl_FragColor = vec4(finalColor, 0.6);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    
    // 设置位置
    const centerY = (worldPointsToUse.reduce((sum, p) => sum + p.y, 0) / worldPointsToUse.length);
    const centerZ = (worldPointsToUse.reduce((sum, p) => sum + p.z, 0) / worldPointsToUse.length);
    
    if (isSideView) {
      // 侧面视图：设置 z 坐标
      mesh.position.z = centerZ;
    } else {
      // 俯视图：设置 y 坐标并旋转为水平
      mesh.position.y = centerY;
      // 旋转 90 度，使平面平行于 XZ 平面
      mesh.rotation.x = Math.PI / 2;
    }
    
    return mesh;
  }

  /**
   * 添加填充网格到轮廓的 group 中
   * @param fillMesh 填充网格
   */
  public addFillMesh(fillMesh: THREE.Mesh): void {
    // 清理旧的填充网格
    const oldFillMeshes = this.group.children.filter(child => 
      child instanceof THREE.Mesh && !(child instanceof THREE.LineLoop)
    );
    for (const mesh of oldFillMeshes) {
      this.group.remove(mesh);
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        mesh.material.dispose();
      }
    }
    
    // 添加新的填充网格
    this.group.add(fillMesh);
  }
}
