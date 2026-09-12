// ============================================================
// WaterMaterial —— 水体管线独立材质（不进 MAT_FN_INDEX，独享 GLSL）
// ============================================================
// 语义（《地形与渲染管线架构.md》§4）：
//   · 静止基面几何（WaterSurface）由本材质做着色/动画；水位=0，顶点 y 即世界高。
//   · 表面（deep>=0）：预计算 FFT 海况场（WaterFFT，3 层 × 2 相位变体；
//       烘焙在 oceanBake worker 后台跑，主线程只打包 DataTexture——加载期不卡）
//       - 顶点位移：L0/L1 高度+choppy 滚动采样（世界连续，跨 chunk 无缝）
//       - 片元法线/焦散/泡沫：L1/L2 层世界法线叠加
//       - 菲涅尔 + 程序化天空反演 + Blinn 太阳高光
//   · ★ 距离 LOD 环（《地形与渲染管线架构.md》§1 播放/静态层；2026-09-09 落地）：
//       uLodNear(12m) 内 = 三实例 FFT 全量；近→远 smoothstep 渐隐：
//         顶点丢 L1/L2 采样 + 波高/choppy/激荡乘 lodW → 55m 外波高 0（静态基准面）；
//         片元丢 n1/n2 法线级联，泡沫/波形交替高光消隐。纯 shader 零几何改动，
//         无边跳变（宽 43m 渐变带 + border 顶点本就不参与位移）。
//   · 坑水帘/斜边（deep<0）与 boss4D 水幕/漂浮保持原管线（旧解析波动）。
//   · 一个全局共享实例喂所有 chunk（材质不参与地形分发）；防 chunk 重建误杀：
//     userData.decorShared = true（ChunkManager.disposeVisual 跳过 shared 释放）。
//   · 光照喂值挂 wallRegistry（updateWallMaterialsLighting 昼夜同 feed，uTime 每帧）。
//   · 半透明：透明 pass 里 renderOrder=10（地形不透明之后）；depthWrite=false。
// ============================================================

import * as THREE from "three";
import { registerWallLightTarget, unregisterWallLightTarget } from "./TerrainMaterial";
import { WATER_MAX_DEEP } from "./WaterSurface";
import type { WaterSurfaceRaw } from "./WaterSurface";
import { bakeOceanField, defaultOceanParams, DEFAULT_OCEAN_LAYERS, type OceanBakeParams, type OceanTile } from "./WaterFFT";
import { oceanBaker } from "./OceanBaker";

// ------------------------------------------------------------
// 预计算 FFT 贴图（启动烘焙一次；Worker 后台跑 FFT，主线程只打包 DataTexture）
// ------------------------------------------------------------
const OCEAN_SEED = 12345; // 海况确定性种子

/** 层 → 半浮点 DataTexture */
function halfFloatTexture(
  data: Float32Array,
  w: number,
  h: number,
  format: THREE.PixelFormat,
): THREE.DataTexture {
  const raw = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) raw[i] = THREE.DataUtils.toHalfFloat(data[i]);
  const tex = new THREE.DataTexture(raw, w, h, format, THREE.HalfFloatType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; // 供片元 footprint→粗糙度；Repeat 包装兼容 WebGL2
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

interface OceanTextures {
  hdA: THREE.Texture[]; hdB: THREE.Texture[];
  nA: THREE.Texture[]; nB: THREE.Texture[];
}

/**
 * 全量烘焙并生成材质贴图：
 * FFT 字节来自 OceanBaker（oceanBake worker）；主线程只做 HalfFloat DataTexture 打包。
 * Worker 不可用/故障 → 主线程同步 bakeOceanField 同源回退（字节一致）。
 */
async function bakeOceanTextures(params: OceanBakeParams): Promise<OceanTextures> {
  let tiles: OceanTile[][] | null = null;
  try {
    tiles = await oceanBaker.bake(params.seed);
  } catch (e) {
    console.warn("[WaterMaterial] 海况 Worker 请求异常，改主线程同步：", e);
  }
  if (!tiles) {
    try {
      tiles = bakeOceanField(params);
    } catch (e) {
      const err = e as Error;
      throw new Error(`海况同步烘焙失败：${err?.stack ?? String(e)}`);
    }
  }
  try {
    const hdA: THREE.Texture[] = [], hdB: THREE.Texture[] = [];
    const nA: THREE.Texture[] = [], nB: THREE.Texture[] = [];
    for (const layer of tiles) {
      const [tileA, tileB] = layer;
      const N = Math.sqrt(tileA.h.length) | 0;
      hdA.push(packHD(tileA, N));
      hdB.push(packHD(tileB, N));
      nA.push(packN(tileA, N));
      nB.push(packN(tileB, N));
    }
    return { hdA, hdB, nA, nB };
  } catch (e) {
    const err = e as Error;
    throw new Error(`海况贴图打包失败：${err?.stack ?? String(e)}`);
  }

  function packHD(t: OceanTile, N: number): THREE.DataTexture {
    const f = new Float32Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      f[i * 4] = t.h[i];
      f[i * 4 + 1] = t.d[i];
      f[i * 4 + 2] = t.d[N * N + i];
    }
    return halfFloatTexture(f, N, N, THREE.RGBAFormat);
  }
  function packN(t: OceanTile, N: number): THREE.DataTexture {
    // ★ RGBA（勿用 RGB）：WebGL2 下 RGB16F 作为生成 mipmap 的浮点源不保证可渲染，
    //   会导致整张法线纹理 mipmap 生成失败 → 片元全灭。a 通道填 1 占位。
    const f = new Float32Array(N * N * 4);
    for (let i = 0; i < N * N; i++) {
      f[i * 4] = t.n[i * 3];
      f[i * 4 + 1] = t.n[i * 3 + 1];
      f[i * 4 + 2] = t.n[i * 3 + 2];
      f[i * 4 + 3] = 1.0;
    }
    return halfFloatTexture(f, N, N, THREE.RGBAFormat);
  }
}

