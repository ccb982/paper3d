// ============================================================
// SkyDome —— 天空穹顶 + 太阳/月亮圆盘（实时渲染域，归 RenderManager 协调）
// ============================================================
// 设计哲学：与实体/地形渲染分离的"环境层"，永远在战斗场景最底层（renderOrder 最前）。
//   - 天空穹顶：大半径半球，片元着色器按世界方向在【地平线色 ↔ 天顶色】间做竖直渐变
//   - 太阳圆盘：位于太阳方向的带光晕亮圆，只在白昼可见
//   - 月亮贴图：位于月亮方向的方形 quad（特效播放器渲染的大猫哥月亮），只在夜晚可见
//
// 归属：RenderManager.setup() 创建并挂到 scene；RenderManager.follow() 每帧刷新
//   位置（锚定跟随目标/相机的水平位置）+ 颜色（读 SunCycle.skyGradient / 方向）。
//   ⚠️ 本组件不开雾（fog:false）且 depthWrite:false → 穹顶远处于雾区之外也保持清晰，
//   地形在远雾处融进【地平线色】恰好与穹顶底部衔接，形成完整天际。
// ============================================================

import * as THREE from 'three';
import type { MoonSample, SkyGradient, SunSample } from './SunCycle';
import type { MoonEffect } from '../../vendor/player/MoonEffect';

/** 穹顶半径（应大于相机 far 的近半，确保永远不被裁剪前景遮挡） */
const DOME_RADIUS = 320;
/** 太阳/月亮圆盘离地距离（沿各自方向） */
const DISC_DISTANCE = 300;
/** 太阳视直径（度 → 世界单位，配合透视相机近似） */
const SUN_RADIUS = 26;
const MOON_RADIUS = 18;

const SKY_VERT = /* glsl */ `
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldDir = normalize(wp.xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vWorldDir;
  uniform vec3 uHorizonColor;
  uniform vec3 uZenithColor;
  uniform sampler2D uCloudPrevTex;
  uniform sampler2D uCloudCurTex;
  uniform float uCloudBlend;     // 0..1 过渡进度：prev → cur 插值权重
  uniform vec2 uCloudScroll;   // 云纹理水平滚动偏移（循环）
  uniform float uCloudDay;     // 云可见度（白天 1，夜晚 0）

  // ★ HSL → RGB（h:0..1，s:0..1，l:0..1）
  vec3 hsl2rgb(vec3 hsl) {
    vec3 rgb = clamp(abs(mod(hsl.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return hsl.z + hsl.y * (rgb - 0.5) * (1.0 - abs(2.0 * hsl.z - 1.0));
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    // 竖直渐变：用 world dir 的 y（世界竖直分量）在 地平线色 ↔ 天顶色 间混合
    float v = dir.y;
    float hz = smoothstep(0.05, 0.85, v);   // 底部→顶部
    vec3 col = mix(uHorizonColor, uZenithColor, hz);

    // ---- 云层：极坐标圆盘映射，纹理中心 (0.5,0.5) 正对天顶 ----
    //   方位角 phi → 环向，距天顶角 theta → 径向 r（0=天顶，1=地平线）。
    //   云从中心向四周铺开，纹理四条边落在天空边界（地平线处），
    //   天空内部不再出现接缝/断层；断层只在地平线由 smoothstep 淡出。
    float phi = atan(dir.x, dir.z);                       // 方位角 [-PI, PI]
    float theta = acos(clamp(dir.y, 0.0, 1.0));           // 距天顶 [0, π/2]
    float r = min(theta / 1.5707963, 1.0);                // 0 天顶 → 1 地平线
    // 环绕整体旋转（缓慢带动云漂移）
    float ang = phi + uCloudScroll.x;
    float cu = 0.5 + 0.5 * cos(ang) * r;
    float cv = 0.5 - 0.5 * sin(ang) * r;
    vec2 cuv = vec2(cu, cv);
    // 云门控：天顶附近最多，越近地平线（r→1）越淡出 → 无硬边断层
    float cloudV = 1.0 - smoothstep(0.55, 0.85, r);
    // ★ 双缓冲 crossfade：prev(旧帧) → cur(新帧) 按 uCloudBlend 插值，
    //   平滑掉 2 帧/秒结算带来的跳变
    vec4 prevSample = texture2D(uCloudPrevTex, cuv);
    vec4 curSample = texture2D(uCloudCurTex, cuv);
    vec4 cloudSample = mix(prevSample, curSample, clamp(uCloudBlend, 0.0, 1.0));
    float cloudDensity = cloudSample.a * cloudV * uCloudDay;
    // 云色 = 注入的 HSLA（采样得 H/S/L → 转 RGB）。白天注入近白，黄昏注入
    //   暖橙 → 云自然随时间染上晨昏色（CloudSolver 按 hour 调注入色）。
    vec3 cloudCol = hsl2rgb(cloudSample.rgb);   // r=H, g=S, b=L
    // 提亮压白：让云保持蓬松亮白观感，仅保留色相/饱和度偏暖
    cloudCol = mix(vec3(1.0), cloudCol, clamp(cloudSample.g * 3.0, 0.0, 1.0));
    cloudCol *= 0.75 + 0.5 * hz;
    col = mix(col, cloudCol, clamp(cloudDensity, 0.0, 1.0));

    // 地平线下方（v<0）保持地平线色，避免穹顶底缘与地面之间出现空洞感
    gl_FragColor = vec4(col, 1.0);
    // ★ 输出色彩空间：必须与 clearColor 走同一转换管线，
    //   否则穹顶地平线色被 sRGB→线 暗化，与背景色在交界处出现色差
    #include <colorspace_fragment>
  }
`;

