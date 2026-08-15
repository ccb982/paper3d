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
import type { FrameAssetSource } from '../fx/AssetSource';

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

  constructor(
    private em: EntityManager,
    private scene: THREE.Scene,
    private asset: FrameAssetSource,
    capacity = 100,
    glRenderer?: THREE.WebGLRenderer,
  ) {
    // ---- ① 离屏视觉（流体 + 蒙版/VAT → 纹理）----
    this.visual = glRenderer ? new BulletVisual(glRenderer, asset) : null;

    // ---- ③ 3D 渲染器（InstancedMesh；世界尺寸 = 宽 2/3，高按纹理宽高比）----
    const pair = asset.getFramePair(0);
    const aspect = pair ? pair.base.image.height / pair.base.image.width : 3.79;
    const quadW = 2 / 3;
    this.renderer = new BulletRenderer(scene, capacity, {
      width: quadW,
      height: quadW * aspect,
    });
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
  }

  dispose(): void {
    for (const b of this.allBullets) b.dispose();
    this.allBullets = [];
    this.pool = [];
    this.activeBullets.clear();
    this.visual?.dispose();
    this.visual = null;
    this.renderer.dispose();
  }
}
