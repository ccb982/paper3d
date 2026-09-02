// ============================================================
// TerrainMaterial —— 地形材质（材质分发 + 光照图 + 装饰叠加层）
// ============================================================
// 合成公式（2026-08-27 阶段二定稿）：
//   base = 材质函数(tileId, 世界坐标, 参数)    ← 地块自挂材质（TileMaterials）
//   decal = uAlbedo（装饰叠加层：白底 + 贴图印章；无材质地块保留旧基色）
//   lit  = base × decal × (uAmbientColor×G + uSunColor×R)   ← 光照图（烘焙）
//        + 镜面高光 + 菲涅尔 + 自发光                         ← 表面属性（材质）
//   edge：4×4 地块边界描边（棋盘感；borderLine 标志控制强度）
//
// 输入：
//   uTileIds：15×15 块 id 微纹理（Nearest；每像素 = 站在哪个 4×4 地块上）
//   uMatBaseLCH[id]   = vec4(OKLab色 L,C,H, roughness)   ★ 感知均匀空间（见 colorLab）
//   uMatJitter[id]    = vec4(逐地块抖动幅度 dL,dC,dH, 0)  ★ GPU 化（原 albedo 侧 CPU 抖动移除）
//   uMatSurface[id]   = vec4(specular, fresnel, emissiveStrength, edgeStrength)
//   uMatEmissive[id]  = vec4(emissive rgb)
//   uMatParams[id*16] = 材质图案参数（16 个 float，顺序 = 注册模板声明顺序）
//
// 伪造渲染（2026-08-31 素材填充，OKLab 定稿）：
//   每个地块只声明一个 sRGB-HSL 基色（作者侧），丰富渐变全由 GPU 逐像素产生：
//   base = oklchShade(...) —— 在感知均匀的 OKLab(L,C,H) 里做空间非均匀偏移
//     （shadeField 三尺度 patch/mid/grain + 每地块独立 jitter），收口 OKLab→线性 RGB，
//     喂给 linear 光照管线（ACES 全程 linear，three 末尾 linearToOutputTexel 转 sRGB）。
//   相较旧 HSL 抖动：OKLab 的 L 感知均匀——明暗渐变不再有黄/蓝亮度不均。
//
// 分发：数据驱动——uMatFn[id] 存材质 fnId 的注册索引（见 MAT_FN_INDEX），
//   materialBase 据索引自动路由到对应 mat_<fnId>；加材质 = 注册 GLSL 函数
//   + 在 MAT_FN_INDEX 登记一行，无需手写 id 分支（同地块像素分支一致，GPU 相干）。
//
// 职责边界：
//   - 材质不知道 SunCycle/RenderManager——被动接收 updateTerrainLighting
//   - 阴影/AO 全在烘焙光照图，实时域不重复计算
//   - 装饰纹理独立叠加（uAlbedo），不参与材质定义
// ============================================================

import * as THREE from 'three';

/** 地形光照调参入口。
 *  ★ 光照哲学（定稿）：默认整个地面是暗的，光是把亮度"加上去"的——
 *    环境项只是保底可见度（暗基准），太阳直射项承担主要照明。
 *    这样影子读作「光的缺席」而非「涂上去的黑块」。
 *    锚点：正午平地合成亮度 ≈1.3 进 ACES。 */
export const TERRAIN_LIGHT_TUNING = {
  /** 直射强度基准（乘 SunCycle.intensityScale）——主要照明来源 */
  sunIntensity: 1.15,
  /** 白昼环境色（冷灰蓝）与强度：暗基准，不是照明主力 */
  ambientDay: 0x9aa8c4,
  ambientDayIntensity: 0.32,
  /** 夜晚环境色（深蓝）与强度 */
  ambientNight: 0x2a3552,
  ambientNightIntensity: 0.10,
};

/** 水体侧壁亮度基准（仅水墙路径用：× 0.32 = 深暗水面增益；非水墙增益恒 1.0，
 *  光照采样已与顶面同源——见 WALL_FRAG 2026-09-02 修正）。 */
export const WALL_BRIGHTNESS = 2.9;

/** 侧壁自发光保底强度（夜晚值；× 材质本色直接发光）。
 *  墙面法线水平，上方来光几乎不受直射（N·L≈0）→ 光照公式的直射项对竖直
 *  面天然失效。夜晚用材质本色直接发光保底可见，白天 0（光照充足不需要）。
 *  ★ 0.16 实测仍极黑，拉夸张档（2026-09-01 用户反馈；水体侧壁另有 id 削弱）。 */
export const WALL_EMISSIVE = 0.55;

const registry = new Set<TerrainMaterial>();

/** 材质 uniform 数组尺寸（每 tile id 一槽；上限 = 可注册地块 id 上限）。
 *  ★ 加地块时只要 id < MATERIAL_SLOTS 即"注册即生效"，无需改数组尺寸。
 *    当前留 32 余量；如需更多，同步放大本常数与下方 GLSL 数组尺寸。 */
export const MATERIAL_SLOTS = 32;

/**
 * ★ 材质 fnId → GLSL 函数索引（数据驱动分发，替代原 tile id 硬编码分支）。
 * 加材质 = TileMaterials 注册 + 在此登记一行（GLSL 函数本体另写于 MATERIAL_GLSL）。
 * 索引数值无业务含义，稳定即可。
 */
const MAT_FN_INDEX: Record<string, number> = {
  dirt: 0, brick: 1, grass: 2, wood: 3, rock: 4, moss: 5,
  water: 6, ice: 7, ash: 8, mud: 9, pit: 10, sand: 11,
};

/** TileDef.visual.material.fnId → 材质函数索引（-1 = 无材质） */
export function materialFnIndex(fnId: string | undefined): number {
  return fnId ? (MAT_FN_INDEX[fnId] ?? -1) : -1;
}

/** 由注册表自动生成 GLSL 分发链（fn 索引 → mat_<fnId> 调用） */
const MATERIAL_DISPATCH = Object.entries(MAT_FN_INDEX)
  .map(([fnId, idx]) => `    if (fn == ${idx}) return mat_${fnId}(f, w, id);`)
  .join('\n');

/**
 * 每 chunk 材质渲染配置（ChunkManager 从块数据构建；基色/参数全部打包成数组）
 */
