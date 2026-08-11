// ============================================================
// FTXQuad —— 纯纹理帧渲染器（渲染管线①：ftx3 纹理包）
// ============================================================
// 继承 FxRendererBase：
//   - quad + 合成 shader（base HSL + residual 残差 → RGB，GPU 合成）
//   - bbox 区域映射（帧内容只占 bbox，透明外延）
//   - 反转（flipX/flipY 由基类应用 scale 取反）
//   - 流体注入（uFluidTex 分支）
// 读 FrameState.frameIndex → source.getFramePair → 渲染。

import * as THREE from 'three';
import { FxRendererBase } from './FxRendererBase';
import type { FrameAssetSource } from '../fx/AssetSource';

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uBaseTexture;
  uniform sampler2D uResidual;
  uniform sampler2D uFluidTex;
  uniform float uUseFluid;
  uniform vec2 uFrameSize;
  uniform vec4 uBbox; // x, y, w, h（像素）
  varying vec2 vUv;
  vec3 hsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
  }
  void main() {
    // 纹理数据 row0=顶部（flipY=false）→ vUv 左下原点，翻转 v
    vec2 texUV = (vec2(vUv.x, 1.0 - vUv.y) * uFrameSize - uBbox.xy) / uBbox.zw;
    if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) {
      discard;
    }
    if (uUseFluid > 0.5) {
      vec4 fluid = texture2D(uFluidTex, texUV);
      if (fluid.a < 0.5) discard;
      gl_FragColor = fluid;
      return;
    }
    vec4 base = texture2D(uBaseTexture, texUV);
    if (base.a < 0.5) discard;
    vec4 res = texture2D(uResidual, texUV);
    float dH = (res.r * 2.0 - 1.0) * 0.5;
    float dS = (res.g * 2.0 - 1.0) * 0.5;
    float dL = (res.b * 2.0 - 1.0) * 0.5;
    float finalH = fract(base.r + dH);
    float finalS = clamp(base.g + dS, 0.0, 1.0);
    float finalL = clamp(base.b + dL, 0.0, 1.0);
    gl_FragColor = vec4(hsl2rgb(finalH, finalS, finalL), base.a);
  }
`;

export class FTXQuad extends FxRendererBase {
  protected material: THREE.ShaderMaterial;
  private _frameSize = new THREE.Vector2(512, 512);
  private _bbox = new THREE.Vector4(0, 0, 512, 512);

  constructor(
    scene: THREE.Scene,
    private source: FrameAssetSource,
  ) {
    super();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uBaseTexture: { value: null as unknown as THREE.Texture },
        uResidual: { value: null as unknown as THREE.Texture },
        uFluidTex: { value: null as unknown as THREE.Texture },
        uUseFluid: { value: 0 },
        uFrameSize: { value: this._frameSize },
        uBbox: { value: this._bbox },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.set(0, 0, 0);
    scene.add(this.mesh);
  }

  override render(state: { frameIndex: number }, fluidTexture?: THREE.Texture | null): void {
    const pair = this.source.getFramePair(state.frameIndex);
    if (!pair) return;
    const u = this.material.uniforms;
    u.uBaseTexture.value = pair.base;
    u.uResidual.value = pair.residual;
    if (fluidTexture) {
      u.uFluidTex.value = fluidTexture;
      u.uUseFluid.value = 1;
    } else {
      u.uUseFluid.value = 0;
    }
  }

  /**
   * ★ yaw-only billboard：贴片垂直地面（立牌式），只绕 Y 轴水平面向相机。
   * 相机俯视时看到角色的"正面上部"、侧面看是薄片——有 3D 立体感
   * （方舟/八方旅人式 2D 角色融入 3D 场景的标准做法）。
   * 注：全姿态 billboard 会让角色永远平视贴屏幕，没有"站立"感。
   */
  setBillboard(camera: THREE.Camera): void {
    if (!this.mesh) return;
    const dir = new THREE.Vector3().subVectors(camera.position, this.mesh.position);
    dir.y = 0; // 只取水平方向
    if (dir.lengthSq() > 1e-8) {
      dir.normalize();
      this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    }
    this.applyFlip();
  }

  /** 按资产帧数据更新 bbox 映射（资产加载后调用一次即可） */
  setFrameMapping(frameSize: { width: number; height: number }, bbox: { x: number; y: number; w: number; h: number }): void {
    this._frameSize.set(frameSize.width, frameSize.height);
    this._bbox.set(bbox.x, bbox.y, bbox.w, bbox.h);
    this.material.uniforms.uFrameSize.value.needsUpdate = true;
  }
}
