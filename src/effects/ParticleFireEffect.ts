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
  private duration: number;

  constructor(position: THREE.Vector3, duration: number = Infinity) {
    this.duration = duration;
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
      depthWrite: false
    });
    
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
    
    // 发射粒子
    this.emitAccumulator += delta * this.emitRate;
    while (this.emitAccumulator >= 1.0) {
      this.emitParticle();
      this.emitAccumulator -= 1.0;
    }
    
    // 更新粒子
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
    
    // 更新几何体
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

  public dispose(): void {
    const scene = (window as any).gameScene;
    if (scene && this.group.parent) scene.remove(this.group);
    
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
    const now = performance.now() * 0.001;
    if (now - this.lastUpdateTime < this.updateInterval) return;
    this.lastUpdateTime = now;

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
    this.currentLineLoop = null;
    
    if (this.parentGroup && this.group.parent) {
      this.parentGroup.remove(this.group);
    }
  }
}