export interface TileRenderConfig {
  /** 15×15 块 id 微纹理（R8，Nearest，flipY=false） */
  tileIds: THREE.DataTexture;
  /** vec4×N：OKLab 基色 (L,C,H) + roughness（★ 感知均匀空间，见 colorLab） */
  base: Float32Array;
  /** vec4×N：逐地块抖动幅度 (dL,dC,dH,0)——GPU 化（原 albedo 侧 CPU 抖动移除） */
  jitter: Float32Array;
  /** vec4×N：specular, fresnel, emissiveStrength, edgeStrength */
  surface: Float32Array;
  /** vec4×N：emissive rgb */
  emissive: Float32Array;
  /** float×N×16：材质图案参数（id*16 + i） */
  params: Float32Array;
  /** float×N：LOD 高台发光强度（0=无；>0=近距离发光） */
  lodEmissive: Float32Array;
  /** int×N：每 tile id 的材质函数索引（uMatFn；-1 = 无材质） */
  fn: Int32Array;
}

export const MATERIAL_GLSL = /* glsl */ `
  // ==================== 材质输入（★ 必须先声明后使用；放函数库最前） ====================
  uniform sampler2D uTileIds;
  uniform vec4 uMatBaseLCH[${MATERIAL_SLOTS}];
  uniform vec4 uMatJitter[${MATERIAL_SLOTS}];
  uniform vec4 uMatSurface[${MATERIAL_SLOTS}];
  uniform vec4 uMatEmissive[${MATERIAL_SLOTS}];
  uniform int uMatFn[${MATERIAL_SLOTS}];
  uniform float uMatParams[${MATERIAL_SLOTS * 16}];
  uniform float uMatLODEmissive[${MATERIAL_SLOTS}];
  uniform float uTime;   // 动画材质时钟（秒；updateTerrainLighting 每帧喂，静态材质不用）

  // ==================== 噪声基座（纯视觉，无需与 JS hash2 对齐） ====================
  float h21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise2(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
               mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm2(vec2 p) {
    return vnoise2(p) * 0.6 + vnoise2(p * 2.3) * 0.3 + vnoise2(p * 5.1) * 0.1;
  }

  // ★ ES 1.00 不允许结构体数组成员——直接用函数读参数
  float matP(int id, int i) { return uMatParams[id * 16 + i]; }

  // ==================== OKLab 伪造渲染库（感知均匀空间，见 colorLab.ts） ====================
  // OKLab(L,a,b) → 线性 RGB。★ 输出 linear——ACES/colorspace_fragment 全在 linear 域。
  vec3 oklab2linear(vec3 lab) {
    float l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    float m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    float s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
    float l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    return vec3(
       4.0767416613 * l - 3.3077115904 * m + 0.2309699287 * s,
      -1.2684380041 * l + 2.6097574007 * m - 0.3413193963 * s,
      -0.0041960865 * l - 0.7034186145 * m + 1.7076147009 * s);
  }

  // 多尺度空间场：大尺度斑块(patch) / 中频渐变(mid) / 高频颗粒(grain)。
  // ★ 大世界坐标先折回原点防 mediump/highp 精度损失。
  const float SHADE_FIELD = 2048.0;
  vec3 shadeField(vec2 w) {
    w = w - floor(w / SHADE_FIELD) * SHADE_FIELD;
    return vec3(
      (fbm2(w * 0.04) - 0.5) * 2.0,
      (fbm2(w * 0.18) - 0.5) * 2.0,
       h21(floor(w * 30.0)) - 0.5);
  }

  // ==================== 材质函数（返回 vec4(dL, dC, dH, reflect)） ====================
  // f = (patch, mid, grain)；w = 世界坐标；id = tile id。
  // xyz 匹配 LCH：(L=明暗, C=饱和度, H=色相)。
  // w = 反光层乘数（1.0=无变化；0.85~1.15 范围，多尺度亮度层次）。

  // 纯泥土地面：大尺度斑驳 + 路辙扫痕（各向异性条痕）+ 圆形石子（暗点+亮边）
  vec4 mat_dirt(vec3 f, vec2 w, int id) {
    float grain = (h21(floor(w * 80.0)) - 0.5) * matP(id, 0) * 1.5;
    float patchv = f.x * matP(id, 3) * 0.5;
    // 路辙扫痕：沿 x 拉伸的条状明暗（各向异性噪声，车辙走向感）
    float ruts = (vnoise2(vec2(w.x * 0.8, w.y * 14.0)) - 0.5) * matP(id, 2) * 0.9;
    // 石子：0.5m 格内稀疏圆点——暗核 + 外圈微亮（立体感），不再是整格变暗
    vec2 pc = floor(w * 2.0);
    vec2 pf = fract(w * 2.0);
    float pseed = h21(pc + vec2(17.7, 3.3));
    vec2 ppos = vec2(0.25 + h21(pc + 1.1) * 0.5, 0.25 + h21(pc + 2.2) * 0.5);
    float pd = length(pf - ppos);
    float hasPeb = step(pseed, matP(id, 1));
    float peb = hasPeb * smoothstep(0.18, 0.06, pd) * -0.08;
    float pebRim = hasPeb * smoothstep(0.10, 0.20, pd) * smoothstep(0.32, 0.20, pd) * 0.03;
    float dL = patchv + ruts + grain + peb + pebRim;
    float dC = f.y * 0.004;
    float reflect = 1.0 + patchv * 0.40 + ruts * 0.20 + grain * 0.10 + peb * 0.6;
    return vec4(dL, dC, 0.0, reflect);
  }

  // 砖石路面：真实错缝砌法（行高固定 + 每行半砖偏移 + 随机微错位）+ 灰缝 + 变体
  vec4 mat_brick(vec3 f, vec2 w, int id) {
    float bw = 0.72, bh = 0.30;                                   // 砖宽/高（米）
    float row = floor(w.y / bh);
    float roff = h21(vec2(row, 1.7)) * 0.9 + mod(row, 2.0) * 0.5; // 每行错位（半砖 + 随机）
    float bx = w.x / bw + roff;
    float col = floor(bx);
    float lx = fract(bx), ly = fract(w.y / bh);
    vec2 bc = vec2(col, row);
    float jit = (h21(bc + vec2(13.1, 0.0)) - 0.5) * matP(id, 1);
    float variant = h21(bc + vec2(29.3, 0.0)) < matP(id, 2) ? 0.05 : 0.0;
    float broken = h21(bc + vec2(41.7, 0.0)) < matP(id, 3) ? -0.09 : 0.0;
    // 灰缝：砖右缘 + 上缘，缝缘柔化（不生硬）
    float gw = matP(id, 0);
    float groutX = smoothstep(1.0 - gw, 1.0 - gw * 0.4, lx);
    float groutY = smoothstep(1.0 - gw, 1.0 - gw * 0.4, ly);
    float grout = max(groutX, groutY) * -0.30;
    float dL = jit + variant + broken + grout + f.y * 0.04;
    float dH = variant * 0.4;                                     // 变体砖色相微偏黄
    float reflect = 1.0 + jit * 0.30 + grout * 0.25 + f.y * 0.25 + broken * 0.4;
    return vec4(dL, f.y * 0.003, dH, reflect);
  }

  // 草地路面：大尺度明暗斑块 + 草簇明暗对 + 枯草斑（色相偏黄）+ 草叶中频
  vec4 mat_grass(vec3 f, vec2 w, int id) {
    float patchv = f.x * matP(id, 0) * 0.6;
    float grain = f.z * matP(id, 3) * 1.5;
    // 草簇密度网格（tuftScale 驱动网格频率）
    float ts = 1.0 / max(matP(id, 2) * 7.0, 0.25);
    vec2 c = floor(w * ts);
    float tuftDark = h21(c + vec2(51.1, 0.0)) < matP(id, 1) ? -0.07 : 0.0;
    float tuftHi = h21(c * 1.7 + vec2(9.9, 1.1)) < matP(id, 1) * 0.7 ? 0.05 : 0.0;
    float blade = f.y * 0.06;
    // 枯草斑：大尺度低频阈值 → 色相偏黄 + 降饱和
    float dry = smoothstep(0.60, 0.85, fbm2(w * 0.13 + 77.0)) * 0.5;
    float dL = patchv + grain + tuftDark + tuftHi + blade;
    float dC = patchv * 0.2 + f.y * 0.006 - dry * 0.03;
    float dH = dry * 0.03;
    float reflect = 1.0 + patchv * 0.40 + (tuftHi - tuftDark) * 0.20 + blade * 0.10 - dry * 0.10;
    return vec4(dL, dC, dH, reflect);
  }

  // 木板路面：横板条（板宽参数化）+ 板缝 + 端缝错位 + 方向性木纹（沿板拉伸）+ 钉点
  vec4 mat_wood(vec3 f, vec2 w, int id) {
    float pw = max(matP(id, 0), 0.15);                // 板宽（米）
    float row = floor(w.y / pw);
    float ry = fract(w.y / pw);
    // 端缝错位：每行端缝位置随机偏移（seamJitter 控制幅度）
    float seamOff = h21(vec2(row, 3.3)) * matP(id, 1) * 8.0;
    float seamX = abs(fract(w.x * 0.5 + seamOff) - 0.5);
    float endSeam = smoothstep(0.020, 0.008, seamX) * -0.22;
    float seam = (ry < 0.035 || ry > 0.965) ? -0.30 : 0.0;
    float jit = (h21(vec2(row, 7.7)) - 0.5) * matP(id, 2);
    // 木纹：沿板方向（x）拉伸的双频噪声（粗纹 + 细纹）
    float grain = (vnoise2(vec2(w.x * 2.5, w.y * 60.0)) - 0.5) * matP(id, 3) * 0.8
                + (vnoise2(vec2(w.x * 0.7, w.y * 22.0)) - 0.5) * matP(id, 3) * 0.5;
    // 钉点：格内稀疏圆点
    vec2 c = floor(w / 1.2);
    float nail = 0.0;
    if (h21(c + vec2(88.3, 4.4)) < matP(id, 4)) {
      vec2 l = fract(w / 1.2) - 0.5;
      if (dot(l, l) < 0.004) nail = -0.30;
    }
    float dL = seam + endSeam + jit + grain + nail;
    float dH = (h21(vec2(row, 7.7)) - 0.5) * 0.03;
    float reflect = 1.0 + jit * 0.30 + grain * 0.16 + (seam + endSeam) * 0.08;
    return vec4(dL, f.y * 0.004, dH, reflect);
  }

  // 岩石：水平分层岩理（带状 + 扰动）+ 方向拉丝 + ridged 线状裂纹（不再是方格暗块）
  vec4 mat_rock(vec3 f, vec2 w, int id) {
    float band = sin(w.y * 4.2 + fbm2(w * 0.5) * 3.0);
    float strata = band * matP(id, 0) * 0.35;
    float streak = (vnoise2(vec2(w.x * 0.3, w.y * 0.05)) - 0.5) * matP(id, 1) * 0.5;
    float rn = fbm2(w * 1.3 + 27.0);
    float crackLine = 1.0 - abs(rn * 2.0 - 1.0);
    float crack = smoothstep(1.0 - matP(id, 2) * 0.4, 1.0, crackLine) * -0.12;
    // ★ 微凹凸：grain 只加亮（不产生黑板颗粒）
    float bump = max(f.z, 0.0) * matP(id, 3) * 0.6;
    float dL = strata + streak + crack + bump;
    float reflect = 1.0 + strata * 0.25 + streak * 0.20 + bump * 0.10 + crack * 0.5;
    return vec4(dL, f.y * 0.002, 0.0, reflect);
  }

  // 苔藓：多尺度苔斑覆盖（大斑块 + 中频破碎边缘）+ 绒毛边 + 滴水痕 + 石底颗粒
  vec4 mat_moss(vec3 f, vec2 w, int id) {
    float covIn = f.x * 0.5 + 0.5 + f.y * 0.22;
    float cover = smoothstep(matP(id, 0), matP(id, 0) + max(matP(id, 1), 0.02) + 0.10, covIn);
    float edgeBand = smoothstep(0.0, 0.35, cover) * (1.0 - smoothstep(0.65, 1.0, cover));
    float fuzz = f.z * 0.06 * edgeBand;
    // 滴水痕：沿 y 拉伸的暗条纹
    float drip = (vnoise2(vec2(w.x * 2.0, w.y * 0.25)) - 0.5) * matP(id, 2) * 0.35;
    // 石底颗粒（非苔区）
    float stoneG = (1.0 - cover) * max(f.z, 0.0) * matP(id, 3) * 0.10;
    float dL = -cover * 0.13 + fuzz + drip + stoneG;
    float dC = cover * 0.06;
    float dH = cover * 0.02;                          // 苔区偏绿
    float reflect = 1.0 + cover * 0.35 + fuzz * 0.12 + drip * 0.15;
    return vec4(dL, dC, dH, reflect);
  }

  // 水面：双层流动波纹（uTime 驱动干涉）+ ridged 波峰亮线 + 浅水斑 + 闪粼
  vec4 mat_water(vec3 f, vec2 w, int id) {
    float t = uTime * 0.35;
    float freq = 1.2 + matP(id, 1) * 2.0;
    float n1 = vnoise2(w * freq + vec2(t * 0.7, t * 0.4));
    float n2 = vnoise2(w * freq * 2.3 - vec2(t * 0.5, -t * 0.6));
    float wave = (n1 * 0.65 + n2 * 0.35 - 0.5) * 2.0;             // -1..1
    float dL = wave * matP(id, 0) * 0.10;
    // 波峰细线（ridged 阈值 → 亮边）
    float crest = smoothstep(0.82, 1.0, 1.0 - abs(wave) * 0.9);
    // 浅水斑（大尺度静态，透底感）
    float shallow = smoothstep(0.55, 0.90, fbm2(w * 0.25 + 5.0)) * matP(id, 3);
    // 阳光闪粼：高频点随时间轮换
    float glint = step(0.985, h21(floor(w * 6.0) + floor(t * 3.0))) * matP(id, 2);
    float dC = shallow * -0.02 + crest * 0.01;
    float reflect = 1.0 + wave * 0.18 + crest * 0.50 + shallow * 0.25 + glint * 0.8;
    return vec4(dL + shallow * 0.05 + glint * 0.06, dC, 0.0, reflect);
  }

  // 冰面：ridged 结晶裂纹 + 冰层厚薄渐变 + 霜白斑 + 高频闪晶
  vec4 mat_ice(vec3 f, vec2 w, int id) {
    float rn = fbm2(w * 1.8);
    float crackLine = 1.0 - abs(rn * 2.0 - 1.0);
    float crack = smoothstep(1.0 - matP(id, 0) * 0.35, 1.0, crackLine) * -0.10;
    float depthv = (fbm2(w * 0.35) - 0.5) * matP(id, 3) * 0.5;
    float frost = smoothstep(0.62, 0.85, fbm2(w * 0.5 + 37.0)) * matP(id, 2) * 0.10;
    float shimmer = step(0.992, h21(floor(w * 55.0))) * matP(id, 1) * 0.35;
    float dL = crack + depthv + frost + shimmer;
    float dC = -frost * 0.4;                          // 霜区降饱和
    float reflect = 1.0 + crack * 0.8 + frost * 0.6 + shimmer * 1.2 + depthv * 0.2;
    return vec4(dL, dC, 0.0, reflect);
  }

  // 灰烬地：风积条纹 + 聚堆斑块 + 高频灰粒 + 余烬点（uTime 呼吸闪烁）
  vec4 mat_ash(vec3 f, vec2 w, int id) {
    float drift = (vnoise2(vec2(w.x * 0.25, w.y * 1.1)) - 0.5) * matP(id, 3) * 0.8;
    float clump = f.x * matP(id, 1) * 0.6;
    float grain = (h21(floor(w * 90.0)) - 0.5) * matP(id, 0) * 1.6;
    // 余烬点：稀疏格 + 独立频率/相位的呼吸脉动
    float t = uTime * 0.8;
    vec2 ec = floor(w * 1.6);
    float emberP = h21(ec + vec2(71.3, 13.7));
    float ember = 0.0;
    if (emberP < matP(id, 2)) {
      float pulse = 0.55 + 0.45 * sin(t * (2.0 + h21(ec) * 3.0) + h21(ec + 7.7) * 6.28);
      ember = pulse * 0.22;
    }
    float dL = drift + clump + grain + ember;
    float dC = ember * 0.6;                           // 余烬提饱和
    float dH = ember * 0.04;                          // 色相偏暖
    float reflect = 1.0 + clump * 0.30 + grain * 0.10 + ember * 1.5 + drift * 0.15;
    return vec4(dL, dC, dH, reflect);
  }

  // 泥沼地：低频水洼（暗+强反光）+ ridged 干裂纹 + 湿度渐变 + 泥粒
  vec4 mat_mud(vec3 f, vec2 w, int id) {
    float pn = fbm2(w * 0.45 + 11.0);
    float puddle = smoothstep(1.0 - matP(id, 0), 1.05 - matP(id, 0) * 0.5, pn + 0.5);
    float rn = fbm2(w * 1.1 + 53.0);
    float crackL = smoothstep(0.88, 0.98, 1.0 - abs(rn * 2.0 - 1.0)) * matP(id, 1) * -0.12;
    float wet = f.x * matP(id, 2) * 0.15;
    float grain = (h21(floor(w * 85.0)) - 0.5) * matP(id, 3) * 1.4;
    float dL = -puddle * 0.10 + crackL + wet + grain;
    float dC = puddle * 0.02;
    float reflect = 1.0 + puddle * 0.55 - crackL * 0.4 + wet * 0.3 + grain * 0.08;
    return vec4(dL, dC, 0.0, reflect);
  }

  // 坑洞：径向渐深 + ridged 裂纹（裂纹透警示红光）+ 暗粒
  vec4 mat_pit(vec3 f, vec2 w, int id) {
    vec2 c = fract(w * 0.25) - 0.5;                   // 每 4m 一格的中心渐深
    float r = length(c) * 2.0;
    float depthv = (1.0 - smoothstep(0.0, 1.4, r)) * matP(id, 2) * -0.12;
    float rn = fbm2(w * 0.9 + 91.0);
    float crack = smoothstep(0.86, 0.97, 1.0 - abs(rn * 2.0 - 1.0)) * matP(id, 0) * -0.10;
    float glow = crack * matP(id, 1) * 0.5;           // 裂纹微光（偏红）
    float grain = (h21(floor(w * 80.0)) - 0.5) * matP(id, 3) * 1.2;
    float dL = depthv + crack + grain;
    float dC = glow * 0.05;
    float dH = glow * 0.02;
    float reflect = 1.0 + depthv * 0.5 + glow * 0.8 + grain * 0.1;
    return vec4(dL, dC, dH, reflect);
  }

  // 沙土（1-7 写实风主打）：纯色底 + 高频细沙粒 + 极弱低频起伏。
  // ★ 无斑块/无石子/无扫痕/无裂纹——"粗糙感"只来自细沙粒与微起伏。
  vec4 mat_sand(vec3 f, vec2 w, int id) {
    float grain = (h21(floor(w * 110.0)) - 0.5) * matP(id, 0) * 1.6;
    float und = (vnoise2(w * 0.55) - 0.5) * matP(id, 1) * 0.35;
    float dL = grain + und;
    float reflect = 1.0 + grain * 0.08 + und * 0.15;
    return vec4(dL, 0.0, 0.0, reflect);
  }

  // ==================== 分发（数据驱动：tile→材质.fnId→GLSL 函数） ====================
  // materialShade 返回 vec4(dL, dC, dH, reflect)；无材质 → 零偏移 + reflect=1.0。
  vec4 materialShade(vec3 f, vec2 w, int id) {
    int fn = uMatFn[id];
${MATERIAL_DISPATCH}
    return vec4(0.0, 0.0, 0.0, 1.0);
  }

  // ==================== 收口：基色 + 逐像素偏移 + 反光层 → 线性 RGB ====================
  // 每个像素拿到自己独立的 OKLab 偏移（非整体统一调色）+ 反光层乘数：
  //   materialShade 的尺度渐变 + 每地块 hash 抖动族 + 反光层，叠加在作者侧基色上。
  vec3 oklchShade(vec2 w, int id, vec3 field) {
    vec4 sh = materialShade(field, w, id);                // (dL, dC, dH, reflect)
    vec3 LCH = uMatBaseLCH[id].xyz + sh.xyz
             + uMatJitter[id].xyz * ((h21(floor(w)) - 0.5) * 2.0);  // 每地块独立抖动
    LCH.x = clamp(LCH.x, 0.0, 1.0);                        // L clamp（勿 mod）
    LCH.y = clamp(LCH.y, 0.0, 0.4);                        // C clamp（感知上限）
    LCH.z = fract(LCH.z);                                  // H 唯一可环绕
    vec3 lab = vec3(LCH.x, LCH.y * cos(LCH.z * 6.28318530718),
                           LCH.y * sin(LCH.z * 6.28318530718));
    vec3 base = oklab2linear(lab);                         // → linear 光照管线
    return base * sh.w;                                   // × 反光层乘数（多尺度亮度层次）
  }

  // ==================== 伪 PBR：零额外噪声采样（从 shadeField 衍生） ====================
  // 伪法线：grain 有限差分 → 微阴影/微高光（2次 h21，极轻量）
  vec3 pseudoNormal(vec2 w) {
    float eps = 0.066;  // ~2格（grain 频率30，格宽 0.033m）
    float gC = h21(floor(w * 30.0));
    float gR = h21(floor((w + vec2(eps, 0.0)) * 30.0));
    float gU = h21(floor((w + vec2(0.0, eps)) * 30.0));
    float dhdx = (gR - gC) / eps;
    float dhdz = (gU - gC) / eps;
    return normalize(vec3(-dhdx * 0.4, 1.0, -dhdz * 0.4));
  }
`;