const SUN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SUN_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uVisible;   // 0..1 白昼可见度
  uniform float uGlow;      // 光晕强度
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    // 实心圆 + 边缘柔化
    float disc = smoothstep(1.0, 0.92, r);
    // 光晕：从圆缘向外衰减
    float halo = exp(-max(r - 0.85, 0.0) * 8.0) * uGlow;
    vec3 col = uColor * (disc + halo * 0.6);
    col *= uVisible;
    gl_FragColor = vec4(col, uVisible * disc);
  }
`;

const MOON_TEX_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    // 与素材预览同约定：纹理数据 y 向下，这里 v 翻转成向上 → 显示与绘画网页预览一致
    vUv = vec2(uv.x, 1.0 - uv.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ★ 月亮贴图着色器：支持两种模式——
//   1. 旧模式：用 base+residual HSL 解码（通过 setMoonTexture 设置）
//   2. MoonEffect 模式：直接采样特效播放器离屏渲染的 RGB 纹理
//   ★ 表面叠加浅月色（uTint 随夜晚可见度调制，白天不泛白）
const MOON_TEX_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uBase;
  uniform sampler2D uResidual;
  uniform sampler2D uMoonEffectTex;
  uniform float uUseMoonEffect;
  uniform float uVisible;      // 0..1 夜晚可见度
  uniform vec3 uColor;         // 浅月色（表面叠加）
  uniform float uTint;         // 表面浅色叠加强度（0..1）

  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }

  void main() {
    vec4 color;
    if (uUseMoonEffect > 0.5) {
      // ★ MoonEffect 模式：直接采样特效播放器渲染结果
      color = texture2D(uMoonEffectTex, vUv);
    } else {
      // ★ 旧模式：HSL 解码
      vec4 base = texture2D(uBase, vUv);
      if (base.a < 0.5) discard;
      vec4 res = texture2D(uResidual, vUv);
      float dH = (res.r * 2.0 - 1.0) * 0.5;
      float dS = (res.g * 2.0 - 1.0) * 0.5;
      float dL = (res.b * 2.0 - 1.0) * 0.5;
      float h = fract(base.r + dH);
      float s = clamp(base.g + dS, 0.0, 1.0);
      float l = clamp(base.b + dL, 0.0, 1.0);
      color = vec4(hsl2rgb(vec3(h, s, l)), base.a);
    }

    // ★ 表面浅月色叠加：只作用于贴图本体（alpha 内），夜晚更明显
    vec3 col = color.rgb + uColor * (uTint * color.a);
    gl_FragColor = vec4(col, color.a * uVisible);
  }
`;

