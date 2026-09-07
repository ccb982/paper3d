// ============================================================
// WaterMaterial —— 水体管线独立材质（不进 MAT_FN_INDEX，独享 GLSL）
// ============================================================
// 语义（《水体管线架构.md》§4）：
//   · 静止基面几何（WaterSurface）由本材质做着色/动画；水位=0，顶点 y 即世界高。
//   · 表面（deep>=0）：预计算 FFT 海况场（WaterFFT，3 层 × 2 相位变体）
//       - 顶点位移：L0/L1 高度+choppy 滚动采样（世界连续，跨 chunk 无缝）
//       - 片元法线/焦散/泡沫：L1/L2 层世界法线叠加
//       - 菲涅尔 + 程序化天空反演 + Blinn 太阳高光
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

// ------------------------------------------------------------
// 预计算 FFT 贴图（启动烘焙一次；HalfFloat + Linear 采样可行于 WebGL2）
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
  tex.minFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * 全量烘焙并生成材质贴图：
 * 每层每变体 → texHD（RGBA：r=h，g=dx，b=dz）+ texN（RGB：世界法线）。
 */
function bakeOceanTextures(
  params: OceanBakeParams,
): {
  hdA: THREE.Texture[]; hdB: THREE.Texture[];
  nA: THREE.Texture[]; nB: THREE.Texture[];
} {
  const tiles = bakeOceanField(params);
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
    const f = new Float32Array(N * N * 3);
    f.set(t.n, 0);
    return halfFloatTexture(f, N, N, THREE.RGBFormat);
  }
}

let oceanTextures: ReturnType<typeof bakeOceanTextures> | null = null;
function ensureOceanTextures(): ReturnType<typeof bakeOceanTextures> {
  if (!oceanTextures) {
    oceanTextures = bakeOceanTextures(defaultOceanParams(OCEAN_SEED));
  }
  return oceanTextures;
}