// ==================== 片元主函数（uniform 声明已在 MATERIAL_GLSL 顶部） ====================
const FRAGMENT_MAIN = /* glsl */ `
        uniform sampler2D uAlbedo;
        uniform sampler2D uLightmap;
        uniform vec3 uSunDir;
        uniform vec2 uSunSide;
        uniform float uSunDay;
        uniform vec3 uAmbientColor;
        uniform vec3 uSunColor;
        varying vec2 vUv;
        varying vec2 vWorld;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec3 alb = texture2D(uAlbedo, vUv).rgb;
          vec3 lm = texture2D(uLightmap, vUv).rgb;      // r=直射 / g=AO
          int id = int(texture2D(uTileIds, vUv).r * 255.0 + 0.5);

          // 多尺度空间场 + OKLab 逐像素偏移收口 → 线性 RGB 基色
          // （无材质地块 uMatBaseLCH=白（L1,C0,H0）→ linear(1,1,1) → ×alb 即 alb）
          vec3 field = shadeField(vWorld);
          vec3 base = oklchShade(vWorld, id, field);

          // ★ 4×4 地块边界描边（黑色分界线）：块内 UV 距边 → 向近黑混合
          //   （2026-08-29 二调：band 0.035 = 每块边缘 14cm（相邻合拢 ~28cm 细缝），
          //     强度 0.85 ≈ 全黑；用户要求"更细更黑"）
          vec2 buv = fract(vUv * 15.0);
          float dEdge = min(min(buv.x, 1.0 - buv.x), min(buv.y, 1.0 - buv.y));
          float edge = 1.0 - smoothstep(0.0, 0.010, dEdge);
          base = mix(base, vec3(0.02), edge * uMatSurface[id].w);

          // 伪 AO：大尺度斑块暗谷（patch 负值 = 谷地 = 变暗；0.4~1.0）
          float ao = smoothstep(-0.3, 0.3, field.x) * 0.6 + 0.4;

          vec3 lit = base * alb * (uAmbientColor * lm.g * ao + uSunColor * lm.r);

          // ---- 表面属性（伪 PBR：法线扰动 + 粗糙度调制） ----
          vec3 N = pseudoNormal(vWorld);                   // 微阴影/微高光
          float rough = uMatBaseLCH[id].w + field.z * 0.15;  // 材质基础 + grain 调制
          vec3 V = normalize(cameraPosition - vec3(vWorld.x, 0.0, vWorld.y));
          vec3 L = normalize(uSunDir);
          float spec = uMatSurface[id].x;
          if (spec > 0.001) {
            vec3 H = normalize(L + V);
            float power = mix(48.0, 8.0, rough);          // 粗糙→模糊高光，光滑→锐利
            lit += uSunColor * spec * pow(max(dot(N, H), 0.0), power);
          }
          float fres = uMatSurface[id].y;
          if (fres > 0.001) {
            lit += fres * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.30;
          }
          float emis = uMatSurface[id].z;
          if (emis > 0.001) {
            lit += uMatEmissive[id].rgb * emis * (0.92 + 0.08 * h21(vUv * 512.0));
          }
          // ---- LOD 高台发光（实时渲染层，增强版）----
          //   目标：相机调整（俯瞰/平移/转身）时能明显看到各地块的发光层次变化。
          //   三层调制叠加：
          //     distBand 距离带状呼吸（多个距离环带 → 俯瞰时区块明显分层）
          //     glance   镜头掠射角（侧面掠射更亮）
          //     sunLayer 太阳方位分层（转向太阳侧明显亮起 → 相机转动可见差异）
          float lodE = uMatLODEmissive[id];
          if (lodE > 0.001) {
            float dist  = length(cameraPosition - vec3(vWorld.x, 0.0, vWorld.y));
            vec2 toCam  = cameraPosition.xz - vWorld;
            float toCamL = max(length(toCam), 1e-4);

            // ① 距离带状呼吸：多环带锯齿 → 俯瞰时邻近区域出现明暗环带，移动明显
            //   （chunk=60m/LOD_RANGES=20,40,60 对齐：主带 0/20/40/60 退缩环）
            float ring1 = smoothstep(60.0, 12.0, dist);       // 主发光带（远→近亮起）
            float ring2 = smoothstep(40.0, 28.0, dist) * 0.6; // 次带叠加
            float ring3 = smoothstep(22.0, 14.0, dist) * 0.4; // 近距微带
            float distBand = clamp(ring1 + ring2 + ring3, 0.0, 1.6);

            // ② 掠射增强：降得越多（越俯视）掠射角越大越亮，侧看/俯瞰平台明显
            float zoneX = length(toCam);
            float glance = 0.45 + 0.55 * clamp(zoneX / max(dist, 0.001), 0.0, 1.0);

            // ③ 太阳方位分层（增强）：朝向太阳侧 + 随昼夜加强；转动相机亮面扫过
            float sunLayer = 0.5 + 0.9 * dot(toCam / toCamL, uSunSide) * uSunDay;
            sunLayer = clamp(sunLayer, 0.0, 1.0);

            // ④ 静态空间抖动（地块 id 级）：让相邻平台发光强度不一致，差异可见
            float idJit = 0.75 + 0.5 * h21(floor(vWorld * 0.25));

            // 亮度增强主要反射层：基色 × 强乘数（原 max≈0.025 → 现可达 ~1.0+）
            lit += base * lodE * 18.0 * distBand * glance * sunLayer * idJit;
          }

          gl_FragColor = vec4(lit, 1.0);
          #include <tonemapping_fragment>   // ★ 与全局 ACES 管线对齐（缺了会偏色）
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `;

