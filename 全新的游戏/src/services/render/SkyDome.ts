// ============================================================
// SkyDome —— 天空穹顶 + 太阳/月亮圆盘（实时渲染域，归 RenderManager 协调）
// ============================================================
// 设计哲学：与实体/地形渲染分离的"环境层"，永远在战斗场景最底层（renderOrder 最前）。
//   - 天空穹顶：大半径半球，片元着色器按世界方向在【地平线色 ↔ 天顶色】间做竖直渐变
//   - 太阳圆盘：位于太阳方向的带光晕亮圆，只在白昼可见
//   - 月亮圆盘：位于月亮方向的圆盘（月相用遮罩裁成月牙），只在夜晚可见
//
// 归属：RenderManager.setup() 创建并挂到 scene；RenderManager.follow() 每帧刷新
//   位置（锚定跟随目标/相机的水平位置）+ 颜色（读 SunCycle.skyGradient / 方向）。
//   ⚠️ 本组件不开雾（fog:false）且 depthWrite:false → 穹顶远处于雾区之外也保持清晰，
//   地形在远雾处融进【地平线色】恰好与穹顶底部衔接，形成完整天际。
// ============================================================

import * as THREE from 'three';
import type { MoonSample, SkyGradient, SunSample } from './SunCycle';

/** 穹顶半径（应大于相机 far 的近半，确保永远不被裁剪前景遮挡） */
const DOME_RADIUS = 320;
/** 太阳/月亮圆盘离地距离（沿各自方向） */
const DISC_DISTANCE = 300;
/** 太阳视直径（度 → 世界单位，配合透视相机近似） */
const SUN_RADIUS = 26;
const MOON_RADIUS = 18;
/** 月亮光晕（满月发光，新月不发光）最大强度系数 */
const MOON_GLOW_MAX = 0.85;

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

    // ---- 云层：绕 Y 轴水平角映射 U（循环），竖直条带映射 V ----
    //   云只存在于地平线以上一个高度带内（v ∈ [0.04, 0.9]）
    float angle = atan(dir.x, dir.z);                 // [-PI, PI]
    float u = fract(angle / 6.28318530718 + 0.5 + uCloudScroll.x);
    float cloudV = smoothstep(0.12, 0.28, v) * (1.0 - smoothstep(0.55, 0.85, v));
    // 近地平线云占满水平带，越高越收敛到中心（透视感弱化，简化处理）
    float vv = 0.5 + (v - 0.2) * 0.6;
    vec2 cuv = vec2(u, vv + uCloudScroll.y);
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

const MOON_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uVisible;   // 0..1 夜晚可见度
  uniform float uPhase;     // 0=新月,0.5=满月
  uniform float uGlow;      // 光晕强度
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float disc = smoothstep(1.0, 0.94, r);
    if (disc <= 0.0) discard;

    // 月相：用一个偏移阴影圆盘裁切出月牙。phase 驱动"被遮阴影圆"的偏移量
    //   full moon (phase→0.5) 阴影圆偏移到圆盘之外 → 无阴影，满月全亮
    //   new moon (phase→0)    阴影圆与圆盘重合  → 全被遮，几乎消失
    float shadowOff = mix(0.0, 3.0, uPhase * 2.0);
    vec2 sp = p + vec2(shadowOff, 0.0);        // 阴影圆中心（向右偏移）
    float shadow = smoothstep(1.0, 0.94, length(sp));
    float lit = clamp(disc - shadow, 0.0, 1.0);

    // 光晕：满月强、新月弱
    float halo = exp(-max(r - 0.9, 0.0) * 6.0) * uGlow * uPhase * 2.0;

    vec3 col = uColor * (lit + halo * 0.5);
    float alpha = lit;
    if (alpha <= 0.004 && halo <= 0.004) discard;
    gl_FragColor = vec4(col, alpha * uVisible);
  }
`;

export class SkyDome {
  private group: THREE.Group;
  private skyMat: THREE.ShaderMaterial;
  private skyMesh: THREE.Mesh;

  private sunMat: THREE.ShaderMaterial;
  private sunMesh: THREE.Mesh;
  private moonMat: THREE.ShaderMaterial;
  private moonMesh: THREE.Mesh;

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

    // ---- 月亮圆盘 ----
    this.moonMat = new THREE.ShaderMaterial({
      vertexShader: SUN_VERT,
      fragmentShader: MOON_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(0xc8d8f0) },
        uVisible: { value: 0 },
        uPhase: { value: 0.5 },
        uGlow: { value: 0.5 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.moonMesh = new THREE.Mesh(new THREE.CircleGeometry(MOON_RADIUS, 32), this.moonMat);
    this.moonMesh.renderOrder = -90;
    this.moonMesh.frustumCulled = false;

    this.group = new THREE.Group();
    this.group.add(this.skyMesh, this.sunMesh, this.moonMesh);
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

  /**
   * 每帧刷新：锚定到跟随点（水平位置跟随，垂直固定），并按 SunCycle 状态更新
   *   穹顶颜色 + 太阳/月亮位置与可见度。
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

    // ---- 月亮圆盘：沿 moon.dir 放置 + 夜晚可见（含月相光晕）----
    const mx = anchor.x + moon.dir.x * DISC_DISTANCE;
    const my = anchor.y + moon.dir.y * DISC_DISTANCE;
    const mz = anchor.z + moon.dir.z * DISC_DISTANCE;
    this.moonMesh.position.set(mx, my, mz);
    this.moonMesh.lookAt(anchor.x, anchor.y, anchor.z);
    // 可见度 = 夜对应（1 - daylight）× 月亮可见度/月相
    const nightFactor = 1 - sun.daylight;
    const moonVisible = nightFactor * moon.visibility;
    this.moonMat.uniforms.uVisible.value = moonVisible;
    this.moonMat.uniforms.uPhase.value = moon.phase;
    this.moonMat.uniforms.uColor.value.setHex(moon.color);
    this.moonMat.uniforms.uGlow.value = MOON_GLOW_MAX * moon.phase;
  }
}
