// ============================================================
// RoomSurfaceMaterial —— 基地 / 驾驶舱的**程序化房间表面**着色器（2026-09-16）
// ============================================================
// 用户定调：全面美化基地和驾驶室房间，**不建模**（= 不从网上找 / 导入模型），
//   房间视觉**全部靠 shader + 手搓顶点**（几何见 RoomDecoGeo.ts）。
//
// 这里提供四套材质工厂，全部是 ShaderMaterial（无贴图、无外部资产）：
//   · createRoomSurfaceMaterial —— 墙面 / 地板 / 天花板 / 结构件：程序化面板网格 +
//       随机呼吸发光缝 + 巡检扫描带 + 内置伪光照（把 BaseScene 的四盏灯烘进 shader）
//   · createStripMaterial       —— 灯带 / 灯管：行波光点 + 呼吸
//   · createScreenMaterial      —— 屏幕 / 舷窗内的舷窗数据屏：扫描线 + 滚动数据块
//   · createPadMaterial         —— 交互站地面光圈（放到 ShaderMaterial 上的圆环脉冲）
//   · createViewportMaterial    —— 驾驶舱舷窗：星尘 + 缓慢漂移的星云 + 极光带
//
// ★ 硬性约定（架构文档 §12.6）：自定义 ShaderMaterial 的 frag 末尾必须
//   `#include <colorspace_fragment>`，否则颜色不进 sRGB 输出管线，和其它材质
//   在交界处出现明显色偏。

import * as THREE from 'three';

// ★ 共用时钟：所有实例共享同一个 uniform 对象 → 每帧只更新一处，全部材质生效
const uTime = { value: 0 };

/** 每帧喂时间（BaseScene.update 调用一次即可） */
export function updateRoomTime(t: number): void {
  uTime.value = t;
}

// ------------------------------------------------------------
// 1) 房间表面
// ------------------------------------------------------------

export interface RoomSurfaceOpts {
  /** 主体色（hex；会按 sRGB→线性 转换后再进 shader） */
  base: number;
  /** 发光缝 / 能量 accent（hex） */
  accent: number;
  /** 暗缝色（hex） */
  grout: number;
  /** 大板尺寸（米） */
  panel: number;
  /** 每块大板细分格数 */
  sub: number;
  /** 能量强度（0 = 完全静态的清水混凝土感） */
  energy: number;
  /** 金属高光强度 */
  metal: number;
  /** 整体亮度增益（各 preset 微调用） */
  gain: number;
  /** true = 驾驶舱变体（更快更强的巡检带 + 舱壁滚动数据条） */
  cockpit: boolean;
}

const ROOM_DEFAULTS: RoomSurfaceOpts = {
  base: 0x2b3f4b, accent: 0x8ae0ff, grout: 0x0d151b,
  panel: 3.0, sub: 3, energy: 1.0, metal: 0.35, gain: 1.0, cockpit: false,
};

/** 房间标配调色板（由 BaseScene.buildHall 取用；配色改动集中在这里） */
export const ROOM_PALETTES: Record<string, Partial<RoomSurfaceOpts>> = {
  /** 地板：板幅大、缝宽、高反光（像打过蜡的合金地砖） */
  floor: { base: 0x354751, accent: 0x74d7ff, grout: 0x101a21, panel: 3.0, sub: 3, energy: 0.85, metal: 0.70, gain: 1.02 },
  /** 墙：标准罗德岛舱壁 */
  wall: { base: 0x2b3f4b, accent: 0x8ae0ff, grout: 0x0d151b, panel: 3.0, sub: 3, energy: 1.00, metal: 0.32, gain: 1.00 },
  /** 天花板：暗、几乎不发光 */
  ceil: { base: 0x1d2c37, accent: 0x6fd0ff, grout: 0x0a1218, panel: 3.0, sub: 2, energy: 0.65, metal: 0.20, gain: 0.92 },
  /** 结构件（梁/柱/框架）：板幅小、金属感强、暖橙缝 */
  struct: { base: 0x4a5764, accent: 0xffc978, grout: 0x141c24, panel: 1.5, sub: 1, energy: 0.55, metal: 0.85, gain: 1.05 },
  /** 家具 / 控制台 */
  furn: { base: 0x27343e, accent: 0x86e2ff, grout: 0x0c141a, panel: 1.2, sub: 2, energy: 1.10, metal: 0.55, gain: 1.00 },
  /** 货箱 */
  crate: { base: 0x455260, accent: 0xffd28a, grout: 0x141b22, panel: 1.2, sub: 1, energy: 0.40, metal: 0.55, gain: 1.00 },
  /** 驾驶舱：暖橙 accent + cockpit 变体 */
  cockpit: { base: 0x223742, accent: 0xffb765, grout: 0x0d1419, panel: 2.4, sub: 3, energy: 1.15, metal: 0.50, gain: 1.00, cockpit: true },
  /** 驾驶舱地板（舷侧走道） */
  cockpitFloor: { base: 0x2c4048, accent: 0xffc48a, grout: 0x101920, panel: 2.4, sub: 3, energy: 0.95, metal: 0.70, gain: 1.02, cockpit: true },
} as const satisfies Record<string, Partial<RoomSurfaceOpts>>;

