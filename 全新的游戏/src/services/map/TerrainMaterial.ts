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
import { PATCH_DECOR_GLSL } from './PatchDecor';

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
export const WALL_EMISSIVE = 0.15;
// ★ 侧壁夜晚直射保底（2026-09-07 用户：夜间地块侧壁非常亮）——原 0.85
//   月光全开级 + 自发光 0.55 双保险把壁面顶到"接近白天"。降为月光级 0.30，
//   壁面夜晚呈月下暗灰（防纯黑初衷保留，配合自发光 0.15 兜底）。
export const WALL_NIGHT_DIRECT_FLOOR = 0.30;

/** ★ LOD 内实时太阳方向调制（2026-09-05 用户架构决策）：
 *  阴影烘焙一次（静态 BAKE_SUN 方向），近距离实时叠加"方向重映射"——
 *  dirMod = N·L / L.y：平地恒 1（亮度守恒），坡面/侧壁方向感随实时太阳旋转；
 *  距离 NEAR 内全强度、FAR 外平滑淡回纯烘焙（远场保持静态阴影形状）。
 *  clamp 幅度防止背光死黑/顺光过曝（背光轻压 -15%、顺光增强 +20%——
 *  2026-09-05 用户反馈背光太暗后 0.6→0.85，顺光太高后 1.4→1.2）。 */
export const SUN_DIR_LOD_NEAR = 30;
export const SUN_DIR_LOD_FAR = 90;
export const SUN_DIR_MOD_MIN = 0.85;
export const SUN_DIR_MOD_MAX = 1.2;

/** 侧壁白天直射保底（2026-09-05）：墙光 = 所属列烘焙顶光，坡脚/坑谷列在
 *  台影+AO 带内 lm.r≈0.12~0.3，坡面侧壁系统性比断崖墙黑一块（断崖归高处
 *  列 0.745）。竖直墙物理上本就不靠上方直射（N·L≈0），烘焙 lm.r 只当"区域
 *  亮度代理"——白天钳到 ≥0.45，让坡底/影区墙回到可见档，与开墙差距收敛到
 *  ~1.6× 而不失真黑；坑谷真影仍比开阔明些。夜晚保底用 0.85（月光档）不变。 */
export const WALL_DIRECT_DAY_FLOOR = 0.45;

/** 顶面白天直射保底（2026-09-05）：深影列 lm.r≈0.09 时顶面/坡面(WELD/BEVEL
 *  facet 属顶网格)直接塌成纯黑（实测 rock 基色也只剩 0.066 sRGB）。白天钳到
 *  ≥0.28——影区仍读"深阴影"（≈开阔 38%）但不再死黑；夜晚不加保底（夜景靠
 *  环境光分层，见 updateTerrainLighting）。保留阴影可读性哲学（光=缺席而非黑块）。 */
export const TERRAIN_DIRECT_DAY_FLOOR = 0.28;

/** 侧壁装饰纹理增益（2026-09-05 用户：侧壁强度削弱即可，坑底保持满强度）。
 *  墙顶点权重恒 1 → patchDecor 全强度；乘此系数把墙面的碎粒/塌陷斑收敛到
 *  ~一半观感，坑底（k=1）仍最"坑坑洼洼"。 */
export const WALL_DECOR_GAIN = 0.5;

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
  water: 6, ice: 7, ash: 8, mud: 9, pit: 10, sand: 11, cement: 12, pebble: 13,
};

/** TileDef.visual.material.fnId → 材质函数索引（-1 = 无材质） */
export function materialFnIndex(fnId: string | undefined): number {
  return fnId ? (MAT_FN_INDEX[fnId] ?? -1) : -1;
}

/** 顶面（低频已烘 uMatLow）→ 只跑高频层；water/pebble 无低频拆分（全量函数） */
const MATERIAL_HI_DISPATCH = Object.entries(MAT_FN_INDEX)
  .map(([fnId, idx]) =>
    idx === MAT_FN_INDEX.water || idx === MAT_FN_INDEX.pebble
      ? `    if (fn == ${idx}) return mat_${fnId}(vec3(0.0), w, id);`
      : `    if (fn == ${idx}) return mat_${fnId}_hi(fz, w, id);`)
  .join('\n');

