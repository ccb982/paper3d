// ============================================================
// BulletManager —— 子弹管理器（对象池 + 共享流体 + 离屏蒙版烘焙）
// ============================================================
// 预创建 N 颗子弹（刚体/贴片常驻复用），spawn 取出激活 / 超时回池。
// 池空（N 颗全在飞）→ spawn 返回 null（调用方忽略即可）。
// 玩家/敌人/友军共用（camp 由 spawn 参数决定）。
//
// ★ 共享流体效果（素材包 .scene.zip 的 per_frame_data.physics）：
//   全部子弹显示同一帧纹理 → 一个 FluidEffect 驱动全池（纹理流动/注入），
//   发射时 reset（恢复初始残差），纹理每次开火"重新流动"。
//
// ★ 离屏蒙版烘焙（素材包区域实体 + maskEffect）：
//   蒙版（模板裁剪 + VAT 顶点位移）与流体一起渲染进【1 张离屏纹理】
//   （纹理坐标系，正交相机，与子弹世界变换完全无关）；
//   100 颗子弹的 quad 都采样这一张烘焙纹理 → 单纹理单管线，
//   不存在共享网格/逐子弹注入变换/画布尺寸错位等隐患。

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
  /** ★ 当前飞行中的子弹（★ 不在池里！spawn 时 pop 出池；蒙版渲染/流体遍历用） */
  private activeBullets = new Set<BulletBase>();
  /** 当前飞行中的子弹数（流体步进门控：无子弹在飞不空转） */
  private activeCount = 0;
  /** ★ 离屏烘焙资源（蒙版 + VAT + 流体 → 单张纹理；无蒙版实体 = null） */
  private bake: {
    rt: THREE.WebGLRenderTarget;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    entities: EntityMeshData[];
    baseTex: THREE.Texture;
    residualTex: THREE.Texture;
  } | null = null;

  constructor(
    private em: EntityManager,
    private scene: THREE.Scene,
    private asset: FrameAssetSource,
    capacity = 100,
    private renderer?: THREE.WebGLRenderer,
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
    // ★ 离屏烘焙：素材包区域实体 + maskEffect → 建立蒙版场景 + 离屏 RT
    const anyBundle = asset as { getFrameRenderData?: (i: number) => { entities?: EntityMeshData[] } | null };
    const fd0 = anyBundle.getFrameRenderData?.(0);
    const maskEntities = fd0?.entities;
    if (renderer && maskEntities && maskEntities.length > 0) {
      const pair = asset.getFramePair(0);
      const w = pair?.base.image.width ?? 134;
      const h = pair?.base.image.height ?? 508;
      const rt = new THREE.WebGLRenderTarget(w, h, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: true,
      });
      const bakeScene = new THREE.Scene();
      for (const em of maskEntities) {
        // 纹理坐标系渲染：bbox 全幅（0,0,1,1），深度/多边形偏移无关紧要
        const cm = em.mesh.material as THREE.ShaderMaterial;
        cm.depthTest = false;
        cm.depthWrite = false;
        cm.polygonOffset = false;
        (cm.uniforms.uBboxOffset.value as THREE.Vector2).set(0, 0);
        (cm.uniforms.uBboxScale.value as THREE.Vector2).set(1, 1);
        (cm.uniforms.uTexOffset.value as THREE.Vector2).set(0, 0);
        (cm.uniforms.uTexScale.value as THREE.Vector2).set(1, 1);
        cm.uniforms.uTexRotation.value = 0;
        cm.uniforms.uDistortEnabled.value = 0; // ★ 扭曲交给 quad（UV 空间）
        em.fillMesh.position.set(0, 0, 0);
        em.fillMesh.scale.set(1, 1, 1);
        em.fillMesh.quaternion.identity();
        em.mesh.position.set(0, 0, 0);
        em.mesh.scale.set(1, 1, 1);
        em.mesh.quaternion.identity();
        bakeScene.add(em.fillMesh);
        bakeScene.add(em.mesh);
      }
      this.bake = {
        rt,
        scene: bakeScene,
        camera: new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1),
        entities: maskEntities,
        baseTex: pair!.base,
        residualTex: pair!.residual,
      };
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
      // ★ 合成纹理提供者：优先烘焙纹理（蒙版+VAT+流体已烘焙），无蒙版回退流体
      b.fluidTextureProvider = () => this.bakeTexture ?? this.fluidTexture;
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

  /** ★ 每帧驱动：共享流体步进（有子弹在飞才跑）→ 离屏烘焙（蒙版+VAT+流体） */
  update(dt: number): void {
    if (this.fluid && this.activeCount > 0) {
      this.fluid.step(Math.max(0, Math.min(dt, 0.1)));
    }
    if (this.bake && this.renderer && this.activeCount > 0) {
      this.bakeFrame();
    }
  }

  /** ★ 离屏烘焙：蒙版（模板裁剪 + VAT 位移）+ 流体合成 → 一张纹理 */
  private bakeFrame(): void {
    const b = this.bake!;
    const renderer = this.renderer!;
    const time = performance.now() / 1000;
    const useFluid = !!this.fluid && this.activeCount > 0;

    for (const em of b.entities) {
      const fm = em.fillMesh.material as THREE.ShaderMaterial;
      fm.uniforms.uTime.value = time;
      fm.uniforms.uFramesPerSecond.value = 30;
      const cm = em.mesh.material as THREE.ShaderMaterial;
      cm.uniforms.uTime.value = time;
      cm.uniforms.uFramesPerSecond.value = 30;
      cm.uniforms.uBaseTexture.value = b.baseTex;
      cm.uniforms.uResidual.value = b.residualTex;
      cm.uniforms.uUseFluid.value = useFluid ? 1 : 0;
      if (useFluid) cm.uniforms.uFluidTex.value = this.fluid!.getCompositeTexture();
      cm.uniforms.uDistortEnabled.value = 0;
    }

    const prevTarget = renderer.getRenderTarget();
    const prevClearColor = new THREE.Color();
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(b.rt);
    renderer.setClearColor(0x000000, 0);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    const gl = renderer.getContext();
    gl.enable(gl.STENCIL_TEST);
    renderer.clear(true, true, true); // 清颜色+模板（透明底）

    // ① fill 遍：区域多边形写模板（invert）
    for (const em of b.entities) em.fillMesh.visible = true;
    renderer.render(b.scene, b.camera);
    // ② color 遍：模板 Equal 1 内采样（base+residual / 流体）
    for (const em of b.entities) em.fillMesh.visible = false;
    renderer.render(b.scene, b.camera);
    for (const em of b.entities) em.fillMesh.visible = true;

    gl.disable(gl.STENCIL_TEST);
    renderer.autoClear = autoClear;
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.setRenderTarget(prevTarget);
  }

  /** ★ 当前烘焙纹理（蒙版+VAT+流体；无蒙版 = null → quad 回退流体/静态） */
  get bakeTexture(): THREE.Texture | null {
    return this.bake ? this.bake.rt.texture : null;
  }

  /** ★ 当前流体合成纹理（无流体 = null） */
  get fluidTexture(): THREE.Texture | null {
    return this.fluid ? this.fluid.getCompositeTexture() : null;
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
    this.bake?.rt.dispose();
    this.bake = null;
  }
}
