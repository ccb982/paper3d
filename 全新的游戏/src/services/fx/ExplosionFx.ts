// ============================================================
// ExplosionFx —— 程序化爆炸视觉（自爆 / 范围爆炸；无资产依赖）
// ============================================================
// 强烈版（2026-09-19）：双扩散环（错峰）+ 白热闪光核 + 飞散火花（重力弧线）。
// 加法混合；~0.55s 生命。用法：WorldMode 建（scene）→ aoe 结算 spawn → 每帧 update → 退出 dispose。
// ============================================================

import * as THREE from 'three';

interface Burst {
  age: number;
  life: number;
  radius: number;
  ring1: THREE.Mesh;
  ring2: THREE.Mesh;
  core: THREE.Mesh;
  sparks: THREE.Mesh[];
  sparkVel: Float32Array;   // 每火花 3 分量（x,y,z）
  mats: THREE.Material[];
}

export class ExplosionFx {
  private group = new THREE.Group();
  private bursts: Burst[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.72, 1, 48);
  private readonly coreGeo = new THREE.CircleGeometry(1, 24);
  private readonly sparkGeo = new THREE.PlaneGeometry(0.22, 0.22);
  private readonly sparkCount = 10;

  constructor(scene: THREE.Scene) {
    this.group.renderOrder = 999;
    scene.add(this.group);
  }

  /** 生成一次爆炸（radius = 世界单位；y = 爆心高度） */
  spawn(x: number, y: number, z: number, radius: number): void {
    const mats: THREE.Material[] = [];
    const mkMat = (color: number, opacity: number): THREE.MeshBasicMaterial => {
      const m = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      });
      mats.push(m);
      return m;
    };
    const ring1 = new THREE.Mesh(this.ringGeo, mkMat(0xffe9b0, 1));
    ring1.rotation.x = -Math.PI / 2;
    ring1.position.set(x, y + 0.25, z);
    const ring2 = new THREE.Mesh(this.ringGeo, mkMat(0xff8a3c, 0.9));
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.set(x, y + 0.35, z);
    const core = new THREE.Mesh(this.coreGeo, mkMat(0xfffdf2, 1));
    core.rotation.x = -Math.PI / 2;
    core.position.set(x, y + 0.5, z);
    this.group.add(ring1, ring2, core);
    // 火花：随机水平方向 + 上抛，受重力
    const sparks: THREE.Mesh[] = [];
    const sparkVel = new Float32Array(this.sparkCount * 3);
    for (let i = 0; i < this.sparkCount; i++) {
      const s = new THREE.Mesh(this.sparkGeo, mkMat(0xffd27a, 1));
      s.position.set(x, y + 0.6, z);
      this.group.add(s);
      sparks.push(s);
      const a = (i / this.sparkCount) * Math.PI * 2 + Math.random() * 0.6;
      const sp = (2.2 + Math.random() * 2.6) * Math.max(0.6, radius / 3);
      sparkVel[i * 3] = Math.cos(a) * sp;
      sparkVel[i * 3 + 1] = 2.2 + Math.random() * 2.4;
      sparkVel[i * 3 + 2] = Math.sin(a) * sp;
    }
    this.bursts.push({
      age: 0, life: 0.55, radius,
      ring1, ring2, core, sparks, sparkVel, mats,
    });
  }

  update(dt: number): void {
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        this.group.remove(b.ring1, b.ring2, b.core);
        for (const s of b.sparks) this.group.remove(s);
        for (const m of b.mats) m.dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      // 主环：快速扩散、快速淡出
      const s1 = 0.35 + t * b.radius * 0.95;
      b.ring1.scale.set(s1, s1, s1);
      (b.ring1.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - t, 1.4);
      // 副环：错峰 0.08s、更大更橙
      const t2 = Math.max(0, (b.age - 0.08) / (b.life - 0.08));
      const s2 = 0.2 + t2 * b.radius * 1.45;
      b.ring2.scale.set(s2, s2, s2);
      (b.ring2.material as THREE.MeshBasicMaterial).opacity = (1 - t2) * 0.9;
      // 白热核：瞬间放大 + 极快淡出
      const sc = 0.9 + t * b.radius * 0.8;
      b.core.scale.set(sc, sc, sc);
      (b.core.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t * 2.4);
      // 火花：抛物弧线 + 收缩
      for (let k = 0; k < b.sparks.length; k++) {
        const s = b.sparks[k];
        b.sparkVel[k * 3 + 1] -= 9 * dt;
        s.position.x += b.sparkVel[k * 3] * dt;
        s.position.y += b.sparkVel[k * 3 + 1] * dt;
        s.position.z += b.sparkVel[k * 3 + 2] * dt;
        const ss = Math.max(0.15, 1 - t * 0.9);
        s.scale.set(ss, ss, ss);
        s.rotation.z += dt * 6;
        (s.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      }
    }
  }

  dispose(): void {
    for (const b of this.bursts) {
      this.group.remove(b.ring1, b.ring2, b.core);
      for (const s of b.sparks) this.group.remove(s);
      for (const m of b.mats) m.dispose();
    }
    this.bursts.length = 0;
    this.group.removeFromParent();
    this.ringGeo.dispose();
    this.coreGeo.dispose();
    this.sparkGeo.dispose();
  }
}
