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

/** 滚转临时对象（避免每帧分配） */
const _rollQ = new THREE.Quaternion();
const _LOCAL_Z = new THREE.Vector3(0, 0, 1);

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
  uniform float uFluidClip;
  uniform vec2 uFrameSize;
  uniform vec4 uBbox; // x, y, w, h（像素）
  varying vec2 vUv;
  vec3 hsl2rgb(float h, float s, float l) {
    vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
  }
  uniform float uTime;
  uniform float uDistortEnabled;
  uniform float uFadeAlpha;
  uniform float uDistortAmplitude;
  uniform float uDistortFrequency;
  uniform float uDistortSpeed;
  uniform float uDistortRotation;
  uniform float uDistortTurbulance;
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  void main() {
    // 纹理数据 row0=顶部（flipY=false）→ vUv 左下原点，翻转 v
    vec2 texUV = (vec2(vUv.x, 1.0 - vUv.y) * uFrameSize - uBbox.xy) / uBbox.zw;
    // ★ 呼吸式扭曲（特效包每帧参数；标准实现：旋转 → 正弦偏移 → 反向旋转）
    if (uDistortEnabled > 0.5) {
      float time = uTime;
      float cosDR = cos(uDistortRotation);
      float sinDR = sin(uDistortRotation);
      vec2 dUv = texUV - 0.5;
      vec2 rotUv = vec2(
        dUv.x * cosDR - dUv.y * sinDR,
        dUv.x * sinDR + dUv.y * cosDR
      );
      rotUv += 0.5;
      float amplitude = uDistortAmplitude * (0.5 + 0.5 * sin(time * 0.4));
      float frequency = uDistortFrequency;
      float phase = time * uDistortSpeed + 0.5 * sin(time * 0.3);
      float offsetX = amplitude * sin(frequency * rotUv.y + phase);
      rotUv.x += offsetX;
      float secondaryAmp = amplitude * 0.3;
      float secondaryFreq = frequency * 1.8;
      float secondaryPhase = time * 2.5;
      rotUv.x += secondaryAmp * sin(secondaryFreq * rotUv.y + secondaryPhase);
      // ★ 湍流（值噪声流动）：波形之上的乱向扭曲，uDistortTurbulance 控制强度
      if (uDistortTurbulance > 0.001) {
        float turbAmp = amplitude * 0.7 * uDistortTurbulance;
        float tf = frequency * 1.3;
        rotUv.x += (vnoise(rotUv * tf + vec2(0.0, time * 0.7)) - 0.5) * 2.0 * turbAmp;
        rotUv.y += (vnoise(rotUv * tf + vec2(7.3, time * 0.5)) - 0.5) * 2.0 * turbAmp * 0.8;
      }
      vec2 backUv = rotUv - 0.5;
      texUV = vec2(
        backUv.x * cosDR + backUv.y * sinDR,
        -backUv.x * sinDR + backUv.y * cosDR
      );
      texUV += 0.5;
    }
    if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) {
      discard;
    }
    if (uUseFluid > 0.5) {
      vec4 fluid = texture2D(uFluidTex, texUV);
      // ★ 魂体模式（uFluidClip=1，祖宗等）：流体 alpha 裁到基础色轮廓——
      //   背景不参与混合、不写深度（不挡水/子弹）；默认关（受击染料要能溢出体外）
      float fa = fluid.a;
      if (uFluidClip > 0.5) {
        vec4 baseForClip = texture2D(uBaseTexture, texUV);
        fa = min(fa, baseForClip.a);
      }
      // ★ 全透明背景 discard（不写深度 → 水可透过贴片透明背景显示）：
      //   残差流动痕迹是渐变 alpha（>0.02），不受影响——仅在 alpha≈0 的
      //   纯背景处丢弃，保留"残差平流到基础色=0 区域"的流动表现。
      if (fa < 0.02) discard;
      gl_FragColor = vec4(fluid.rgb, fa);
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
    gl_FragColor = vec4(hsl2rgb(finalH, finalS, finalL), base.a * uFadeAlpha);
  }
