我们明白了：需要的是“巨大尖刺、根根分明”，只需要两层（内层和外层）。之前的问题在于尖刺被随机方向移动淹没，而且几何体本身尖刺不够突出。

重新设计：使用圆锥几何体组合来构建尖刺，而不是通过球体顶点偏移。每个尖刺是一个独立的 Mesh（圆锥），可以独立控制位置、缩放、颜色和动画。这样就能保证“根根分明”。

方案：手动构建花苞状爆炸体
内层：较短的尖刺，颜色橙红，先爆炸。

外层：较长的尖刺，颜色金黄，稍后爆炸。

爆炸动画：每个尖刺沿着自身的轴向（从中心向外）移动，同时可能旋转。使用简单的 Tween 动画或手动更新位置。

中心添加闪光球体。

优点
尖刺根根分明，形状完全可控。

可以精确控制每个尖刺的爆炸时间、方向、速度，形成层次感。

性能好（几十个圆锥体）。

实现步骤
创建圆锥几何体 ConeGeometry。

为每个尖刺创建一个 Mesh，位置在球面上，朝向径向。

在动画中，让尖刺向外移动（沿径向），并逐渐缩小或淡出。

分层：内层先移动，外层延迟。

下面是完整代码，你可以直接替换 DawnBurstEffect.ts。

typescript
import { BaseEffect } from './BaseEffect';
import * as THREE from 'three';

/**
 * 尖刺（圆锥体）
 */
class Spike {
  public mesh: THREE.Mesh;
  public direction: THREE.Vector3;   // 径向方向（单位向量）
  public startDelay: number;
  public speed: number;
  public distance: number;           // 移动总距离

  constructor(mesh: THREE.Mesh, direction: THREE.Vector3, startDelay: number, speed: number, distance: number) {
    this.mesh = mesh;
    this.direction = direction.clone().normalize();
    this.startDelay = startDelay;
    this.speed = speed;
    this.distance = distance;
  }
}

/**
 * 生成一组尖刺，均匀分布在球面上
 * @param count 尖刺数量
 * @param radius 基础半径（尖刺底部位置）
 * @param length 尖刺长度
 * @param color 颜色
 * @param startDelay 爆炸延迟（秒）
 * @param speed 移动速度（单位/秒）
 * @param distance 移动距离
 * @returns 尖刺数组
 */
function generateSpikes(
  count: number,
  radius: number,
  length: number,
  color: number,
  startDelay: number,
  speed: number,
  distance: number
): Spike[] {
  const spikes: Spike[] = [];
  const geometry = new THREE.ConeGeometry(0.12, length, 8);
  const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 });

  // 使用 Fibonacci 球体算法生成均匀分布的方向
  const directions: THREE.Vector3[] = [];
  const phiGoldenRatio = Math.PI * (3 - Math.sqrt(5));  // 黄金角
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;  // y 从 1 到 -1
    const radiusAtY = Math.sqrt(1 - y*y);
    const theta = i * phiGoldenRatio * 2;
    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;
    directions.push(new THREE.Vector3(x, y, z).normalize());
  }

  for (let i = 0; i < count; i++) {
    const dir = directions[i];
    // 圆锥默认指向 +Y，需要旋转到目标方向
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir
    );
    const mesh = new THREE.Mesh(geometry, material.clone());
    // 位置：底部在球面上，所以沿方向移动 radius
    mesh.position.copy(dir.clone().multiplyScalar(radius));
    mesh.quaternion.copy(quaternion);
    spikes.push(new Spike(mesh, dir, startDelay, speed, distance));
  }
  return spikes;
}

export class DawnBurstEffect extends BaseEffect {
  private group: THREE.Group;
  private innerSpikes: Spike[] = [];
  private outerSpikes: Spike[] = [];
  private coreFlash: THREE.Mesh | null = null;
  private coreMaterial: THREE.MeshBasicMaterial | null = null;
  private elapsed: number = 0;

