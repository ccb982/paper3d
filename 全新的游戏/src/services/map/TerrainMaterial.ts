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
//   uMatBase[id]      = vec4(rgb基色, roughness)
//   uMatSurface[id]   = vec4(specular, fresnel, emissiveStrength, edgeStrength)
//   uMatEmissive[id]  = vec4(emissive rgb)
//   uMatParams[id*16] = 材质图案参数（16 个 float，顺序 = 注册模板声明顺序）
//
// 分发：if 链按 tileId 调 GLSL 材质函数（≤16 分支，同地块像素分支一致，
//   GPU 相干；加材质 = 注册 + 在 materialBase 加一个分支）。
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
  .map(([fnId, idx]) => `    if (fn == ${idx}) return mat_${fnId}(w, id);`)
  .join('\n');

/**
 * 每 chunk 材质渲染配置（ChunkManager 从块数据构建；基色/参数全部打包成数组）
 */
export interface TileRenderConfig {
  /** 15×15 块 id 微纹理（R8，Nearest，flipY=false） */
  tileIds: THREE.DataTexture;
  /** vec4×N：rgb 基色 + roughness */
  base: Float32Array;
  /** vec4×N：specular, fresnel, emissiveStrength, edgeStrength */
  surface: Float32Array;
  /** vec4×N：emissive rgb */
  emissive: Float32Array;
  /** float×N×16：材质图案参数（id*16 + i） */
  params: Float32Array;
  /** int×N：每 tile id 的材质函数索引（uMatFn；-1 = 无材质） */
  fn: Int32Array;
}

const MATERIAL_GLSL = /* glsl */ `
  // ==================== 材质输入（★ 必须先声明后使用；放函数库最前） ====================
  uniform sampler2D uTileIds;
  uniform vec4 uMatBase[${MATERIAL_SLOTS}];
  uniform vec4 uMatSurface[${MATERIAL_SLOTS}];
  uniform vec4 uMatEmissive[${MATERIAL_SLOTS}];
  uniform int uMatFn[${MATERIAL_SLOTS}];
  uniform float uMatParams[${MATERIAL_SLOTS * 16}];

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

  // ==================== 材质函数（返回相对基色的调制系数，最终 ×uMatBase） ====================

  // 纯泥土地面：颗粒 / 小石子 / 路辙扫痕 / 大尺度斑驳
  vec3 mat_dirt(vec2 w, int id) {
    float grain = (h21(floor(w * 80.0)) - 0.5) * matP(id, 0) * 2.0;
    float patchv = (vnoise2(w * 0.04) - 0.5) * matP(id, 3) * 2.0;
    vec2 c = floor(w * 0.5);
    float peb = h21(c + vec2(17.7, 3.3)) < matP(id, 1) ? -0.12 : 0.0;
    float ruts = (vnoise2(vec2(w.x * 0.2, w.y * 1.5)) - 0.5) * matP(id, 2);
    return vec3(1.0 + grain + patchv + peb + ruts);
  }

  // 砖石路面：砖块网格 + 灰缝 + 每砖抖动 + 色变体 + 破损（棋盘感来源之一）
  vec3 mat_brick(vec2 w, int id) {
    vec2 cell = floor(w / 1.0);
    vec2 l = fract(w / 1.0);
    l.x = fract(l.x + h21(cell + vec2(3.1, 0.0)) * 0.5);   // 交错错位
    float jit = (h21(cell + vec2(13.1, 0.0)) - 0.5) * matP(id, 1) * 2.0;
    float variant = h21(cell + vec2(29.3, 0.0)) < matP(id, 2) ? 0.06 : 0.0;
    float broken = h21(cell + vec2(41.7, 0.0)) < matP(id, 3) ? -0.10 : 0.0;
    float grout = (l.x > 1.0 - matP(id, 0) || l.y > 1.0 - matP(id, 0)) ? -0.38 : 0.0;
    return vec3(1.0 + jit + variant + broken + grout);
  }

  // 草地路面：大尺度明暗斑块 + 草簇暗孔/受光草尖 + 草叶方向拉丝
  vec3 mat_grass(vec2 w, int id) {
    float patchv = (vnoise2(w * 0.035) - 0.5) * matP(id, 0) * 2.0;
    float grain = (h21(floor(w * 55.0)) - 0.5) * matP(id, 3);
    // 草簇网格（~0.45m）：暗簇底（土色空隙）+ 受光草尖高光
    vec2 c = floor(w * 2.2);
    float tuftDark = h21(c + vec2(51.1, 0.0)) < matP(id, 1) ? -0.14 : 0.0;
    float tuftHi = h21(c * 1.7 + vec2(9.9, 1.1)) < matP(id, 2) ? 0.12 : 0.0;
    // 草叶方向拉丝（沿 x 的细密明度条，制造草叶方向感）
    float blade = (vnoise2(vec2(w.x * 7.0, w.y * 0.35)) - 0.5) * 0.10;
    return vec3(1.0 + patchv + grain + tuftDark + tuftHi + blade);
  }

  // 木板路面：横板条 + 板缝 + 板抖动 + 木纹 + 钉点
  vec3 mat_wood(vec2 w, int id) {
    float plk = floor(w.y / 0.6);
    float seam = fract(w.y / 0.6) < 0.02 ? -0.40 : 0.0;
    float jit = (h21(vec2(plk, 7.7)) - 0.5) * matP(id, 2) * 2.0;
    float grain = (vnoise2(vec2(w.x * 0.15, w.y * 2.5)) - 0.5) * matP(id, 3) * 2.0;
    vec2 c = floor(w / 1.2);
    float nail = 0.0;
    if (h21(c + vec2(88.3, 4.4)) < matP(id, 4)) {
      vec2 l = fract(w / 1.2) - 0.5;
      if (dot(l, l) < 0.004) nail = -0.35;
    }
    return vec3(1.0 + seam + jit + grain + nail);
  }

  // 岩石：分层岩理 + 方向拉丝 + 粗裂纹 + 颗粒
  vec3 mat_rock(vec2 w, int id) {
    float strata = (vnoise2(w * 0.05) - 0.5) * matP(id, 0) * 2.0;
    float streak = (vnoise2(vec2(w.x * 0.3, w.y * 0.05)) - 0.5) * matP(id, 1) * 2.0;
    vec2 c = floor(w * 0.8);
    float crack = h21(c + vec2(19.3, 8.8)) < matP(id, 2) ? -0.20 : 0.0;
    float grain = (h21(floor(w * 30.0)) - 0.5) * 0.05;
    return vec3(1.0 + strata + streak + crack + grain);
  }

  // 苔藓：石底 × 苔斑混合 + 绒毛
  vec3 mat_moss(vec2 w, int id) {
    float cover = smoothstep(matP(id, 0), matP(id, 0) + 0.25, vnoise2(w * 0.1));
    vec3 stone = vec3(1.0);
    vec3 moss = vec3(0.55, 0.78, 0.5);
    vec3 col = mix(stone, moss, cover * matP(id, 3));
    float fuzz = (h21(floor(w * 40.0)) - 0.5) * 0.05 * cover;
    return col + fuzz;
  }

  // ==================== 分发（数据驱动：tile→材质.fnId→GLSL 函数） ====================
  // 不再按 tile id 硬编码分支；uMatFn[id] = 材质注册表函数索引，
  // 分发链由 MAT_FN_INDEX 自动生成。加材质只在两处登记，不再碰本函数体。
  vec3 materialBase(vec2 w, int id) {
    int fn = uMatFn[id];
${MATERIAL_DISPATCH}
    return vec3(1.0);   // 无材质地块 → 基色 1.0（叠加层提供颜色）
  }
`;