`;

export class FTXQuad extends FxRendererBase {
  protected material: THREE.ShaderMaterial;
  private _frameSize = new THREE.Vector2(512, 512);
  private _bbox = new THREE.Vector4(0, 0, 512, 512);
  /** 纹理宽高比（h/w，非正方形纹理保持比例用） */
  private _texAspect = 1;
  /** ★ 贴片底部锚点（脚踩地面）：setPosition 时 y 自动 + 贴片半高 */
  private anchorBottom = true;
  /** ★ 底部锚点抬升覆写（世界单位；null = 默认 baseScale.y/2；载具躺乘压低中心用） */
  private anchorLift: number | null = null;
  /** ★ 平面内整体滚转（弧度；绕贴片法线，相机面内躺倒用） */
  private rollRad = 0;
  /** ★ 按纹理宽高比设置 quad 缩放（避免竖长/横长纹理被压扁） */
  setScaleKeepAspect(baseSize: number): void {
    this.setScale(baseSize, baseSize * this._texAspect);
  }

  /** ★ 覆写 setPosition：底部锚点 → y 自动抬升贴片半高（脚踩地面，不在地底） */
  override setPosition(x: number, y: number, z = 0): void {
    const halfH = this.anchorBottom ? (this.anchorLift ?? Math.abs(this.baseScale.y) / 2) : 0;
    super.setPosition(x, y + halfH, z);
  }

  /** 切换底部锚点（默认 true：脚踩地面） */
  setAnchorBottom(v: boolean): void {
    this.anchorBottom = v;
  }

  /** ★ 覆写底部锚点抬升量（世界单位；null = 还原默认半高） */
  setAnchorLift(v: number | null): void {
    this.anchorLift = v;
  }

  /** ★ 平面内滚转（弧度；setBillboard 时绕贴片法线应用；0 = 还原站立） */
  setRoll(rad: number): void {
    this.rollRad = rad;
  }

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
        /** ★ 魂体模式：流体 alpha 裁到基础色轮廓（祖宗等；默认 0） */
        uFluidClip: { value: 0 },
        uFrameSize: { value: this._frameSize },
        uBbox: { value: this._bbox },
        uTime: { value: 0 },
        uDistortEnabled: { value: 0 },
        uFadeAlpha: { value: 1 },
        uDistortAmplitude: { value: 0.06 },
        uDistortFrequency: { value: 5.0 },
        uDistortSpeed: { value: 1.2 },
        uDistortRotation: { value: 0 },
        uDistortTurbulance: { value: 0 },
      },
      transparent: true,
      // ★ 角色贴片写深度（2026-09-07）：水面（透明 pass renderOrder=10）要正确
      //   遮挡——水线上角色盖水、水线下水盖角色——必须以角色像素为深度依据。
      //   原 depthWrite=false 会让水面按"地形深度"测试 → 水整片盖住角色。
      depthWrite: true,
      // ★ depthTest 开启：贴片读深度缓冲 → 被地形（高台/墙）挡住的实体
      //   自动被深度裁剪（地形先渲染写深度，透明贴片后渲染读深度）
      depthTest: true,
      // ★ 深度轻微拉近：贴片与高台立面接近平行/贴边时防 z-fighting 闪动
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
    const geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.set(0, 0, 0);
    // ★ 渲染剔除完全由小地图 2D 视锥（RasterMap.queryFrustum）决定，
    //   关闭 three 3D 视锥兜底（避免双剔除 + O(场景mesh) 遍历）
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  override render(state: { frameIndex: number }, fluidTexture?: THREE.Texture | null): void {
    const pair = this.source.getFramePair(state.frameIndex);
    if (!pair) return;
    const u = this.material.uniforms;
    u.uBaseTexture.value = pair.base;
    u.uResidual.value = pair.residual;
    u.uTime.value = performance.now() / 1000;
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
    // ★ 平面内滚转（躺倒）：绕贴片自身法线（局部 +Z）旋转 → 相机面内旋转
    if (this.rollRad) {
      this.mesh.quaternion.multiply(_rollQ.setFromAxisAngle(_LOCAL_Z, this.rollRad));
    }
    this.applyFlip();
  }

  /** ★ 设置呼吸式扭曲参数（特效包每帧参数；关 = 停用）。
   *   波形分量默认开启；湍流分量 0~1 由 setTurbulance 单独控制（默认 0=关） */
  setDistort(opts: { enabled: boolean; amplitude: number; frequency: number; speed: number; rotation: number }): void {
    const u = this.material.uniforms;
    u.uDistortEnabled.value = opts.enabled ? 1 : 0;
    u.uDistortAmplitude.value = opts.amplitude;
    u.uDistortFrequency.value = opts.frequency;
    u.uDistortSpeed.value = opts.speed;
    u.uDistortRotation.value = opts.rotation;
  }

  /** ★ 单独开关湍流分量（默认 1 = 波形+湍流都开；0 = 仅波形） */
  setTurbulance(mix: number): void {
    this.material.uniforms.uDistortTurbulance.value = Math.max(0, Math.min(1, mix));
  }

  /** ★ 渐隐透明度（0~1；LOD 远距离 → 半透明"看不清"） */
  setFadeAlpha(a: number): void {
    this.material.uniforms.uFadeAlpha.value = Math.max(0, Math.min(1, a));
  }

  /** ★ LOD 响应（基类节流 + 渐隐映射：lod2 → 半透明，lod3 → 全透明；投影随 LOD 门控） */
  override setLodLevel(level: number): void {
    super.setLodLevel(level);
    this.setFadeAlpha(level >= 3 ? 0 : level === 2 ? 0.45 : 1);
  }

  /** ★ 非 billboard 固定朝向：绕 Y 轴旋转（0=朝 +z，π=朝 -z） */
  setYaw(rad: number): void {
    if (!this.mesh) return;
    this.mesh.rotation.y = rad;
    this.applyFlip();
  }

  /** 按资产帧数据更新 bbox 映射（资产加载后调用一次即可；★ 记录纹理宽高比） */
  setFrameMapping(frameSize: { width: number; height: number }, bbox: { x: number; y: number; w: number; h: number }): void {
    this._frameSize.set(frameSize.width, frameSize.height);
    this._bbox.set(bbox.x, bbox.y, bbox.w, bbox.h);
    this._texAspect = frameSize.height / frameSize.width;
    this.material.uniforms.uFrameSize.value.needsUpdate = true;
  }

  /** ★ 魂体模式：流体 alpha 裁到基础色轮廓（祖宗等；默认关——受击染料需可溢出体外） */
  setFluidClipToBase(v: boolean): void {
    this.material.uniforms.uFluidClip.value = v ? 1 : 0;
  }

  /** ★ 深度写入开关（祖宗：透明背景不挡水/子弹；默认 true 保留水面遮挡语义） */
  setDepthWrite(v: boolean): void {
    this.material.depthWrite = v;
    this.material.needsUpdate = true;
  }

  override dispose(): void {
    super.dispose();
  }
}
