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

const MATERIAL_GLSL = /* glsl */ `
  // ==================== 材质输入（★ 必须先声明后使用；放函数库最前） ====================
  uniform sampler2D uTileIds;
  uniform vec4 uMatBaseLCH[${MATERIAL_SLOTS}];
  uniform vec4 uMatJitter[${MATERIAL_SLOTS}];
  uniform vec4 uMatSurface[${MATERIAL_SLOTS}];
  uniform vec4 uMatEmissive[${MATERIAL_SLOTS}];
  uniform int uMatFn[${MATERIAL_SLOTS}];
  uniform float uMatParams[${MATERIAL_SLOTS * 16}];
  uniform float uMatLODEmissive[${MATERIAL_SLOTS}];

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

  // 纯泥土地面：全尺度明暗颗粒，饱和度只走中频（成片浓淡），色相克制
  vec4 mat_dirt(vec3 f, vec2 w, int id) {
    float grain = (h21(floor(w * 80.0)) - 0.5) * matP(id, 0);
    float patchv = f.x * matP(id, 3) * 0.5;
    float midv = f.y * matP(id, 2) * 0.35;
    vec2 c = floor(w * 0.5);
    float peb = h21(c + vec2(17.7, 3.3)) < matP(id, 1) ? -0.05 : 0.0;
    float dL = patchv + midv + grain + peb;
    float dC = f.y * 0.004;
    float reflect = 1.0 + patchv * 0.40 + midv * 0.25 + grain * 0.12;
    return vec4(dL, dC, 0.0, reflect);
  }

  // 砖石路面：每砖独立明暗 + 灰缝 + 变体，色相随旧砖微偏黄
  vec4 mat_brick(vec3 f, vec2 w, int id) {
    vec2 cell = floor(w / 1.0);
    vec2 l = fract(w / 1.0);
    l.x = fract(l.x + h21(cell + vec2(3.1, 0.0)) * 0.5);   // 交错错位
    float jit = (h21(cell + vec2(13.1, 0.0)) - 0.5) * matP(id, 1);
    float variant = h21(cell + vec2(29.3, 0.0)) < matP(id, 2) ? 0.05 : 0.0;
    float broken = h21(cell + vec2(41.7, 0.0)) < matP(id, 3) ? -0.08 : 0.0;
    float grout = (l.x > 1.0 - matP(id, 0) || l.y > 1.0 - matP(id, 0)) ? -0.30 : 0.0;
    float dL = jit + variant + broken + grout + f.y * 0.05;
    float dH = h21(cell + vec2(29.3, 0.0)) < matP(id, 2) ? 0.02 : 0.0;
    float reflect = 1.0 + jit * 0.30 + grout * 0.20 + f.y * 0.25;
    return vec4(dL, f.y * 0.003, dH, reflect);
  }

  // 草地路面：大尺度明暗斑块为主，饱和度随 patch 浓淡，草簇/草尖局部
  vec4 mat_grass(vec3 f, vec2 w, int id) {
    float patchv = f.x * matP(id, 0) * 0.6;
    float grain = f.z * matP(id, 3) * 1.5;
    vec2 c = floor(w * 2.2);
    float tuftDark = h21(c + vec2(51.1, 0.0)) < matP(id, 1) ? -0.06 : 0.0;
    float tuftHi = h21(c * 1.7 + vec2(9.9, 1.1)) < matP(id, 2) ? 0.05 : 0.0;
    float blade = f.y * 0.06;
    float dL = patchv + grain + tuftDark + tuftHi + blade;
    float dC = patchv * 0.2 + f.y * 0.006;
    float reflect = 1.0 + patchv * 0.40 + (tuftHi - tuftDark) * 0.20 + blade * 0.10;
    return vec4(dL, dC, f.y * 0.004, reflect);
  }

  // 木板路面：板缝 + 每板抖动 + 木纹（中频），色相随新旧板微偏
  vec4 mat_wood(vec3 f, vec2 w, int id) {
    float plk = floor(w.y / 0.6);
    float seam = fract(w.y / 0.6) < 0.02 ? -0.30 : 0.0;
    float jit = (h21(vec2(plk, 7.7)) - 0.5) * matP(id, 2);
    float grain = f.y * matP(id, 3) * 0.6;
    vec2 c = floor(w / 1.2);
    float nail = 0.0;
    if (h21(c + vec2(88.3, 4.4)) < matP(id, 4)) {
      vec2 l = fract(w / 1.2) - 0.5;
      if (dot(l, l) < 0.004) nail = -0.30;
    }
    float dL = seam + jit + grain + nail;
    float dH = (h21(vec2(plk, 7.7)) - 0.5) * 0.03;
    float reflect = 1.0 + jit * 0.30 + grain * 0.16 + seam * 0.08;
    return vec4(dL, f.y * 0.004, dH, reflect);
  }

  // 岩石：中频分层岩理 + 方向拉丝 + 粗裂纹，色相克制
  vec4 mat_rock(vec3 f, vec2 w, int id) {
    float strata = f.y * matP(id, 0) * 0.6;
    float streak = (vnoise2(vec2(w.x * 0.3, w.y * 0.05)) - 0.5) * matP(id, 1) * 0.5;
    vec2 c = floor(w * 0.8);
    float crack = h21(c + vec2(19.3, 8.8)) < matP(id, 2) ? -0.10 : 0.0;
    // ★ 浅色噪点：grain 只加亮（不产生黑板颗粒），幅度减半
    float grain = max(f.z, 0.0) * matP(id, 3) * 0.6;
    float dL = strata + streak + crack + grain;
    float reflect = 1.0 + strata * 0.30 + streak * 0.20 + grain * 0.10 + crack * 0.08;
    return vec4(dL, f.y * 0.002, 0.0, reflect);
  }

  // 苔藓：石底 + 苔斑——苔区更暗更饱和，色相微偏绿
  vec4 mat_moss(vec3 f, vec2 w, int id) {
    float cover = smoothstep(matP(id, 0), matP(id, 0) + 0.25, f.x * 0.5 + 0.5);
    float fuzz = f.z * 0.05 * cover;
    float reflect = 1.0 + cover * 0.35 + fuzz * 0.12;
    return vec4(-cover * 0.12 + fuzz, cover * 0.05, cover * 0.03, reflect);
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