// ★ 月亮外发光：径向渐变光晕 quad（加法混合，位于月亮 quad 后面/同位置）
const MOON_GLOW_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uIntensity;    // 光晕强度（随夜晚可见度）
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    // 中心强、向外快速衰减；中心会被月亮本体盖住，只露外圈柔光
    float a = pow(smoothstep(1.0, 0.0, r), 2.2) * uIntensity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export class SkyDome {
  private group: THREE.Group;
  private skyMat: THREE.ShaderMaterial;
  private skyMesh: THREE.Mesh;

  private sunMat: THREE.ShaderMaterial;
  private sunMesh: THREE.Mesh;

  /** ★ 月亮贴图（大猫哥月亮 → 特效播放器 HSL 解码管线） */
  private moonTexMat: THREE.ShaderMaterial;
  private moonTexMesh: THREE.Mesh;
  private moonTexReady = false;

  /** ★ 月亮外发光光晕（加法混合径向渐变，位置/朝向与月亮 quad 同步） */
  private moonGlowMat: THREE.ShaderMaterial;
  private moonGlowMesh: THREE.Mesh;

  /** ★ 特效播放器桥接（VAT/扭曲/区域实体渲染） */
  private moonEffect: MoonEffect | null = null;
  /** 主渲染器引用（setup 先于 setMoonEffect 调用，保存此处用于延迟注入） */
  private _renderer: THREE.WebGLRenderer | null = null;

  /** 云纹理滚动偏移（累积；U 水平漂移） */
  private cloudScroll = { x: 0, y: 0 };

  constructor() {
    // ---- 天空穹顶：大半径下半球（只画背面/内侧朝下的球壳，避免 0,0 处自遮挡） ----
    this.emptyCloudTex.needsUpdate = true;
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uHorizonColor: { value: new THREE.Color(0x87ceeb) },
        uZenithColor: { value: new THREE.Color(0x4a90d9) },
        uCloudPrevTex: { value: this.emptyCloudTex },
        uCloudCurTex: { value: this.emptyCloudTex },
        uCloudBlend: { value: 1 },
        uCloudScroll: { value: new THREE.Vector2(0, 0) },
        uCloudDay: { value: 1 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    const domeGeo = new THREE.SphereGeometry(DOME_RADIUS, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    // 只保留半球（顶部到地平线）；底部封口不需要。position.y 为 [0..R] → 全在朝上方向
    this.skyMesh = new THREE.Mesh(domeGeo, this.skyMat);
    this.skyMesh.renderOrder = -100;
    this.skyMesh.frustumCulled = false;

    // ---- 太阳圆盘 ----
    this.sunMat = new THREE.ShaderMaterial({
      vertexShader: SUN_VERT,
      fragmentShader: SUN_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(0xfff3e0) },
        uVisible: { value: 0 },
        uGlow: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,   // 永远在最上层（远景天空不参与深度遮罩）
      fog: false,
    });
    this.sunMesh = new THREE.Mesh(new THREE.CircleGeometry(SUN_RADIUS, 32), this.sunMat);
    this.sunMesh.renderOrder = -90;
    this.sunMesh.frustumCulled = false;

    // ---- ★ 月亮贴图圆盘（大猫哥月亮素材包 HSL 解码；命中前不可见，用空 1×1 纹理兜底）----
    const emptyTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    emptyTex.needsUpdate = true;
    this.moonTexMat = new THREE.ShaderMaterial({
      vertexShader: MOON_TEX_VERT,
      fragmentShader: MOON_TEX_FRAG,
      uniforms: {
        uVisible: { value: 0 },
        uBase: { value: this.emptyCloudTex },
        uResidual: { value: this.emptyCloudTex },
        uMoonEffectTex: { value: emptyTex },
        uUseMoonEffect: { value: 0 },
        uColor: { value: new THREE.Color(0xc8d8f0) },
        uTint: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    // ★ 方形网格：正方形 UV 采样 bbox 区域，把画布非等比特例下被拉成椭圆的
    //   月亮内容重新压回正圆（与绘画网页"画布等比化"等价）。
    this.moonTexMesh = new THREE.Mesh(new THREE.PlaneGeometry(MOON_RADIUS * 2, MOON_RADIUS * 2), this.moonTexMat);
    this.moonTexMesh.renderOrder = -90;
    this.moonTexMesh.frustumCulled = false;
    this.moonTexMesh.visible = false;

    // ---- ★ 月亮外发光光晕（加法混合，quad 比月亮大，中心柔光被月亮盖住）----
    this.moonGlowMat = new THREE.ShaderMaterial({
      vertexShader: MOON_TEX_VERT,
      fragmentShader: MOON_GLOW_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(0xc8d8f0) },
        uIntensity: { value: 0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.moonGlowMesh = new THREE.Mesh(this.moonTexMesh.geometry, this.moonGlowMat);
    this.moonGlowMesh.renderOrder = -91; // 先画光晕再画月亮（加法混合顺序无关，仅整洁）
    this.moonGlowMesh.frustumCulled = false;
    this.moonGlowMesh.visible = false;

    this.group = new THREE.Group();
    this.group.add(this.skyMesh, this.sunMesh, this.moonGlowMesh, this.moonTexMesh);
  }

  /** ★ 注入大猫哥月亮素材包（特效播放器解码出的 base/residual 纹理）。
   *  纹理已是 bbox 裁剪后的月亮本体（bbox 尺寸），方形 quad 完整采样。
   *  传 null 表示没有素材包 → 不显示月亮。
   *  ★ 与 setMoonEffect 互斥：调用后会清空 MoonEffect。 */
  setMoonTexture(
    base: THREE.Texture | null,
    residual: THREE.Texture | null,
  ): void {
    this.moonTexReady = !!(base && residual);
    this.moonEffect = null;
    this.moonTexMesh.visible = this.moonTexReady;
    this.moonGlowMesh.visible = this.moonTexReady;
    if (!this.moonTexReady) return;
    // 纹理 = 月亮本体（bbox 裁剪后），完整采样
    this.moonTexMat.uniforms.uBase.value = base!;
    this.moonTexMat.uniforms.uResidual.value = residual!;
    this.moonTexMat.uniforms.uUseMoonEffect.value = 0;
    // 光晕 quad 比月亮 quad 大 1.6 倍
    this.moonGlowMesh.scale.set(1.6, 1.6, 1);
  }

  /** ★ 设置 MoonEffect 桥接（VAT/扭曲/区域实体动画）。
   *  ★ 与 setMoonTexture 互斥：调用后会清空旧纹理。
   *  ★ 自动注入已保存的主渲染器引用（如果 setup 已先调用）。 */
  setMoonEffect(effect: MoonEffect | null): void {
    this.moonEffect = effect;
    this.moonTexReady = !!effect;
    this.moonTexMesh.visible = this.moonTexReady;
    this.moonGlowMesh.visible = this.moonTexReady;
    if (!effect) {
      this.moonTexMat.uniforms.uUseMoonEffect.value = 0;
      return;
    }
    // ★ 延迟注入渲染器（如果 setup 已经先于 setMoonEffect 调用）
    if (this._renderer) {
      effect.setRenderer(this._renderer);
    }
    this.moonTexMat.uniforms.uMoonEffectTex.value = effect.getMoonTexture();
    this.moonTexMat.uniforms.uUseMoonEffect.value = 1;
    // ★ 按月亮本体宽高比缩放 quad（RT 已裁剪到月亮本体，最长边撑满 MOON_RADIUS*2）
    const cs = effect.getContentScale();
    this.moonTexMesh.scale.set(cs.x, cs.y, 1);
    // ★ 光晕 quad 同比例再放大 1.6 倍，保持与月亮同宽高比（光晕包着月亮）
    this.moonGlowMesh.scale.set(cs.x * 1.6, cs.y * 1.6, 1);
  }

  /** 注入主渲染器（MoonEffect 需要共享主渲染器的 WebGL 上下文）
   *  ★ 在 setup 阶段调用（此时 MoonEffect 可能尚未创建），保存引用用于延迟注入。 */
  setMoonEffectRenderer(renderer: THREE.WebGLRenderer): void {
    this._renderer = renderer;
    this.moonEffect?.setRenderer(renderer);
  }

  /** 挂到场景（RenderManager.setup 调用） */
  attach(scene: THREE.Scene): void {
    scene.add(this.group);
  }

  /** 从场景移除（模式 exit 等场景重装配时调用） */
  detach(scene: THREE.Scene): void {
    scene.remove(this.group);
  }

  /** 环境可见开关：舰船内部隐藏天空穹顶/日月 */
  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  /**
   * 绑定云层双缓冲纹理 + 过渡进度（CloudSolver 每帧喂）。
   * prev→cur 按 blend 插值，平滑 2 帧/秒结算的跳变。
   */
  setCloudTextures(prev: THREE.Texture | null, cur: THREE.Texture | null, blend: number): void {
    (this.skyMat.uniforms.uCloudPrevTex.value as THREE.Texture) = prev ?? this.emptyCloudTex;
    (this.skyMat.uniforms.uCloudCurTex.value as THREE.Texture) = cur ?? this.emptyCloudTex;
    (this.skyMat.uniforms.uCloudBlend.value as number) = blend;
  }

  /** 空云纹理缓存（未启用云时兜底为全透明） */
  private emptyCloudTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);

  /** 更新 MoonEffect VAT 时间（每帧调用） */
  updateMoonEffect(dt: number): void {
    this.moonEffect?.update(dt);
    if (this.moonEffect) {
      this.moonTexMat.uniforms.uMoonEffectTex.value = this.moonEffect.getMoonTexture();
    }
  }

  /**
   * 每帧刷新：锚定到跟随点（水平位置跟随，垂直固定），并按 SunCycle 状态更新
   *   穹顶颜色 + 太阳/月亮位置与可见度。
   * 如果有 MoonEffect（VAT动画），需要在 `update` 前调用 `updateMoonEffect(dt)`。
   */
  update(
    anchor: { x: number; y: number; z: number },
    sun: SunSample,
    moon: MoonSample,
    sky: SkyGradient,
  ): void {
    // ---- 穹顶位置：锚定的水平位置，垂直固定在锚点上（头顶始终罩着天空） ----
    this.group.position.set(anchor.x, anchor.y, anchor.z);

    // ---- 穹顶颜色 ----
    (this.skyMat.uniforms.uHorizonColor.value as THREE.Color).setHex(sky.horizon);
    (this.skyMat.uniforms.uZenithColor.value as THREE.Color).setHex(sky.zenith);

    // ---- 云：白昼可见，夜晚隐没（随 daylight 渐变） ----
    (this.skyMat.uniforms.uCloudDay.value as number) = sun.daylight;

    // ---- 太阳圆盘：沿 sun.dir 放置 + 白昼可见 ~ 仰角 ----
    const sx = anchor.x + sun.dir.x * DISC_DISTANCE;
    const sy = anchor.y + sun.dir.y * DISC_DISTANCE;
    const sz = anchor.z + sun.dir.z * DISC_DISTANCE;
    this.sunMesh.position.set(sx, sy, sz);
    // 让圆盘正对相机（锚点近似相机位置）
    this.sunMesh.lookAt(anchor.x, anchor.y, anchor.z);
    // 可见度：白天可见（daylight 高；低仰角保持可见但有微弱呼吸）
    const sunVisible = sun.daylight;
    this.sunMat.uniforms.uVisible.value = sunVisible;
    this.sunMat.uniforms.uColor.value.setHex(sun.color);
    this.sunMat.uniforms.uGlow.value = 0.4 + 0.6 * sunVisible;

    // ---- ★ 月亮贴图：沿 moon.dir 放置 + 夜晚可见 ----
    const mx = anchor.x + moon.dir.x * DISC_DISTANCE;
    const my = anchor.y + moon.dir.y * DISC_DISTANCE;
    const mz = anchor.z + moon.dir.z * DISC_DISTANCE;
    if (this.moonTexReady) {
      // 可见度 = 夜对应（1 - daylight）× 月亮可见度
      const moonVisible = (1 - sun.daylight) * moon.visibility;
      // ★ 地平线淡出：月亮落到地平线下方彻底隐藏。
      //   否则 depthTest=false 的 quad 落山时仍画在最上层，会盖住同一位置
      //   升起的太阳（日出与月落同时发生在地平线附近）。
      //   dir.y = sin(仰角)，0..1/6（约 0~9.6°）线性淡出。
      const horizFade = THREE.MathUtils.clamp(moon.dir.y * 6.0, 0, 1);
      const vis = moonVisible * horizFade;
      this.moonTexMesh.position.set(mx, my, mz);
      this.moonTexMesh.lookAt(anchor.x, anchor.y, anchor.z);
      this.moonTexMat.uniforms.uVisible.value = vis;
      // ★ 表面浅月色叠加：夜晚微亮（最多 0.28 强度）
      this.moonTexMat.uniforms.uTint.value = vis * 0.28;

      // ★ 外发光：位置/朝向与月亮同步，强度随可见度（满月最亮）
      this.moonGlowMesh.position.set(mx, my, mz);
      this.moonGlowMesh.lookAt(anchor.x, anchor.y, anchor.z);
      this.moonGlowMat.uniforms.uIntensity.value = vis * 0.55;
    }
  }
}