export class TerrainMaterial extends THREE.ShaderMaterial {
  constructor(albedo: THREE.Texture, lightmap: THREE.Texture, cfg?: TileRenderConfig) {
    super({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uAlbedo: { value: albedo },
        uLightmap: { value: lightmap },
        uTileIds: { value: cfg?.tileIds ?? new THREE.DataTexture(new Uint8Array(225), 15, 15) },
        uMatBaseLCH: { value: cfg?.base ?? new Float32Array(MATERIAL_SLOTS * 4) },
        uMatJitter: { value: cfg?.jitter ?? new Float32Array(MATERIAL_SLOTS * 4) },
        uMatSurface: { value: cfg?.surface ?? new Float32Array(MATERIAL_SLOTS * 4) },
        uMatEmissive: { value: cfg?.emissive ?? new Float32Array(MATERIAL_SLOTS * 4) },
        uMatFn: { value: cfg?.fn ?? new Int32Array(MATERIAL_SLOTS).fill(-1) },
        uMatParams: { value: cfg?.params ?? new Float32Array(MATERIAL_SLOTS * 16) },
        uMatLODEmissive: { value: cfg?.lodEmissive ?? new Float32Array(MATERIAL_SLOTS) },
        uSunDir: { value: new THREE.Vector3(-0.342, 1.0, 0.940).normalize() },
        uSunSide: { value: new THREE.Vector2(-0.342, 0.940).normalize() },
        uSunDay: { value: 1 },
        uTime: { value: 0 },
        uAmbientColor: { value: new THREE.Color(0x9aa8c4).multiplyScalar(TERRAIN_LIGHT_TUNING.ambientDayIntensity) },
        uSunColor: { value: new THREE.Color(0xfff3e0).multiplyScalar(TERRAIN_LIGHT_TUNING.sunIntensity) },
      }),
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec2 vWorld;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);   // ★ fog_vertex 依赖它
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xz;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: MATERIAL_GLSL + FRAGMENT_MAIN,
      fog: true, // ★ 场景有 THREE.Fog——必须参与雾，否则远端地形浮在背景外
    });
    registry.add(this);
  }

  override dispose(): void {
    registry.delete(this);
    super.dispose();
  }
}

