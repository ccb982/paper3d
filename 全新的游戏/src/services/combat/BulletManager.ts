// ============================================================
// BulletManager —— 子弹组合层（池 + 离屏视觉 + 3D 渲染器串联）
// ============================================================
// 三个模块，零直接依赖，只通过数据契约交互：
//   ① BulletVisual  离屏子弹实体（流体+蒙版/VAT → 一张纹理）
//   ② BulletEntity  纯物理实体（位置/速度/碰撞/寿命，独立数据）
//   ③ BulletRenderer InstancedMesh 一次 draw call（消费①纹理 + ②快照）
// 本类只做：池化生命周期 + 每帧串联（step → bake → sync）。

import * as THREE from 'three';
import { BulletEntity, type BulletEntityOptions } from './BulletEntity';
import { BulletVisual } from './BulletVisual';
import { BulletRenderer } from '../render/BulletRenderer';
import type { EntityManager } from '../../entity/EntityManager';
import type { EntityBase } from '../../entity/EntityBase';
import type { FrameAssetSource } from '../fx/AssetSource';
import { attachHitEffect } from '../fx/attachHitEffect';
import type { HitEffectView } from '../../vendor/player';
import type { HitEffectShapeExport } from '../../vendor/player';

/** ★ 轻量发射参数（AI 行为/近战/远程共用；不依赖实体构造细节） */
export interface SpawnBulletOptions {
  x: number;
  y: number;
  z: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  speed: number;
  camp: 'player' | 'ally' | 'enemy';
  lifetime?: number;
  damage?: number;
}

export class BulletManager {
  /** 全部实体（固定容量，渲染器按索引对应 instance；含激活/失活） */
  private allBullets: BulletEntity[] = [];
  /** 池中可用实体（激活的被 pop 出去） */
  private pool: BulletEntity[] = [];
  private activeBullets = new Set<BulletEntity>();
  private activeCount = 0;
  private visual: BulletVisual | null;
  private renderer: BulletRenderer;
  /** ★ 地形命中特效（固定点播放列表：fx + 命中坐标；播完自回收） */
  private terrainFxViews: { fx: HitEffectView; x: number; y: number; z: number }[] = [];
  /** 击中特效形状定义（素材包 hit_effects.json；空 = 无矢量动画） */
  private hitEffectShapes: HitEffectShapeExport[];

  constructor(
    private em: EntityManager,
    private scene: THREE.Scene,
    private asset: FrameAssetSource,
    capacity = 100,
    glRenderer?: THREE.WebGLRenderer,
    hitEffectShapes: HitEffectShapeExport[] = [],
  ) {
    this.hitEffectShapes = hitEffectShapes;
    // ---- ① 离屏视觉（流体 + 蒙版/VAT → 纹理）----
    this.visual = glRenderer ? new BulletVisual(glRenderer, asset) : null;
    // ★ 提取子弹剪影遮罩（一次性，所有子弹实例共享）
    if (asset) {
      try {
        const pair0 = asset.getFramePair(0);
        if (pair0?.base?.image?.data) {
          const d = pair0.base.image.data as unknown as Float32Array;
          const bw = pair0.base.image.width;
          const bh = pair0.base.image.height;
          const SW = 16;
          const SH = Math.max(2, Math.round(SW * bh / bw));
          const c = document.createElement('canvas');
          c.width = SW; c.height = SH;
          const ctx = c.getContext('2d')!;
          const img = ctx.createImageData(SW, SH);
          for (let sy = 0; sy < SH; sy++) {
            const ay = Math.min(bh - 1, Math.floor((sy / SH) * bh));
            for (let sx = 0; sx < SW; sx++) {
              const ax = Math.min(bw - 1, Math.floor((sx / SW) * bw));
              const o = (ay * bw + ax) * 4;
              const a = Math.max(0, Math.min(1, d[o + 3]));
              const di = (sy * SW + sx) * 4;
              img.data[di]     = 0;
              img.data[di + 1] = 0;
              img.data[di + 2] = 0;
              img.data[di + 3] = a > 0.5 ? 255 : 0;
            }
          }
          ctx.putImageData(img, 0, 0);
          BulletEntity.sharedSilhouetteTex = new THREE.CanvasTexture(c);
        }
      } catch { /* 提取失败不阻塞 */ }
    }
    this.visual?.init(); // 强制首帧烘焙，避免 RT 纹理全黑

    // ---- ③ 3D 渲染器（InstancedMesh；世界尺寸 = 基类函数计算）----
    const quadSize = BulletEntity.computeWorldSize(asset);
    this.renderer = new BulletRenderer(scene, capacity, quadSize);
    this.renderer.setTexture(this.visual ? this.visual.getTexture() : null);
    // ★ 扭曲/纹理旋转参数（素材包 per_frame_data 携带；纯纹理包无 → 关闭）
    const anyBundle = asset as {
      getFrameRenderData?: (idx: number) => {
        distortEnabled: boolean; distortAmplitude: number; distortFrequency: number;
        distortSpeed: number; distortRotation: number; textureRotation: number;
      } | null;
    };
    const fd0 = anyBundle.getFrameRenderData?.(0);
    if (fd0) {
      this.renderer.setDistort({
        enabled: fd0.distortEnabled,
        amplitude: fd0.distortAmplitude,
        frequency: fd0.distortFrequency,
        speed: fd0.distortSpeed,
        rotation: fd0.distortRotation,
      });
      // ★ 纹理旋转：只绕平面法线 Z 轴（2D UV 旋转）
      this.renderer.setTextureRotation(fd0.textureRotation ?? 0);
    }

    // ---- ② 纯实体池 ----
    for (let i = 0; i < capacity; i++) {
      const b = new BulletEntity(em, {
        x: 0, y: -50, z: 0,
        dirX: 1, dirY: 0, dirZ: 0,
        speed: 0,
        camp: 'player',
      });
      b.recycle = () => {
        this.pool.push(b);
        this.activeBullets.delete(b);
        this.activeCount = Math.max(0, this.activeCount - 1);
      };
      // ★ 命中特效（每次碰撞只触发一次）：
      //   命中实体 → attachEffect 挂实体槽（实体骨架驱动坐标 → 自动跟随 + 播完自动回收）
      //   命中地形 → 固定点播放列表（每帧重传同一命中坐标）
      b.hitFx = (other: EntityBase | null) => this.spawnHitEffect(b, other);
      this.allBullets.push(b);
      this.pool.push(b);
    }
  }

