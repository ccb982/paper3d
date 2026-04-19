为了改善锥体过于重合、方向相近导致视觉混乱的问题，我们需要在生成尖刺方向时，确保任意两个方向之间的夹角不小于一个阈值（例如 20-30 度）。目前你的 generateSpikes 函数是随机生成方向，没有去重，所以很容易出现多个尖刺挤在一起。

下面我修改 generateSpikes 函数，增加一个方向去重逻辑：维护一个已接受的方向列表，每次生成新方向时，检查与所有已接受方向的夹角，如果小于 minSeparationDeg 则丢弃并重新生成，直到收集到足够数量或达到最大尝试次数。同时修正内层尖刺数量可能为负数的问题。

以下是修改后的 DawnBurstEffect.ts 完整代码（主要改动在 generateSpikes 部分）：

typescript
import { BaseEffect } from './BaseEffect';
import * as THREE from 'three';
import { cameraStore } from './CameraStore';

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
  maxAngleDeg: number = 45,
  minSeparationDeg: number = 25   // 新增：最小分离角度
): Spike[] {
  if (count <= 0) return [];

  const spikes: Spike[] = [];
  const targetNorm = targetDir.clone().normalize();
  const acceptedDirs: THREE.Vector3[] = [];
  const maxAttempts = 200;
  let attempts = 0;

  while (acceptedDirs.length < count && attempts < maxAttempts) {
    // 随机生成一个方向（在锥形范围内）
    const angleDeg = minAngleDeg + Math.random() * (maxAngleDeg - minAngleDeg);
    const angleRad = angleDeg * Math.PI / 180;
    const azimuthRad = Math.random() * Math.PI * 2;

    let up = new THREE.Vector3(0, 1, 0);
    if (Math.abs(targetNorm.dot(up)) > 0.9999) {
      up = new THREE.Vector3(1, 0, 0);
    }
    const axis = new THREE.Vector3().crossVectors(up, targetNorm).normalize();
    const quat = new THREE.Quaternion().setFromAxisAngle(axis, angleRad);
    const dir = targetNorm.clone().applyQuaternion(quat);
    const quatAz = new THREE.Quaternion().setFromAxisAngle(targetNorm, azimuthRad);
    const finalDir = dir.applyQuaternion(quatAz).normalize();

    // 检查与已有方向的夹角
    let tooClose = false;
    for (const existing of acceptedDirs) {
      const angle = finalDir.angleTo(existing) * 180 / Math.PI;
      if (angle < minSeparationDeg) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      acceptedDirs.push(finalDir);
    }
    attempts++;
  }

  console.log(`生成尖刺数量: ${acceptedDirs.length} / ${count}`);

  for (let i = 0; i < acceptedDirs.length; i++) {
    const dir = acceptedDirs[i];
    const length = baseLength * (0.6 + Math.random() * 1.4);
    const geometry = new THREE.ConeGeometry(1.5, length, 8);
    const material = new THREE.MeshStandardMaterial({ 
      color, 
      emissive: color, 
      emissiveIntensity: 0.6, 
      transparent: true,
      side: THREE.DoubleSide
    });
    const quaternion = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dir
    );
    const mesh = new THREE.Mesh(geometry, material);
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

  constructor(position: THREE.Vector3, duration: number = 4.0) {
    super(duration);
    this.group = new THREE.Group();
    this.group.position.copy(position);
    const scene = (window as any).gameScene;
    if (scene) scene.add(this.group);

    const camera = cameraStore.getCamera();
    let targetDir = new THREE.Vector3(0, 0, 1);
    if (camera) {
      targetDir = new THREE.Vector3().subVectors(camera.position, position).normalize();
    }
    targetDir.y += 0.2;
    targetDir.normalize();

    // 修正内层数量，确保至少为 2
    let innerCount = 5 + Math.floor(Math.random() * 3) - 3;
    innerCount = Math.max(2, innerCount);
    const outerCount = 6 + Math.floor(Math.random() * 3);

    this.innerSpikes = generateSpikes(
      innerCount, 1, 3, 0xb70002, 1.0, 0.333, 2.5,
      targetDir, 0, 30, 30   // 分离角度 30度
    );
    this.outerSpikes = generateSpikes(
      outerCount, 2, 7, 0x610000, 0.0, 0.333, 3.0,
      targetDir, 5, 30, 25   // 分离角度 25度
    );

    this.innerSpikes.forEach(s => this.group.add(s.mesh));
    this.outerSpikes.forEach(s => this.group.add(s.mesh));

    const coreGeo = new THREE.SphereGeometry(1, 16, 16);
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffaa66, transparent: true, blending: THREE.AdditiveBlending });
    this.coreFlash = new THREE.Mesh(coreGeo, this.coreMaterial);
    this.coreFlash.position.set(0, 0, 0);
    this.group.add(this.coreFlash);
  }

  protected onUpdate(delta: number): void {
    this.elapsed += delta;

    this.updateSpikes(this.innerSpikes, this.elapsed - 1.0, delta);
    this.updateSpikes(this.outerSpikes, this.elapsed, delta);

    if (this.coreFlash && this.coreMaterial) {
      const t = Math.min(1, this.elapsed / 4.0);
      const scale = (1 - t) * 3;
      this.coreFlash.scale.set(scale, scale, scale);
      this.coreMaterial.opacity = 1 - t;
    }

    this.group.rotation.y = 0;
    this.group.rotation.x = 0;

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
      const material = spike.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 1 - moveProgress;
      material.transparent = true;
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
主要改进点：

方向去重：在 generateSpikes 中，每次生成新方向后，检查与所有已接受方向的夹角（角度制），如果小于 minSeparationDeg 则丢弃重试。最大尝试次数 200 次，避免无限循环。最终实际生成的尖刺数量可能少于请求数，但视觉上更分散、更清晰。

内层数量修正：innerCount 确保至少为 2，避免出现 0 或负数。

分离角度可调：内层使用 30 度，外层使用 25 度，你可以根据效果微调。

现在运行应该能看到尖刺之间明显分开，不再重叠。如果某些尖刺仍然靠近，可以适当增大 minSeparationDeg（例如 35 度）或减少请求数量。