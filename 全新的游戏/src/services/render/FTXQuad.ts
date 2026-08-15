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
  uniform float uTime;
  uniform float uDistortEnabled;
  uniform float uFadeAlpha;
  uniform float uDistortAmplitude;
  uniform float uDistortFrequency;
  uniform float uDistortSpeed;
  uniform float uDistortRotation;
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
  /** ★ 对齐轴（setAlignToAxis 记录：本地 +y 的世界方向） */
  private _alignAxis = new THREE.Vector3(0, 0, 1);
  /** ★ 弹头锚点偏移量（0 = 居中；>0 = 贴片沿对齐轴回移半长，弹头上端压在碰撞点） */
  private _headAnchorLen = 0;
  /** ★ 交叉第二平面（子弹立体感：绕长轴 90°，任何视角不显纸片） */
  private mesh2: THREE.Mesh | null = null;
  private crossPlane = false;
  private qY90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);

  /** ★ 交叉双平面开关（子弹用）：第二块贴片绕长轴旋转 90°，
   *   与主贴片十字相交 → 体积感，永不出现"竖着的纸片" */
  enableCrossPlane(on: boolean): void {
    this.crossPlane = on;
    this.syncMesh2();
  }

  /** 同步第二平面（位置/缩放/四元数 = 主贴片绕本地 y 再转 90°；可见性跟随） */
  private syncMesh2(): void {
    if (!this.mesh2 || !this.mesh) return;
    this.mesh2.position.copy(this.mesh.position);
    this.mesh2.scale.copy(this.mesh.scale);
    this.mesh2.quaternion.copy(this.mesh.quaternion).multiply(this.qY90);
    this.mesh2.visible = this.crossPlane && this.mesh.visible;
  }

  /** ★ 按纹理宽高比设置 quad 缩放（避免竖长/横长纹理被压扁） */
  setScaleKeepAspect(baseSize: number): void {
    this.setScale(baseSize, baseSize * this._texAspect);
  }

  /** ★ 覆写 setPosition：底部锚点 → y 自动抬升贴片半高（脚踩地面，不在地底）；
   *   弹头锚点 → 贴片沿对齐轴回移半长，使弹头上端（本地 +y = 飞行前方）压在碰撞点 */
  override setPosition(x: number, y: number, z = 0): void {
    if (this._headAnchorLen > 0) {
      // 弹头上端 = mesh.position + axis*len → 平移后压在中心点（碰撞点）
      super.setPosition(
        x - this._headAnchorLen * this._alignAxis.x,
        y - this._headAnchorLen * this._alignAxis.y,
        z - this._headAnchorLen * this._alignAxis.z,
      );
    } else {
      const halfH = this.anchorBottom ? Math.abs(this.baseScale.y) / 2 : 0;
      super.setPosition(x, y + halfH, z);
    }
    this.syncMesh2();
  }

  /** ★ 弹头锚点开关（子弹用）：弹头上端（纹理上端 = 飞行前方）对准碰撞点，
   *   拖尾纯视觉不参与碰撞。偏移量 = 贴片半长，需在 setScale* 之后调用 */
  setHeadAnchored(on: boolean): void {
    this._headAnchorLen = on ? Math.abs(this.baseScale.y) / 2 : 0;
  }

  /** 切换底部锚点（默认 true：脚踩地面） */
  setAnchorBottom(v: boolean): void {
    this.anchorBottom = v;
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
        uFrameSize: { value: this._frameSize },
        uBbox: { value: this._bbox },
        uTime: { value: 0 },
        uDistortEnabled: { value: 0 },
        uFadeAlpha: { value: 1 },
        uDistortAmplitude: { value: 0.06 },
        uDistortFrequency: { value: 5.0 },
        uDistortSpeed: { value: 1.2 },
        uDistortRotation: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
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
    // ★ 交叉第二平面（共享几何/材质；默认隐藏，enableCrossPlane 开启）
    this.mesh2 = new THREE.Mesh(geometry, this.material);
    this.mesh2.frustumCulled = false;
    this.mesh2.visible = false;
    scene.add(this.mesh2);
  }

  /** ★ 可见性（主贴片 + 交叉平面同步；LOD 渐隐同材质自动生效） */
  override setVisible(visible: boolean): void {
    super.setVisible(visible);
    this.syncMesh2();
  }

  protected override applyFlip(): void {
    super.applyFlip();
    this.syncMesh2();
  }

  override dispose(): void {
    if (this.mesh2) {
      this.mesh2.parent?.remove(this.mesh2);
      this.mesh2 = null;
    }
    super.dispose();
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
   * ★ 弹道式朝向（交叉双平面，视角自适应）：
   *   - 长轴（本地 +y，弹头端）精确对齐飞行方向 axis
   *   - 平面1 法线尽量朝相机（viewV 投影 ⊥ 长轴）
   *   - ★ 视角越接近正上方/正下方，双平面绕长轴越转 45°（十字体感）：
   *     俯视时两平面各露半面 → 有厚度；平视（TPS 常规）保持贴脸横拖尾
   *   - 无 NaN 分支，任何角度都可见
   */
  setAlignToAxis(
    axis: { x: number; y: number; z: number },
    camPos: { x: number; y: number; z: number },
    pos: { x: number; y: number; z: number },
  ): void {
    if (!this.mesh) return;
    const v = new THREE.Vector3(axis.x, axis.y, axis.z);
    if (v.lengthSq() < 1e-8) return;
    v.normalize();
    this._alignAxis.copy(v);
    // 视线方向（子弹 → 相机，含俯仰）
    let viewV = new THREE.Vector3(camPos.x - pos.x, camPos.y - pos.y, camPos.z - pos.z);
    if (viewV.lengthSq() < 1e-8) viewV.set(0, 0, -1);
    viewV.normalize();
    // 平面1 法线基准 = 视线投影 ⊥ 长轴（正对长轴时用世界 up 兜底，绝不 NaN）
    let n1 = viewV.clone().addScaledVector(v, -viewV.dot(v));
    if (n1.lengthSq() < 1e-6) {
      n1.set(0, 1, 0).addScaledVector(v, -v.y);
      if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0).addScaledVector(v, -v.x);
    }
    n1.normalize();
    // ★ 自适应交叉角：视线越竖直，双平面越转 45°（俯视有厚度；平视保持贴脸）
    const elev = Math.abs(viewV.y);
    const theta = (Math.PI / 4) * Math.max(0, Math.min(1, (elev - 0.15) / 0.55));
    const n1a = n1.clone().applyAxisAngle(v, theta).normalize();
    const n1b = new THREE.Vector3().crossVectors(v, n1a).normalize();
    this.mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(n1b, v, n1a));
    this.applyFlip(); // 内部同步 mesh2
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
    this.applyFlip(); // 内部同步 mesh2
  }

  /** ★ 设置呼吸式扭曲参数（特效包每帧参数；关 = 停用） */
  setDistort(opts: { enabled: boolean; amplitude: number; frequency: number; speed: number; rotation: number }): void {
    const u = this.material.uniforms;
    u.uDistortEnabled.value = opts.enabled ? 1 : 0;
    u.uDistortAmplitude.value = opts.amplitude;
    u.uDistortFrequency.value = opts.frequency;
    u.uDistortSpeed.value = opts.speed;
    u.uDistortRotation.value = opts.rotation;
  }

  /** ★ 渐隐透明度（0~1；LOD 远距离 → 半透明"看不清"） */
  setFadeAlpha(a: number): void {
    this.material.uniforms.uFadeAlpha.value = Math.max(0, Math.min(1, a));
  }

  /** ★ LOD 响应（基类节流 + 渐隐映射：lod2 → 半透明，lod3 → 全透明） */
  override setLodLevel(level: number): void {
    super.setLodLevel(level);
    this.setFadeAlpha(level >= 3 ? 0 : level === 2 ? 0.45 : 1);
  }

  /** ★ 非 billboard 固定朝向：绕 Y 轴旋转（0=朝 +z，π=朝 -z） */
  setYaw(rad: number): void {
    if (!this.mesh) return;
    this.mesh.rotation.y = rad;
    this.applyFlip(); // 内部同步 mesh2
  }

  /** 按资产帧数据更新 bbox 映射（资产加载后调用一次即可；★ 记录纹理宽高比） */
  setFrameMapping(frameSize: { width: number; height: number }, bbox: { x: number; y: number; w: number; h: number }): void {
    this._frameSize.set(frameSize.width, frameSize.height);
    this._bbox.set(bbox.x, bbox.y, bbox.w, bbox.h);
    this._texAspect = frameSize.height / frameSize.width;
    this.material.uniforms.uFrameSize.value.needsUpdate = true;
  }
}