  constructor(position: THREE.Vector3, duration: number = 1.5) {
    super(duration);
    this.group = new THREE.Group();
    this.group.position.copy(position);
    const scene = (window as any).gameScene;
    if (scene) scene.add(this.group);

    // 1. 内层尖刺（较短，橙红，先爆）
    this.innerSpikes = generateSpikes(24, 0.25, 0.6, 0xff6644, 0.0, 4.0, 1.2);
    // 2. 外层尖刺（较长，金黄，延迟0.1秒爆）
    this.outerSpikes = generateSpikes(36, 0.35, 0.9, 0xffaa55, 0.1, 3.5, 1.5);

    // 添加到组
    this.innerSpikes.forEach(s => this.group.add(s.mesh));
    this.outerSpikes.forEach(s => this.group.add(s.mesh));

    // 3. 核心闪光球体
    const coreGeo = new THREE.SphereGeometry(0.3, 16, 16);
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffaa66, transparent: true, blending: THREE.AdditiveBlending });
    this.coreFlash = new THREE.Mesh(coreGeo, this.coreMaterial);
    this.coreFlash.position.set(0, 0, 0);
    this.group.add(this.coreFlash);
  }

  protected onUpdate(delta: number): void {
    this.elapsed += delta;

    // 更新内层尖刺（无延迟）
    this.updateSpikes(this.innerSpikes, this.elapsed, delta);
    // 更新外层尖刺（延迟0.1秒）
    this.updateSpikes(this.outerSpikes, this.elapsed - 0.1, delta);

    // 核心闪光：缩放并淡出
    if (this.coreFlash && this.coreMaterial) {
      const t = Math.min(1, this.elapsed / 0.3);
      const scale = 1 + t * 2;
      this.coreFlash.scale.set(scale, scale, scale);
      this.coreMaterial.opacity = 1 - t;
    }

    // 整体轻微旋转
    this.group.rotation.y += delta * 2;
    this.group.rotation.x += delta * 0.5;

    // 如果所有尖刺都已消失（移动距离达到，且不活跃），可以提前结束
    if (this.elapsed >= this.duration) {
      this.isActive = false;
    }
  }

  private updateSpikes(spikes: Spike[], currentTime: number, delta: number): void {
    if (currentTime < 0) return;
    for (const spike of spikes) {
      const t = Math.max(0, currentTime - spike.startDelay);
      if (t <= 0) continue;
      // 移动进度：先快后慢
      const moveProgress = Math.min(1, t * spike.speed);
      const easeOut = 1 - Math.pow(1 - moveProgress, 2);
      const offset = spike.direction.clone().multiplyScalar(easeOut * spike.distance);
      spike.mesh.position.copy(spike.direction.clone().multiplyScalar(0.25).add(offset)); // 起始位置在半径0.25处
      // 淡出
      const material = spike.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 1 - moveProgress;
      material.transparent = true;
      // 缩放变小
      const scale = 1 - moveProgress * 0.5;
      spike.mesh.scale.set(scale, scale, scale);
    }
  }

  public dispose(): void {
    const scene = (window as any).gameScene;
    if (scene && this.group.parent) scene.remove(this.group);
    this.innerSpikes.forEach(s => {
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    });
    this.outerSpikes.forEach(s => {
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    });
    if (this.coreFlash) {
      this.coreFlash.geometry.dispose();
      this.coreMaterial?.dispose();
    }
  }
}
说明
尖刺生成：使用 Fibonacci 球体算法生成均匀分布的方向，确保尖刺均匀覆盖球面。

尖刺几何体：使用 ConeGeometry，长度可调。每个尖刺独立，可单独控制位置、旋转、缩放、透明度。

爆炸动画：每个尖刺沿径向向外移动，移动距离 distance，速度 speed，移动曲线先快后慢（easeOut）。同时逐渐透明并缩小。

分层：内层尖刺无延迟，外层延迟 0.1 秒开始移动，形成层次感。

核心闪光：球体快速放大并淡出。

整体旋转：让特效更有动态。

参数调整建议
innerSpikes 数量、长度、颜色、速度、移动距离。

outerSpikes 类似。

调整 coreFlash 的大小和淡出时间。

可以添加中心光晕平面（GlowPlane）增强效果。

这个方案能确保尖刺根根分明，视觉效果华丽，且性能优秀（几十个独立 Mesh）。你可以根据需要微调参数