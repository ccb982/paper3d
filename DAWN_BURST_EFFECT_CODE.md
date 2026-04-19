你想要的效果是：尖刺指向屏幕方向（大致朝向相机），并且仰角在 15° 到 45° 之间，形成一种“刺向屏幕”的冲击感。下面是修改后的代码，核心改动：

在 DawnBurstEffect 构造函数中，获取相机位置（通过 CameraStore），计算从爆炸中心指向相机的方向。

generateSpikes 函数增加 targetDir、minAngleDeg、maxAngleDeg 参数，为每个尖刺生成一个在锥形范围内的随机方向。

锥体的位置放置在爆炸中心 + 方向 * 根部偏移（半径），尖端指向该方向。

爆炸时，尖刺沿着自身方向向外移动，同时透明度降低、稍微缩小。

这样每个尖刺都会指向屏幕方向，且仰角可控，视觉上更集中、更有冲击力。

以下是完整代码（替换你的 DawnBurstEffect.ts）：

typescript
import { BaseEffect } from './BaseEffect';
import * as THREE from 'three';
import { cameraStore } from '../core/CameraStore'; // 假设你有 CameraStore

class Spike {
  public mesh: THREE.Mesh;
  public direction: THREE.Vector3;
  public startDelay: number;
  public speed: number;
  public distance: number;

  constructor(mesh: THREE.Mesh, direction: THREE.Vector3, startDelay: number, speed: number, distance: number) {
    this.mesh = mesh;
    this.direction = direction.clone().normalize();
    this.startDelay = startDelay;
    this.speed = speed;
    this.distance = distance;
  }
}

/**
 * 生成一组指向大致目标方向（相机）的锥体，仰角在给定范围内
 * @param count 尖刺数量
 * @param radius 根部偏移半径（从爆炸中心沿方向移动的距离）
 * @param baseLength 锥体基础长度
 * @param color 颜色
 * @param startDelay 开始延迟
 * @param speed 移动速度
 * @param distance 爆炸移动距离
 * @param targetDir 目标方向（从爆炸中心指向相机）
 * @param minAngleDeg 最小仰角（度）
 * @param maxAngleDeg 最大仰角（度）
 */
