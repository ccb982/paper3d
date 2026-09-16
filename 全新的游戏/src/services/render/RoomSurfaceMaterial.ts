// ============================================================
// RoomSurfaceMaterial —— 基地 / 驾驶舱的**程序化房间表面**着色器（2026-09-16 · 极简改版）
// ============================================================
// 用户定调：全面美化基地和驾驶室房间，**不建模**（= 不从网上找 / 导入模型），
//   房间视觉**全部靠 shader + 手搓顶点**（几何见 RoomDecoGeo.ts）。
//
// ★ 2026-09-16 极简改版（对齐经典实现：nalbam/spaceship、achimala/TheLongSilence）：
//   · 表面**不再叠** "随机呼吸发光缝 / 细分网格 / 巡检扫描带" —— 这三层是噪声源，
//     远看整面墙变成蜘蛛网；改为：大板缝（恒定屏幕线宽）+ **每块板独立的明度/色相微抖动**
//     （哑光喷漆钢板的真实观感）+ 竖向渐变 + 墙脚接触压暗。
//   · **发光只保留在功能位**（灯带 / 屏幕 / 交互光圈 / 舷窗），表面一律不发光。
//   · 灯光三层（TheLongSilence 做法）：环境底光（hemi 烘焙）+ 方向光 + 自发光几何。
//
// 材质工厂：
//   · createRoomSurfaceMaterial —— 墙面 / 地板 / 天花板 / 结构件 / 家具 / 货箱
//   · createStripMaterial       —— 灯带 / 灯管（平稳光 + 极淡行波）
//   · createScreenMaterial      —— 屏幕 / 数据屏（低压扫描线 + 缓慢数据块）
//   · createPadMaterial         —— 交互站地面光圈（细环 + 呼吸核心）
//   · createBlobShadowMaterial  —— 家具接触阴影（脚下软圆影，把道具"焊"在地上）
//   · createViewportMaterial    —— 驾驶舱舷窗（星尘 + 星云 + 极光）
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
  /** 主体色（hex；sRGB）—— 上半段（亮色） */
  base: number;
  /** 板间冷暖偏移色（每块板按 hash 往它偏一点点；不是发光色） */
  tint: number;
  /** 板缝色（暗） */
  grout: number;
  /** 大板尺寸（米）；表面唯一的"分格"来源 */
  panel: number;
  /** 每块板的明度随机幅度（0.04~0.10；0 = 完全均质塑料感） */
  jitter: number;
  /** 竖向渐变强度（地面暗 → 视线高度亮；0 = 无渐变） */
  vign: number;
  /** 金属高光强度（哑光舱壁建议 ≤0.3） */
  metal: number;
  /** 整体亮度增益 */
  gain: number;
  /** ★ 双色调：墙裙分界高度（米）；0 = 不启用（全灰单色） */
  bandY: number;
  /** ★ 双色调：墙裙（下段）颜色 —— 与 base 形成高对比的第二色调 */
  band: number;
}

const ROOM_DEFAULTS: RoomSurfaceOpts = {
  base: 0x333a42, tint: 0x9fc4d8, grout: 0x14171b,
  panel: 3.6, jitter: 0.06, vign: 0.55, metal: 0.16, gain: 1.0,
  bandY: 0, band: 0x2b3138,
};

/** 房间标配调色板（由 BaseScene.buildHall 取用；配色改动集中在这里）
 *  ★ 极简色板（2026-09-16 三次定调）：**双色调高对比**才是好看的极简——
 *    · 墙：**亮骨灰（上段） + 深炭（下段墙裙）**，两种色调硬碰硬（经典舱壁做法）；
 *    · 地板 / 天花板走深炭（与墙裙同族），家具介于两者之间，货箱亮一档；
 *    · accent 只出现在功能位（灯带 / 屏幕 / 交互光圈）。 */
