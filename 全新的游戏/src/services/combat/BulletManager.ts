// ============================================================
// BulletManager —— 子弹管理器（对象池 + 共享流体，架构 4.2）
// ============================================================
// 预创建 N 颗子弹（刚体/贴片常驻复用），spawn 取出激活 / 超时回池。
// 池空（N 颗全在飞）→ spawn 返回 null（调用方忽略即可）。
// 玩家/敌人/友军共用（camp 由 spawn 参数决定）。
//
// ★ 共享流体效果（素材包 .scene.zip 的 per_frame_data.physics）：
//   全部子弹显示同一帧纹理 → 一个 FluidEffect 驱动全池（纹理流动/注入），
//   每颗子弹渲染时取同一个 compositeTarget 纹理；
//   发射时 reset（恢复初始残差），纹理每次开火"重新流动"。

import * as THREE from 'three';
import { BulletBase, type BulletOptions } from '../../entity/BulletBase';
import type { EntityManager } from '../../entity/EntityManager';
import type { FrameAssetSource } from '../fx/AssetSource';
import { FluidEffect } from '../../vendor/player/fluid/FluidEffect';
import type { EntityMeshData } from '../../vendor/player/gl/renderer';

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
  private pool: BulletBase[] = [];
  private capacity: number;
  /** ★ 共享流体效果（素材包携带物理时创建；无 → null，普通贴片渲染） */
  private fluid: FluidEffect | null = null;
  /** ★ 共享蒙版资源（素材包区域实体 + maskEffect；全池子弹共用一套网格/场景） */
  private mask: { entities: EntityMeshData[]; scene: THREE.Scene } | null = null;
  /** ★ 当前飞行中的子弹（★ 不在池里！spawn 时 pop 出池；蒙版渲染/流体遍历用） */
  private activeBullets = new Set<BulletBase>();
  /** 当前飞行中的子弹数（流体步进门控：无子弹在飞不空转） */
  private activeCount = 0;

  constructor(
    private em: EntityManager,
    private scene: THREE.Scene,
    private asset: FrameAssetSource,
    capacity = 100,
    renderer?: THREE.WebGLRenderer,
  ) {
    this.capacity = capacity;
    // ★ 共享流体：素材包（Asset.getFluidEffect 读 per_frame_data.physics）才有；
    //   纯纹理包（ftx3）/程序圆点无物理 → 无流体
    const anyAsset = asset as { getFluidEffect?: (idx: number, r: THREE.WebGLRenderer) => FluidEffect | null };
    if (renderer && anyAsset.getFluidEffect) {
      try {
        this.fluid = anyAsset.getFluidEffect(0, renderer);
      } catch {
        this.fluid = null;
      }
    }
    // ★ 共享蒙版资源：素材包（Asset.getFrameRenderData）区域实体 + maskEffect；
    //   纯纹理包/程序圆点无 → null（蒙版渲染零开销）
    const anyBundle = asset as { getFrameRenderData?: (i: number) => { entities?: EntityMeshData[] } | null };
    const fd0 = anyBundle.getFrameRenderData?.(0);
    const maskEntities = fd0?.entities;
    if (maskEntities && maskEntities.length > 0) {
      const maskScene = new THREE.Scene();
      for (const em of maskEntities) {
        // ★ 游戏内贴片已 bbox 裁剪 → 纹理映射恒为全幅（0,0,1,1）；
        //   深度开 + 多边形偏移（蒙版画在主贴片之上，防 z-fighting）
        const cm = em.mesh.material as THREE.ShaderMaterial;
        cm.depthTest = true;
        cm.depthWrite = false;
        cm.polygonOffset = true;
        cm.polygonOffsetFactor = -2;
        cm.polygonOffsetUnits = -2;
        (cm.uniforms.uBboxOffset.value as THREE.Vector2).set(0, 0);
        (cm.uniforms.uBboxScale.value as THREE.Vector2).set(1, 1);
        (cm.uniforms.uTexOffset.value as THREE.Vector2).set(0, 0);
        (cm.uniforms.uTexScale.value as THREE.Vector2).set(1, 1);
        cm.uniforms.uTexRotation.value = 0;
        const fm = em.fillMesh.material as THREE.ShaderMaterial;
        fm.depthTest = true;
        fm.depthWrite = false;
        em.fillMesh.frustumCulled = false;
        em.mesh.frustumCulled = false;
        maskScene.add(em.fillMesh);
        maskScene.add(em.mesh);
      }
      this.mask = { entities: maskEntities, scene: maskScene };
    }
    for (let i = 0; i < capacity; i++) {
      // 池中子弹初始失活（构造末尾已 deactivate，藏在地图外）
      const b = new BulletBase(em, scene, asset, {
        kind: 'bullet',
        x: 0, y: -50, z: 0,
        dirX: 1, dirY: 0, dirZ: 0,
        speed: 0,
        camp: 'player',
      });
      // 流体合成纹理提供者（渲染时 FTXQuad 切到 uFluidTex 分支）
      b.fluidTextureProvider = () => this.fluidTexture;
      // ★ 共享蒙版资源（全池共用同一套网格/场景）
      b.setMaskShared(this.mask);
      b.recycle = () => {
        this.pool.push(b);
        this.activeBullets.delete(b);
        this.activeCount = Math.max(0, this.activeCount - 1);
      };
      this.pool.push(b);
    }
  }

  /** ★ 发射：从池取一颗激活；池空（100 颗全在飞）返回 null（短暂无弹，等回收） */
  spawn(opts: SpawnBulletOptions): BulletBase | null {
    const b = this.pool.pop();
    if (!b) {
      console.warn('[bullet] 池空：100 颗都在飞行中，等待超时回收');
      return null;
    }
    const full: BulletOptions = {
      ...opts,
      kind: 'bullet' as const,
    };
    // ★ 每次开火重置共享流体（恢复初始残差 → 纹理重新流动）
    if (this.fluid) {
      try {
        this.fluid.solver.reset();
      } catch { /* 重置失败不影响发射 */ }
    }
    this.activeCount++;
    this.activeBullets.add(b);
    b.activate(full);
    return b;
  }

  /** ★ 每帧驱动共享流体（WorldMode.update 调用；无子弹在飞不空转） */
  update(dt: number): void {
    if (this.fluid && this.activeCount > 0) {
      this.fluid.step(Math.max(0, Math.min(dt, 0.1)));
    }
  }

  /** ★ 当前流体合成纹理（子弹渲染传入；无流体 = null） */
  get fluidTexture(): THREE.Texture | null {
    return this.fluid ? this.fluid.getCompositeTexture() : null;
  }

  /** ★ 蒙版特效渲染（WorldMode 在场景渲染后调用；只处理飞行中的子弹） */
  renderMaskPass(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    for (const b of this.activeBullets) {
      b.renderMaskPass(renderer, camera);
    }
  }

  /** 池中可用子弹数（诊断/调参） */
  get available(): number {
    return this.pool.length;
  }

  dispose(): void {
    for (const b of this.pool) b.dispose();
    this.pool = [];
    this.activeBullets.clear();
    this.fluid?.dispose();
    this.fluid = null;
  }
}