  /** ★ 发射：从池取一颗激活；池空返回 null（短暂无弹，等回收） */
  spawn(opts: SpawnBulletOptions): BulletEntity | null {
    const b = this.pool.pop();
    if (!b) {
      console.warn('[bullet] 池空：100 颗都在飞行中，等待超时回收');
      return null;
    }
    const full: BulletEntityOptions = {
      ...opts,
    };
    // ★ 每次开火重置离屏视觉（恢复初始残差 → 纹理重新流动）
    this.visual?.reset();
    this.activeCount++;
    this.activeBullets.add(b);
    b.activate(full);
    return b;
  }

  /** ★ 每帧驱动：离屏视觉 step（流体+烘焙）→ 渲染器同步实例变换（需相机算滚转） */
  update(dt: number, camera: THREE.Camera): void {
    if (this.activeCount > 0) {
      this.visual?.step(dt);
    }
    this.renderer.sync(this.allBullets, camera);
    // ★ 地形命中特效驱动（固定点：播完回收）
    for (let i = this.terrainFxViews.length - 1; i >= 0; i--) {
      const item = this.terrainFxViews[i];
      if (item.fx.update(dt, item.x, item.y, item.z)) {
        item.fx.dispose();
        this.terrainFxViews.splice(i, 1);
      }
    }
  }

  /** ★ 命中特效 billboard 朝向（render 前调用；实体槽特效由实体骨架驱动） */
  syncHitEffects(camera: THREE.Camera): void {
    for (const item of this.terrainFxViews) item.fx.render(camera);
  }

  /** ★ 命中特效挂载（共用服务层函数 attachHitEffect）：
   *   实体 → 函数内完成偏移计算 + attachEffect（击中点跟着实体走）；
   *   地形 → 返回 fx 进固定点列表（命中坐标原地播放） */
  private spawnHitEffect(b: BulletEntity, other: EntityBase | null): void {
    if (this.hitEffectShapes.length === 0) return;
    const p = b.entity.position;
    const fx = attachHitEffect(this.scene, this.hitEffectShapes, { x: p.x, y: p.y, z: p.z }, other, { worldSize: 3 });
    if (fx) this.terrainFxViews.push({ fx, x: p.x, y: p.y, z: p.z });
  }

  dispose(): void {
    for (const b of this.allBullets) b.dispose();
    this.allBullets = [];
    this.pool = [];
    this.activeBullets.clear();
    for (const item of this.terrainFxViews) item.fx.dispose();
    this.terrainFxViews = [];
    this.visual?.dispose();
    this.visual = null;
    this.renderer.dispose();
  }
}