/** 侧壁（vTex 坐标空间，低频未烘焙）→ 全量（低频 + 高频） */
const MATERIAL_FULL_DISPATCH = Object.entries(MAT_FN_INDEX)
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

  // ==================== 解析线条抗锯齿 / 距离细节淡出（fwidth） ====================
  // aaStep/aaBand：线条/条纹的阈值带按像素足迹自动加宽——近处保持原锐度
  //   （minW 兜底）、远处随 fwidth 变软（minification 不再阶梯/闪噪）。
  // detailVis：按像素足迹返回 1→0 的细节可见度；重噪声材质在远景早退
  //   （"远处细节直接抛弃"，同时省掉后段 fbm/hash ALU）。
  float aaStep(float x, float edge, float minW) {
    float w = max(fwidth(x), minW);
    return smoothstep(edge - w, edge + w, x);
  }
  float aaBand(float x, float edge, float halfW, float minW) {
    float w = max(fwidth(x), minW);
    return 1.0 - smoothstep(halfW - w, halfW + w, abs(x - edge));
  }
  float detailVis(vec2 w, float near, float far) {
    float foot = max(fwidth(w.x), fwidth(w.y));
    return 1.0 - smoothstep(near, far, foot);
  }

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

  // 纯泥土地面：大尺度斑驳【低频·烘焙】+ 路辙扫痕/石子/颗粒【高频】
  vec4 mat_dirt_lo(vec3 f, vec2 w, int id) {
    float patchv = f.x * matP(id, 3) * 0.5;
    return vec4(patchv, f.y * 0.004, 0.0, patchv * 0.40);
  }
  vec4 mat_dirt_hi(float fz, vec2 w, int id) {
    // ★ 远景早退：路辙/石子细于像素后整体丢弃（省噪声 ALU，防闪噪）
    float vis = detailVis(w, 0.10, 0.35);
    if (vis <= 0.002) return vec4(0.0);
    float grain = (h21(floor(w * 80.0)) - 0.5) * matP(id, 0) * 1.5;
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
    float dL = ruts + grain + peb + pebRim;
    float reflect = ruts * 0.20 + grain * 0.10 + peb * 0.6;
    return vec4(dL, 0.0, 0.0, reflect) * vis;
  }
  vec4 mat_dirt(vec3 f, vec2 w, int id) { return mat_dirt_lo(f, w, id) + mat_dirt_hi(f.z, w, id); }

  // 砖石路面：错缝砌法/灰缝/抖动/破损【高频】+ 大尺度呼吸【低频·烘焙】
  vec4 mat_brick_lo(vec3 f, vec2 w, int id) {
    return vec4(f.y * 0.015, f.y * 0.002, 0.0, f.y * 0.08);
  }
  vec4 mat_brick_hi(float fz, vec2 w, int id) {
    float bw = 0.72, bh = 0.30;
    float row = floor(w.y / bh);
    float roff = h21(vec2(row, 1.7)) * 0.5 + mod(row, 2.0) * 0.5;
    float bx = w.x / bw + roff;
    float col = floor(bx);
    float lx = fract(bx), ly = fract(w.y / bh);
    vec2 bc = vec2(col, row);
    float jit = (h21(bc + vec2(13.1, 0.0)) - 0.5) * matP(id, 1) * 0.40;    // ±0.02
    float variant = (h21(bc + vec2(29.3, 0.0)) - 0.5) * matP(id, 2) * 0.10; // ±0.05 连续（非硬切）
    float broken = h21(bc + vec2(41.7, 0.0)) < matP(id, 3) ? -0.05 : 0.0;
    float gw = matP(id, 0);
    // ★ fwidth AA：灰缝宽度随像素足迹自适应（近处保持原锐度）
    float groutX = aaStep(lx, 1.0 - gw * 0.8, gw * 0.2);
    float groutY = aaStep(ly, 1.0 - gw * 0.8, gw * 0.2);
    float grout = max(groutX, groutY) * -0.12;
    float dL = jit + variant + broken + grout;
    float dH = variant * 0.20;                 // 原 0.4 → 温和色相偏
    float reflect = jit * 0.15 + grout * 0.12;
    return vec4(dL, 0.0, dH, reflect);
  }
  vec4 mat_brick(vec3 f, vec2 w, int id) { return mat_brick_lo(f, w, id) + mat_brick_hi(f.z, w, id); }

  // 草地：大斑/草丛/枯草【低频·烘焙】+ 草叶细颗【高频】
  vec4 mat_grass_lo(vec3 f, vec2 w, int id) {
    float patchv = (vnoise2(w * 0.20) - 0.5) * 2.0 * matP(id, 0) * 0.28;      // 大斑软明暗
    float tuft  = (vnoise2(w * 0.55 + 13.0) - 0.5) * 2.0 * matP(id, 1) * 0.12; // 草丛起伏
    float dry   = vnoise2(w * 0.10 + 71.0);
    return vec4(
      patchv + tuft,
      f.y * 0.003 - patchv * 0.012,             // 弱色呼吸
      patchv * 0.006 + dry * 0.008,             // 大斑/枯草微偏黄（温和）
      patchv * 0.12);
  }
  vec4 mat_grass_hi(float fz, vec2 w, int id) {
    float grain = (vnoise2(w * 2.2 + 29.0) - 0.5) * 2.0 * matP(id, 3) * 0.045;// 草叶细颗（极少）
    return vec4(grain, 0.0, 0.0, grain * 0.05);
  }
  vec4 mat_grass(vec3 f, vec2 w, int id) { return mat_grass_lo(f, w, id) + mat_grass_hi(f.z, w, id); }

  // 木板路面：板条/板缝/端缝/木纹/钉点【高频】+ 大尺度色呼吸【低频·烘焙】
  vec4 mat_wood_lo(vec3 f, vec2 w, int id) {
    return vec4(0.0, f.y * 0.002, 0.0, 0.0);
  }
  vec4 mat_wood_hi(float fz, vec2 w, int id) {
    float pw = max(matP(id, 0), 0.15);
    float row = floor(w.y / pw);
    float jit = (h21(vec2(row, 7.7)) - 0.5) * matP(id, 2) * 0.5;           // ±0.03
    float seamOff = h21(vec2(row, 3.3)) * matP(id, 1) * 8.0;
    float ry = fract(w.y / pw);
    float band = max(ry, 1.0 - ry);                        // 板两端 = 缝区
    // ★ fwidth AA：板缝/端缝随像素足迹自适应
    float seam = (1.0 - aaStep(band, 0.030, 0.010)) * -0.12;
    float seamX = abs(fract(w.x * 0.5 + seamOff) - 0.5);
    float endSeam = (1.0 - aaStep(seamX, 0.013, 0.007)) * -0.10;
    float grain = (vnoise2(vec2(w.x * 1.8, w.y * 50.0)) - 0.5) * matP(id, 3) * 0.32;
    float nail = 0.0;
    vec2 c = floor(w / 1.2);
    if (h21(c + vec2(88.3, 4.4)) < matP(id, 4)) {
      vec2 l = fract(w / 1.2) - 0.5;
      nail = (1.0 - aaStep(length(l), 0.0632, 0.006)) * -0.12; // ★ fwidth AA 钉点
    }
    float dL = seam + endSeam + jit + grain + nail;
    float dH = (h21(vec2(row, 7.7)) - 0.5) * 0.012;
    float reflect = grain * 0.10 + seam * 0.06 + endSeam * 0.06;
    return vec4(dL, 0.0, dH, reflect);
  }
  vec4 mat_wood(vec3 f, vec2 w, int id) { return mat_wood_lo(f, w, id) + mat_wood_hi(f.z, w, id); }

  // 岩石：大理石实底【低频·烘焙】+ 曲纹/裂纹/微凹凸【高频】
  vec4 mat_rock_lo(vec3 f, vec2 w, int id) {
    // 大理石实底：低频暖色斑（石头基色起伏）
    float base = (fbm2(w * 0.35 + 3.0) - 0.5) * 0.16;
    return vec4(base, 0.0, 0.0, 0.0);
  }
  vec4 mat_rock_hi(float fz, vec2 w, int id) {
    // ★ 远景早退：曲纹/裂纹细于像素后整体丢弃（省 4×fbm2 大额 ALU，防闪噪）
    float vis = detailVis(w, 0.30, 0.80);
    if (vis <= 0.002) return vec4(0.0);
    // 曲纹场：两层异频 FBM 叠加出弯曲线路
    float v = fbm2(w * 1.4 + 7.0) + fbm2(w * 2.8 + 13.0) * 0.6 + fbm2(w * 5.6 + 21.0) * 0.35;
    // 脊线（1 - |2v-1| → 越接近整数0/1 越亮），再收成细白纹；fwidth AA
    float ridge = 1.0 - abs(v * 2.0 - 1.0);
    // strata 控密度（脊线阈值），streak 控弯度（噪声扰动幅度）
    float bend = (vnoise2(w * 1.1 + 41.0) - 0.5) * matP(id, 1) * 0.5;
    float vein = aaStep(ridge + bend, 1.0 - matP(id, 0) * 0.25, max(0.01, matP(id, 0) * 0.25)) * 0.16;
    // 轻裂纹（ridged 线状暗纹）；fwidth AA
    float rn = fbm2(w * 1.3 + 27.0);
    float crackLine = 1.0 - abs(rn * 2.0 - 1.0);
    float crack = aaStep(crackLine, 1.0 - matP(id, 2) * 0.2, max(0.01, matP(id, 2) * 0.2)) * -0.06;
    // 微凹凸
    float bump = max(fz, 0.0) * matP(id, 3) * 0.5;
    float dL = vein + crack + bump;
    // 大理纹微偏冷（亮度纹路给一点冷白，底偏暖形成层次）
    float dC = vein * 0.015;
    float reflect = vein * 0.10 + bump * 0.08;
    return vec4(dL, dC, 0.0, reflect) * vis;
  }
  vec4 mat_rock(vec3 f, vec2 w, int id) { return mat_rock_lo(f, w, id) + mat_rock_hi(f.z, w, id); }

  // 苔藓：覆盖/绒毛/滴水/石底 —— 全项属低频/微小（整体烘进 matLow）
  vec4 mat_moss_lo(vec3 f, vec2 w, int id) {
    float covIn = f.x * 0.5 + 0.5 + f.y * 0.10;
    float cover = smoothstep(matP(id, 0), matP(id, 0) + max(matP(id, 1), 0.02) + 0.15, covIn);
    float fuzz = f.z * 0.03 * cover;
    float drip = (vnoise2(vec2(w.x * 1.5, w.y * 0.20)) - 0.5) * matP(id, 2) * 0.16;
    float stone = (1.0 - cover) * f.z * matP(id, 3) * 0.05;
    float dL = -cover * 0.06 + fuzz + drip + stone;
    float dC = cover * 0.025;
    float dH = cover * 0.010;                       // 苔区微偏绿（温和）
    float reflect = cover * 0.12 + fuzz * 0.06 + drip * 0.08;
    return vec4(dL, dC, dH, reflect);
  }
  vec4 mat_moss_hi(float fz, vec2 w, int id) { return vec4(0.0); }
  vec4 mat_moss(vec3 f, vec2 w, int id) { return mat_moss_lo(f, w, id); }

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
    float reflect = wave * 0.18 + crest * 0.50 + shallow * 0.25 + glint * 0.8;
    return vec4(dL + shallow * 0.05 + glint * 0.06, dC, 0.0, reflect);
  }

  // 水底鹅卵石河床（2026-09-07 v4）：贴合真实河床——
  // 小而密、磨圆的扁椭圆卵石相互紧贴（叠瓦状），随机朝向打破格感；
  // 石色 = 暖灰棕多矿复合（黑/白/土黄/黄褐/红棕，无蓝无青）；
  // 石缝细砂、被水浸润的湿润光泽。无动画、静态、reflect 归一 → 舒适。
  vec4 mat_pebble(vec3 f, vec2 w, int id) {
    // ★ 远景早退：卵石细于像素后整体丢弃（省 3×3 邻格椭圆搜索的大额 ALU）
    float vis = detailVis(w, 0.10, 0.35);
    if (vis <= 0.002) return vec4(0.0);
    float cs = 1.0 / max(matP(id, 0) * 140.0, 2.0);        // 卵石格尺度（米）（默认 ~8cm）
    vec2 g = w / cs;
    vec2 gid = floor(g);
    vec2 lf = fract(g);
    // 逐像素搜 3×3 邻格：找覆盖本像素的椭圆（旋转+缩放 → 单位圆判定）
    float best = 1e9;
    float seedh = 0.0;
    for (int i = -1; i <= 1; i++) {
      for (int j = -1; j <= 1; j++) {
        vec2 gi = gid + vec2(float(i), float(j));
        vec2 c = gi + (vec2(h21(gi + vec2(13.1, 7.7)), h21(gi + vec2(29.3, 17.1))) - 0.5) * matP(id, 1);
        float r1 = h21(gi + vec2(7.1, 3.3));
        float a = 0.50 + r1 * 0.16;                              // 长半轴（格单位）
        float b = a * (0.55 + h21(gi + vec2(41.7, 7.7)) * 0.20); // 短半轴（扁圆 1.5~1.8:1）
        float th = h21(gi + vec2(91.3, 5.5)) * 6.28318530718;    // 随机朝向
        vec2 d = lf - (c - gid);
        float cth = cos(th), sth = sin(th);
        vec2 q = vec2(d.x * cth - d.y * sth, d.x * sth + d.y * cth);
        float rr = (q.x / a) * (q.x / a) + (q.y / b) * (q.y / b);
        if (rr < best) { best = rr; seedh = h21(gi + vec2(63.1, 13.7)); }
      }
    }
    float stone = 1.0 - smoothstep(0.82, 1.04, best);   // 椭圆面掩码（软边）
    float dome = max(0.0, 1.0 - sqrt(best) * 0.95);     // 石面微凸（湿润圆润感）
    float sh = seedh;
    float hueOff;
    float toneMul;
    if      (sh < 0.14) { hueOff = 0.00; toneMul = -0.9; }  // 深灰黑
    else if (sh < 0.36) { hueOff = 0.02; toneMul =  0.2; }  // 土黄
    else if (sh < 0.58) { hueOff = 0.05; toneMul =  0.5; }  // 黄褐
    else if (sh < 0.76) { hueOff = 0.00; toneMul =  0.0; }  // 灰
    else if (sh < 0.90) { hueOff = 0.03; toneMul =  0.9; }  // 红棕
    else                { hueOff = 0.00; toneMul =  1.5; }  // 浅白石
    float perTone = (seedh - 0.5) * matP(id, 2) * 2.0 + toneMul * matP(id, 2) * 0.5;
    float chroma = (sh < 0.14 || sh >= 0.90) ? 0.006 : 0.020 + seedh * 0.032;
    float grain = (h21(floor(w * 120.0)) - 0.5) * matP(id, 3) * 0.9;
    float dL = stone * (dome * 0.09 + perTone) - (1.0 - stone) * 0.07 + grain;
    float dC = stone * chroma;
    float dH = hueOff;
    float reflect = stone * (dome * 0.22 + perTone * 0.06);  // 湿润中心光泽（delta）
    return vec4(dL, dC, dH, reflect) * vis;
  }

  // 冰面：冰层厚薄/霜斑/闪晶【低频·烘焙】+ 结晶裂纹【高频】
  vec4 mat_ice_lo(vec3 f, vec2 w, int id) {
    float depthv = (vnoise2(w * 0.30) - 0.5) * matP(id, 3) * 0.20;
    float frost = smoothstep(0.65, 0.88, vnoise2(w * 0.35 + 37.0)) * matP(id, 2) * 0.06;
    float shimmer = smoothstep(0.72, 0.95, vnoise2(w * 0.9)) * matP(id, 1) * 0.05;
    return vec4(
      depthv + frost + shimmer,
      -frost * 0.12,
      0.0,
      frost * 0.22 + depthv * 0.10 + shimmer * 0.14);
  }
  vec4 mat_ice_hi(float fz, vec2 w, int id) {
    // ★ 远景早退：裂纹细于像素后整体丢弃（省 fbm ALU，防闪噪）
    float vis = detailVis(w, 0.25, 0.70);
    if (vis <= 0.002) return vec4(0.0);
    float rn = fbm2(w * 1.6);
    float crackL = 1.0 - abs(rn * 2.0 - 1.0);
    float crack = aaStep(crackL, 1.0 - matP(id, 0) * 0.125, max(0.008, matP(id, 0) * 0.125)) * -0.05;
    return vec4(crack, 0.0, 0.0, crack * 0.30) * vis;
  }
  vec4 mat_ice(vec3 f, vec2 w, int id) { return mat_ice_lo(f, w, id) + mat_ice_hi(f.z, w, id); }

  // 灰烬地：风积条纹/聚堆【低频·烘焙】+ 灰粒/余烬呼吸【高频】
  vec4 mat_ash_lo(vec3 f, vec2 w, int id) {
    float drift = (vnoise2(vec2(w.x * 0.22, w.y * 0.9)) - 0.5) * matP(id, 3) * 0.35;
    float clump = (vnoise2(w * 0.50 + 17.0) - 0.5) * matP(id, 1) * 0.30;
    return vec4(drift + clump, 0.0, 0.0, clump * 0.12 + drift * 0.06);
  }
  vec4 mat_ash_hi(float fz, vec2 w, int id) {
    float grain = (h21(floor(w * 60.0)) - 0.5) * matP(id, 0) * 0.60;
    float t = uTime * 0.6;
    vec2 ec = floor(w * 2.0);
    float ember = 0.0;
    if (h21(ec + vec2(71.3, 13.7)) < matP(id, 2)) {
      float pulse = 0.55 + 0.45 * sin(t * (2.0 + h21(ec) * 3.0) + h21(ec + 7.7) * 6.28318530718);
      ember = pulse * 0.10;
    }
    float dL = grain + ember;
    return vec4(dL, ember * 0.20, ember * 0.012, ember * 0.30 + grain * 0.04);
  }
  vec4 mat_ash(vec3 f, vec2 w, int id) { return mat_ash_lo(f, w, id) + mat_ash_hi(f.z, w, id); }

  // 泥沼地：水洼/湿度【低频·烘焙】+ 干裂纹/泥粒【高频】
  vec4 mat_mud_lo(vec3 f, vec2 w, int id) {
    float pn = vnoise2(w * 0.45 + 11.0);
    float puddle = smoothstep(1.0 - matP(id, 0), 1.05 - matP(id, 0) * 0.5, pn + 0.5);
    float wet = (vnoise2(w * 0.28) - 0.5) * matP(id, 2) * 0.10;
    return vec4(-puddle * 0.05 + wet, puddle * 0.010, 0.0, puddle * 0.25 + wet * 0.10);
  }
  vec4 mat_mud_hi(float fz, vec2 w, int id) {
    // ★ 远景早退：干裂纹/泥粒细于像素后整体丢弃（省 fbm ALU，防闪噪）
    float vis = detailVis(w, 0.20, 0.55);
    if (vis <= 0.002) return vec4(0.0);
    float rn = fbm2(w * 1.1 + 53.0);
    float crackBase = 1.0 - abs(rn * 2.0 - 1.0);
    float crackL = aaStep(crackBase, 0.93, 0.05) * matP(id, 1) * -0.06; // fwidth AA
    float grain = (h21(floor(w * 60.0)) - 0.5) * matP(id, 3) * 0.60;
    return vec4(crackL + grain, 0.0, 0.0, grain * 0.04) * vis;
  }
  vec4 mat_mud(vec3 f, vec2 w, int id) { return mat_mud_lo(f, w, id) + mat_mud_hi(f.z, w, id); }

  // 坑洞：径向渐深【低频·烘焙】+ 裂纹/警示红光/暗粒【高频】
  vec4 mat_pit_lo(vec3 f, vec2 w, int id) {
    vec2 c = fract(w * 0.25) - 0.5;                   // 每 4m 一格的中心渐深
    float r = length(c) * 2.0;
    float depthv = (1.0 - smoothstep(0.0, 1.4, r)) * matP(id, 2) * -0.12;
    return vec4(depthv, 0.0, 0.0, depthv * 0.5);
  }
  vec4 mat_pit_hi(float fz, vec2 w, int id) {
    // ★ 远景早退：裂纹/红光/暗粒细于像素后整体丢弃（省 fbm ALU，防闪噪）
    float vis = detailVis(w, 0.20, 0.55);
    if (vis <= 0.002) return vec4(0.0);
    float rn = fbm2(w * 0.9 + 91.0);
    float crackBase = 1.0 - abs(rn * 2.0 - 1.0);
    float crack = aaStep(crackBase, 0.915, 0.055) * matP(id, 0) * -0.10; // fwidth AA
    float glow = crack * matP(id, 1) * 0.5;           // 裂纹微光（偏红）
    float grain = (h21(floor(w * 80.0)) - 0.5) * matP(id, 3) * 1.2;
    return vec4(crack + grain, glow * 0.05, glow * 0.02, glow * 0.8 + grain * 0.1) * vis;
  }
  vec4 mat_pit(vec3 f, vec2 w, int id) { return mat_pit_lo(f, w, id) + mat_pit_hi(f.z, w, id); }

  // 沙土：三尺度低频（大波/中波/色呼吸/色相漂移）【低频·烘焙】+ 细粒【高频】
  vec4 mat_sand_lo(vec3 f, vec2 w, int id) {
    float macro = (vnoise2(w * 0.18) - 0.5) * 2.0 * matP(id, 2) * 0.50;  // 大波（大范围明暗）
    float meso  = (vnoise2(w * 0.75) - 0.5) * 2.0 * matP(id, 1) * 0.46;  // 中波（团块起伏）
    // 色彩呼吸：shade = 明暗场（不含细粒，保持大团块色彩整体感）
    float shade = macro * 0.6 + meso * 0.4;
    float hueDrift = (vnoise2(w * 0.22 + 31.0) - 0.5) * 2.0 * matP(id, 3) * 0.015;
    return vec4(
      macro + meso,
      -shade * 0.028 * matP(id, 3),                     // 暗→饱和+（湿）亮→褪色（干）
      shade * 0.016 * matP(id, 3) + hueDrift,           // 暗→偏冷灰 亮→偏黄暖 + 斑驳漂移
      (macro + meso) * 0.18);
  }
  vec4 mat_sand_hi(float fz, vec2 w, int id) {
    float grain = (h21(floor(w * 110.0)) - 0.5) * matP(id, 0) * 1.6;     // 细粒（像素磨砂）
    return vec4(grain, 0.0, 0.0, grain * 0.18);
  }
  vec4 mat_sand(vec3 f, vec2 w, int id) { return mat_sand_lo(f, w, id) + mat_sand_hi(f.z, w, id); }

  // 水泥：三尺度低频（大波/中波/色呼吸/色相漂移）【低频·烘焙】+ 细颗粒【高频】
  vec4 mat_cement_lo(vec3 f, vec2 w, int id) {
    float macro = (vnoise2(w * 0.18) - 0.5) * 2.0 * matP(id, 2) * 0.25;  // 大波极弱
    float meso  = (vnoise2(w * 0.75) - 0.5) * 2.0 * matP(id, 1) * 0.35;  // 中波微起伏
    float shade = macro * 0.6 + meso * 0.4;
    float hueDrift = (vnoise2(w * 0.22 + 31.0) - 0.5) * 2.0 * matP(id, 3) * 0.008;
    return vec4(
      macro + meso,
      -shade * 0.020 * matP(id, 3),
      shade * 0.010 * matP(id, 3) + hueDrift,
      0.0);                                  // ★ 哑光：reflect 恒 1.0（delta 0）
  }
  vec4 mat_cement_hi(float fz, vec2 w, int id) {
    float grain = (h21(floor(w * 110.0)) - 0.5) * matP(id, 0) * 1.2;     // 细颗粒（少）
    return vec4(grain, 0.0, 0.0, 0.0);
  }
  vec4 mat_cement(vec3 f, vec2 w, int id) { return mat_cement_lo(f, w, id) + mat_cement_hi(f.z, w, id); }

  // ==================== 条带装饰（《我画的第一个装饰性纹理》2026-09-05 定稿） ====================
  // 语义（用户定调）：规规矩矩的斑马线式标线——横平竖直 + 轻磨损。
  //   · 模板 = 用户手绘 JSON：右缘竖向车道（中心 x≈3.70m，半宽 0.10m）上三段
  //     虚线（沿轴 0.17~0.50 / 0.73~3.00 / 3.30~3.86m，按手绘坐标换算）；
  //   · 位置四选一 = 模板旋转 0°/90°/180°/270° → 车道偏右/偏上/偏左/偏下；
  //   · 出现条带的地块中，55% 单条 / 45% 两条不同旋转叠加；
  //   · ★ 20% 地块出现概率（tileH 门控）；沙土地块专属（TILE_FLAT_SAND 声明 stripes）；
  //   · 颜色 = 琥珀 sRGB(255,190,111) → OKLCH(0.846,0.122,0.196)；
  //     磨损 = 边缘噪声啃边（0~3cm，只蚀不胀）+ 内部轻斑驳（0.88~1.0）。
  // 门控：uMatParams slot15（stripes）=0 关（早退零成本）；仅顶面调用。
  // ★ reflect 贡献恒 0：oklchShade 的 sh = materialShade + stripeDeco + hazardDeco 的
  //   sh.w 是加性累积，材料已约 1.0；若叠加会让装饰区亮度×2+ 过曝，被 ACES 拉偏品红。
  vec4 stripeDeco(vec3 baseLCH, vec2 w, int id) {
    float amt = matP(id, 15);
    if (amt <= 0.001) return vec4(0.0, 0.0, 0.0, 0.0);
    vec2 wt = w - floor(w / 4096.0) * 4096.0;
    vec2 tc = floor(wt / 4.0);
    vec2 lp = wt - tc * 4.0;                            // 地块内坐标 0..4m
    // ★ 远处丢弃：像素足迹超过车道尺度（半宽 0.10m）后整体淡出——
    //   有 fwidth AA 兜底（亚像素时自动趋于均值），窗口放晚到接近彻底亚像素；
    //   提前于哈希门控/噪声前收敛（远景零后续 ALU）
    //   （foot 取 wt：连续坐标，避免 fract 边界处导数尖峰误杀）
    float foot = max(fwidth(wt.x), fwidth(wt.y));
    amt *= 1.0 - smoothstep(0.24, 0.72, foot);
    if (amt <= 0.001) return vec4(0.0, 0.0, 0.0, 0.0);
    float tileH = h21(tc);                              // 地块主哈希
    if (tileH > 0.20) return vec4(0.0, 0.0, 0.0, 0.0);  // ★ 20% 出现概率
    float two = step(h21(tc + 3.9), 0.45);              // 45% 双条叠加（独立哈希）
    float k1 = floor(h21(tc + 7.3) * 4.0);              // 旋转 0~3 四选一
    float k2 = mod(k1 + 1.0 + floor(h21(tc + 13.7) * 3.0), 4.0); // 第二条旋转必不同
    float mask = 0.0;
    for (int i = 0; i < 2; i++) {
      if (i == 1 && two < 0.5) break;
      float ki = i == 0 ? k1 : k2;
      vec2 d = lp - vec2(2.0);                          // 以地块中心为原点
      vec2 t = d;                                       // 逆旋转回模板空间
      if (ki > 2.5)      t = vec2(-d.y, d.x);           // 270° → 车道偏下
      else if (ki > 1.5) t = vec2(-d.x, -d.y);          // 180° → 车道偏左
      else if (ki > 0.5) t = vec2(d.y, -d.x);           //  90° → 车道偏上
      t += vec2(2.0);
      float aw = abs(vnoise2(t * 5.0 + ki * 23.7) - 0.5) * 0.06; // 磨损量 0~3cm
      // 车道：模板右缘竖向 |t.x - 3.70| ≤ 0.10；边缘被噪声啃蚀（只蚀不胀）
      // ★ fwidth AA：远景线宽随像素足迹变软，不出现横线段/闪噪
      float mLane = aaBand(t.x, 3.70, 0.10 + aw, 0.01);
      // 三段虚线（沿模板轴；段端同啃蚀 + fwidth AA）
      float mDash = 0.0;
      mDash = max(mDash, aaStep(t.y, 0.17 + aw, 0.03) * (1.0 - aaStep(t.y, 0.50 - aw, 0.03)));
      mDash = max(mDash, aaStep(t.y, 0.73 + aw, 0.03) * (1.0 - aaStep(t.y, 3.00 - aw, 0.03)));
      mDash = max(mDash, aaStep(t.y, 3.30 + aw, 0.03) * (1.0 - aaStep(t.y, 3.86 - aw, 0.03)));
      mask = max(mask, mLane * mDash);
    }
    if (mask <= 0.001) return vec4(0.0, 0.0, 0.0, 0.0);
    vec3 base = baseLCH;
    vec3 amber = vec3(0.846, 0.122, 0.196);
    float weather = 0.88 + vnoise2(lp * 9.0) * 0.12;    // 内部轻斑驳（0.88~1.0）
    vec3 dd = (amber - base) * mask * amt * weather;
    return vec4(dd, 0.0);                                // 颜色只走 sh.xyz，不碰亮度
  }

  // ==================== 警示贴画（《装饰性纹理，警示贴画》2026-09-06 定稿） ====================
  // 语义（用户定调）：内部一个方形（背景色面板），外部一圈黑黄交替的最经典 45°
  // 警示线框。铺在沙土地块顶面；与条带装饰同款随机散布（~20% 地块出现）。
  //   · 模板 = 用户手绘 JSON：居中方形 + 外圈警示环（环厚 ~0.5m）。手绘线只是示意、
  //     密度不足——完整条纹在此程序化生成：每条边 ~13 条黑黄对（周期 P=0.32m，
  //     单条垂直宽 ~0.11m），无需逐根手画。
  //   · 中间色 = 背景色(原始) RGB(255,164,92) 调暗成「不敢再碰的做旧灰橙」
  //     OKLCH(≈0.62,0.085,0.16)——既有层次又不会被 ACES 推成品红，与亮黄警示条拉开。
  //   · 做旧（用户定：磨损做旧）：外圈细黑描边 ~2.5cm；警示环边缘噪声啃蚀（0~2cm，
  //     只蚀不胀）；黄条内部轻斑驳（0.92~1.0）；黑条微明暗（±0.02 不呆板）；
  //     极淡斜向刮痕（约一半地块有）。
  //   · 颜色 = 警示黄 OKLCH(0.85, 0.175, 0.24) ≈ sRGB(约 255,197,0)；黑 OKLCH(0.015,0,0)。
  // ★ reflect 贡献恒 0：oklchShade 的 sh = materialShade + stripeDeco + hazardDeco 的
  //   sh.w 是加性累积，材料已约 1.0；若叠加会让贴画区亮度×2+ 过曝，被 ACES 拉偏品红。
  // 门控：uMatParams slot14（hazard）=0 关（早退零成本）；仅顶面调用（topSurf>0.5）。
  vec4 hazardDeco(vec3 baseLCH, vec2 w, int id) {
    float amt = matP(id, 14);
    if (amt <= 0.001) return vec4(0.0, 0.0, 0.0, 0.0);
    vec2 wt = w - floor(w / 4096.0) * 4096.0;
    vec2 tc = floor(wt / 4.0);                            // 地块坐标（哈希盐）
    vec2 lp = wt - tc * 4.0;                              // 地块内坐标 0..4m
    // ★ 远处丢弃：像素足迹超过条纹尺度（半周期 0.16m）后整体淡出——
    //   有 fwidth AA 兜底（亚像素时自动趋于均值），窗口放晚到接近彻底亚像素；
    //   提前于哈希门控/噪声前收敛（远景零后续 ALU）
    //   （foot 取 wt：连续坐标，避免 fract 边界处导数尖峰误杀）
    float foot = max(fwidth(wt.x), fwidth(wt.y));
    amt *= 1.0 - smoothstep(0.30, 0.90, foot);
    if (amt <= 0.001) return vec4(0.0, 0.0, 0.0, 0.0);
    float tileH = h21(tc + 7.31);                         // ★ 独立盐：~10% 出现
    if (tileH > 0.10) return vec4(0.0, 0.0, 0.0, 0.0);
    float k = floor(h21(tc + 3.17) * 2.0);                // 条纹方向变体（0=↘ / 1=↗）
    vec2 d = lp - vec2(2.0);                              // 以地块中心为原点
    float q = max(abs(d.x), abs(d.y));                    // 旋转方距（正方形）
    const float OS = 1.55;                                // 外框半宽（贴画 3.1m）
    const float IS = 1.25;                                // 内部方形半宽（背景面板 2.5m）
    // 做旧① 边缘啃蚀：0~2cm（只蚀不胀，外缘向内缩）；fwidth AA
    float wear = abs(vnoise2(lp * 5.0 + k * 17.0) - 0.5) * 0.04;
    float mOut = 1.0 - aaStep(q, OS - wear, 0.005);
    if (mOut <= 0.001) return vec4(0.0, 0.0, 0.0, 0.0);
    // 外圈细黑描边：贴画最外 ~2.5cm 压近黑（q 靠近 OS 处为 1，画内部为 0）
    float mOutline = mOut * aaStep(q, OS - 0.020, 0.012);
    // 警示环本体（内缘 2cm 软过渡，外缘让出描边带，避免黑黄条纹叠在描边上发黄）
    float mStripe = mOut * aaStep(q, IS, 0.02)
                  * (1.0 - aaStep(q, OS - 0.022, 0.012));
    // 内部背景面板
    float mIn = mOut * (1.0 - aaStep(q, IS, 0.02));
    // 45° 条纹：对角坐标 u，周期 P = 一对黑黄；每条边 ~2·IS/P ≈ 13 对
    float u = k < 0.5 ? d.x + d.y : d.x - d.y;
    const float P = 0.32;
    float fr = fract(u / P);
    // ★ fwidth 取 u/P（连续量）：避免 fract 边界导数尖峰；远处自动变软
    float fw = max(fwidth(u) / P, 0.06);
    float yellowF = 1.0 - smoothstep(0.50 - fw, 0.50 + fw, fr);  // 半周期黄 → 黑
    // 做旧② 黄条轻斑驳 / 黑条微明暗 / 内部面板斑驳
    float mottle = 0.92 + vnoise2(lp * 9.0 + k * 29.0) * 0.08;
    float blackJit = (vnoise2(lp * 7.0 + k * 41.0) - 0.5) * 0.04;   // 黑条微明暗 ±0.02
    float inWear = 0.94 + vnoise2(lp * 9.0 + k * 31.0) * 0.06;      // 内部面板轻做旧
    // 做旧③ 斜向刮痕：细线，约一半地块有，极淡压暗
    float scPresence = step(h21(tc + 19.7), 0.5);
    float scU = d.x * 1.4 + d.y * 1.4 + (vnoise2(lp * 2.0 + k * 7.0) - 0.5) * 0.8;
    // ★ fwidth 取 scU（连续量）避免 fract 边界导数尖峰；远处自动变软
    float scFw = max(fwidth(scU), 0.004);
    float scWeight = smoothstep(0.984 - scFw, 0.984 + scFw, fract(scU)) * scPresence * 0.30;
    // 目标色组装（OKLab delta）：环条纹 + 内部背景面板 + 描边 + 刮痕
    vec3 base = baseLCH;
    vec3 yellow = vec3(0.85, 0.175, 0.24);                 // 警示黄
    vec3 black = vec3(0.015, 0.0, 0.0);                   // 黑
    // 内部黄色面板（手绘模板"纹理内部颜色"= rgb(179,142,3) → OKLCH(0.6626,0.1348,0.2500)）
    vec3 interior = vec3(0.6626, 0.1348, 0.2500) * inWear;
    float worn = 1.0 + (mottle - 1.0) * yellowF + blackJit;
    vec3 target = mix(black, yellow, yellowF) * worn;
    vec3 dd = (target - base) * mStripe * amt;            // 警示环：黑黄交替（不含描边带）
    dd += (interior - base) * mIn * amt;                  // 中间方形：黄色面板
    dd += (black * 0.85 - base) * mOutline * amt;         // 外圈描边压近黑
    dd += (base * 0.9 - base) * scWeight * amt;           // 刮痕把 base 压暗 10%
    // ★ reflect 贡献恒 0：oklchShade 里 sh = materialShade + stripeDeco + hazardDeco 的
    //   sh.w 是加性的，materialsShade 已约 1.0；这里若再加会导致贴画区 base×~2 过曝偏品。
    return vec4(dd, 0.0);                                  // 颜色只走 sh.xyz，不碰亮度
  }

  // ==================== 分发（数据驱动：tile→材质.fnId→GLSL 函数） ====================
  // 返回 vec4(dL, dC, dH, dReflect)；dReflect = 反光层乘数 - 1；无材质 → 全零。
  // 顶面（低频已烘 uMatLow）→ materialShadeHi：只跑高频层。
  vec4 materialShadeHi(float fz, vec2 w, int id) {
    int fn = uMatFn[id];
${MATERIAL_HI_DISPATCH}
    return vec4(0.0);
  }
  // 侧壁（vTex 坐标空间，低频未烘焙）→ materialShadeFull：低频 + 高频。
  vec4 materialShadeFull(vec3 f, vec2 w, int id) {
    int fn = uMatFn[id];
${MATERIAL_FULL_DISPATCH}
    return vec4(0.0);
  }

  // ==================== 收口（侧壁全量路径）：基色 + 偏移 + 反光层 → 线性 RGB ====================
  // 每个像素拿到自己独立的 OKLab 偏移（非整体统一调色）+ 反光层乘数。
  vec3 oklchShade(vec2 w, int id, vec3 field) {
    vec4 sh = materialShadeFull(field, w, id);            // (dL, dC, dH, dReflect)
    // ★ 逐地块轻微 HSL 色偏：粒度 = 4×4m 地块（每地块整体一个 hash 色偏，
    //   地块内部连续纯色）。原 1m 粒度（floor(w)）会碎成小方块——2026-09-02
    //   用户反馈"纹理上有方块"后归零；现按地块粒度恢复"每地块轻微变化"。
    vec3 LCH = uMatBaseLCH[id].xyz + sh.xyz
             + uMatJitter[id].xyz * ((h21(floor(w / 4.0)) - 0.5) * 2.0);
    LCH.x = clamp(LCH.x, 0.0, 1.0);                        // L clamp（勿 mod）
    LCH.y = clamp(LCH.y, 0.0, 0.4);                        // C clamp（感知上限）
    LCH.z = fract(LCH.z);                                  // H 唯一可环绕
    vec3 lab = vec3(LCH.x, LCH.y * cos(LCH.z * 6.28318530718),
                           LCH.y * sin(LCH.z * 6.28318530718));
    vec3 base = oklab2linear(lab);                         // → linear 光照管线
    return base * (1.0 + sh.w);                           // × 反光层乘数（多尺度亮度层次）
  }

  // ==================== OKLab ↔ LCH / 线性 ↔ OKLab（顶面低频+高频合成用） ====================
  vec3 linear2oklab(vec3 c) {
    float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    float lc = pow(max(l, 0.0), 0.3333333333);
    float mc = pow(max(m, 0.0), 0.3333333333);
    float sc = pow(max(s, 0.0), 0.3333333333);
    return vec3(
      0.2104542553 * lc + 0.7936177850 * mc - 0.0040720468 * sc,
      1.9779984951 * lc - 2.4285922050 * mc + 0.4505937099 * sc,
      0.0259040371 * lc + 0.7827717662 * mc - 0.8086757660 * sc);
  }
  vec3 oklabToLch(vec3 lab) {
    float C = length(lab.yz);
    // ★ 灰度色 a=b=0：atan(0,0) 驱动相关（可能 NaN）——按 H=0 兜底
    float H = C > 1e-5 ? atan(lab.z, lab.y) / 6.28318530718 : 0.0;
    return vec3(lab.x, C, fract(H));
  }
  vec3 lchToOklab(vec3 lch) {
    return vec3(lch.x,
      lch.y * cos(lch.z * 6.28318530718),
      lch.y * sin(lch.z * 6.28318530718));
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
        uniform sampler2D uMatLow;   // ★ 材质低频图（性能 Step 1：低频烘焙，顶面只跑高频）
        uniform vec3 uSunDir;
        uniform vec2 uSunSide;
        uniform float uSunDay;
        uniform vec3 uAmbientColor;
        uniform vec3 uSunColor;
        varying vec2 vUv;
        varying vec2 vWorld;
        varying vec3 vColor;
        varying vec3 vNw;    // ★ 世界法线（顶面 vertex 同名 varying）
        varying float vPw;   // ★ 补丁权重（补丁装饰纹理驱动）
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          // ★ 补丁 = 乘性焦土染色（2026-09-05 定案）：顶点色 = 乘数（白=原样、非中性色=
          //   烧焦调）。albedo × vColor 保留纹理明暗/颗粒 → "地面被烧过"而非换纸；
          //   乘数亮度由 PATCH_COLOR 保证（0.16 级深乘会全黑；整块替换会丢纹理）。
          vec3 alb = texture2D(uAlbedo, vUv).rgb * vColor;
          vec3 lm = texture2D(uLightmap, vUv).rgb;      // r=直射 / g=AO / b=伪AO
          int id = int(texture2D(uTileIds, vUv).r * 255.0 + 0.5);

          // ★ 性能 Step 1：低频（材质色/斑块/逐地块 jitter）已由 CPU 烘进 uMatLow；
          //   此处只跑高频层（线条/裂纹/颗粒/装饰），在 OKLab(LCH) 空间叠加收口。
          vec3 lowLin = texture2D(uMatLow, vUv).rgb;    // sRGB 解码后的线性低频色
          vec2 wf = vWorld - floor(vWorld / 2048.0) * 2048.0;
          float fz = h21(floor(wf * 30.0)) - 0.5;       // grain 场（rock bump 等高频项用）
          vec4 sh = materialShadeHi(fz, vWorld, id);    // (dL, dC, dH, dReflect)
          vec3 baseLch = oklabToLch(linear2oklab(max(lowLin, vec3(0.0))));
          sh += stripeDeco(baseLch, vWorld, id);        // ★ 条带装饰（slot15 门控）
          sh += hazardDeco(baseLch, vWorld, id);        // ★ 警示贴画（slot14 门控）
          vec3 LCH = baseLch + sh.xyz;
          LCH.x = clamp(LCH.x, 0.0, 1.0);
          LCH.y = clamp(LCH.y, 0.0, 0.4);
          LCH.z = fract(LCH.z);
          vec3 base = oklab2linear(lchToOklab(LCH)) * (1.0 + sh.w);

          // ★ 4×4 地块边界描边（黑色分界线）：块内 UV 距边 → 向近黑混合
          //   （2026-08-29 二调：band 0.035 = 每块边缘 14cm（相邻合拢 ~28cm 细缝），
          //     强度 0.85 ≈ 全黑；用户要求"更细更黑"）
          vec2 buv = fract(vUv * 15.0);
          float dEdge = min(min(buv.x, 1.0 - buv.x), min(buv.y, 1.0 - buv.y));
          float edge = 1.0 - smoothstep(0.0, 0.010, dEdge);
          base = mix(base, vec3(0.02), edge * uMatSurface[id].w);

          // 伪 AO：大尺度斑块暗谷（低频 patch 场已烘进 lightmap B；0.4~1.0）
          float ao = lm.b * 0.6 + 0.4;

          // ★ 顶面直射保底（2026-09-05）：深影列 lm.r≈0.09 一整片塌黑（坡面尤其）。
          //   白天钳到 ≥${TERRAIN_DIRECT_DAY_FLOOR.toFixed(2)}（见常量注释，影仍暗不死黑）；
          //   夜晚不保底（夜景 = 环境光分层）。
          float d = mix(lm.r, max(lm.r, ${TERRAIN_DIRECT_DAY_FLOOR.toFixed(2)}), uSunDay);

          // ★ LOD 内实时太阳方向重映射（2026-09-05 用户架构决策：阴影烘焙一次，
          //   LOD 内实时维护方向）——dirMod = N·L / L.y：平地恒 1（亮度守恒），
          //   坡面方向感随实时太阳旋转（朝阳坡>1 背坡<1，全天东升西落可见）；
          //   距离 30m 内全强度、90m 外平滑淡回纯烘焙（远场保持静态阴影形状）。
          //   clamp 幅度防背光死黑/顺光过曝。L 提前声明（下方镜面高光共用）。
          vec3 L = normalize(uSunDir);
          float dirMod = clamp(max(dot(vNw, L), 0.12) / max(L.y, 0.12),
            ${SUN_DIR_MOD_MIN.toFixed(2)}, ${SUN_DIR_MOD_MAX.toFixed(2)});
          float distCam = length(cameraPosition - vec3(vWorld.x, 0.0, vWorld.y));
          float lodW = smoothstep(${SUN_DIR_LOD_FAR.toFixed(1)}, ${SUN_DIR_LOD_NEAR.toFixed(1)}, distCam);
          d *= mix(1.0, dirMod, lodW);

          // ★ 补丁装饰性纹理（PatchDecor §补丁属性）：坑洞/裂痕内部"坑坑洼洼"
          //   —— 碎粒/塌陷斑随补丁权重渐变。★ 必须在 lit 乘积之前乘 alb
          //   （2026-09-05 修：原先放在 lit 之后，亮度乘数被吞 → 顶面坑底噪点
          //   不可见，只有乘序正确的侧壁路径生效）；法线扰动存 tilt 待 N 初始化。
          vec3 decorTilt = vec3(0.0);
          if (vPw > 0.001) {
            vec3 dec = patchDecor(vWorld, vPw);
            alb *= dec.x;
            decorTilt = vec3(dec.y, 0.0, dec.z);
          }

          vec3 lit = base * alb * (uAmbientColor * lm.g * ao + uSunColor * d);

          // ---- 表面属性（伪 PBR：法线扰动 + 粗糙度调制） ----
          vec3 N = pseudoNormal(vWorld);                   // 微阴影/微高光
          if (vPw > 0.001) N = normalize(N + decorTilt);   // 补丁伪法线扰动
          float rough = uMatBaseLCH[id].w + fz * 0.15;  // 材质基础 + grain 调制
          vec3 V = normalize(cameraPosition - vec3(vWorld.x, 0.0, vWorld.y));
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
  constructor(albedo: THREE.Texture, lightmap: THREE.Texture, matLow: THREE.Texture, cfg?: TileRenderConfig, useVertexColor = false) {
    // ★ 补丁顶点色通道（§14.10）：中性白(1,1,1)=原样；非中性色=乘性焦土染色（albedo × vColor）
    //   useVertexColor=true 时必须由 geometry 提供 'color' 属性（或缺省置信白）
    const vcVar = useVertexColor ? 'vColor = color;' : 'vColor = vec3(1.0);';
    super({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uAlbedo: { value: albedo },
        uLightmap: { value: lightmap },
        uMatLow: { value: matLow },
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
        varying vec3 vColor;
        varying vec3 vNw;    // ★ 世界法线（LOD 内实时太阳方向重映射用）
        attribute float apw; // ★ 补丁权重（补丁装饰纹理驱动；无补丁 geometry 恒 0）
        varying float vPw;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          ${vcVar}
          vPw = apw;
          vNw = normalize(mat3(modelMatrix) * normal);  // 地块群仅平移 → 本地=世界
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);   // ★ fog_vertex 依赖它
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xz;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: MATERIAL_GLSL + PATCH_DECOR_GLSL + FRAGMENT_MAIN,
      fog: true, // ★ 场景有 THREE.Fog——必须参与雾，否则远端地形浮在背景外
    });
    this.vertexColors = useVertexColor; // 供 three 注入 attribute color（配 geometry color 属性）
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

const WALL_VERT = (vcVar: string) => /* glsl */ `
  varying vec2 vUv;      // 地块中心 uv（采样 uTileIds 得所属 tile id）
  varying vec2 vUvC;     // chunk 连续 uv（采样 uAlbedo/uLightmap，与顶面同约定）
  varying vec2 vTex;     // ★ 墙面 2D 纹理坐标（沿墙水平距离 × 绝对高度）
  varying vec3 vColor;   // ★ 补丁色通道（§14.10；无补丁 = vec3(1.0)）
  varying vec3 vNw;      // ★ 世界法线（LOD 内实时太阳方向重映射用）
  varying vec3 vWpos;    // ★ 世界坐标（LOD 距离衰减用）
  attribute float apw;   // ★ 补丁权重（补丁装饰纹理驱动；无补丁 geometry 恒 0）
  varying float vPw;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vColor = ${vcVar};
    vPw = apw;
    vUvC = position.xz / 60.0 + 0.5;   // 局部坐标（中心原点）→ chunk 0..1
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWpos = wp.xyz;
    // ★ 不能直接用 wp.xz 当纹理坐标：墙面是竖直面，法线水平分量几乎恒定 →
    //   沿墙体内方向 w 不随墙高变化，纹理压成竖条纹（2026-09-01 用户反馈）。
    //   改成墙面自己的切平面坐标：(沿墙水平距离, 墙高)，两方向都随像素变 →
    //   与顶面同款 dirt/brick/grass 等 2D 材质纹理，且沿墙排布规则。
    // ★ 法线必须用世界方向（mat3(modelMatrix)），绝不能乘 normalMatrix——
    //   normalMatrix = 模型视图法线矩阵，随相机转向变化，会把纹理方向带偏
    //   （相机转动 → 侧壁纹理水平漂移，2026-09-01 用户反馈）。地块群仅平移
    //   无旋转，mat3(modelMatrix) 恒等 → 本地法线即世界方向，结果与视角无关。
    vec3 N = normalize(mat3(modelMatrix) * normal);
    vNw = N;
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
  uniform vec3 uSunDir;        // ★ 实时太阳方向（LOD 内方向重映射用）
  varying vec2 vUv;
  varying vec2 vUvC;
  varying vec2 vTex;
  varying vec3 vColor;   // ★ 补丁色通道（乘性染色；白=原样）
  varying vec3 vNw;      // ★ 世界法线（WALL_VERT 同名 varying）
  varying vec3 vWpos;    // ★ 世界坐标（LOD 距离衰减用）
  varying float vPw;     // ★ 补丁权重（补丁装饰纹理驱动）
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
    // ★ 补丁 = 乘性焦土染色（与顶面同款：albedo × vColor，保留墙面纹理细节）
    vec3 alb = texture2D(uAlbedo, isWaterWall ? vUvC : vUv).rgb * vColor;
    vec3 lm = texture2D(uLightmap, isWaterWall ? vUvC : vUv).rgb;
    vec3 field = shadeField(vTex);
    vec3 base = oklchShade(vTex, id, field);            // ★ 侧壁：低频未烘焙，走全量路径

    // ★ 补丁装饰性纹理（PatchDecor）：坑壁碎屑坑洼（亮度乘数；墙面无镜面/
    //   菲涅尔项，伪法线扰动无落点——且 dirMod 用宏观法线保持朝阳/背阳方向
    //   感，不做微扰）。w = vTex（墙面 (沿墙距, 高)，见 PatchDecor 注释）。
    //   墙增益 WALL_DECOR_GAIN=0.5（2026-09-05 用户：侧壁削弱，坑底满强度）。
    if (vPw > 0.001) {
      alb *= mix(1.0, patchDecor(vTex, vPw).x, ${WALL_DECOR_GAIN});
    }

    // ★ 4×4 地块边界描边（与顶面同款：分界线在墙面上延展）
    vec2 buv = fract((isWaterWall ? vUvC : vUv) * 15.0);
    float dEdge = min(min(buv.x, 1.0 - buv.x), min(buv.y, 1.0 - buv.y));
    float edge = 1.0 - smoothstep(0.0, 0.010, dEdge);
    base = mix(base, vec3(0.02), edge * uMatSurface[id].w);

    // 伪 AO：大尺度斑块暗谷（patch 负值 = 谷地 = 变暗；0.4~1.0）
    float ao = smoothstep(-0.3, 0.3, field.x) * 0.6 + 0.4;

    // ★ 直射保底：墙面是竖直面，法线水平不受直射（N·L≈0）——若所属地块
    //   在烘焙阴影区（lm.r≈0），整面墙只剩 ambient×ao ≈ 纯黑。直射项按
    //   昼夜各钳下限：夜晚 ≥${WALL_NIGHT_DIRECT_FLOOR.toFixed(2)}（月光级；
    //   原 0.85 月光全开级别把夜晚壁面顶得比顶面亮太多——2026-09-07 用户：
    //   夜间侧壁非常亮 → 降档），白天 ≥${WALL_DIRECT_DAY_FLOOR.toFixed(2)}
    //   （坡脚/影区墙保亮，见 WALL_DIRECT_DAY_FLOOR 追注释；2026-09-05 修坡面
    //   侧壁偏暗）。
    //   ★ 水体墙同样受保底（2026-09-05 补）：台缘坡壁低侧若为 water 块，裸
    //   lm.r≈0.09 乘 0.32 增益 → 近似纯黑（用户实测 seed12345 chunk(-1,1)）；
    //   保底后经 ×0.32 仍读作深暗水面，不再死黑。
    float d = mix(max(lm.r, ${WALL_NIGHT_DIRECT_FLOOR.toFixed(2)}), max(lm.r, ${WALL_DIRECT_DAY_FLOOR.toFixed(2)}), uSunDay);

    // ★ LOD 内实时太阳方向重映射（与顶面同款，2026-09-05）：墙面法线水平 →
    //   方向感最明显（朝阳墙/背阳墙随实时太阳全天旋转）；水墙豁免（深暗水面
    //   是专调观感，不随方向变亮）
    {
      vec3 Lw = normalize(uSunDir);
      float dirMod = clamp(max(dot(vNw, Lw), 0.12) / max(Lw.y, 0.12),
        ${SUN_DIR_MOD_MIN.toFixed(2)}, ${SUN_DIR_MOD_MAX.toFixed(2)});
      float lodW = smoothstep(${SUN_DIR_LOD_FAR.toFixed(1)}, ${SUN_DIR_LOD_NEAR.toFixed(1)},
        length(cameraPosition - vWpos));
      d *= mix(1.0, dirMod, isWaterWall ? 0.0 : lodW);
    }

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
    useVertexColor = false, // ★ 补丁色通道（§14.10）：乘性焦土染色
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
      uSunDir: { value: new THREE.Vector3(-0.342, 1.0, 0.940).normalize() },
      uTime: { value: 0 },
    });
    super({
      uniforms: u,
      vertexShader: WALL_VERT(useVertexColor ? 'color' : 'vec3(1.0)'),
      fragmentShader: MATERIAL_GLSL + PATCH_DECOR_GLSL + WALL_FRAG,
      fog: true,
    });
    wallRegistry.add(this);
    this.vertexColors = useVertexColor; // 供 three 注入 attribute color
  }

  override dispose(): void {
    wallRegistry.delete(this);
    super.dispose();
  }
}

/** 模式退出清空注册表（材质由 disposeVisual 释放；世界 Hot 段统一 reset 重来）。
 *  ★ 常驻共享材质（userData.decorShared，如 sharedWaterMaterial）不得清——
 *    它是模块单例，构造时注册一次，被清掉后不会重新注册 → uTime/昼夜喂值冻结
 *    （症状：返回舰船再进战场后水体静止、落水抖动失效）。 */
export function clearWallMaterialRegistry(): void {
  for (const m of [...wallRegistry]) {
    if ((m.userData as { decorShared?: boolean } | undefined)?.decorShared) continue;
    wallRegistry.delete(m);
  }
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
    // ★ 实时太阳方向（LOD 内方向重映射用；守卫式，Boss4D 墙材质跳过）
    if (m.uniforms.uSunDir) m.uniforms.uSunDir.value.set(sun.dir.x, sun.dir.y, sun.dir.z);
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