// ============================================================
// WallMaterial —— 断崖侧壁（与顶面同款 OKLab 材质纹理 + 同套光照公式）
// ============================================================
// 与 TerrainMaterial 共享 MATERIAL_GLSL（shadeField/材料函数/oklchShade/伪法线），
// 差异：
//   - ★ 光照与顶面完全统一：uAlbedo/uLightmap/uAmbientColor/uSunColor 同一套
//     （侧壁也采样烘焙光图，朝阳/背阳由烘焙的 lm.r 决定，而不是每面方向系数）
//   - 无 LOD 发光/水面描边（墙不需要地表那些）
//   - 地块 id 由墙顶点的"所属地块采样 uv"读 uTileIds（与顶面完全一致的微纹理）
// 效果：侧壁呈现与地面同款 dirt/brick/grass/rock… 逐像素材质纹理，且从任何
// 角度观察光照/明暗与顶面一致（墙 = 顶面的延展，碰撞=所见不变式）。
// ============================================================

/** 每帧昼夜调制注册表（WallMaterial 及 Boss4D 墙材质；updateWallMaterialsLighting 统一喂） */
type WallLightTarget = THREE.ShaderMaterial;
const wallRegistry = new Set<WallLightTarget>();

/** Boss4D 墙材质注册（同享昼夜喂值；材质 dispose 时由 disposeVisual 释放再退注册） */
export function registerWallLightTarget(m: WallLightTarget): void {
  wallRegistry.add(m);
}
export function unregisterWallLightTarget(m: WallLightTarget): void {
  wallRegistry.delete(m);
}

