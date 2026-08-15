// ============================================================
// BulletVisual —— 离屏子弹实体（2D 纹理空间，不感知 3D 世界）
// ============================================================
// 自包含的子弹"画面生产者"：
//   - 流体（素材包 physics → FluidEffect，残差流动/注入）
//   - 蒙版/VAT（素材包区域实体 → 模板裁剪 + 顶点位移）
//   - 全部渲染进【1 张离屏 RT】→ 对外只暴露 getTexture()
//
// 3D 世界不知道它怎么烘焙；它不知道 3D 世界/相机/子弹实例。
// 唯一接口 = 一张纹理（100 颗子弹的渲染器统一采样）。

import * as THREE from 'three';
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

export class BulletVisual {
  private fluid: FluidEffect | null = null;
  /** 离屏烘焙（蒙版实体存在 = 模板/VAT 路径；否则全幅合成路径） */
  private bake: {
    rt: THREE.WebGLRenderTarget;
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    entities: EntityMeshData[];
    baseTex: THREE.Texture;
    residualTex: THREE.Texture;
    fullQuad: THREE.Mesh | null; // 无蒙版实体时的全幅合成 quad
    fullMat: THREE.ShaderMaterial;
  } | null = null;
  private renderer: THREE.WebGLRenderer | null;

  constructor(renderer: THREE.WebGLRenderer, asset: FrameAssetSource) {
    this.renderer = renderer;
    // ---- 流体（素材包 physics；纯纹理包无物理 → null） ----
    const anyAsset = asset as { getFluidEffect?: (idx: number, r: THREE.WebGLRenderer) => FluidEffect | null };
    if (anyAsset.getFluidEffect) {
      try {
        this.fluid = anyAsset.getFluidEffect(0, renderer);
      } catch {
        this.fluid = null;
      }
    }
    // ---- 离屏烘焙 ----
    const pair = asset.getFramePair(0);
    if (!pair) return;
    const w = pair.base.image.width;
    const h = pair.base.image.height;
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
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);

    // 蒙版实体（素材包区域实体 → 模板裁剪 + VAT 位移）
    const anyBundle = asset as { getFrameRenderData?: (i: number) => { entities?: EntityMeshData[] } | null };
    const entities = anyBundle.getFrameRenderData?.(0)?.entities ?? [];
    for (const em of entities) {
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
      scene.add(em.fillMesh);
      scene.add(em.mesh);
    }

    // 无蒙版实体时的全幅合成 quad（同一 RT）
    const fullMat = makeCompositeMaterial();
    const fullQuad = entities.length === 0
      ? new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fullMat)
      : null;
    if (fullQuad) scene.add(fullQuad);

    this.bake = { rt, scene, camera, entities, baseTex: pair.base, residualTex: pair.residual, fullQuad, fullMat };
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

  /** ★ 输出烘焙纹理（渲染器唯一采样源） */
  getTexture(): THREE.Texture | null {
    return this.bake ? this.bake.rt.texture : null;
  }

  /** 离屏烘焙：模板裁剪 + VAT 位移 + 流体合成 → 一张纹理 */
  private bakeFrame(): void {
    const b = this.bake;
    const renderer = this.renderer;
    if (!b || !renderer) return;
    const time = performance.now() / 1000;
    const useFluid = !!this.fluid;

    for (const em of b.entities) {
      (em.fillMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
      (em.fillMesh.material as THREE.ShaderMaterial).uniforms.uFramesPerSecond.value = 30;
      const cm = em.mesh.material as THREE.ShaderMaterial;
      cm.uniforms.uTime.value = time;
      cm.uniforms.uFramesPerSecond.value = 30;
      cm.uniforms.uBaseTexture.value = b.baseTex;
      cm.uniforms.uResidual.value = b.residualTex;
      cm.uniforms.uUseFluid.value = useFluid ? 1 : 0;
      if (useFluid) cm.uniforms.uFluidTex.value = this.fluid!.getCompositeTexture();
      cm.uniforms.uDistortEnabled.value = 0;
    }
    if (b.fullQuad) {
      const m = b.fullMat.uniforms;
      m.uBase.value = b.baseTex;
      m.uResidual.value = b.residualTex;
      m.uUseFluid.value = useFluid ? 1 : 0;
      if (useFluid) m.uFluidTex.value = this.fluid!.getCompositeTexture();
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

    if (b.entities.length > 0) {
      // ① fill 遍：区域多边形写模板（invert）
      for (const em of b.entities) em.fillMesh.visible = true;
      renderer.render(b.scene, b.camera);
      // ② color 遍：模板 Equal 1 内采样（base+residual / 流体 + VAT）
      for (const em of b.entities) em.fillMesh.visible = false;
      renderer.render(b.scene, b.camera);
      for (const em of b.entities) em.fillMesh.visible = true;
    } else if (b.fullQuad) {
      // 无蒙版：全幅合成
      renderer.render(b.scene, b.camera);
    }

    gl.disable(gl.STENCIL_TEST);
    renderer.autoClear = autoClear;
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.setRenderTarget(prevTarget);
  }

  dispose(): void {
    this.fluid?.dispose();
    this.fluid = null;
    if (this.bake) {
      this.bake.rt.dispose();
      this.bake.fullMat.dispose();
      this.bake.fullQuad?.geometry.dispose();
      this.bake = null;
    }
  }
}
