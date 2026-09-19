// ============================================================
// ExplosionFx —— 程序化爆炸视觉（自爆 / 范围爆炸；无资产依赖）
// ============================================================
// 扩散环 + 中心闪光（加法混合，~0.45s 淡出）。
// 用法：WorldMode 建（scene）→ 每次 aoe 结算 spawn → 每帧 update → 退出 dispose。
// ============================================================

import * as THREE from 'three';

interface Burst {
  ring: THREE.Mesh;
  core: THREE.Mesh;
  age: number;
  life: number;
  radius: number;
}

export class ExplosionFx {
  private group = new THREE.Group();
  private bursts: Burst[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.72, 1, 48);
  private readonly coreGeo = new THREE.CircleGeometry(1, 24);

  constructor(scene: THREE.Scene) {
    this.group.renderOrder = 999;
    scene.add(this.group);
  }

  /** 生成一次爆炸（radius = 世界单位；y = 爆心高度） */
  spawn(x: number, y: number, z: number, radius: number): void {
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffb35c, transparent: true, opacity: 1, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, y + 0.25, z);
    const core = new THREE.Mesh(this.coreGeo, new THREE.MeshBasicMaterial({
      color: 0xfff0c2, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    core.rotation.x = -Math.PI / 2;
    core.position.copy(ring.position);
    this.group.add(ring);
    this.group.add(core);
    this.bursts.push({ ring, core, age: 0, life: 0.45, radius });
  }

  update(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        this.group.remove(b.ring);
        this.group.remove(b.core);
        (b.ring.material as THREE.Material).dispose();
        (b.core.material as THREE.Material).dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const rs = 0.3 + t * b.radius;
      b.ring.scale.set(rs, rs, rs);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      const cs = 0.7 + t * b.radius * 0.45;
      b.core.scale.set(cs, cs, cs);
      (b.core.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
    }
  }

  dispose(): void {
    for (const b of this.bursts) {
      this.group.remove(b.ring);
      this.group.remove(b.core);
      (b.ring.material as THREE.Material).dispose();
      (b.core.material as THREE.Material).dispose();
    }
    this.bursts.length = 0;
    this.group.removeFromParent();
    this.ringGeo.dispose();
    this.coreGeo.dispose();
  }
}