// ------------------------------------------------------------
// 顶点着色器
// ------------------------------------------------------------
const WATER_VERT = /* glsl */ `
  attribute float deep;
  attribute vec2 spin;
  uniform float uTime;
  uniform float uHasOcean;
  uniform vec2 uScrollDir;
  uniform vec3 uLayerScale;   // 每层世界尺度（m）
  uniform vec3 uSpeed;        // 每层滚动速度（m/s）
  uniform vec3 uAmp;          // 每层高度幅度
  uniform vec3 uChop;         // 每层 choppy 位移幅度
  uniform vec3 uTriPeriod;    // 每层 A/B 交叠周期（s）

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
    float wv = 0.0;
    if (isNotRoof > 0.5 && isFall <= 0.5 && uHasOcean > 0.5) {
      // ★ 水面（deep=0）：预计算 FFT 位移（世界 uv，跨 chunk 无缝）
      vec2 uv0 = wp.xz / uLayerScale.x + uScrollDir * (uTime * uSpeed.x);
      vec2 uv1 = wp.xz / uLayerScale.y + uScrollDir * (uTime * uSpeed.y);
      vec4 a = hdLayer0(uv0, uTime);
      vec4 b = hdLayer1(uv1, uTime);
      float h = a.r * uAmp.x + b.r * uAmp.y;
      vec2 disp = a.gb * uChop.x + b.gb * uChop.y;
      wp.x += disp.x * uChopScale;
      wp.z += disp.y * uChopScale;
      wp.y += h * uAmpScale;
    } else if (isFall > 0.5) {
      wv = waterWaveY(wp.xz, uTime);
      if (isFall > 0.5) wv *= 1.0 - vUv.y * vUv.y;
      wp.y += wv;
    }
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
  uniform vec2 uScrollDir;
  uniform vec3 uLayerScale;
  uniform vec3 uSpeed;
  uniform vec3 uAmp;
  uniform vec3 uLayerAmp; // 各层已烘焙 RMS 幅度（片元相对归一用）
  uniform vec3 uTriPeriod;

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
      // ---- ★ 水面：FFT 场 + 复杂光照 ----
      vec2 uv0 = vWorld.xz / uLayerScale.x + uScrollDir * (uTime * uSpeed.x);
      vec2 uv1 = vWorld.xz / uLayerScale.y + uScrollDir * (uTime * uSpeed.y);
      vec2 uv2 = vWorld.xz / uLayerScale.z + uScrollDir * (uTime * uSpeed.z);

      float w0 = triW(uTime, uTriPeriod.x);
      float w1 = triW(uTime, uTriPeriod.y);
      float w2 = triW(uTime, uTriPeriod.z);

      vec3 n0 = norm(uN0A, uN0B, uv0, w0);
      vec3 n1 = norm(uN1A, uN1B, uv1, w1);
      vec3 n2 = norm(uN2A, uN2B, uv2, w2);
      N = normalize(n0 * 1.0 + n1 * 1.25 + n2 * 1.6);

      // 高度（泡沫/透亮用）
      float h1 = mix(texture2D(uHD1A, uv1).r, texture2D(uHD1B, uv1).r, w1);
      float h2 = mix(texture2D(uHD2A, uv2).r, texture2D(uHD2B, uv2).r, w2);
      float d2 = mix(texture2D(uHD2A, uv2).g, texture2D(uHD2B, uv2).g, w2); // 细节位移（微调法线抖动）

      N = normalize(N + vec3(d2 * 0.06, 0.0, 0.0));

      vec3 L = normalize(uSunDir);
      float NdotV = clamp(dot(N, V), 0.0, 1.0);
      float F = 0.03 + 0.97 * pow(1.0 - NdotV, 5.0); // 菲涅尔（Schlick）

      // 深度（水色主体）
      float depthT = clamp(vDeep / uMaxDeep, 0.0, 1.0);
      vec3 shallow = vec3(0.36, 0.66, 0.62);
      vec3 deepc = vec3(0.04, 0.13, 0.17);
      vec3 base = mix(shallow, deepc, depthT);

      // 焦散（折射光汇聚高亮，太阳视角度相关）
      float cau = pow(max(dot(n2, L), 0.0), 4.0);
      vec3 refractBase = base * (uAmbientColor * 0.95 + uSunColor * (0.08 + cau * 0.10) * uSunDay);

      // 泡沫：岸浅泡沫 + 波峰白沫（相对自身 RMS：~2.5× 峰值触发，与幅度无关）
      float shore = 1.0 - smoothstep(0.0, 0.35, vDeep);
      float h1n = h1 / max(uLayerAmp.y, 1e-4);
      float h2n = h2 / max(uLayerAmp.z, 1e-4);
      float crest = smoothstep(1.0, 2.2, h2n) * smoothstep(1.2, 2.6, h1n);
      float foam = max(shore, crest);
      refractBase = mix(refractBase, refractBase * 1.35 + vec3(0.32), foam * 0.35);

      // 程序化天空反演（垂直分层 + 太阳方位增暖）
      vec3 R = reflect(-V, N);
      float ry = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 zenith = vec3(0.05, 0.10, 0.18);
      vec3 horiz = vec3(0.52, 0.66, 0.72);
      vec3 sky = mix(horiz, zenith, pow(ry, 0.55));
      vec3 sunDisk = uSunColor * max(pow(max(dot(R, L), 0.0), 400.0) * 1.2, 0.0) * uSunDay;
      sky = sky * (uAmbientColor * 1.05 + uSunColor * 0.28 * uSunDay) + sunDisk * 0.30;

      // 反射强度：菲涅尔为主 + 深度修正（岸浅水反射弱，透底为主）
      float reflMix = F * (0.35 + 0.65 * depthT);
      col = mix(refractBase, sky, reflMix);

      // 太阳高光（Blinn）+ 波光粼粼（高频法线）
      vec3 H = normalize(L + V);
      float specPow = pow(max(dot(N, H), 0.0), 140.0);
      float glit = pow(max(dot(N, H), 0.0), 512.0);
      col += uSunColor * (specPow * (0.22 + 0.4 * F) + glit * 0.05) * uSunDay;

      // 岸线淡色透底（浅处提亮）
      col = mix(col, col * 1.12 + vec3(0.04, 0.10, 0.08), shore * 0.5);

      alpha = clamp(mix(0.5, 0.85, depthT) + foam * 0.16, 0.0, 0.96);
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
  constructor() {
    const tex = ensureOceanTextures();
    super({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uAmbientColor: { value: new THREE.Color(0x9aa8c4).multiplyScalar(0.65) },
        uSunColor: { value: new THREE.Color(0xfff3e0).multiplyScalar(1.1) },
        uSunDay: { value: 1 },
        uSunDir: { value: new THREE.Vector3(-0.342, 1.0, 0.940).normalize() },
        uTime: { value: 0 },
        uMaxDeep: { value: WATER_MAX_DEEP },
        // ---- FFT 海况场 ----
        uHasOcean: { value: 1 },
        uScrollDir: { value: new THREE.Vector2(0.35, 0.94).normalize() },
        uLayerScale: { value: new THREE.Vector3(96, 40, 14) },
        uSpeed: { value: new THREE.Vector3(0.14, 0.28, 0.5) },
        uAmp: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
        uLayerAmp: { value: new THREE.Vector3(DEFAULT_OCEAN_LAYERS[0].amp, DEFAULT_OCEAN_LAYERS[1].amp, DEFAULT_OCEAN_LAYERS[2].amp) },
        uChop: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
        uTriPeriod: { value: new THREE.Vector3(14.0, 10.0, 7.0) },
        uHD0A: { value: tex.hdA[0] }, uHD0B: { value: tex.hdB[0] },
        uHD1A: { value: tex.hdA[1] }, uHD1B: { value: tex.hdB[1] },
        uHD2A: { value: tex.hdA[2] }, uHD2B: { value: tex.hdB[2] },
        uN0A: { value: tex.nA[0] }, uN0B: { value: tex.nB[0] },
        uN1A: { value: tex.nA[1] }, uN1B: { value: tex.nB[1] },
        uN2A: { value: tex.nA[2] }, uN2B: { value: tex.nB[2] },
        uAmpScale: { value: 1.0 },
        uChopScale: { value: 1.0 },
      }),
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.userData.decorShared = true; // ChunkManager.disposeVisual 跳过（全局共享）
    registerWallLightTarget(this);
  }

  override dispose(): void {
    unregisterWallLightTarget(this);
    super.dispose();
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
  if (raw.spin) geo.setAttribute("spin", new THREE.BufferAttribute(raw.spin, 2));
  geo.setIndex(new THREE.BufferAttribute(raw.indices, 1));
  const mesh = new THREE.Mesh(geo, sharedWaterMaterial);
  mesh.renderOrder = 10;
  return mesh;
}