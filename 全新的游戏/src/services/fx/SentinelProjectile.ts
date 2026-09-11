// ============================================================
// SentinelProjectile —— 祖宗弹（专属投影物）
// ============================================================
// 不走通用子弹管线（那是共享子弹纹理的 InstancedMesh）：
//   · 纹理 = 祖宗自己的帧（CanvasTexture，调用方注入）
//   · 朝向 = 纹理"尾部"(下) 始终对着飞行方向（屏幕空间旋转）
//   · 结束 = 寿命到 或 触地 → 返回落点 (x,z)，由模式层在此生成站桩祖宗
// ============================================================

import * as THREE from 'three';
import { RasterMap } from '../map/RasterMap';

/** 世界尺寸（贴片宽，米） */
const SHOT_SIZE = 1.3;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class SentinelProjectile {
  readonly sprite: THREE.Sprite;
  private readonly vel: THREE.Vector3;
  private life: number;

  constructor(
    scene: THREE.Scene,
    texture: THREE.Texture,
    x: number, y: number, z: number,
    dirX: number, dirY: number, dirZ: number,
    speed: number,
    lifetime: number,
  ) {
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(SHOT_SIZE, SHOT_SIZE, 1);
    this.sprite.position.set(x, y, z);
    scene.add(this.sprite);
    const len = Math.hypot(dirX, dirY, dirZ) || 1;
    this.vel = new THREE.Vector3(dirX / len, dirY / len, dirZ / len).multiplyScalar(speed);
    this.life = lifetime;
  }

  /** 每帧推进：返回 null=飞行中；返回 {x,z}=落点（寿命到/触地，需生成祖宗） */
  update(dt: number, camera: THREE.Camera): { x: number; z: number } | null {
    this.life -= dt;
    const p = this.sprite.position;
    p.x += this.vel.x * dt;
    p.y += this.vel.y * dt;
    p.z += this.vel.z * dt;

    // 尾部对着飞行方向（相机空间：把速度旋到相机系，再令纹理"下"对齐它）
    _q.copy(camera.quaternion).invert();
    _v.copy(this.vel).applyQuaternion(_q);
    this.sprite.material.rotation = Math.atan2(_v.x, -_v.y);

    const gy = RasterMap.current?.surfaceHeightAt(p.x, p.z) ?? 0;
    if (p.y <= gy + 0.15 || this.life <= 0) {
      return { x: p.x, z: p.z };
    }
    return null;
  }

  dispose(): void {
    this.sprite.removeFromParent();
    this.sprite.material.dispose();
  }
}