export const ROOM_PALETTES: Record<string, Partial<RoomSurfaceOpts>> = {
  /** 地板：深炭灰、金属感最强（与墙裙同族） */
  floor: { base: 0x2a2e33, tint: 0xbfc2c5, grout: 0x101214, panel: 3.6, jitter: 0.05, vign: 0.22, metal: 0.34, gain: 1.0 },
  /** 墙：**上亮下暗**双色调（上段骨灰 / 下段炭黑，分界 y=3.0） */
  wall: { base: 0xacafa8, tint: 0xcac3ba, grout: 0x1e2124, panel: 4.0, jitter: 0.06, vign: 0.34, metal: 0.08, gain: 1.0, bandY: 3.0, band: 0x2b3138 },
  /** 天花板：最暗（几乎不反光） */
  ceil: { base: 0x1a1d21, tint: 0xa9adb2, grout: 0x0b0d0e, panel: 4.0, jitter: 0.05, vign: 0.50, metal: 0.04, gain: 0.95 },
  /** 结构件（梁 / 柱 / 框架 / 踢脚）：深炭骨架 —— 压在亮墙上的暗线 */
  struct: { base: 0x2f353b, tint: 0xc8ab84, grout: 0x111417, panel: 2.4, jitter: 0.04, vign: 0.24, metal: 0.34, gain: 1.0 },
  /** 家具 / 控制台：比墙裙亮一档（在下半区读得出来） */
  furn: { base: 0x363c42, tint: 0xb9c2c8, grout: 0x14171a, panel: 2.0, jitter: 0.05, vign: 0.20, metal: 0.18, gain: 1.0 },
  /** 货箱 / 料桶：最亮一档（在场里一眼可读） */
  crate: { base: 0x5e646a, tint: 0xd8b070, grout: 0x1f2226, panel: 1.6, jitter: 0.08, vign: 0.16, metal: 0.12, gain: 1.0 },
  /** 驾驶舱：暖调双色调（上段暖骨灰 / 下段暖炭黑） */
  cockpit: { base: 0xaba49a, tint: 0xe0b088, grout: 0x1d1d1c, panel: 3.2, jitter: 0.06, vign: 0.34, metal: 0.10, gain: 1.0, bandY: 3.2, band: 0x302b26 },
  /** 驾驶舱地台 / 舷侧走道：深炭（与墙裙同族） */
  cockpitFloor: { base: 0x2a2c2f, tint: 0xdcb086, grout: 0x111316, panel: 3.2, jitter: 0.05, vign: 0.22, metal: 0.30, gain: 1.0 },
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

  uniform vec3  uBase;
  uniform vec3  uTint;
  uniform vec3  uGrout;
  uniform vec3  uBandCol;
  uniform float uBandY;
  uniform float uPanel;
  uniform float uJitter;
  uniform float uVign;
  uniform float uMetal;
  uniform float uGain;
  uniform float uRoomH;

  // ★ 把 BaseScene 的光烘进 shader（线性空间值，与场景里的真实灯同色同强度）
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
    // 平面坐标：按面法线主轴取世界坐标的两个分量（相邻 / 不同尺寸的构件网格连续）
    vec2 sp = (an.y > 0.7) ? vW.xz : ((an.x > 0.7) ? vW.zy : vW.xy);
    bool isFloor = an.y > 0.7;

    // ---- 大板缝（fwidth 恒定屏幕线宽 → 远近一样细）----
    float cell = max(uPanel, 0.25);
    vec2 q = sp / cell;
    vec2 g = abs(fract(q - 0.5) - 0.5);
    vec2 fw = max(fwidth(q), vec2(1e-5));
    vec2 mSeam = clamp(1.0 - g / (fw * 1.7), 0.0, 1.0);
    float seam = max(mSeam.x, mSeam.y);

    // ---- 每块板独立的明度 / 冷暖抖动：哑光喷漆钢板的真实观感（无发光、无动画）----
    vec2 pid = floor(q + 0.5);
    float hj = hash21(pid);
    float ht = hash21(pid + 17.31);
    vec3 base = uBase * (1.0 + (hj - 0.5) * 2.0 * uJitter);
    base *= mix(vec3(1.0), uTint, (ht - 0.5) * 2.0 * 0.14);

    // ---- ★ 双色调墙裙（竖直墙面专用）：y < uBandY → 深色第二色调 ----
    //   两块色以"硬碰硬"的方式交接（高对比），交界处留一条发丝暗缝
    float bandEdge = 0.0;
    if (!isFloor && an.y < 0.7 && uBandY > 0.01) {
      float band = 1.0 - smoothstep(uBandY - 0.04, uBandY + 0.04, vW.y);
      vec3 bandCol = uBandCol * (1.0 + (hj - 0.5) * 2.0 * uJitter);
      bandCol *= mix(vec3(1.0), uTint, (ht - 0.5) * 2.0 * 0.10);
      // 墙裙带内的竖向细分线稍密（板幅减半），让下段像"护墙板"
      base = mix(base, bandCol, band);
      bandEdge = exp(-pow((vW.y - uBandY) * 90.0, 2.0)); // 分界暗缝
    }

    // ---- 竖向渐变：地面最暗、腰间最亮；地板面单独给一个平缓系数 ----
    float up = clamp(vW.y / max(uRoomH, 0.001), 0.0, 1.0);
    float grad = isFloor ? 0.96 : mix(1.0 - uVign * 0.5, 1.04, pow(up, 0.85));
    // 墙脚 / 家具下沿的接触压暗（假 AO；真 AO 走 RoomPostFx 的 GTAO）
    float foot = mix(0.82, 1.0, smoothstep(0.0, 1.7, vW.y));
    if (isFloor) foot = 1.0;
    // 天花板压一点，避免顶部抢视线
    if (n.y < -0.7) grad *= 0.94;

    // ---- 伪光照（hemi + 三方向光；比旧版更平、更少高光，主次交给灯带）----
    float hemiT = 0.5 + 0.5 * n.y;
    vec3 amb = mix(HEMI_GND, HEMI_SKY, hemiT) * 0.82;
    float dKey  = max(dot(n, normalize(vec3(-6.0, 10.0,  8.0))), 0.0);
    float dWarm = max(dot(n, normalize(vec3( 7.0,  4.0,  6.0))), 0.0);
    float dFill = max(dot(n, normalize(vec3( 0.0,  6.0, 18.0))), 0.0);
    vec3 lit = amb
      + KEY_COL  * dKey  * 0.44
      + WARM_COL * dWarm * 0.13
      + FILL_COL * dFill * 0.18;

    vec3 col = base * lit * grad * foot * uGain;

    // 金属高光（Blinn-Phong，很淡：只在掠射角给一点点板面反光）
    if (uMetal > 0.001) {
      vec3 V = normalize(cameraPosition - vW);
      vec3 H = normalize(normalize(vec3(-6.0, 10.0, 8.0)) + V);
      col += HEMI_SKY * pow(max(dot(n, H), 0.0), 42.0) * uMetal * 0.12;
    }

    // ---- 缝：压暗即止（没有任何发光缝）----
    col = mix(col, uGrout * lit, max(seam * 0.72, bandEdge * 0.85));

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
      uBase: { value: new THREE.Color(o.base) },
      uTint: { value: new THREE.Color(o.tint) },
      uGrout: { value: new THREE.Color(o.grout) },
      uBandCol: { value: new THREE.Color(o.band) },
      uBandY: { value: o.bandY },
      uPanel: { value: o.panel },
      uJitter: { value: o.jitter },
      uVign: { value: o.vign },
      uMetal: { value: o.metal },
      uGain: { value: o.gain },
      uRoomH: { value: 12.6 },
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
    float along = mix(vUv.x, vUv.y, uAxis);
    // 极淡的行波高光（振幅从旧的 0.55 降到 0.10：灯管是稳定的，不是霓虹）
    float travel = pow(max(sin(along * 6.2831 - t * uSpeed), 0.0), 12.0) * 0.10;
    // 整体呼吸（0.94~1.0，几乎察觉不到）
    float breathe = 0.97 + 0.03 * sin(t * 0.9 + vW.z * 0.12);
    // 灯管两端微微收暗（不像截断）
    float ends = smoothstep(0.0, 0.08, along) * smoothstep(1.0, 0.92, along);
    vec3 col = uColor * (uBright * breathe * (0.70 + travel) * (0.30 + 0.70 * ends));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** 灯带 / 灯管（稳定光 + 极淡行波；亮度靠 uBright 微调） */
export function createStripMaterial(
  color: number,
  opts: { speed?: number; bright?: number; axis?: 0 | 1 } = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTime,
      uColor: { value: new THREE.Color(color) },
      uSpeed: { value: opts.speed ?? 1.1 },
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
  uniform float uMode;      // 0=数据块 1=数字列（七段数码管） 2=雷达 3=柱状图

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    float t = uTime + uSeed;
    vec2 uv = vUv;

    // 底色：中心亮、四周暗的荧光屏观感
    float vig = smoothstep(1.0, 0.30, length(uv - 0.5) * 1.7);
    vec3 col = uColor * (0.10 + 0.30 * vig);

    // 横向扫描线（很细、很淡）
    float scan = 0.5 + 0.5 * sin(uv.y * 150.0 - t * 3.0);
    col += uColor * scan * 0.035;

    // 顶部一条状态线（视觉锚点，让屏幕一眼像仪表）
    float topLine = smoothstep(0.035, 0.0, abs(uv.y - 0.94));
    col += uColor * topLine * 0.35;

    if (uMode < 0.5) {
      // ---- 0：缓慢滚动的数据列 ----
      vec2 cellId = vec2(floor(uv.x * 13.0), floor(uv.y * 9.0 - t * 0.30));
      float blk = step(0.84, hash21(cellId));
      col += uColor * blk * 0.10;
    } else if (uMode < 1.5) {
      // ---- 1：示波器（三路波形 + 标尺网格 + 扫描头）----
      vec2 gg = abs(fract(uv * vec2(12.0, 6.0)) - 0.5);
      float grid = (1.0 - smoothstep(0.03, 0.06, gg.x)) + (1.0 - smoothstep(0.03, 0.06, gg.y));
      col += uColor * grid * 0.06;
      float axis = 1.0 - smoothstep(0.004, 0.010, abs(uv.y - 0.5));
      col += uColor * axis * 0.14;
      // 三路不同频率 / 相位的信号
      float wave = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float amp = 0.17 - fi * 0.045;
        float yy = 0.5
          + amp * sin((uv.x * (5.0 + fi * 3.0) + t * (0.85 + fi * 0.55)) * 3.1416)
          + amp * 0.45 * sin((uv.x * (13.0 - fi * 4.0) - t * (1.35 + fi * 0.9)) * 3.1416);
        wave += (1.0 - smoothstep(0.005, 0.014, abs(uv.y - yy))) * (0.95 - fi * 0.24);
      }
      col += uColor * wave;
      // 扫描头：从左向右反复扫过一次，带一道窄辉光（示波器的"刷新"感）
      float head = fract(t * 0.16);
      col += uColor * exp(-pow((uv.x - head) * 16.0, 2.0)) * 0.30;
    } else if (uMode < 2.5) {
      // ---- 2：雷达（同心圆 + 旋转扫掠 + 目标点）----
      vec2 p = (uv - 0.5) * vec2(1.0, 1.6);
      float r = length(p);
      float a = atan(p.y, p.x);
      float rings = 0.0;
      for (int i = 1; i <= 3; i++) {
        float rr = float(i) * 0.12;
        rings += 1.0 - smoothstep(0.002, 0.006, abs(r - rr));
      }
      float crosshair = (1.0 - smoothstep(0.002, 0.006, abs(p.x)))
                      + (1.0 - smoothstep(0.002, 0.006, abs(p.y)));
      float sweep = pow(max(sin(a - t * 1.3), 0.0), 14.0) * smoothstep(0.42, 0.0, r);
      col += uColor * (rings * 0.5 + crosshair * 0.25 + sweep * 0.9);
      // 目标点（固定位置 + 扫过时点亮）
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        vec2 tp = (vec2(hash21(vec2(fi, 1.7)), hash21(vec2(fi, 5.3))) - 0.5) * vec2(0.8, 0.8);
        float ta = atan(tp.y, tp.x);
        float ang = mod(a - ta + 6.2831, 6.2831);
        float blip = exp(-pow((length(p - tp)) * 90.0, 2.0)) * (0.25 + 0.75 * step(ang, 0.6));
        col += uColor * blip;
      }
    } else {
      // ---- 3：频谱柱 + 平滑包络线（像均衡器，不再是无意义数字）----
      float barsN = 12.0;
      float ci = floor(uv.x * barsN);
      float f = fract(uv.x * barsN);
      #define BARH(id) (0.12 + 0.78 * abs(fract(sin(t * (0.6 + hash21(vec2(id, 2.2)) * 1.4) + id * 1.7) * 43758.5453)))
      float h0 = BARH(ci);
      float h1 = BARH(ci + 1.0);
      float bar = step(uv.y, h0) * step(f, 0.72);
      col += uColor * bar * 0.26 * smoothstep(0.0, 0.08, uv.y);
      // 包络线（把柱顶连起来）
      float hv = mix(h0, h1, smoothstep(0.0, 1.0, f));
      col += uColor * (1.0 - smoothstep(0.004, 0.012, abs(uv.y - hv))) * 0.55;
      // 峰值保持（一根慢慢下落的横线）
      float peak = 0.55 + 0.42 * abs(sin(t * 0.23 + uSeed));
      col += uColor * (1.0 - smoothstep(0.002, 0.006, abs(uv.y - peak))) * 0.35;
    }

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** 屏幕 / 数据屏。mode：0=滚动数据块 1=数字列（数码管抖动）2=雷达 3=柱状图 */
export function createScreenMaterial(color: number, seed = 0, mode = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTime,
      uColor: { value: new THREE.Color(color) },
      uSeed: { value: seed },
      uMode: { value: mode },
    },
    vertexShader: STRIP_VERT,
    fragmentShader: SCREEN_FRAG,
  });
}

