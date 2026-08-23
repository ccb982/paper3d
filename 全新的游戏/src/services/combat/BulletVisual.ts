// ============================================================
// BulletVisual —— 离屏子弹实体（2D 纹理空间，不感知 3D 世界）
// ============================================================
// 自包含的子弹"画面生产者"（继承 OffscreenBake：RT 管线在基类）：
//   - 流体（素材包 physics → FluidEffect，残差流动/注入）
//   - 蒙版/VAT（素材包区域实体 → 模板裁剪 + 顶点位移）
//   - 全部渲染进【1 张离屏 RT】→ 对外只暴露 getTexture()
//
// 3D 世界不知道它怎么烘焙；它不知道 3D 世界/相机/子弹实例。
// 唯一接口 = 一张纹理（100 颗子弹的渲染器统一采样）。

import * as THREE from 'three';
import { OffscreenBake } from '../render/OffscreenBake';
import { FluidEffect } from '../../vendor/player/fluid/FluidEffect';
import type { EntityMeshData } from '../../vendor/player/gl/renderer';
import type { FrameAssetSource } from '../fx/AssetSource';

/** 全幅合成材质（无蒙版实体时：base+residual / 流体 → RGB） */
function makeCompositeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uBase;
      uniform sampler2D uResidual;
      uniform sampler2D uFluidTex;
      uniform float uUseFluid;
      varying vec2 vUv;
      vec3 hsl2rgb(float h, float s, float l) {
        vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
      }
      void main() {
        vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
        if (uUseFluid > 0.5) {
          vec4 f = texture2D(uFluidTex, uv);
          if (f.a < 0.5) discard;
          gl_FragColor = f;
          return;
        }
        vec4 base = texture2D(uBase, uv);
        if (base.a < 0.5) discard;
        vec4 res = texture2D(uResidual, uv);
        float dH = (res.r * 2.0 - 1.0) * 0.5;
        float dS = (res.g * 2.0 - 1.0) * 0.5;
        float dL = (res.b * 2.0 - 1.0) * 0.5;
        float finalH = fract(base.r + dH);
        float finalS = clamp(base.g + dS, 0.0, 1.0);
        float finalL = clamp(base.b + dL, 0.0, 1.0);
        gl_FragColor = vec4(hsl2rgb(finalH, finalS, finalL), base.a);
      }
    `,
    uniforms: {
      uBase: { value: null as unknown as THREE.Texture },
      uResidual: { value: null as unknown as THREE.Texture },
      uFluidTex: { value: null as unknown as THREE.Texture },
      uUseFluid: { value: 0 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export class BulletVisual extends OffscreenBake {
  private fluid: FluidEffect | null = null;
  /** 蒙版场景内容（区域实体；空 = 全幅合成路径） */
  private scene: THREE.Scene;
  private entities: EntityMeshData[] = [];
  private baseTex: THREE.Texture;
  private residualTex: THREE.Texture;
  private fullQuad: THREE.Mesh | null;
  private fullMat: THREE.ShaderMaterial;
  /** ★ 固定步长累加器：模拟与帧卡顿解耦
   *   （防卡顿帧 dt=0.1 时平流一步位移≈50px 的"周期性黑团闪现后消散"） */
  private simAccum = 0;
  /** 固定模拟步长 */
  private static readonly SIM_DT = 1 / 60;
  /** 单帧最大补步数（超出部分丢弃：极端卡顿时模拟时间膨胀而非跳变） */
  private static readonly MAX_STEPS_PER_FRAME = 4;
  /** ★ 调试：每帧场回读开关（?dbg=1 启用，?dbgn=N 抽样每 N 帧输出一次） */
  private dbg = false;
  private dbgN = 1;
  private dbgFrame = 0;

  constructor(renderer: THREE.WebGLRenderer, asset: FrameAssetSource) {
    const pair = asset.getFramePair(0);
    const w = pair?.base.image.width ?? 134;
    const h = pair?.base.image.height ?? 508;
    super(renderer, w, h);
    this.scene = new THREE.Scene();
    this.baseTex = pair!.base;
    this.residualTex = pair!.residual;

    // ---- 流体（素材包 physics；纯纹理包无物理 → null） ----
    const anyAsset = asset as { getFluidEffect?: (idx: number, r: THREE.WebGLRenderer) => FluidEffect | null };
    if (anyAsset.getFluidEffect) {
      try {
        this.fluid = anyAsset.getFluidEffect(0, renderer);
      } catch {
        this.fluid = null;
      }
    }

    // ---- 蒙版实体（素材包区域实体 → 模板裁剪 + VAT 位移） ----
    const anyBundle = asset as { getFrameRenderData?: (i: number) => { entities?: EntityMeshData[] } | null };
    this.entities = anyBundle.getFrameRenderData?.(0)?.entities ?? [];
    for (const em of this.entities) {
      const cm = em.mesh.material as THREE.ShaderMaterial;
      cm.depthTest = false;
      cm.depthWrite = false;
      cm.polygonOffset = false;
      (cm.uniforms.uBboxOffset.value as THREE.Vector2).set(0, 0);
      (cm.uniforms.uBboxScale.value as THREE.Vector2).set(1, 1);
      (cm.uniforms.uTexOffset.value as THREE.Vector2).set(0, 0);
      (cm.uniforms.uTexScale.value as THREE.Vector2).set(1, 1);
      cm.uniforms.uTexRotation.value = 0;
      cm.uniforms.uDistortEnabled.value = 0; // 扭曲交给 3D 渲染器（UV 空间）
      em.fillMesh.position.set(0, 0, 0);
      em.fillMesh.scale.set(1, 1, 1);
      em.fillMesh.quaternion.identity();
      em.mesh.position.set(0, 0, 0);
      em.mesh.scale.set(1, 1, 1);
      em.mesh.quaternion.identity();
      this.scene.add(em.fillMesh);
      this.scene.add(em.mesh);
    }

    // ---- 无蒙版实体时的全幅合成 quad（同一 RT） ----
    this.fullMat = makeCompositeMaterial();
    this.fullQuad = this.entities.length === 0
      ? new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.fullMat)
      : null;
    if (this.fullQuad) this.scene.add(this.fullQuad);
  }

  /** ★ 强制首帧烘焙 + 预热（解决构造时纹理全黑 + 首次开火 shader 编译卡顿） */
  init(): void {
    // ★ 版本横幅：无条件打印，用于确认运行中的是最新代码
    console.log(`[BulletVisual] init ✓ v230823-4 fluid=${!!this.fluid} dbgParam=${location.search || '(无参数)'}`);
    // ★ 诊断开关（临时）：URL 参数剥离源配置，定位周期性黑团来源
    //   ?nowp=1 去路点（源每1s瞬移）| ?nogate=1 去间歇门控 | ?nowave=1 去波形摆动
    if (this.fluid) {
      const q = new URLSearchParams(location.search);
      if (q.has('nowp') || q.has('nogate') || q.has('nowave')) {
        for (const s of this.fluid.solver.config.continuousSources) {
          if (q.has('nowp')) delete s.waypoints;
          if (q.has('nogate')) delete s.intermittent;
          if (q.has('nowave')) delete s.wave;
        }
        console.log('[BulletVisual] 诊断开关生效:', location.search);
      }
      // ★ 每帧场回读：?dbg=1 启用，?dbgn=5 表示每 5 帧输出一次（默认每帧）
      this.dbg = q.has('dbg');
      const dbgn = Number(q.get('dbgn'));
      if (Number.isFinite(dbgn) && dbgn >= 1) this.dbgN = Math.floor(dbgn);
      if (this.dbg) {
        console.log(`[BulletVisual] ★每帧场回读已启用 (dbgn=${this.dbgN}) —— 若看不到本行说明 URL 未带 ?dbg=1 或运行的是旧构建`);
      } else if (q.has('dbg') === false && this.fluid === null) {
        console.warn('[BulletVisual] 无流体实例且未启用 dbg：资产可能缺少 physics 配置');
      }
    }
    this.bakeFrame();
    if (this.fluid) {
      // ★ 预热：提前跑几步，让平流/压力/注入/合成等全部材质在此处编译完成
      for (let i = 0; i < 5; i++) this.fluid.step(BulletVisual.SIM_DT);
      // ★ 预热后恢复初始态并重新合成：待机画面保持纯净残差，
      //   不残留预热演化出的暗色密度
      this.fluid.solver.reset();
      this.bakeFrame();
    }
  }

  /** ★ 每帧驱动：固定步长流体 step + 烘焙（管理器仅在"有子弹在飞"时调用） */
  step(dt: number): void {
    if (this.fluid) {
      // ★ 固定步长累加器：无论真实帧率如何抖动，模拟每步恒定 1/60s。
      //   卡顿帧（GC/编译尖峰）不再产生大 dt → 不再有大位移跳变；
      //   高帧率屏也不会过快推进模拟。积压超预算直接丢弃。
      this.simAccum += Math.min(Math.max(dt, 0), 0.1);
      let n = 0;
      while (this.simAccum >= BulletVisual.SIM_DT && n < BulletVisual.MAX_STEPS_PER_FRAME) {
        this.fluid.step(BulletVisual.SIM_DT);
        this.simAccum -= BulletVisual.SIM_DT;
        n++;
      }
      if (this.simAccum > BulletVisual.SIM_DT) this.simAccum = 0;
    }
    // ★ 每帧场回读（?dbg=1）：观察密度/速度场的周期性异常
    if (this.dbg && this.fluid) {
      this.dbgFrame = (this.dbgFrame + 1) % this.dbgN;
      if (this.dbgFrame === 0) this.fluid.solver.debugReadFields();
    }
    this.bakeFrame();
  }

  /** ★ 开火重置：恢复初始残差（纹理每次开火重新流动） */
  reset(): void {
    // ★ 预存一步的预算：保证 reset 后的第一帧 update 必定至少跑 1 步模拟
    //   （否则首帧可能 0 步 → 烘焙到 reset 前的陈旧合成画面）
    this.simAccum = BulletVisual.SIM_DT;
    if (this.fluid) {
      try {
        this.fluid.solver.reset();
      } catch { /* 重置失败不影响发射 */ }
    }
  }

  /** 离屏烘焙：模板裁剪 + VAT 位移 + 流体合成 → 一张纹理 */
  private bakeFrame(): void {
    const time = performance.now() / 1000;
    const useFluid = !!this.fluid;

    for (const em of this.entities) {
      (em.fillMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      (em.fillMesh.material as THREE.ShaderMaterial).uniforms.uFramesPerSecond.value = 30;
      const cm = em.mesh.material as THREE.ShaderMaterial;
      cm.uniforms.uTime.value = time;
      cm.uniforms.uFramesPerSecond.value = 30;
      cm.uniforms.uBaseTexture.value = this.baseTex;
      cm.uniforms.uResidual.value = this.residualTex;
      cm.uniforms.uUseFluid.value = useFluid ? 1 : 0;
      if (useFluid) cm.uniforms.uFluidTex.value = this.fluid!.getCompositeTexture();
      cm.uniforms.uDistortEnabled.value = 0;
    }
    if (this.fullQuad) {
      const m = this.fullMat.uniforms;
      m.uBase.value = this.baseTex;
      m.uResidual.value = this.residualTex;
      m.uUseFluid.value = useFluid ? 1 : 0;
      if (useFluid) m.uFluidTex.value = this.fluid!.getCompositeTexture();
    }

    const gl = this.renderer.getContext();
    gl.enable(gl.STENCIL_TEST);
    this.begin();
    if (this.entities.length > 0) {
      // ① fill 遍：区域多边形写模板（invert）
      for (const em of this.entities) em.fillMesh.visible = true;
      this.renderer.render(this.scene, this.camera);
      // ② color 遍：模板 Equal 1 内采样（base+residual / 流体 + VAT）
      for (const em of this.entities) em.fillMesh.visible = false;
      this.renderer.render(this.scene, this.camera);
      for (const em of this.entities) em.fillMesh.visible = true;
    } else if (this.fullQuad) {
      // 无蒙版：全幅合成
      this.renderer.render(this.scene, this.camera);
    }
    gl.disable(gl.STENCIL_TEST);
    this.end();
  }

  override dispose(): void {
    this.fluid?.dispose();
    this.fluid = null;
    this.fullMat.dispose();
    this.fullQuad?.geometry.dispose();
    super.dispose();
  }
}
