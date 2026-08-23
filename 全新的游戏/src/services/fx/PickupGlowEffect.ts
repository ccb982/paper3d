// ============================================================
// PickupGlowEffect —— 拾取金色发光粒子特效
// ============================================================
// 在物品拾取位置生成 8 个金色粒子，向外飞散 + 上浮 + 淡出。
// 约 0.6 秒后自动清理，无需手动调用 dispose。
// ============================================================

import * as THREE from 'three';

export class PickupGlowEffect {
  private scene: THREE.Scene;
  private particles: {
    sprite: THREE.Sprite;
    vx: number;
    vy: number;
    vz: number;
  }[] = [];
  private elapsed = 0;
  private readonly duration = 0.6;
  private disposed = false;

  constructor(scene: THREE.Scene, x: number, y: number, z: number) {
    this.scene = scene;

    // 生成金色径向渐变纹理
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, 'rgba(255, 215, 0, 1)');
    gradient.addColorStop(0.3, 'rgba(255, 200, 50, 0.9)');
    gradient.addColorStop(0.7, 'rgba(255, 180, 0, 0.4)');
    gradient.addColorStop(1, 'rgba(255, 180, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    const texture = new THREE.CanvasTexture(canvas);
    // ★ 径向渐变是显示空间 sRGB 色：打标签走 解码→线性→ACES→编码 正确管线，
    //   否则被当线性直通 → ACES 后过亮（与 HitEffectView 同款修复，2026-08-23）
    texture.colorSpace = THREE.SRGBColorSpace;

    // 生成 8 个粒子，沿圆周均匀分布 + 随机上浮速度
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 1,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.position.set(x, y + 0.3, z);
      const angle = (Math.PI * 2 * i) / 8;
      const speed = 1.5 + Math.random() * 1.0;
      this.particles.push({
        sprite,
        vx: Math.cos(angle) * speed,
        vy: 1.0 + Math.random() * 2.0,
        vz: Math.sin(angle) * speed,
      });
      sprite.scale.set(0.35, 0.35, 1);
      scene.add(sprite);
    }
  }

  /** 每帧更新，返回 true 表示已播完可移除 */
  update(dt: number): boolean {
    if (this.disposed) return true;
    this.elapsed += dt;
    const progress = this.elapsed / this.duration;
    if (progress >= 1) {
      this.dispose();
      return true;
    }
    const alpha = 1 - progress;
    const scale = 0.35 + progress * 0.6;
    for (const p of this.particles) {
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.material.opacity = alpha;
      p.sprite.scale.setScalar(scale);
    }
    return false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.particles) {
      this.scene.remove(p.sprite);
      p.sprite.material.dispose();
      (p.sprite.material as THREE.SpriteMaterial).map?.dispose();
    }
    this.particles = [];
  }
}