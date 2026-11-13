// ============================================================
// src/fx/channels/PickupGlowChannel —— 拾取金色粒子（统一运行时通道）
// ============================================================
// 从 services/fx/PickupGlowEffect 收敛而来（行为/数值零变化），改动只有两点：
//   ① 生命周期归 FxRuntime（不再由调用方维护数组 + splice + dispose）；
//   ② **实例池化**：此前每次拾取 new 8 个 Sprite + 8 个 SpriteMaterial，
//      现在固定 MAX_BURSTS 组常驻复用（每组 1 材质 + 8 Sprite），拾取 100 次只建 6 个材质。
// 视觉口径（勿改）：8 粒子沿圆周均匀分布、speed 1.5~2.5、vy 1~3、0.6s、
//   scale 0.35 → 0.95、alpha 线性淡出、加法混合。
// ============================================================

import * as THREE from 'three';
import type { FxPickupGlowSpec } from '../core/types';
import type { FxChannel } from '../runtime/FxChannel';

const PARTICLES = 8;
const DURATION = 0.6;
/** 同时最多几组（超出 → 抢 age 最大的复用，不新建） */
const MAX_BURSTS = 6;

/** 共享金色粒子纹理（进程内唯一；不随通道销毁而释放） */
let _glowTex: THREE.CanvasTexture | null = null;
function glowTexture(): THREE.CanvasTexture {
  if (_glowTex) return _glowTex;
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
  // ★ 径向渐变是显示空间 sRGB 色：打标签走 解码→线性→ACES→编码 正确管线
  texture.colorSpace = THREE.SRGBColorSpace;
  _glowTex = texture;
  return texture;
}

interface Burst {
  id: number;
  active: boolean;
  age: number;
  /** 1 个材质管 8 个 Sprite（同一 burst 内 opacity 恒相同） */
  mat: THREE.SpriteMaterial;
  sprites: THREE.Sprite[];
  /** 起点（池化复用：位置 = origin + vel × age，无累积误差） */
  ox: number; oy: number; oz: number;
  /** 每粒子速度（3 分量 × 8） */
  vel: Float32Array;
}

export class PickupGlowChannel implements FxChannel {
  private readonly group = new THREE.Group();
  private readonly bursts: Burst[] = [];
  private nextId = 1;

  constructor(scene: THREE.Scene) {
    const tex = glowTexture();
    for (let b = 0; b < MAX_BURSTS; b++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 1,
      });
      const sprites: THREE.Sprite[] = [];
      for (let i = 0; i < PARTICLES; i++) {
        const sprite = new THREE.Sprite(mat);
        sprite.visible = false;
        this.group.add(sprite);
        sprites.push(sprite);
      }
      this.bursts.push({
        id: 0, active: false, age: 0,
        mat, sprites,
        ox: 0, oy: 0, oz: 0,
        vel: new Float32Array(PARTICLES * 3),
      });
    }
    scene.add(this.group);
  }

  /** 播一组粒子；返回实例 id（用于单发撤销） */
  spawn(spec: FxPickupGlowSpec): number {
    let burst = this.bursts.find((b) => !b.active);
    if (!burst) {
      // 全在播 → 抢最旧的（不新建、不掉帧）
      burst = this.bursts[0];
      for (const b of this.bursts) if (b.age > burst.age) burst = b;
    }

    const id = this.nextId++;
    burst.id = id;
    burst.active = true;
    burst.age = 0;
    burst.ox = spec.x;
    burst.oy = spec.y + 0.3;
    burst.oz = spec.z;
    burst.mat.opacity = 1;

    for (let i = 0; i < PARTICLES; i++) {
      const angle = (Math.PI * 2 * i) / PARTICLES;
      const speed = 1.5 + Math.random() * 1.0;
      burst.vel[i * 3] = Math.cos(angle) * speed;
      burst.vel[i * 3 + 1] = 1.0 + Math.random() * 2.0;
      burst.vel[i * 3 + 2] = Math.sin(angle) * speed;
      const s = burst.sprites[i];
      s.position.set(burst.ox, burst.oy, burst.oz);
      s.scale.set(0.35, 0.35, 1);
      s.visible = true;
    }
    return id;
  }

  /** 单发撤销（提前掐掉） */
  kill(id: number): void {
    const burst = this.bursts.find((b) => b.id === id && b.active);
    if (burst) this.retire(burst);
  }

  clear(): void {
    for (const b of this.bursts) if (b.active) this.retire(b);
  }

  update(dt: number): void {
    for (const b of this.bursts) {
      if (!b.active) continue;
      b.age += dt;
      const progress = b.age / DURATION;
      if (progress >= 1) {
        this.retire(b);
        continue;
      }
      const alpha = 1 - progress;
      const scale = 0.35 + progress * 0.6;
      b.mat.opacity = alpha;
      // ★ 解析解（匀速、无加速度）⇒ 与旧的逐帧累加逐值等价，且复位只需清 age
      for (let i = 0; i < PARTICLES; i++) {
        const s = b.sprites[i];
        s.position.set(
          b.ox + b.vel[i * 3] * b.age,
          b.oy + b.vel[i * 3 + 1] * b.age,
          b.oz + b.vel[i * 3 + 2] * b.age,
        );
        s.scale.set(scale, scale, 1);
      }
    }
  }

  dispose(): void {
    for (const b of this.bursts) {
      for (const s of b.sprites) this.group.remove(s);
      b.mat.dispose();  // ★ map 是共享纹理，不随通道释放
    }
    this.bursts.length = 0;
    this.group.removeFromParent();
  }

  private retire(b: Burst): void {
    b.active = false;
    b.age = 0;
    b.mat.opacity = 0;
    for (const s of b.sprites) s.visible = false;
  }
}
