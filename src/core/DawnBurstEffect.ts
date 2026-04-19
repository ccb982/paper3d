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
  maxAngleDeg: number = 45
): Spike[] {
  const spikes: Spike[] = [];
  const targetNorm = targetDir.clone().normalize();

  const directions: THREE.Vector3[] = [];

  for (let i = 0; i < count; i++) {
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

    directions.push(finalDir);
  }

  for (let i = 0; i < count; i++) {
    const dir = directions[i];
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

    const innerCount = 5 + Math.floor(Math.random() * 3);
    const outerCount = 6 + Math.floor(Math.random() * 3);

    this.innerSpikes = generateSpikes(
      innerCount-3, 1, 3, 0xb70002, 1.0, 0.333, 2.5,
      targetDir, 0, 30
    );
    this.outerSpikes = generateSpikes(
      outerCount+2, 2, 7, 0x610000, 0.0, 0.333, 3.0,
      targetDir, 5, 30
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