const SURF_VERT = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SURF_FRAG = /* glsl */ `
  varying vec3 vW;
  varying vec3 vN;

  uniform float uTime;
  uniform vec3  uBase;
  uniform vec3  uAccent;
  uniform vec3  uGrout;
  uniform float uPanel;
  uniform float uSub;
  uniform float uEnergy;
  uniform float uMetal;
  uniform float uGain;
  uniform float uRoomH;
  uniform float uCockpit;

  // ★ 把 BaseScene 的四盏灯烘进 shader（线性空间值，已按 sRGB→linear 换算，
  //   与原有的 HemisphereLight / 三盏 DirectionalLight 同色同强度动）
  const vec3 HEMI_SKY = vec3(0.5026, 0.6312, 0.7446); // 0xbcd0e0
  const vec3 HEMI_GND = vec3(0.0232, 0.0356, 0.0513); // 0x2a3540
  const vec3 KEY_COL  = vec3(0.7760, 0.8544, 0.9394); // 0xe4eef8
  const vec3 WARM_COL = vec3(1.0000, 0.6939, 0.3919); // 0xffd9a8
  const vec3 FILL_COL = vec3(0.5773, 0.6867, 0.7913); // 0xc8d8e6

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 n = normalize(vN);
    vec3 an = abs(n);
    // ★ 平面坐标：按面法线主轴取世界坐标的两个分量。
    //   用世界坐标而不是 uv → 相邻 / 不同尺寸的构件在同一平面上网格连续，无错位断层。
    vec2 sp = (an.y > 0.7) ? vW.xz : ((an.x > 0.7) ? vW.zy : vW.xy);
    bool isWallZ = an.z > 0.7;

    float t = uTime;
    float cell = max(uPanel, 0.05);
    vec2 q = sp / cell;

    // ---- 大板干缝（屏幕空间线宽恒定 → 远近都一样细，不会近看糊成一片）----
    vec2 g = abs(fract(q - 0.5) - 0.5);
    vec2 fw = max(fwidth(q), vec2(1e-5));
    vec2 mDark = clamp(1.0 - g / (fw * 2.2), 0.0, 1.0);   // 实体凹缝
    vec2 mGlow = clamp(1.0 - g / (fw * 5.5), 0.0, 1.0);   // 发光晕（比凹缝宽）
    float seamD = max(mDark.x, mDark.y);

    // ★ 随机呼吸发光缝：每根竖缝/横缝各自一个随机数，约 20% 的缝是"活"的，
    //   且各自有独立相位 → 整面墙像有大量独立指示灯在起伏（不是整面墙一起呼吸）
    float colId = floor(sp.x / cell + 0.5);
    float rowId = floor(sp.y / cell + 0.5);
    float litV = step(0.80, hash21(vec2(colId, 7.13)));
    float litH = step(0.80, hash21(vec2(3.71, rowId)));
    float brV  = 0.55 + 0.45 * sin(t * 1.60 + colId * 2.30);
    float brH  = 0.55 + 0.45 * sin(t * 1.35 + rowId * 1.90 + 1.70);
    float glowLine = mGlow.x * litV * brV + mGlow.y * litH * brH;

    // ---- 细分网格（大板内部的次级钣金线，很淡）----
    float subCell = cell / max(uSub, 1.0);
    vec2 qs = sp / subCell;
    vec2 gs = abs(fract(qs - 0.5) - 0.5);
    vec2 fws = max(fwidth(qs), vec2(1e-5));
    vec2 ms = clamp(1.0 - gs / (fws * 1.6), 0.0, 1.0);
    float sub = max(ms.x, ms.y);

    // ---- 巡检扫描带（柔和的一道能量扫过，沿"上方向"走）----
    float scanSpeed = (uCockpit > 0.5) ? 2.10 : 1.25;
    float scanPow   = (uCockpit > 0.5) ? 10.0 : 14.0;
    float scan = pow(max(sin(sp.y * 0.45 - t * scanSpeed), 0.0), scanPow);

    // ---- 驾驶舱变体：舷侧壁加滚动数据条 ----
    float bars = 0.0;
    if (uCockpit > 0.5 && isWallZ) {
      bars = step(0.84, hash21(vec2(
        floor(sp.x / 0.55),
        floor(sp.y * 1.6 - t * 1.6)
      ))) * 0.18;
    }

    // ---- 高度渐变（地板暗、墙腰往上渐亮，给大房间撑出体积感）----
    float up = clamp(vW.y / max(uRoomH, 0.001), 0.0, 1.0);
    vec3 base = uBase * mix(0.52, 1.16, pow(up, 0.75));

    // ---- 伪光照（hemi + 三方向光）----
    float hemiT = 0.5 + 0.5 * n.y;
    vec3 amb = mix(HEMI_GND, HEMI_SKY, hemiT) * 0.55;
    float dKey  = max(dot(n, normalize(vec3(-6.0, 10.0,  8.0))), 0.0);
    float dWarm = max(dot(n, normalize(vec3( 7.0,  4.0,  6.0))), 0.0);
    float dFill = max(dot(n, normalize(vec3( 0.0,  6.0, 18.0))), 0.0);
    vec3 lit = amb
      + KEY_COL  * dKey  * 0.62
      + WARM_COL * dWarm * 0.24
      + FILL_COL * dFill * 0.22;

    vec3 col = base * lit * uGain;

    // 金属高光（Blinn-Phong，非 PBR；房间是哑光合金，够用且便宜）
    if (uMetal > 0.001) {
      vec3 V = normalize(cameraPosition - vW);
      vec3 H = normalize(normalize(vec3(-6.0, 10.0, 8.0)) + V);
      col += HEMI_SKY * pow(max(dot(n, H), 0.0), 42.0) * uMetal * 0.30;
    }

    // ---- 叠加：凹缝压暗 → 发光缝 / 扫描带 / 数据条提亮 ----
    col = mix(col, uGrout, seamD * 0.80);
    col += uAccent * glowLine * uEnergy * 0.55;
    col += uAccent * sub       * uEnergy * 0.07;
    col += uAccent * scan      * uEnergy * 0.24;
    col += uAccent * bars      * uEnergy;

    gl_FragColor = vec4(col, 1.0);
    // ★ 必须：自定义 ShaderMaterial 走 sRGB 输出管线
    #include <colorspace_fragment>
  }
`;

