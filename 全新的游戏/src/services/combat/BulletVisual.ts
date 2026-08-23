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

  /** ★ 强制首帧烘焙（解决构造时纹理全黑的问题） */
  init(): void {
    this.bakeFrame();
  }

  /** ★ 每帧驱动：流体 step + 烘焙（管理器仅在"有子弹在飞"时调用） */
  step(dt: number): void {
    if (this.fluid) this.fluid.step(Math.max(0, Math.min(dt, 0.1)));
    this.bakeFrame();
  }

  /** ★ 开火重置：恢复初始残差（纹理每次开火重新流动） */
  reset(): void {
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