// ==================== 片元主函数（uniform 声明已在 MATERIAL_GLSL 顶部） ====================
const FRAGMENT_MAIN = /* glsl */ `
        uniform sampler2D uAlbedo;
        uniform sampler2D uLightmap;
        uniform vec3 uSunDir;
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

          // 材质函数输出相对调制系数 → × 该地块基色（调色板）
          vec3 base = materialBase(vWorld, id) * uMatBase[id].rgb;

          // ★ 4×4 地块边界描边（棋盘感）：块内 UV 距边 → 压暗
          vec2 buv = fract(vUv * 15.0);
          float dEdge = min(min(buv.x, 1.0 - buv.x), min(buv.y, 1.0 - buv.y));
          float edge = 1.0 - smoothstep(0.0, 0.05, dEdge);
          base *= 1.0 - edge * uMatSurface[id].w;

          vec3 lit = base * alb * (uAmbientColor * lm.g + uSunColor * lm.r);

          // ---- 表面属性（材质）：镜面 / 菲涅尔 / 自发光 ----
          vec3 N = vec3(0.0, 1.0, 0.0);
          vec3 V = normalize(cameraPosition - vec3(vWorld.x, 0.0, vWorld.y));
          vec3 L = normalize(uSunDir);
          float spec = uMatSurface[id].x;
          if (spec > 0.001) {
            vec3 H = normalize(L + V);
            lit += uSunColor * spec * pow(max(dot(N, H), 0.0), 24.0);
          }
          float fres = uMatSurface[id].y;
          if (fres > 0.001) {
            lit += fres * pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.30;
          }
          float emis = uMatSurface[id].z;
          if (emis > 0.001) {
            lit += uMatEmissive[id].rgb * emis * (0.92 + 0.08 * h21(vUv * 512.0));
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
        uMatBase: { value: cfg?.base ?? new Float32Array(MATERIAL_SLOTS * 4) },
        uMatSurface: { value: cfg?.surface ?? new Float32Array(MATERIAL_SLOTS * 4) },
        uMatEmissive: { value: cfg?.emissive ?? new Float32Array(MATERIAL_SLOTS * 4) },
        uMatFn: { value: cfg?.fn ?? new Int32Array(MATERIAL_SLOTS).fill(-1) },
        uMatParams: { value: cfg?.params ?? new Float32Array(MATERIAL_SLOTS * 16) },
        uSunDir: { value: new THREE.Vector3(-0.342, 1.0, 0.940).normalize() },
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
  color: number;
  intensityScale: number;
  daylight: number;
}): void {
  const T = TERRAIN_LIGHT_TUNING;
  const ambHex = nightLerpHex(T.ambientNight, T.ambientDay, sun.daylight);
  const ambI = T.ambientNightIntensity +
    (T.ambientDayIntensity - T.ambientNightIntensity) * sun.daylight;
  for (const m of registry) {
    m.uniforms.uAmbientColor.value.setHex(ambHex).multiplyScalar(ambI);
    m.uniforms.uSunColor.value.setHex(sun.color).multiplyScalar(T.sunIntensity * sun.intensityScale);
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