// ------------------------------------------------------------
// 3.5) 管路流光 / 蒸汽 / 全息（可动元素专用）
// ------------------------------------------------------------

const FLOW_FRAG = /* glsl */ `
  varying vec3 vW;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uSpeed;
  uniform float uDots;
  void main() {
    float along = vUv.x;
    // 一列向 +x 移动的光点（管路里的介质流动）
    float ph = along * uDots - uTime * uSpeed;
    float dot0 = pow(max(sin(ph * 3.1416), 0.0), 10.0);
    float ends = smoothstep(0.0, 0.06, along) * smoothstep(1.0, 0.94, along);
    vec3 col = uColor * (0.10 + dot0 * 1.1) * (0.35 + 0.65 * ends);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/** 管路 / 线缆内的流光（沿 uv.x 流动的离散光点） */
export function createFlowMaterial(color: number, opts: { speed?: number; dots?: number } = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTime,
      uColor: { value: new THREE.Color(color) },
      uSpeed: { value: opts.speed ?? 0.55 },
      uDots: { value: opts.dots ?? 4.0 },
    },
    vertexShader: STRIP_VERT,
    fragmentShader: FLOW_FRAG,
  });
}

const STEAM_FRAG = /* glsl */ `
  varying vec3 vW;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uSeed;
  uniform float uRise;
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, amp = 0.5;
    for (int i = 0; i < 4; i++) { s += noise(p) * amp; p *= 2.03; amp *= 0.5; }
    return s;
  }
  void main() {
    // 向上翻滚的汽团：噪声坐标随高度/时间上移
    vec2 q = vec2(vUv.x * 2.2, vUv.y * 2.6 + uTime * uRise + uSeed * 3.7);
    float n = fbm(q);
    // 上下都收口 + 淡出
    float shape = smoothstep(0.05, 0.45, vUv.y) * smoothstep(1.0, 0.35, vUv.y)
                * (1.0 - abs(vUv.x - 0.5) * 1.7);
    float a = smoothstep(0.42, 0.95, n) * shape * 0.42;
    gl_FragColor = vec4(uColor, clamp(a, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

/** 蒸汽 / 热气（竖直面片，向上翻滚的汽团；transparent） */
export function createSteamMaterial(seed = 0, rise = 0.22, color = 0xd8e2ea): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTime,
      uColor: { value: new THREE.Color(color) },
      uSeed: { value: seed },
      uRise: { value: rise },
    },
    vertexShader: STRIP_VERT,
    fragmentShader: STEAM_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

const HOLO_FRAG = /* glsl */ `
  varying vec3 vW;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3  uColor;
  uniform float uSeed;
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }
  void main() {
    // 全息投影：横向扫描线 + 竖向淡出 + 偶发抖动
    float scan = 0.60 + 0.40 * sin(vUv.y * 70.0 - uTime * 4.0);
    float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
    float flick = 0.90 + 0.10 * sin(uTime * 37.0 + uSeed * 9.0) * sin(uTime * 11.0 + uSeed * 3.0);
    float a = scan * fade * flick * 0.85;
    gl_FragColor = vec4(uColor * a, a);
    #include <colorspace_fragment>
  }
`;

/** 全息投影（光柱 / 悬浮图标；transparent + 不写深度） */
export function createHoloMaterial(color: number, seed = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: uTime,
      uColor: { value: new THREE.Color(color) },
      uSeed: { value: seed },
    },
    vertexShader: STRIP_VERT,
    fragmentShader: HOLO_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
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

  void main() {
    float t = uTime;
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;                       // 圆形裁切（不用圆环几何）

    // 一道细外环（恒定细度，不随距离变粗）
    float edge = smoothstep(0.99, 0.955, r) * smoothstep(0.90, 0.935, r);
    // 内圈淡环
    float ring2 = smoothstep(0.78, 0.74, r) * smoothstep(0.66, 0.70, r) * 0.55;
    // 中央核心：呼吸（激活时更亮更实）
    float core = smoothstep(0.16, 0.0, r) * (0.30 + 0.70 * uActive);
    float breathe = 0.86 + 0.14 * sin(t * 1.5 + uSeed * 6.2831);

    float glow = (edge * (0.50 + 0.50 * uActive) + ring2 * (0.35 + 0.65 * uActive) + core) * breathe;

    vec3 col = uColor * glow;
    float alpha = clamp(glow * 0.9, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
  }
`;

/** 交互站地面光圈：细环 + 呼吸核心；transparent + 不写深度 */
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
// 5) 家具接触阴影（把道具"焊"在地面上）
// ------------------------------------------------------------

const SHADOW_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uOpacity;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float a = smoothstep(1.0, 0.10, r);
    a = pow(a, 1.6) * uOpacity;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
    #include <colorspace_fragment>
  }
`;

/** 软圆阴影贴片（铺在家具底部；读 RoomDeco 的 shadow() 摆放） */
export function createBlobShadowMaterial(opacity = 0.42): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: opacity } },
    vertexShader: PAD_VERT,
    fragmentShader: SHADOW_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------
// 6) 驾驶舱舷窗（星空 viewport）
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
    vec3 col = vec3(0.010, 0.017, 0.032) * 1.6;

    // 星云（两层不同流速的 fbm，缓慢漂移；亮度较旧版收敛）
    vec2 q = uv * 3.2 + vec2(t * 0.016, -t * 0.009);
    float neb = fbm(q) * fbm(q * 1.9 + 2.7);
    col += uColor * neb * 0.55;
    col += vec3(0.30, 0.14, 0.48) * pow(neb, 2.4) * 0.55;

    // 星点：稀疏 + 慢闪
    vec2 sc = uv * vec2(38.0, 25.0);
    vec2 si = floor(sc);
    float star = pow(hash21(si), 78.0);
    float tw = 0.70 + 0.30 * sin(t * 1.6 + hash21(si + 1.3) * 30.0);
    col += vec3(0.85, 0.93, 1.0) * star * tw * 2.6;

    // 极光带：一条横向辉光，随时间起伏（很淡）
    float au = exp(-pow((uv.y - 0.40 - 0.05 * sin(uv.x * 3.1 + t * 0.30)) * 8.0, 2.0));
    col += uColor * au * 0.16;

    // 舷窗四周压暗（玻璃边缘的暗渐晕）
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