const WALL_VERT = /* glsl */ `
  varying vec2 vUv;      // 地块中心 uv（采样 uTileIds 得所属 tile id）
  varying vec2 vUvC;     // chunk 连续 uv（采样 uAlbedo/uLightmap，与顶面同约定）
  varying vec2 vTex;     // ★ 墙面 2D 纹理坐标（沿墙水平距离 × 绝对高度）
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vUvC = position.xz / 60.0 + 0.5;   // 局部坐标（中心原点）→ chunk 0..1
    vec4 wp = modelMatrix * vec4(position, 1.0);
    // ★ 不能直接用 wp.xz 当纹理坐标：墙面是竖直面，法线水平分量几乎恒定 →
    //   沿墙体内方向 w 不随墙高变化，纹理压成竖条纹（2026-09-01 用户反馈）。
    //   改成墙面自己的切平面坐标：(沿墙水平距离, 墙高)，两方向都随像素变 →
    //   与顶面同款 dirt/brick/grass 等 2D 材质纹理，且沿墙排布规则。
    // ★ 法线必须用世界方向（mat3(modelMatrix)），绝不能乘 normalMatrix——
    //   normalMatrix = 模型视图法线矩阵，随相机转向变化，会把纹理方向带偏
    //   （相机转动 → 侧壁纹理水平漂移，2026-09-01 用户反馈）。地块群仅平移
    //   无旋转，mat3(modelMatrix) 恒等 → 本地法线即世界方向，结果与视角无关。
    vec3 N = normalize(mat3(modelMatrix) * normal);
    vec2 hor = normalize(vec2(N.x, N.z) + 1e-4);
    vec2 along = vec2(-hor.y, hor.x);   // 沿墙水平方向（与法线水平投影正交）
    vTex = vec2(dot(wp.xz, along), wp.y);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WALL_FRAG = /* glsl */ `
  uniform sampler2D uAlbedo;
  uniform sampler2D uLightmap;
  uniform vec3 uAmbientColor;
  uniform vec3 uSunColor;
  uniform float uSunDay;       // 0..1 白昼度（夜晚直射保底开关）
  uniform float uWallEmissive; // 侧壁自发光保底（夜晚 >0；× 材质本色）
  varying vec2 vUv;
  varying vec2 vUvC;
  varying vec2 vTex;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    int id = int(texture2D(uTileIds, vUv).r * 255.0 + 0.5);
    bool isWaterWall = (id == 4);   // ★ 水体侧壁（id 4 = water）独立路径

    // ★ 光照/装饰采样点（2026-09-02 修正"侧壁与顶部颜色不一致"）：
    //   墙面是竖直面，vUvC（xz 投影）塌缩到墙脚线一个点——烘焙光图里墙脚是
    //   AO/阴影深区，整面墙取到"坑底光照"，再靠 2.9 增益拉亮 → 与顶面系统性
    //   色偏。改为非水墙采样 vUv（墙顶所属地块中心，与 uTileIds 同源）——
    //   光照与顶面同源同值，wallGain 回归 1.0，颜色自然一致（墙 = 顶面延展）。
    //   水墙保持墙脚投影 + 低增益（深暗水面观感是专调效果）。
    vec3 alb = texture2D(uAlbedo, isWaterWall ? vUvC : vUv).rgb;
    vec3 lm = texture2D(uLightmap, isWaterWall ? vUvC : vUv).rgb;
    vec3 field = shadeField(vTex);
    vec3 base = oklchShade(vTex, id, field);       // 与顶面逐像素一致的材质纹理

    // ★ 4×4 地块边界描边（与顶面同款：分界线在墙面上延展）
    vec2 buv = fract((isWaterWall ? vUvC : vUv) * 15.0);
    float dEdge = min(min(buv.x, 1.0 - buv.x), min(buv.y, 1.0 - buv.y));
    float edge = 1.0 - smoothstep(0.0, 0.010, dEdge);
    base = mix(base, vec3(0.02), edge * uMatSurface[id].w);

    // 伪 AO：大尺度斑块暗谷（patch 负值 = 谷地 = 变暗；0.4~1.0）
    float ao = smoothstep(-0.3, 0.3, field.x) * 0.6 + 0.4;

    // ★ 夜晚直射保底：墙面是竖直面，法线水平不受直射（N·L≈0）——若所属地块
    //   在烘焙阴影区（lm.r≈0），夜晚整面墙只剩 ambient×ao ≈ 纯黑。
    //   夜晚直射钳到 ≥0.85（月光全开级别，配合 NIGHT_SUN 冷蓝色温 → 月光打墙），
    //   白天按 daylight 平滑回烘焙原值。
    float d = isWaterWall ? lm.r : mix(max(lm.r, 0.85), lm.r, uSunDay);

    // ★ 增益：非水墙 1.0（光照已与顶面同源，不再需要补偿墙脚塌缩）；
    //   水体侧壁压到 32%（无增亮，纯烘焙明暗；专调深暗水面）
    float wallGain = isWaterWall ? ${WALL_BRIGHTNESS.toFixed(2)} * 0.32 : 1.0;
    vec3 lit = base * alb * (uAmbientColor * lm.g * ao + uSunColor * d) * wallGain;

    // ★ 侧壁自发光保底（LOD 发光思路）：竖直面法线不受上方光照（N·L≈0），
    //   光照公式对墙天然偏暗 → 材质本色直接发光，不受 AO/直射遮挡影响
    //   （水体侧壁不参与——见 isWaterWall 独立路径）
    if (!isWaterWall) lit += base * alb * uWallEmissive;

    gl_FragColor = vec4(lit, 1.0);
    #include <tonemapping_fragment>   // ★ 与全局 ACES 管线对齐（顶面同款）
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class WallMaterial extends THREE.ShaderMaterial {
  constructor(
    albedo: THREE.Texture,
    lightmap: THREE.Texture,
    cfg?: TileRenderConfig,
  ) {
    const u = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
      uAlbedo: { value: albedo },
      uLightmap: { value: lightmap },
      // 以下全部来自 / 与 TerrainMaterial 同源（cfg 与顶面每 chunk 同一份）
      uTileIds: { value: cfg?.tileIds ?? new THREE.DataTexture(new Uint8Array(225), 15, 15) },
      uMatBaseLCH: { value: cfg?.base ?? new Float32Array(MATERIAL_SLOTS * 4) },
      uMatJitter: { value: cfg?.jitter ?? new Float32Array(MATERIAL_SLOTS * 4) },
      uMatSurface: { value: cfg?.surface ?? new Float32Array(MATERIAL_SLOTS * 4) },
      uMatEmissive: { value: cfg?.emissive ?? new Float32Array(MATERIAL_SLOTS * 4) },
      uMatFn: { value: cfg?.fn ?? new Int32Array(MATERIAL_SLOTS).fill(-1) },
      uMatParams: { value: cfg?.params ?? new Float32Array(MATERIAL_SLOTS * 16) },
      uMatLODEmissive: { value: cfg?.lodEmissive ?? new Float32Array(MATERIAL_SLOTS) },
      uAmbientColor: { value: new THREE.Color(0x9aa8c4).multiplyScalar(TERRAIN_LIGHT_TUNING.ambientDayIntensity) },
      uSunColor: { value: new THREE.Color(0xfff3e0).multiplyScalar(TERRAIN_LIGHT_TUNING.sunIntensity) },
      uSunDay: { value: 1 },
      uWallEmissive: { value: 0 },
      uTime: { value: 0 },
    });
    super({
      uniforms: u,
      vertexShader: WALL_VERT,
      fragmentShader: MATERIAL_GLSL + WALL_FRAG,
      fog: true,
    });
    wallRegistry.add(this);
  }

  override dispose(): void {
    wallRegistry.delete(this);
    super.dispose();
  }
}

