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
  minSeparationDeg: number = 25
): Spike[] {
  if (count <= 0) return [];

  const spikes: Spike[] = [];
  const targetNorm = targetDir.clone().normalize();
  const acceptedDirs: THREE.Vector3[] = [];
  const maxAttempts = 200;
  let attempts = 0;

  while (acceptedDirs.length < count && attempts < maxAttempts) {
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
    const length = baseLength * (0.7 + Math.random() * 1.4);
    const geometry = new THREE.ConeGeometry(0.7, length, 8);
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

class RingEffect {
  public mesh: THREE.Mesh;
  public startDelay: number;
  public duration: number;
  public maxScale: number;
  public material: THREE.MeshBasicMaterial;

  constructor(mesh: THREE.Mesh, startDelay: number, duration: number, maxScale: number) {
    this.mesh = mesh;
    this.startDelay = startDelay;
    this.duration = duration;
    this.maxScale = maxScale;
    this.material = mesh.material as THREE.MeshBasicMaterial;
  }
}

export class DawnBurstEffect extends BaseEffect {
  private group: THREE.Group;
  private innerSpikes: Spike[] = [];
  private outerSpikes: Spike[] = [];
  private coreFlash: THREE.Mesh | null = null;
  private coreMaterial: THREE.MeshBasicMaterial | null = null;
  private rings: RingEffect[] = [];
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

    let innerCount = 5 + Math.floor(Math.random() * 3) - 3;
    innerCount = Math.max(2, innerCount);
    const outerCount = 10 + Math.floor(Math.random() * 3);

    this.innerSpikes = generateSpikes(
      innerCount, 2, 3, 0xb70002, 1.0, 0.333, 2.5,
      targetDir, 5, 45, 30
    );
    this.outerSpikes = generateSpikes(
      outerCount, 3, 5, 0x610000, 0.0, 0.333, 3.0,
      targetDir, 0, 30, 30
    );

    this.innerSpikes.forEach(s => this.group.add(s.mesh));
    this.outerSpikes.forEach(s => this.group.add(s.mesh));

    const coreGeo = new THREE.SphereGeometry(1, 16, 16);
    this.coreMaterial = new THREE.MeshBasicMaterial({ color: 0xffaa66, transparent: true, blending: THREE.AdditiveBlending });
    this.coreFlash = new THREE.Mesh(coreGeo, this.coreMaterial);
    this.coreFlash.position.set(0, 0, 0);
    this.group.add(this.coreFlash);

    const ringColors = [0xff4035, 0x7d4dff, 0xff0019];
    const ringDelays = [0.0, 0.2, 0.4];
    const ringDurations = [1.5, 1.5, 1.5];
    const ringMaxScales = [4.0, 5.0, 6.0];

    for (let i = 0; i < 3; i++) {
      const geometry = new THREE.RingGeometry(0, 1, 32);
      const material = new THREE.MeshBasicMaterial({
        color: ringColors[i],
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Mesh(geometry, material);
      ring.rotation.x = (Math.random() - 0.5) * Math.PI;
      ring.rotation.y = (Math.random() - 0.5) * Math.PI;
      ring.rotation.z = (Math.random() - 0.5) * Math.PI;
      ring.scale.set(0, 0, 1);
      this.group.add(ring);
      this.rings.push(new RingEffect(ring, ringDelays[i], ringDurations[i], ringMaxScales[i]));
    }
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

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      const t = this.elapsed - ring.startDelay;
      if (t < 0) continue;
      if (t > ring.duration) {
        ring.mesh.parent?.remove(ring.mesh);
        ring.mesh.geometry.dispose();
        ring.material.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      const progress = t / ring.duration;
      const scale = ring.maxScale * (1 - Math.pow(1 - progress, 2));
      ring.mesh.scale.set(scale, scale, 1);
      ring.material.opacity = 0.8 * (1 - progress);
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
    this.rings.forEach(ring => {
      ring.mesh.geometry.dispose();
      ring.material.dispose();
    });
  }
}