export function createRoomSurfaceMaterial(
  opts: Partial<RoomSurfaceOpts> & { preset?: keyof typeof ROOM_PALETTES } = {},
): THREE.ShaderMaterial {
  const preset = opts.preset ? (ROOM_PALETTES[opts.preset] as Partial<RoomSurfaceOpts>) : {};
  const o: RoomSurfaceOpts = { ...ROOM_DEFAULTS, ...preset, ...opts };
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTime,
      uBase: { value: new THREE.Color(o.base) },
      uAccent: { value: new THREE.Color(o.accent) },
      uGrout: { value: new THREE.Color(o.grout) },
      uPanel: { value: o.panel },
      uSub: { value: o.sub },
      uEnergy: { value: o.energy },
      uMetal: { value: o.metal },
      uGain: { value: o.gain },
      uRoomH: { value: 12.6 },
      uCockpit: { value: o.cockpit ? 1 : 0 },
    },
    vertexShader: SURF_VERT,
    fragmentShader: SURF_FRAG,
  });
}

// ------------------------------------------------------------
// 2) 灯带 / 灯管
// ------------------------------------------------------------

const STRIP_VERT = /* glsl */ `
  varying vec3 vW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const STRIP_FRAG = /* glsl */ `
  varying vec3 vW;
  varying vec2 vUv;
  uniform float uTime;      // ★ 必须显式声明：用了 uTime 却漏声明 → 整个 program 编译失败
  uniform vec3  uColor;
  uniform float uSpeed;
  uniform float uBright;
  uniform float uAxis;      // 0 = 沿 uv.x 行波；1 = 沿 uv.y（竖向挤出的灯柱用）

  void main() {
    float t = uTime;
    // 沿灯管长轴行走的高光
    float along = mix(vUv.x, vUv.y, uAxis);
    float travel = pow(max(sin(along * 6.2831 - t * uSpeed), 0.0), 6.0);
    // 整体呼吸
    float breathe = 0.82 + 0.18 * sin(t * 1.1 + vW.z * 0.15);
    // 灯管两端微微收暗（不像截断）
    float ends = smoothstep(0.0, 0.06, along) * smoothstep(1.0, 0.94, along);
    vec3 col = uColor * (uBright * breathe * (0.75 + 0.55 * travel)) * (0.35 + 0.65 * ends);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** 灯带 / 灯管（自带呼吸 + 行波高光；比死板的 MeshBasicMaterial 活得多） */
export function createStripMaterial(
  color: number,
  opts: { speed?: number; bright?: number; axis?: 0 | 1 } = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTime,
      uColor: { value: new THREE.Color(color) },
      uSpeed: { value: opts.speed ?? 2.2 },
      uBright: { value: opts.bright ?? 1.0 },
      uAxis: { value: opts.axis ?? 0 },
    },
    vertexShader: STRIP_VERT,
    fragmentShader: STRIP_FRAG,
  });
}