/** 模式退出清空注册表（材质由 disposeVisual 释放；世界 Hot 段统一 reset 重来） */
export function clearWallMaterialRegistry(): void {
  wallRegistry.clear();
}

/**
 * 每帧昼夜调制（RenderManager.follow 调用；所有活跃地形材质统一喂值）。
 * @param sun 太阳状态（renderManager.querySun 同源）
 */
export function updateTerrainLighting(sun: {
  dir: { x: number; y: number; z: number };
  color: number;
  intensityScale: number;
  daylight: number;
}): void {
  const T = TERRAIN_LIGHT_TUNING;
  const ambHex = nightLerpHex(T.ambientNight, T.ambientDay, sun.daylight);
  const ambI = T.ambientNightIntensity +
    (T.ambientDayIntensity - T.ambientNightIntensity) * sun.daylight;
  // ★ 水平太阳方向（实时层：每帧算一次，喂给 LOD 方位分层；避免 per-pixel 重复计算）
  const hxz = Math.hypot(sun.dir.x, sun.dir.z) || 1;
  const sunSide = new THREE.Vector2(sun.dir.x / hxz, sun.dir.z / hxz);
  for (const m of registry) {
    m.uniforms.uAmbientColor.value.setHex(ambHex).multiplyScalar(ambI);
    m.uniforms.uSunColor.value.setHex(sun.color).multiplyScalar(T.sunIntensity * sun.intensityScale);
    m.uniforms.uSunDir.value.set(sun.dir.x, sun.dir.y, sun.dir.z);
    m.uniforms.uSunSide.value.copy(sunSide);
    m.uniforms.uSunDay.value = sun.daylight;
    // ★ 动画材质时钟（水波/余烬闪烁；静态材质不读它，仅 uniform 更新零成本）
    if (m.uniforms.uTime) m.uniforms.uTime.value = performance.now() * 0.001;
  }
}