/** 占位 1×1 纹理：烘焙就绪前喂给 uniform 槽（shader 以 uHasOcean=0 门控跳采样） */
function placeholderTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.needsUpdate = true;
  return tex;
}

let oceanTextures: OceanTextures | null = null;
let oceanTexturesPending: Promise<OceanTextures> | null = null;
async function ensureOceanTextures(): Promise<OceanTextures> {
  if (oceanTextures) return oceanTextures;
  if (!oceanTexturesPending) {
    // ★ 失败不缓存 rejected promise（旧实现失败一次 = 永久静态水面，无法重试）
    oceanTexturesPending = bakeOceanTextures(defaultOceanParams(OCEAN_SEED))
      .then((p) => {
        oceanTextures = p;
        return p;
      })
      .catch((e) => {
        oceanTexturesPending = null;
        throw e;
      });
  }
  return oceanTexturesPending;
}

// ------------------------------------------------------------
// 顶点着色器
// ------------------------------------------------------------
// 局部水面剧烈波动（角色入水 / 炮弹近水 → sharedWaterMaterial.addImpact 注入；
// 顶点抬升 + 片元斜率，纯水面表现，不改角色/碰撞）
// ------------------------------------------------------------
/** uImpact 槽位数（GLSL #define IMPACT_SLOTS 同步） */
const IMPACT_SLOTS = 6;
const IMPACT_UNI = /* glsl */ `
  #define IMPACT_SLOTS 6
  uniform vec4 uImpact[IMPACT_SLOTS]; // xy=世界落点(xz); z=强度; w=起始时刻(w<0=空槽)

  // 落点剧烈起伏：中心回弹涌浪 + 以 ~2.2m/s 外扩的环形波阵，约 2s 内衰减
  float impactAgitation(vec2 wp, float t) {
    float h = 0.0;
    for (int i = 0; i < IMPACT_SLOTS; i++) {
      vec4 im = uImpact[i];
      if (im.w < 0.0) continue;
      float age = t - im.w;
      if (age < 0.0 || age > 2.0) continue;
      float d = max(length(wp - im.xy), 0.03);
      float fade = exp(-age * 1.7);
      float core = exp(-d * d * 3.0);                       // 中心回弹涌浪
      h += im.z * core * (0.35 + 0.65 * sin(age * 11.0)) * fade;
      float dd = (d - age * 2.2) * 2.2;
      float ringA = exp(-dd * dd);                          // 外扩环带
      h += im.z * ringA * sin(d * 9.0 - age * 30.0) * fade * 0.8;
    }
    return h;
  }
`;

