import { BaseEffect } from './BaseEffect';
import * as THREE from 'three';

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
  distance: number
): Spike[] {
  const spikes: Spike[] = [];

  const directions: THREE.Vector3[] = [];
  const phiGoldenRatio = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radiusAtY = Math.sqrt(1 - y*y);
    const theta = i * phiGoldenRatio * 2;
    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;
    directions.push(new THREE.Vector3(x, y, z).normalize());
  }

  for (let i = 0; i < count; i++) {
    const dir = directions[i];
    const length = baseLength * (0.6 + Math.random() * 1.4);
    const geometry = new THREE.ConeGeometry(1, length, 8);
    const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, transparent: true });
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

  constructor(position: THREE.Vector3, duration: number = 3.0) {
    super(duration);
    this.group = new THREE.Group();
    this.group.position.copy(position);
    const scene = (window as any).gameScene;
    if (scene) scene.add(this.group);

    const innerCount = 5 + Math.floor(Math.random() * 3);
    const outerCount = 6 + Math.floor(Math.random() * 3);
    this.innerSpikes = generateSpikes(innerCount, 3, 2.5, 0xff6644, 0.0, 2.5, 2.0);
    this.outerSpikes = generateSpikes(outerCount, 7, 3.5, 0xffaa55, 0.15, 2.0, 2.5);

    this.innerSpikes.forEach(s => this.group.add(s.mesh));
    this.outerSpikes.forEach(s => this.group.add(s.mesh));

    const coreGeo = new THREE.SphereGeometry(0.4, 16, 16);
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
      const scale = 1 + t * 1.5;
      this.coreFlash.scale.set(scale, scale, scale);
      this.coreMaterial.opacity = 1 - t;
    }

    this.group.rotation.y += delta * 0.8;

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
      spike.mesh.position.copy(spike.direction.clone().multiplyScalar(0.3).add(offset));
      const material = spike.mesh.material as THREE.MeshStandardMaterial;
      material.opacity = 1 - moveProgress;
      material.transparent = true;
      const scale = 1 - moveProgress * 0.3;
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