/**
 * 每帧昼夜调制（RenderManager.follow 调用；侧壁 WallMaterial 统一喂值）。
 * ★ 与顶面完全相同的光照（2026-09-01）：侧壁重新采样烘焙光图 uLightmap，
 *   朝阳/背阳由烘焙的 lm.r 决定——不再有每面方向系数，任何角度看一致。
 *   这里只喂与顶面同源的 uAmbientColor/uSunColor（昼夜色温/强度）。
 */
export function updateWallMaterialsLighting(sun: {
  color: number;
  intensityScale: number;
  daylight: number;
  dir: { x: number; y: number; z: number };
}): void {
  const T = TERRAIN_LIGHT_TUNING;
  const ambHex = nightLerpHex(T.ambientNight, T.ambientDay, sun.daylight);
  const ambI = T.ambientNightIntensity +
    (T.ambientDayIntensity - T.ambientNightIntensity) * sun.daylight;
  for (const m of wallRegistry) {
    m.uniforms.uAmbientColor.value.setHex(ambHex).multiplyScalar(ambI);
    m.uniforms.uSunColor.value.setHex(sun.color).multiplyScalar(T.sunIntensity * sun.intensityScale);
    // ★ 夜晚直射保底开关（WALL_FRAG 用；Boss4D 墙材质无此 uniform，跳过）
    if (m.uniforms.uSunDay) m.uniforms.uSunDay.value = sun.daylight;
    // ★ 侧壁自发光保底：墙面法线水平，上方来光几乎不受直射 → 夜晚用
    //   材质本色直接发光（白天 0，随 daylight 平滑淡入）
    if (m.uniforms.uWallEmissive) {
      m.uniforms.uWallEmissive.value = (1 - sun.daylight) * WALL_EMISSIVE;
    }
    // ★ 动画材质时钟（守卫式——Boss4D 墙材质无此 uniform 时跳过）
    if (m.uniforms.uTime) m.uniforms.uTime.value = performance.now() * 0.001;
  }
}

/** hex 颜色线性插值 */
function nightLerpHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(ar + (br - ar) * t) << 16) |
         (Math.round(ag + (bg - ag) * t) << 8) |
          Math.round(ab + (bb - ab) * t);
}