// ------------------------------------------------------------
const WATER_VERT = /* glsl */ `
  attribute float deep;
  attribute float border;
  attribute vec2 spin;
  uniform float uTime;
  uniform float uHasOcean;
  uniform vec2 uScrollDir;
  uniform vec3 uLayerScale;   // 每层世界尺度（m）
  uniform vec3 uSpeed;        // 每层滚动速度（m/s）
  uniform vec3 uAmp;          // 每层高度幅度
  uniform vec3 uChop;         // 每层 choppy 位移幅度
  uniform vec3 uTriPeriod;    // 每层 A/B 交叠周期（s）
  uniform float uLodNear;     // ★ 距离 LOD 近界（m；内 = 全量三实例）
  uniform float uLodFar;      // ★ 距离 LOD 远界（m；外 = 静态基准面，波高→0）

  uniform sampler2D uHD0A; uniform sampler2D uHD0B;
  uniform sampler2D uHD1A; uniform sampler2D uHD1B;
  uniform sampler2D uHD2A; uniform sampler2D uHD2B;
  uniform float uAmpScale;
  uniform float uChopScale;  // boss4D choppy 单独缩放（水平位移更敏感）

  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vDeep;
  varying vec3 vWorld;
  #include <fog_pars_vertex>

  // 波浪三角交叠权重（0→1→0，循环无色缝）
  float triW(float t, float period) {
    return 1.0 - abs(2.0 * fract(t / period * 0.5) - 1.0);
  }

  // 旧解析波动（水帘/boss 仍用；保证坑水交界与幕布正确跟随）
  float waterWaveY(vec2 p, float t) {
    return 0.06 * ( 0.60 * sin(p.x * 0.55 + t * 1.40)
                  + 0.55 * sin(p.y * 0.75 - t * 1.10)
                  + 0.35 * sin((p.x + p.y) * 0.35 + t * 0.80) );
  }

  // L0：涌浪（仅顶点位移）
  vec4 hdLayer0(vec2 uv, float t) {
    float w = triW(t, uTriPeriod.x);
    vec4 a = texture2D(uHD0A, uv);
    vec4 b = texture2D(uHD0B, uv);
    return mix(a, b, w);
  }
  // L1：主波（顶点位移）
  vec4 hdLayer1(vec2 uv, float t) {
    float w = triW(t, uTriPeriod.y);
    vec4 a = texture2D(uHD1A, uv);
    vec4 b = texture2D(uHD1B, uv);
    return mix(a, b, w);
  }
  // L2：细节波（顶点级小涟漪，让波浪层次更可见）
  vec4 hdLayer2(vec2 uv, float t) {
    float w = triW(t, uTriPeriod.z);
    vec4 a = texture2D(uHD2A, uv);
    vec4 b = texture2D(uHD2B, uv);
    return mix(a, b, w);
  }

  ${IMPACT_UNI}

  void main() {
    vUv = uv;
    vNormal = normalize(normal);
    vDeep = deep;
    // ---- boss4D 水幕：自转（几何以自身中心为原点）----
    float isFall = step(0.5, -deep);        // deep -1（坑帘）/ -2（boss4D 水幕）: 1
    float isBoss = step(0.5, -deep - 1.5);  // deep -2: 1
    // isRoof: 1 = 不是屋顶（deep != -3）; 0 = 是屋顶（deep == -3）
    float isNotRoof = step(0.5, abs(deep + 3.0)); // abs(deep+3)≥0.5 → 1（非屋顶）
    vec3 pos = position;
    if (isBoss > 0.5) {
      float ang = spin.x * uTime + spin.y;
      float sa = sin(ang), ca = cos(ang);
      float px = pos.x, pz = pos.z;
      pos.x = px * ca + pz * sa;
      pos.z = -px * sa + pz * ca;
    }
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorld = wp.xyz;
    // ★ 距离 LOD 环（《地形与渲染管线架构.md》§1；smoothstep 无缝，无跳变）：
    //   近界内 = 1（三实例 FFT 全量）→ 远界外 = 0（波高/choppy/激荡全灭，静态基准面）
    float camDist = length(cameraPosition - wp.xyz);
    float lodW = 1.0 - smoothstep(uLodNear, uLodFar, camDist);
    float wv = 0.0;
    // ★ 局部落水剧烈波动（角色入水/炮弹近水）：独立于 FFT 海况——
    //   海况未就绪/烘焙失败时也照常抖动（此前误挂在海况分支内 → "抖动初始化失败"）。
    //   连续空间场，含边界顶点一起抬升不会撕裂（不再受 border 静止约束）。
    float shake = 0.0;
    if (isNotRoof > 0.5 && isFall <= 0.5) {
      shake = impactAgitation(wp.xz, uTime) * lodW;
    }
    if (isNotRoof > 0.5 && isFall <= 0.5 && uHasOcean > 0.5 && border < 0.5) {
      // ★ 水面（deep=0）内部顶点：预计算 FFT 位移（世界 uv，跨 chunk 无缝）
      //   边界顶点（border=1，与岸/坑/水帘交界）保持静止，避免纹理性翘边。
      vec2 uv0 = wp.xz / uLayerScale.x + uScrollDir * (uTime * uSpeed.x);
      vec4 a = hdLayer0(uv0, uTime);
      float h = a.r * uAmp.x * 0.5;
      vec2 disp = a.gb * uChop.x;
      // ★ 中远距离丢 L1/L2（细节波对远处不可见；省 2/3 顶点采样）
      if (lodW > 0.25) {
        vec2 uv1 = wp.xz / uLayerScale.y + uScrollDir * (uTime * uSpeed.y);
        vec2 uv2 = wp.xz / uLayerScale.z + uScrollDir * (uTime * uSpeed.z);
        vec4 b = hdLayer1(uv1, uTime);
        vec4 c = hdLayer2(uv2, uTime);
        h += b.r * uAmp.y * 0.45 + c.r * uAmp.z * 0.08;
        disp += b.gb * uChop.y + c.gb * uChop.z * 0.7;
      }
      wp.x += disp.x * uChopScale * lodW;
      wp.z += disp.y * uChopScale * lodW;
      // ★ 远界外波高 fade 到 0（静态基准面；近界内全量）
      wp.y += h * uAmpScale * 5.0 * lodW;
    } else if (isFall > 0.5) {
      wv = waterWaveY(wp.xz, uTime);
      if (isFall > 0.5) wv *= 1.0 - vUv.y * vUv.y;
      wp.y += wv;
    }
    wp.y += shake; // ★ 抖动统一叠加（不依赖 uHasOcean / border）
    // deep=-3 屋顶：无位移（保持稳定）
    if (isBoss > 0.5) wp.y += 0.5 * sin(uTime * 0.9 + spin.y * 3.0); // 4D 漂浮微动
    vec4 mvPosition = viewMatrix * wp;
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// ------------------------------------------------------------
// 片元着色器
// ------------------------------------------------------------
const WATER_FRAG = /* glsl */ `
  uniform vec3 uAmbientColor;
  uniform vec3 uSunColor;
  uniform float uSunDay;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uMaxDeep;
  uniform float uLodNear;
  uniform float uLodFar;
  uniform vec2 uScrollDir;
  uniform vec3 uLayerScale;
  uniform vec3 uSpeed;
  uniform vec3 uAmp;
  uniform vec3 uLayerAmp; // 各层已烘焙 RMS 幅度（片元相对归一用）
  uniform vec3 uTriPeriod;
  uniform vec3 uTexelCount; // 各层纹素数（LOD/粗糙度用）
  uniform float uWindSpeed; // 风速 m/s（Cox-Munk 粗糙度、白帽 onset 用）
  uniform vec3 uWaterScatter; // 水体散射色（蓝绿，驱动水体自身颜色）
  uniform vec3 uWaterAbsorb;  // 水体吸收色（深水吸收，暗蓝/暗绿）

  uniform sampler2D uHD0A; uniform sampler2D uHD0B;
  uniform sampler2D uHD1A; uniform sampler2D uHD1B;
  uniform sampler2D uHD2A; uniform sampler2D uHD2B;
  uniform sampler2D uN0A; uniform sampler2D uN0B;
  uniform sampler2D uN1A; uniform sampler2D uN1B;
  uniform sampler2D uN2A; uniform sampler2D uN2B;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vDeep;
  varying vec3 vWorld;

  #include <common>
  #include <fog_pars_fragment>

  float triW(float t, float period) {
    return 1.0 - abs(2.0 * fract(t / period * 0.5) - 1.0);
  }

  vec2 nl(sampler2D a, sampler2D b, vec2 uv, float w) {
    vec2 la = texture2D(a, uv).xy * 2.0 - 1.0;
    vec2 lb = texture2D(b, uv).xy * 2.0 - 1.0;
    return mix(la, lb, w);
  }
  vec3 norm(sampler2D a, sampler2D b, vec2 uv, float w) {
    vec3 na = texture2D(a, uv).xyz * 2.0 - 1.0;
    vec3 nb = texture2D(b, uv).xyz * 2.0 - 1.0;
    return normalize(mix(na, nb, w));
  }

  // ---- Cox-Munk 微面（项目同款）----
  float ggxD(float NoH, float a) {
    float a2 = a * a;
    return a2 / (3.14159265 * pow(NoH * NoH * (a2 - 1.0) + 1.0, 2.0));
  }
  float smithGGXCorrelated(float NoV, float NoL, float a) {
    float a2 = a * a;
    float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
    float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-5);
  }

  // 泡沫风条纹噪声（hash → 双八度值噪声，风方向拉长）
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i), b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  ${IMPACT_UNI}

  void main() {
    vec3 N;
    float isFall = step(0.5, -vDeep); // deep<0：水帘(坑 -1)/幕布(-2)/斜边(-3)
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(abs(dot(normalize(vNormal), V)), 0.0, 1.0), 2.0);

    vec3 col;
    float alpha;
    if (isFall > 0.5) {
      // ★ 水帘（与原管线一致）：vUv.y = 0 唇 → 1 坑底
      float t = vUv.y;
      float isRoof = 1.0 - step(0.5, abs(vDeep + 3.0)); // 仅 deep==-3 斜边
      vec3 waterAlbedo = vec3(0.40, 0.72, 0.68);      // 与水面顶同色（交合规）
      vec3 bottom = vec3(0.10, 0.22, 0.25);           // 坑底：明亮些，避免幕布整体过深
      vec3 grad = mix(waterAlbedo, bottom, smoothstep(0.0, 0.85, t)); // 下沉更缓更久
      float streak = isRoof > 0.5 ? 0.80 : 0.60 + 0.40 * sin(vUv.x * 11.0 - uTime * 3.0 + t * 5.0);
      col = grad * (0.80 + 0.20 * streak);
      float foamEdge = 1.0 - smoothstep(0.0, 0.08, t); // 唇沿薄泡沫
      col += vec3(foamEdge * 0.20);
      float glint = pow(max(dot(normalize(vNormal), normalize(vec3(0.0, 0.6, 1.0) - V)), 0.0), 6.0);
      col += glint * vec3(0.18, 0.28, 0.30);
      col *= uAmbientColor * 1.1 + uSunColor * 0.32 * uSunDay;
      col = mix(col, vec3(0.40, 0.72, 0.68) * (uAmbientColor * 0.95 + uSunColor * 0.10 * uSunDay), isRoof);
      alpha = mix(0.55, 0.15, isRoof);
      float jb = (1.0 - step(0.5, -vDeep - 1.5)) * (1.0 - smoothstep(0.0, 0.20, t));
      col = mix(vec3(0.40, 0.72, 0.68) * (uAmbientColor * 0.95 + uSunColor * 0.10 * uSunDay), col, jb);
    } else {
      // ---- ★ 水面：FFT 场 + 参考 natural-disasters 渲染思想 ----
      vec2 uv0 = vWorld.xz / uLayerScale.x + uScrollDir * (uTime * uSpeed.x);
      vec2 uv1 = vWorld.xz / uLayerScale.y + uScrollDir * (uTime * uSpeed.y);
      vec2 uv2 = vWorld.xz / uLayerScale.z + uScrollDir * (uTime * uSpeed.z);

      float w0 = triW(uTime, uTriPeriod.x);
      float w1 = triW(uTime, uTriPeriod.y);
      float w2 = triW(uTime, uTriPeriod.z);

      // 像素足印（米）：决定哪些细节进 mss 粗糙度、哪些还能解析
      vec2 dq = dFdx(vWorld.xz);
      vec2 dqv = dFdy(vWorld.xz);
      float fpA = length(dq), fpB = length(dqv);
      float fpShade = sqrt(max(fpA * fpB, 1e-5));   // 各向同性等效足印

      // ★ 距离 LOD 环（与顶点同档；远处丢 L1/L2 法线级联 + 泡沫/高光衰减）
      float fragLodW = 1.0 - smoothstep(uLodNear, uLodFar, length(cameraPosition - vWorld));

      // --- 法线：多尺度斜率叠加（几何法线包底，保持"面"的连续性）---
      vec3 n0 = norm(uN0A, uN0B, uv0, w0);   // L0 涌浪：大尺度斜率（全距离保留）
      vec3 n1 = vec3(0.0), n2 = vec3(0.0);
      float hasDetail = step(0.25, fragLodW);
      if (hasDetail > 0.5) {
        n1 = norm(uN1A, uN1B, uv1, w1);   // L1 主波
        n2 = norm(uN2A, uN2B, uv2, w2);   // L2 细节
      }
      vec3 N3raw = n0 + n1 + n2;
      vec3 N3 = normalize(vec3(N3raw.x * 4.5, N3raw.y, N3raw.z * 4.5));
      // footprint 越大 → 保留几何法线越多（远处不抖、不花）
      float geoW = clamp(fpShade * 0.5, 0.0, 1.0);
      N = normalize(mix(N3, vNormal, geoW * 0.18));

      // ★ 局部落水波动斜率并入法线（波动区的反光/波光随之剧烈晃动；远距离衰减）
      {
        float impE = 0.08;
        vec2 impWp = vWorld.xz;
        float hl = impactAgitation(impWp - vec2(impE, 0.0), uTime);
        float hr = impactAgitation(impWp + vec2(impE, 0.0), uTime);
        float hb = impactAgitation(impWp - vec2(0.0, impE), uTime);
        float hf = impactAgitation(impWp + vec2(0.0, impE), uTime);
        vec2 impSlope = vec2((hl - hr) / impE, (hb - hf) / impE);
        N = normalize(vec3(N.x + impSlope.x * 0.5 * fragLodW, N.y, N.z + impSlope.y * 0.5 * fragLodW));
      }

      // --- 粗糙度（Cox-Munk）：每个 cascade 丢失的细节 → mss ---
      vec3 texel = uLayerScale / uTexelCount;
      vec3 lod = log2(max(vec3(fpShade) / texel, vec3(1.0)));
      float mssTotal = 0.003 + 0.00512 * max(uWindSpeed, 0.5);
      vec3 share = vec3(0.06, 0.30, 0.64);
      float lost = share.x * clamp(lod.x / 6.0, 0.0, 1.0)
                 + share.y * clamp(lod.y / 6.0, 0.0, 1.0)
                 + share.z * clamp(lod.z / 6.0, 0.0, 1.0);
      float mssUnres = mssTotal * lost + 0.0009;
      float mssA = clamp(sqrt(2.0 * mssUnres), 0.012, 0.62);
      float roughness = clamp(sqrt(mssA), 0.02, 0.86);

      // 高度（泡沫/透亮用）“相对自身 RMS 归一”
      float h1x = mix(texture2D(uHD1A, uv1).r, texture2D(uHD1B, uv1).r, w1);
      float h2x = mix(texture2D(uHD2A, uv2).r, texture2D(uHD2B, uv2).r, w2);
      float h1n = h1x / max(uLayerAmp.y, 1e-4);
      float h2n = h2x / max(uLayerAmp.z, 1e-4);

      vec3 L = normalize(uSunDir);
      float NoV = max(dot(N, V), 1e-4);
      float F = 0.03 + 0.97 * pow(1.0 - NoV, 5.0); // Schlick 菲涅尔

// ---- 复刻参考项目：体积散射 + 吸收（HDR 值，系数已按本管线光强折算）----
      float depthT = clamp(vDeep / uMaxDeep, 0.0, 1.0);

      // 水体散射色（参考项目精确值）
      vec3 bodyR = uWaterScatter;

      // 背光透射：波峰薄水逆光发光，参考项目 ×3.4（系数按光强折算）
      float heightNorm = clamp(depthT * 0.5 + 0.5, 0.0, 1.0);
      float thinness = 1.0 / (1.0 + max(vDeep, 0.0) * 0.05);
      float backlit = heightNorm * thinness
                    * pow(clamp(dot(L, -V), 0.0, 1.0), 4.0)
                    * pow(0.5 - 0.5 * dot(L, N), 3.0);
      vec3 scatter = bodyR * uSunColor * backlit * 3.4 * 6.0 * uSunDay;

      // 下行辐照度：太阳直射 + 天空漫射驱动体积颜色
      float sunUp = max(L.y, 0.0);
      float sunFresnel = 0.03 + 0.97 * pow(1.0 - sunUp, 5.0);
      vec3 beam = uSunColor * sunUp * (1.0 - sunFresnel) * uSunDay;
      scatter += bodyR * (beam * 6.0 + uAmbientColor * 0.94);

      // 深水吸收（参考项目精确值，随天光）
      vec3 deep = uWaterAbsorb * uAmbientColor * 0.8 * 6.0;

      // 水体体积颜色（参考项目结构：scatter + deep）
      vec3 refracted = (scatter + deep);

      // --- 泡沫（克制：只在真正浪足处给一点白沫，漂浮白点来自波光而非泡沫）---
      float shore = 1.0 - smoothstep(0.0, 0.5, vDeep);          // 岸浅
      float waveFoam = smoothstep(1.0, 1.9, h1n) * smoothstep(0.9, 1.7, h2n);
      float foamMask = waveFoam * (0.30 + 0.40 * uSunDay);
      vec2 wind = uScrollDir;
      vec2 qs = mat2(wind.x, -wind.y, wind.y, wind.x) * vWorld.xz * 0.12;
      float windy = vnoise(qs + vec2(0.0, -uTime * 0.9)) * 0.55
                  + vnoise(qs * vec2(4.0, 4.0) * 3.0 + vec2(uTime * 1.3, 0.0)) * 0.40;
      float onset = mix(0.55, 0.40, clamp(uWindSpeed / 8.0, 0.0, 1.0));
      float carved = foamMask * (0.10 + windy * 1.0);
      float foam = smoothstep(onset, onset + 0.15, carved);
      foam *= 0.4 + 0.6 * smoothstep(0.35, 2.2, fpShade);       // 近处少量可见
      refracted = mix(refracted, vec3(0.93, 0.96, 0.985) * (uAmbientColor * 1.1 + uSunColor * 0.45 * uSunDay), foam * 0.35 * fragLodW);

      // --- 程序化天空反演（含太阳盘；粗粗糙度越大反射越糊）---
      vec3 Rf = reflect(-V, N);
      float ry = clamp(Rf.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 zenith = vec3(0.04, 0.09, 0.16);
      vec3 horiz = vec3(0.60, 0.72, 0.78);
      float blurR = mix(pow(ry, 0.55), smoothstep(0.0, 1.0, ry), clamp(roughness, 0.0, 1.0));
      vec3 sky = mix(horiz, zenith, blurR);
      vec3 sunDisk = uSunColor * max(pow(max(dot(Rf, L), 0.0), 400.0) * 1.2, 0.0) * uSunDay;
      sky = sky * (uAmbientColor * 1.15 + uSunColor * 0.55 * uSunDay) + sunDisk * 0.40;

      // 菲涅尔反射（参考项目：color = mix(refracted, env, F) + spec）
      // 反射携波法线纹理；roughness 越模糊越糊。+0.18 保证正视也露波纹
      float reflMix = clamp(F + 0.18, 0.0, 1.0);
      vec3 color = mix(refracted, sky, reflMix);

      // --- 太阳高光：GGX 微面（Cox-Munk α，参考项目同款），波浪朝向变化 → 波光 ---
      vec3 H = normalize(L + V);
      float NoH = max(dot(N, H), 0.0);
      float VoH = max(dot(V, H), 1e-4);
      float NoL = max(dot(N, L), 1e-4);
      float D = ggxD(NoH, mssA);
      float Vis = smithGGXCorrelated(NoV, NoL, mssA);
      float Fs = 0.02 + 0.98 * pow(1.0 - VoH, 5.0);
      float spec = D * Vis * Fs * NoL;
      // ★ 距离 LOD：近场全量（基波 + 波形交替波光）；远场只留基波，波形交替高光渐隐
      color += uSunColor * spec * 16.0 * uSunDay * (0.5 + 0.5 * fragLodW);
      // 波浪朝向变化的高频波光（L1/L2 法线），波纹形状明显（远场 hasDetail=0 自然归零）
      color += uSunColor * spec * 6.0 * uSunDay * pow(max(dot(n1, L), 0.5), 2.0);
      color += uSunColor * spec * 4.0 * uSunDay * pow(max(dot(n2, L), 0.5), 3.0);

      // 体色微面调制：波面斜率调制亮度 → 波峰亮、波谷暗，波形清楚
      float slopeLen = length(vec2(N.x, N.z));
      color *= (0.75 + 0.6 * slopeLen);

      // 岸线淡色透底
      color = mix(color, color * 1.12 + vec3(0.04, 0.10, 0.08), shore * 0.5);

      col = color;
      alpha = clamp(mix(0.72, 0.92, depthT) + foam * 0.18, 0.0, 0.96);
      N = normalize(vNormal);
    }

    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** 全局共享水体材质（所有 chunk 共用一份；透明 pass renderOrder=10） */
export class WaterMaterial extends THREE.ShaderMaterial {
  private disposed = false;

  constructor() {
    const blank = placeholderTexture();
    super({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uAmbientColor: { value: new THREE.Color(0x9aa8c4).multiplyScalar(0.65) },
        uSunColor: { value: new THREE.Color(0xfff3e0).multiplyScalar(1.1) },
        uSunDay: { value: 1 },
        uSunDir: { value: new THREE.Vector3(-0.342, 1.0, 0.940).normalize() },
        uTime: { value: 0 },
        uMaxDeep: { value: WATER_MAX_DEEP },
        // ---- 距离 LOD 环（§1 播放层/静态层；12m 内全量，55m 外静态基准面）----
        uLodNear: { value: 12 },
        uLodFar: { value: 55 },
        // ---- FFT 海况场（烘焙在 worker 后台；就绪前 uHasOcean=0 = 静态基面）----
        uHasOcean: { value: 0 },
        uScrollDir: { value: new THREE.Vector2(0.35, 0.94).normalize() },
        uLayerScale: { value: new THREE.Vector3(16, 6, 1.5) },
        uSpeed: { value: new THREE.Vector3(0.14, 0.28, 0.5) },
        uAmp: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
        uLayerAmp: { value: new THREE.Vector3(DEFAULT_OCEAN_LAYERS[0].amp, DEFAULT_OCEAN_LAYERS[1].amp, DEFAULT_OCEAN_LAYERS[2].amp) },
        uChop: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
        uTriPeriod: { value: new THREE.Vector3(11.0, 8.0, 5.0) },
        uTexelCount: { value: new THREE.Vector3(64, 128, 128) },
        uWindSpeed: { value: 5.0 },
        uHD0A: { value: blank }, uHD0B: { value: blank },
        uHD1A: { value: blank }, uHD1B: { value: blank },
        uHD2A: { value: blank }, uHD2B: { value: blank },
        uN0A: { value: blank }, uN0B: { value: blank },
        uN1A: { value: blank }, uN1B: { value: blank },
        uN2A: { value: blank }, uN2B: { value: blank },
        uAmpScale: { value: 1.0 },
        uChopScale: { value: 1.0 },
        // ---- 局部落水剧烈波动（空槽 w=-99）----
        uImpact: {
          value: Array.from(
            { length: IMPACT_SLOTS },
            () => new THREE.Vector4(0, 0, 0, -99),
          ),
        },
        uWaterScatter: { value: new THREE.Vector3(0.018, 0.075, 0.088) },
        uWaterAbsorb: { value: new THREE.Vector3(0.004, 0.021, 0.036) },
      }),
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.userData.decorShared = true; // ChunkManager.disposeVisual 跳过（全局共享）
    registerWallLightTarget(this);
    void this.loadOceanTextures().catch((e) =>
      console.error("[WaterMaterial] 海况初始化异常（未捕获）", e)); // 非阻塞：FFT 在 worker，就绪后热插纹理（uHasOcean 翻 1）
  }

  /** 海况场就绪后热插 12 张 FFT 贴图（字节全部来自 OceanBaker worker）；
   *  ★ 失败可重试（旧实现一次性：失败即永久静态水面）——抖动已与海况解耦，不受影响 */
  private lastOceanError = "";
  private async loadOceanTextures(): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const tex = await ensureOceanTextures();
        if (this.disposed) return;
        const u = this.uniforms;
        u.uHD0A.value = tex.hdA[0]; u.uHD0B.value = tex.hdB[0];
        u.uHD1A.value = tex.hdA[1]; u.uHD1B.value = tex.hdB[1];
        u.uHD2A.value = tex.hdA[2]; u.uHD2B.value = tex.hdB[2];
        u.uN0A.value = tex.nA[0]; u.uN0B.value = tex.nB[0];
        u.uN1A.value = tex.nA[1]; u.uN1B.value = tex.nB[1];
        u.uN2A.value = tex.nA[2]; u.uN2B.value = tex.nB[2];
        u.uHasOcean.value = 1;
        return;
      } catch (e) {
        if (this.disposed) return;
        this.lastOceanError = (e as Error)?.message ?? String(e);
        console.warn(`[WaterMaterial] 海况场烘焙失败（第 ${attempt + 1}/4 次）：${this.lastOceanError}`, e);
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
    console.error(`[WaterMaterial] 海况场烘焙多次失败：水面保持静态基面（落水抖动不受影响）；最后错误：${this.lastOceanError || "无记录"}`);
  }

  override dispose(): void {
    this.disposed = true;
    unregisterWallLightTarget(this);
    super.dispose();
  }

  /**
   * ★ 在世界点 (x,z) 注入一处水面剧烈波动（角色入水 / 炮弹近水）。
   * 顶点抬升 + 片元法线晃动，约 2s 自然衰减。槽满时覆盖最旧的一次。
   * @param strength 波幅（米；步行入水 ~0.8，跳跃/炮弹 ~1.4）
   */
  addImpact(x: number, z: number, strength: number): void {
    const arr = this.uniforms.uImpact.value as THREE.Vector4[];
    let slot = -1;
    let oldest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].w < 0) { slot = i; break; }        // 空槽优先
      if (arr[i].w < oldest) { oldest = arr[i].w; slot = i; }
    }
    if (slot < 0) return;
    arr[slot].set(x, z, strength, performance.now() * 0.001);
  }

  /** ★ 清空全部扰动槽（模式进出防跨局残留；w<0 = 空槽） */
  resetImpacts(): void {
    const arr = this.uniforms.uImpact.value as THREE.Vector4[];
    for (const v of arr) v.set(0, 0, 0, -99);
  }
}

/** 全局共享水体材质实例（标准地形水 + boss4D 水幕共用一份） */
export const sharedWaterMaterial = new WaterMaterial();

/**
 * WaterSurfaceRaw → 已装配水 Mesh（共享材质 + 透明 pass renderOrder=10）。
 * 标准地形水与 boss4D 漂浮水幕共用这一装配路径。
 */
export function createWaterMesh(raw: WaterSurfaceRaw): THREE.Mesh {
const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(raw.vertices, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(raw.normals, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(raw.uvs, 2));
  geo.setAttribute("deep", new THREE.BufferAttribute(raw.deep, 1));
  if (raw.border) geo.setAttribute("border", new THREE.BufferAttribute(raw.border, 1));
  if (raw.spin) geo.setAttribute("spin", new THREE.BufferAttribute(raw.spin, 2));
  geo.setIndex(new THREE.BufferAttribute(raw.indices, 1));
  const mesh = new THREE.Mesh(geo, sharedWaterMaterial);
  mesh.renderOrder = 10;
  mesh.userData.isWater = true; // ★ 水面标记（航行期整批隐藏：不渲染水/不跑 FFT 着色）
  return mesh;
}