// ------------------------------------------------------------
// 3) 屏幕 / 数据屏
// ------------------------------------------------------------

const SCREEN_FRAG = /* glsl */ `
  varying vec3 vW;
  varying vec2 vUv;
  uniform float uTime;      // ★ 见 STRIP_FRAG 注释：漏声明会让整个 program 挂掉
  uniform vec3  uColor;
  uniform float uSeed;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    float t = uTime + uSeed;
    vec2 uv = vUv;

    // 底色：中心亮、边缘暗的荧光屏观感
    float vig = smoothstep(1.0, 0.25, length(uv - 0.5) * 1.6);
    vec3 col = uColor * (0.16 + 0.42 * vig);

    // 横向扫描线
    float scan = 0.5 + 0.5 * sin(uv.y * 190.0 - t * 7.0);
    col += uColor * scan * 0.10;

    // 一条自上而下反复扫过的亮带
    float band = pow(max(sin(uv.y * 3.1416 - t * 1.35), 0.0), 12.0);
    col += uColor * band * 0.35;

    // 随机数据块（网格 quantize 后 hash → 板块状闪烁；像远看的一屏报表）
    vec2 cellId = floor(uv * vec2(11.0, 7.0));
    cellId.y += floor(t * 2.2);
    float blk = step(0.80, hash21(cellId));
    // 每块自己的呼吸相位
    float ph = hash21(cellId + 5.13) * 6.2831;
    col += uColor * blk * (0.22 + 0.22 * sin(t * 3.0 + ph));

    // 偶发整屏闪一下（老式 CRT 的味道，很淡）
    float flick = step(0.985, hash21(vec2(floor(t * 9.0), 3.7))) * 0.25;
    col += uColor * flick;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** 屏幕 / 数据屏（含 quantize 数据块 + 扫描线 + CRT 闪烁） */
export function createScreenMaterial(color: number, seed = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTime,
      uColor: { value: new THREE.Color(color) },
      uSeed: { value: seed },
    },
    vertexShader: STRIP_VERT,
    fragmentShader: SCREEN_FRAG,
  });
}

// ------------------------------------------------------------
// 4) 交互站地面光圈
// ------------------------------------------------------------

const PAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const PAD_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform vec3  uColor;
  uniform float uActive;   // 0/1：角色是否在触发区内（进区 → 光圈收紧变亮）
  uniform float uSeed;

  const float PI2 = 6.2831853;

  void main() {
    float t = uTime;
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;                       // 圆形裁切（不用 [ modeling ] 圆环几何）

    float a = atan(p.y, p.x);

    // 外缘两圈：静态描边 + 慢转的刻度齿
    float edge  = smoothstep(0.94, 0.90, r) * smoothstep(0.72, 0.80, r);
    float ticks = smoothstep(0.55, 0.85, abs(sin(a * 12.0 + t * 0.55)));
    float ring2 = smoothstep(0.62, 0.58, r) * smoothstep(0.44, 0.50, r) * ticks;

    // 向内汇聚的脉冲波（三道等距波，持续往里收）
    float w = fract(r * 1.6 - t * 0.55 + uSeed);
    float wave = pow(1.0 - abs(w * 2.0 - 1.0), 6.0) * 0.55;

    // 中央核心（激活时更亮更实）
    float core = smoothstep(0.30, 0.0, r) * (0.35 + 0.65 * uActive);

    // 激活时整圈背光更实；未激活偏透明，只当"可交互标记"
    float glow =
      edge * (0.55 + 0.45 * uActive)
      + ring2 * (0.45 + 0.55 * uActive)
      + wave * (0.35 + 0.65 * uActive)
      + core;

    // 旋转扫掠亮弧（像雷达）
    float sweep = pow(max(sin(a * 1.0 + t * 1.6), 0.0), 22.0) * smoothstep(0.98, 0.78, r) * 0.55;

    vec3 col = uColor * (glow + sweep);
    float alpha = clamp(glow * 0.95 + sweep * 0.8, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

/** 交互站地面光圈：transparent + 不写深度 + additive-ish（用 normal blending 更可控） */
export function createPadMaterial(color: number, seed = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTime,
      uColor: { value: new THREE.Color(color) },
      uActive: { value: 0 },
      uSeed: { value: seed },
    },
    vertexShader: PAD_VERT,
    fragmentShader: PAD_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------
// 5) 驾驶舱舷窗（星空 viewport）
// ------------------------------------------------------------

const VIEW_FRAG = /* glsl */ `
  varying vec3 vW;
  varying vec2 vUv;
  uniform float uTime;      // ★ 同上
  uniform vec3 uColor;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, amp = 0.5;
    for (int i = 0; i < 5; i++) { s += noise(p) * amp; p *= 2.03; amp *= 0.5; }
    return s;
  }

  void main() {
    float t = uTime;
    vec2 uv = vUv;

    // 深空底
    vec3 col = vec3(0.012, 0.022, 0.042) * 1.6;

    // 星云（两层不同流速的 fbm，缓慢漂移）
    vec2 q = uv * 3.2 + vec2(t * 0.018, -t * 0.010);
    float neb = fbm(q) * fbm(q * 1.9 + 2.7);
    col += uColor * neb * 0.85;
    col += vec3(0.35, 0.15, 0.55) * pow(neb, 2.2) * 0.7;

    // 星点：hash 出离散亮点 + 慢闪
    vec2 sc = uv * vec2(46.0, 30.0);
    vec2 si = floor(sc);
    float star = pow(hash21(si), 62.0);
    float tw = 0.55 + 0.45 * sin(t * 2.1 + hash21(si + 1.3) * 30.0);
    col += vec3(0.85, 0.93, 1.0) * star * tw * 2.4;

    // 极光带：一条横向辉光，随时间起伏
    float au = exp(-pow((uv.y - 0.38 - 0.06 * sin(uv.x * 3.1 + t * 0.35)) * 7.0, 2.0));
    col += uColor * au * 0.30;

    // 舷窗四周压暗（.removeEscape —— 玻璃边缘的暗渐晕）
    float vig = smoothstep(1.05, 0.35, length(uv - 0.5) * 1.65);
    col *= 0.35 + 0.65 * vig;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** 驾驶舱舷窗视野（星尘 + 星云 + 极光；纯 shader，无贴图） */
export function createViewportMaterial(color = 0x7fb6ff): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTime,
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: STRIP_VERT,
    fragmentShader: VIEW_FRAG,
  });
}