function generateSpikes(
  count: number,
  radius: number,
  baseLength: number,
  color: number,
  startDelay: number,
  speed: number,
  distance: number,
  targetDir: THREE.Vector3,
  minAngleDeg: number = 15,
  maxAngleDeg: number = 45
): Spike[] {
  const spikes: Spike[] = [];
  const targetNorm = targetDir.clone().normalize();

  // 预先计算每个尖刺的方向（在锥形范围内随机）
  const directions: THREE.Vector3[] = [];

  for (let i = 0; i < count; i++) {
    // 随机仰角（与 targetDir 的夹角）
    const angleDeg = minAngleDeg + Math.random() * (maxAngleDeg - minAngleDeg);
    const angleRad = angleDeg * Math.PI / 180;
    // 随机方位角（绕 targetDir 轴旋转）
    const azimuthRad = Math.random() * Math.PI * 2;

    // 构造一个与 targetDir 夹角为 angleRad 的随机单位向量
    // 方法：取一个与 targetDir 垂直的向量，然后旋转
    let up = new THREE.Vector3(0, 1, 0);
    // 如果 targetDir 接近垂直，则改用另一个轴
    if (Math.abs(targetNorm.dot(up)) > 0.9999) {
      up = new THREE.Vector3(1, 0, 0);
    }
    const axis = new THREE.Vector3().crossVectors(up, targetNorm).normalize();
    const quat = new THREE.Quaternion().setFromAxisAngle(axis, angleRad);
    const dir = targetNorm.clone().applyQuaternion(quat);
    // 再绕 targetNorm 旋转 azimuthRad 度
    const quatAz = new THREE.Quaternion().setFromAxisAngle(targetNorm, azimuthRad);
    const finalDir = dir.applyQuaternion(quatAz).normalize();

    directions.push(finalDir);
  }

  for (let i = 0; i < count; i++) {
    const dir = directions[i];
    const length = baseLength * (0.6 + Math.random() * 1.4);
    // 圆锥几何体，底部半径 0.3，顶部半径 0
    const geometry = new THREE.ConeGeometry(0.3, length, 8);
    const material = new THREE.MeshStandardMaterial({ 
      color, 
      emissive: color, 
      emissiveIntensity: 0.6, 
      transparent: true,
      side: THREE.DoubleSide
    });
    // 让锥体的 Y 轴（默认向上）指向 dir
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir
    );
    const mesh = new THREE.Mesh(geometry, material);
    // 根部位置：沿方向偏移 radius
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

  constructor(position: THREE.Vector3, duration: number = 2.5) {
    super(duration);
    this.group = new THREE.Group();
    this.group.position.copy(position);
    const scene = (window as any).gameScene;
    if (scene) scene.add(this.group);

    // 获取相机位置，计算指向相机的方向
    const camera = cameraStore.getCamera();
    let targetDir = new THREE.Vector3(0, 0, 1); // 默认前方
    if (camera) {
      targetDir = new THREE.Vector3().subVectors(camera.position, position).normalize();
    }
    // 稍微向上倾斜一点，使效果更自然（可选）
    targetDir.y += 0.2;
    targetDir.normalize();

    const innerCount = 5 + Math.floor(Math.random() * 3);
    const outerCount = 6 + Math.floor(Math.random() * 3);

    // 内层尖刺：仰角 15-35 度，较短，较快
    this.innerSpikes = generateSpikes(
      innerCount, 0.5, 1.8, 0xff6644, 0.0, 3.0, 1.5,
      targetDir, 15, 35
    );
    // 外层尖刺：仰角 25-45 度，较长，稍慢
    this.outerSpikes = generateSpikes(
      outerCount, 0.8, 2.5, 0xffaa55, 0.15, 2.5, 2.0,
      targetDir, 25, 45
    );

    this.innerSpikes.forEach(s => this.group.add(s.mesh));
    this.outerSpikes.forEach(s => this.group.add(s.mesh));

    // 核心闪光
    const coreGeo = new THREE.SphereGeometry(0.5, 16, 16);
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffaa66, transparent: true, blending: THREE.AdditiveBlending });
    this.coreFlash = new THREE.Mesh(coreGeo, this.coreMaterial);
    this.coreFlash.position.set(0, 0, 0);
    this.group.add(this.coreFlash);
  }

  protected onUpdate(delta: number): void {
    this.elapsed += delta;

    this.updateSpikes(this.innerSpikes, this.elapsed, delta);
    this.updateSpikes(this.outerSpikes, this.elapsed - 0.15, delta);

    if (this.coreFlash && this.coreMaterial) {
      const t = Math.min(1, this.elapsed / 0.3);
      const scale = 1 + t * 1.8;
      this.coreFlash.scale.set(scale, scale, scale);
      this.coreMaterial.opacity = 1 - t;
    }

    // 整体缓慢旋转，增强动态
    this.group.rotation.y += delta * 0.5;
    this.group.rotation.x += delta * 0.2;

    if (this.elapsed >= this.duration) {
      this.isActive = false;
    }
  }

  private updateSpikes(spikes: Spike[], currentTime: number, delta: number): void {
    if (currentTime < 0) return;
    for (const spike of spikes) {
      const t = Math.max(0, currentTime - spike.startDelay);
      if (t <= 0) continue;
      const moveProgress = Math.min(1, t * spike.speed);
      const easeOut = 1 - Math.pow(1 - moveProgress, 2);
      const offset = spike.direction.clone().multiplyScalar(easeOut * spike.distance);
      // 根部位置：原始位置 + 偏移（原始位置已在方向上偏移了 radius）
      spike.mesh.position.copy(spike.direction.clone().multiplyScalar(0.3).add(offset));
      const material = spike.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 1 - moveProgress;
      material.transparent = true;
      const scale = 1 - moveProgress * 0.2;
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
关键修改说明：

方向生成：在 generateSpikes 中，每个锥体的方向是在一个以 targetDir 为轴线的圆锥内随机生成，仰角范围由 minAngleDeg 和 maxAngleDeg 控制（默认内层 15-35°，外层 25-45°）。这样所有尖刺都会大致指向相机方向，但又略有分散，形成“刺向屏幕”的效果。

根部位置：锥体的初始位置在 direction * radius 处，即从爆炸中心沿方向伸出一定距离（内层半径 0.5，外层半径 0.8），让尖刺根部附着在爆炸中心附近。

爆炸移动：锥体沿自身方向向外移动 distance（内层 1.5，外层 2.0），同时透明度降低、稍微缩小，模拟能量爆发。

相机获取：通过 cameraStore.getCamera() 获取相机位置，计算方向。你需要确保 CameraStore 已经正确设置（之前项目中应该有）。

如果还没有 CameraStore，可以在 DawnBurstEffect 构造函数中传入相机参数，或者从 useThree 获取（但注意这是在 React 组件外）。最简单的办法是在创建特效时从外部传入相机位置。