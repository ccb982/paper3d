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
import { NormalDetailRT } from './water/normalRT';
import { makeWaveSet, updateWaveSet, packWaves, type GerstnerWave, type WaveGenOpts } from './water/gerstner';

// ------------------------------------------------------------
// 预计算 FFT 贴图（启动烘焙一次；Worker 后台跑 FFT，主线程只打包 DataTexture）
// ------------------------------------------------------------
const OCEAN_SEED = 12345; // 海况确定性种子

/** ★ Gerstner 几何波参数约束（GPU Gems 1 Ch.1：长涌浪 + 短风浪几何级数分布） */
const GERSTNER_OPTS: WaveGenOpts = {
  wavelength: [0.7, 13.0],   // m：最长 13m（涌浪）→ 最短 0.7m（涟漪）
  ampRatio: 0.0038,          // ★ 振幅 = 0.0038 × 波长（8 波叠加峰值 ≈ 0.13m；0.030→4.4m 过高、0.0085→0.3m 仍偏高）
  steepness: 0.85,           // 陡度上限（Q·A·k ≤ 1 ⇒ 波峰不自交）
};

// ------------------------------------------------------------
// 顶点着色器
// ------------------------------------------------------------
// 局部水面剧烈波动（角色入水 / 炮弹近水 → sharedWaterMaterial.addImpact 注入；
// 顶点抬升 + 片元斜率，纯水面表现，不改角色/碰撞）
// ------------------------------------------------------------
/** uImpact 槽位数（GLSL #define IMPACT_SLOTS 同步） */
/** uImpact 槽位数（GLSL #define IMPACT_SLOTS 同步）
 *  ★ 2026-11-03：6 → **10**（玩家涉水每 0.3s 一次 × 2s 寿命 ⇒ 需 6.7 个槽，6 个必然卡死 ⇒ 「走着走着涟漪没了」） */
const IMPACT_SLOTS = 10;
/** ★ 涟漪事件的可见距离上限（m；与 shader 的 uLodFar=55m 对齐 + 余量）。
 *  更远的涟漪本来就被 lodW 淡成 0 ⇒ CPU 侧直接丢弃，零视觉损失、且不占槽。 */
const RIPPLE_VIEW_DIST = 60;
/** ★ 涟漪的可见半径（m；环以 2.2m/s 外扩、约 2s ⇒ 半径 ≈ 4.4m，加余量） */
const RIPPLE_VIEW_RADIUS = 6;
/** 视锥判定用的临时球（零分配） */
const _rippleSphere = new THREE.Sphere();

/** ★ Gerstner 波数量（几何波；细节由共用纹理承担） */
const GERSTNER_COUNT = 8;

const IMPACT_UNI = /* glsl */ `
  #define IMPACT_SLOTS 10
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
  #define GERSTNER_COUNT 8
  attribute float deep;
  attribute float border;
  attribute vec2 spin;
  uniform float uTime;
  uniform vec2 uScrollDir;
  uniform vec3 uLayerScale;   // 每层世界尺度（m）
  // ★★ 解析 Gerstner 波（GPU Gems 1 Ch.1）：**零纹理采样** ⇒ 无接缝/无白线
  //   A = (dirX, dirZ, k, amplitude)   B = (steepness, omega, weight, 0)
  uniform vec4 uGerstnerA[GERSTNER_COUNT];
  uniform vec4 uGerstnerB[GERSTNER_COUNT];
  uniform vec3 uSpeed;        // 每层滚动速度（m/s）
  uniform vec3 uAmp;          // 每层高度幅度
  uniform float uLodNear;     // ★ 距离 LOD 近界（m；内 = 全量三实例）
  uniform float uLodFar;      // ★ 距离 LOD 远界（m；外 = 静态基准面，波高→0）

  uniform float uAmpScale;
  uniform float uChopScale;  // boss4D choppy 单独缩放（水平位移更敏感）

  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vDeep;
  varying vec3 vWorld;
  varying float vBorder;   // ★ 岸带权重（1 = 贴岸顶点 ⇒ 该处走自主计算）
  #include <fog_pars_vertex>

  // 波浪三角交叠权重（0→1→0，循环无色缝）
  float triW(float t, float period) {
    return 1.0 - abs(2.0 * fract(t / period * 0.5) - 1.0);
  }

  // ★★ 每层不同滚动方向（旋转）：3 层都朝同一方向滚 ⇒ 干涉花纹固定 ⇒ 水面「太平静」。
  //   旋转后 3 层互相错开 ⇒ 干涉图案持续变化 ⇒ 水面有生气。
  vec2 rot2(vec2 v, float a) {
    float c = cos(a), s = sin(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
  }

  // 旧解析波动（水帘/boss 仍用；保证坑水交界与幕布正确跟随）
  float waterWaveY(vec2 p, float t) {
    return 0.06 * ( 0.60 * sin(p.x * 0.55 + t * 1.40)
                  + 0.55 * sin(p.y * 0.75 - t * 1.10)
                  + 0.35 * sin((p.x + p.y) * 0.35 + t * 0.80) );
  }

  // L0：涌浪（仅顶点位移）
  // L1：主波（顶点位移）
  // L2：细节波（顶点级小涟漪，让波浪层次更可见）

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
    vBorder = border;   // ★ 岸带权重传给片元（该处走自主计算，不采样共用纹理）
    // ★ 距离 LOD 环（《地形与渲染管线架构.md》§1；smoothstep 无缝，无跳变）：
    //   近界内 = 1（三实例 FFT 全量）→ 远界外 = 0（波高/choppy/激荡全灭，静态基准面）
    float camDist = length(cameraPosition - wp.xyz);
    float lodW = 1.0 - smoothstep(uLodNear, uLodFar, camDist);
    // ★★ 几何位移的淡出**比光照更早**（12→30m）：远处 body 是每块一张 4m quad，
    //   顶点位移在 4m 尺度上按三角形线性插值 ⇒ 远处会看到明显的「三角交错」。
    //   ⇒ 远处几何保持平面，波光全部交给**逐像素法线**（片元按世界坐标采样，与网格密度无关）。
    float geomW = 1.0 - smoothstep(uLodNear, 30.0, camDist);
    float wv = 0.0;
    // ★ 局部落水剧烈波动（角色入水/炮弹近水）：独立于 FFT 海况——
    //   海况未就绪/烘焙失败时也照常抖动（此前误挂在海况分支内 → "抖动初始化失败"）。
    //   连续空间场，含边界顶点一起抬升不会撕裂（不再受 border 静止约束）。
    float shake = 0.0;
    if (isNotRoof > 0.5 && isFall <= 0.5) {
      shake = impactAgitation(wp.xz, uTime) * lodW;
    }
    // ★★ 几何波 = **解析 Gerstner 叠加**（GPU Gems 1 Ch.1）——零纹理采样 ⇒ 无接缝
    //   位移：Px += Q·A·Dx·cos(f)  Pz += Q·A·Dz·cos(f)  Py += A·sin(f)
    //   法线：解析求导（GPU Gems Eq.6b）N = (−Dx·k·A·cos f, 1 − Q·k·A·sin f, −Dz·k·A·cos f)
    // ★ 解析 Gerstner **不依赖** uHasOcean（那是贴图就绪开关；烘焙失败时水面也该有波）
    if (isNotRoof > 0.5 && isFall <= 0.5 && border < 0.5) {
      vec3 gN = vec3(0.0, 1.0, 0.0);
      for (int gi = 0; gi < GERSTNER_COUNT; gi++) {
        vec4 GA = uGerstnerA[gi];
        vec4 GB = uGerstnerB[gi];
        float amp = GA.w;
        if (amp <= 0.0) continue;
        float k = GA.z, steep = GB.x, om = GB.y;
        float f = k * (GA.x * wp.x + GA.y * wp.z) - om * uTime;
        float cf = cos(f), sf = sin(f);
        wp.x += steep * amp * GA.x * cf;
        wp.z += steep * amp * GA.y * cf;
        wp.y += amp * sf;
        gN.x += -GA.x * k * amp * cf;
        gN.y += -steep * k * amp * sf;
        gN.z += -GA.y * k * amp * cf;
      }
      vNormal = normalize(gN);            // ★ 解析法线（比几何法线准）
      // ★ 旧的贴图 FFT 位移整块移除（白线根除）；贴图留给**细节法线**（片元）
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
  uniform vec3 uTexelCount; // 各层纹素数（LOD/粗糙度用）
  uniform float uWindSpeed; // 风速 m/s（Cox-Munk 粗糙度、白帽 onset 用）
  // ★ 离屏细节法线图（GPU Gems render target；按世界坐标平铺采样）
  uniform sampler2D uDetailNormal;
  uniform float uDetailPeriod;
  uniform float uDetailStrength;
  uniform vec3 uTriPeriod;   // ★ 修复：删除 FFT 层时漏留（fragment 仍用到）
  uniform vec3 uWaterScatter; // 水体散射色（蓝绿，驱动水体自身颜色）
  uniform vec3 uWaterAbsorb;  // 水体吸收色（深水吸收，暗蓝/暗绿）

  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vDeep;
  varying vec3 vWorld;
  varying float vBorder;   // ★ 岸带权重（1 = 贴岸顶点 ⇒ 该处走自主计算，不采样共用纹理）

  #include <common>
  #include <fog_pars_fragment>

  // ★★ 每层不同滚动方向（旋转）—— 与顶点着色器同名但各自独立声明（不同 shader 允许）
  vec2 rot2(vec2 v, float a) {
    float c = cos(a), s = sin(a);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
  }
  float triW(float t, float period) {
    return 1.0 - abs(2.0 * fract(t / period * 0.5) - 1.0);
  }

  // ★ 岸带自主波形（解析；**不采样共用纹理**）—— 与顶点着色器的 waterWaveY 同款公式，
  //   这里只用来求**斜率**（法线）⇒ 岸带（border=1）不再"钉死无波"。
  //   顶点位移仍按原策略（避免岸线几何翘边），这里只改法线 ⇒ 零形变风险。
  float waveYSelf(vec2 p, float t) {
    return 0.06 * ( 0.60 * sin(p.x * 0.55 + t * 1.40)
                  + 0.55 * sin(p.y * 0.75 - t * 1.10)
                  + 0.35 * sin((p.x + p.y) * 0.35 + t * 0.80) );
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
      col += vec3(foamEdge * 0.12);   // ★ 唇沿薄泡沫减弱
      float glint = pow(max(dot(normalize(vNormal), normalize(vec3(0.0, 0.6, 1.0) - V)), 0.0), 6.0);
      col += glint * vec3(0.18, 0.28, 0.30);
      col *= uAmbientColor * 1.1 + uSunColor * 0.32 * uSunDay;
      col = mix(col, vec3(0.40, 0.72, 0.68) * (uAmbientColor * 0.95 + uSunColor * 0.10 * uSunDay), isRoof);
      alpha = mix(0.55, 0.15, isRoof);
      float jb = (1.0 - step(0.5, -vDeep - 1.5)) * (1.0 - smoothstep(0.0, 0.20, t));
      col = mix(vec3(0.40, 0.72, 0.68) * (uAmbientColor * 0.95 + uSunColor * 0.10 * uSunDay), col, jb);
    } else {
      // ---- ★ 水面：FFT 场 + 参考 natural-disasters 渲染思想 ----
      vec2 uv0 = rot2(vWorld.xz / uLayerScale.x, 0.00) + uScrollDir * (uTime * uSpeed.x);

      float w0 = triW(uTime, uTriPeriod.x);

      // 像素足印（米）：决定哪些细节进 mss 粗糙度、哪些还能解析
      vec2 dq = dFdx(vWorld.xz);
      vec2 dqv = dFdy(vWorld.xz);
      float fpA = length(dq), fpB = length(dqv);
      float fpShade = sqrt(max(fpA * fpB, 1e-5));   // 各向同性等效足印

      // ★ 距离 LOD 环（与顶点同档；远处丢 L1/L2 法线级联 + 泡沫/高光衰减）
      float fragLodW = 1.0 - smoothstep(uLodNear, uLodFar, length(cameraPosition - vWorld));

      // --- 法线：多尺度斜率叠加（几何法线包底，保持"面"的连续性）---
      // ★★ 法线改用**顶点的解析 Gerstner 法线**（vNormal）—— 贴图**完全不参与**水面渲染
      //   ⇒ fract 接缝 / mipmap 串色 / 白线 全部根除（贴图留给第 2 步的离屏细节法线图）
      vec3 N3 = normalize(vNormal);
      // ★ 细节法线（离屏 RT；按世界坐标平铺采样 ⇒ 跨 chunk 连续、无接缝）
      vec2 dSlope = texture2D(uDetailNormal, vWorld.xz / uDetailPeriod).xy * 2.0 - 1.0;
      N3 = normalize(vec3(N3.x + dSlope.x * uDetailStrength, N3.y, N3.z + dSlope.y * uDetailStrength));
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

      // ★★ 岸带（水-岸交界，border=1 的那 10%）**自主计算**：
      //   共用纹理给的是"内部"的波形；岸带顶点不参与 FFT 位移（钉死，避免岸线翘边），
      //   ⇒ 岸边水面显得死板。这里在**法线**层面混入解析波形（不采样共用纹理），
      //   按 vBorder 权重过渡 ⇒ 与共用纹理的结果无缝融入。
      //   ★ 只在近景生效（fragLodW 衰减）⇒ 远处 100% 走共用纹理（零自主计算）。
      if (vBorder > 0.001 && fragLodW > 0.001) {
        float e2 = 0.25;
        float ay0 = waveYSelf(vWorld.xz - vec2(e2, 0.0), uTime);
        float ay1 = waveYSelf(vWorld.xz + vec2(e2, 0.0), uTime);
        float az0 = waveYSelf(vWorld.xz - vec2(0.0, e2), uTime);
        float az1 = waveYSelf(vWorld.xz + vec2(0.0, e2), uTime);
        vec2 aSlope = vec2((ay0 - ay1) / e2, (az0 - az1) / e2);
        vec3 nSelf = normalize(vec3(-aSlope.x * 0.9, 1.0, -aSlope.y * 0.9));
        N = normalize(mix(N, nSelf, clamp(vBorder * fragLodW, 0.0, 1.0) * 0.65));
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
      // ★ 泡沫判据 = **法线陡峭度**（1 - N.y）：波峰越陡 ⇒ 越接近破碎 ⇒ 白沫
      float steepness = clamp(1.0 - N3.y, 0.0, 1.0);

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
      float waveFoam = smoothstep(0.10, 0.42, steepness);   // ★ 法线越陡 ⇒ 白沫越多（不再依赖贴图高度）
      float foamMask = waveFoam * (0.30 + 0.40 * uSunDay);
      vec2 wind = uScrollDir;
      vec2 qs = mat2(wind.x, -wind.y, wind.y, wind.x) * vWorld.xz * 0.12;
      float windy = vnoise(qs + vec2(0.0, -uTime * 0.9)) * 0.55
                  + vnoise(qs * vec2(4.0, 4.0) * 3.0 + vec2(uTime * 1.3, 0.0)) * 0.40;
      float onset = mix(0.55, 0.40, clamp(uWindSpeed / 8.0, 0.0, 1.0));
      float carved = foamMask * (0.10 + windy * 1.0);
      float foam = smoothstep(onset, onset + 0.15, carved);
      foam *= 0.4 + 0.6 * smoothstep(0.35, 2.2, fpShade);       // 近处少量可见
      refracted = mix(refracted, vec3(0.93, 0.96, 0.985) * (uAmbientColor * 1.1 + uSunColor * 0.45 * uSunDay), foam * 0.20 * fragLodW);  // ★ 泡沫强度下调（太多 ⇒ 像塑料膜）

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
      // 波浪朝向变化的高频波光（用同一解析法线的不同幂次近似多尺度高光）
      color += uSunColor * spec * 6.0 * uSunDay * pow(max(dot(N3, L), 0.5), 2.0);
      color += uSunColor * spec * 4.0 * uSunDay * pow(max(dot(N3, L), 0.5), 3.0);

      // 体色微面调制：波面斜率调制亮度 → 波峰亮、波谷暗，波形清楚
      float slopeLen = length(vec2(N.x, N.z));
      color *= (0.75 + 0.6 * slopeLen);

      // 岸线淡色透底
      color = mix(color, color * 1.12 + vec3(0.04, 0.10, 0.08), shore * 0.5);

      col = color;
      // ★ 更透（2026-09-14 用户定调「纹理不咋透明」）：浅水 0.72 → 0.50（玻璃感、透出河床），
      //   深水 0.92 → 0.90（保住深水读感）；泡沫仍加 0.18
      alpha = clamp(mix(0.50, 0.90, depthT) + foam * 0.10, 0.0, 0.96);   // ★ 泡沫对不透明度的贡献减半
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
  /** ★ 离屏细节法线图（共享同一份 Gerstner uniform ⇒ 淡出/淡入自动同步） */
  private detailRT: NormalDetailRT | null = null;

  /** ★ Gerstner 几何波集（解析；每帧更新参数 ⇒ 淡出/淡入 ⇒ 永不重复） */
  private gerstnerWaves: GerstnerWave[] = makeWaveSet(OCEAN_SEED, GERSTNER_COUNT, GERSTNER_OPTS);
  private gerstnerTime = 0;

  private disposed = false;
  /** ★ 视锥剔除用的相机（涟漪事件；每帧由 WorldMode.render 喂） */
  private viewCamera: THREE.Camera | null = null;
  private readonly viewFrustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();


  constructor() {
    const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 1]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
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
        uScrollDir: { value: new THREE.Vector2(0.35, 0.94).normalize() },
        uLayerScale: { value: new THREE.Vector3(16, 6, 1.5) },
        uSpeed: { value: new THREE.Vector3(0.14, 0.28, 0.5) },
        uAmp: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
        uChop: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
        uTriPeriod: { value: new THREE.Vector3(11.0, 8.0, 5.0) },
        uTexelCount: { value: new THREE.Vector3(64, 128, 128) },
        uWindSpeed: { value: 5.0 },
        // ★★ 共用图集：HD 一张 + 法线一张（各 6 个 tile：3 层 × 2 相位）
        // ★ Gerstner 几何波（解析；零纹理采样）
        uGerstnerA: { value: Array.from({ length: GERSTNER_COUNT }, () => new THREE.Vector4(1, 0, 0, 0)) },
        uGerstnerB: { value: Array.from({ length: GERSTNER_COUNT }, () => new THREE.Vector4(0, 1, 1, 0)) },
        // ★ 离屏细节法线图（GPU Gems：render target；主 pass 一次采样）
        uDetailNormal: { value: blank },
        uDetailPeriod: { value: 6.0 },
        uDetailStrength: { value: 0.55 },
        // ★ 6 个 tile 的 uv 矩形（层*2+相位）：offsetX, offsetY, scaleX, scaleY
        uAmpScale: { value: 1.0 },
        uChopScale: { value: 1.0 },
        // ---- 局部落水剧烈波动（空槽 w=-99）----
        uImpact: {
          value: Array.from(
            { length: IMPACT_SLOTS },
            () => new THREE.Vector4(0, 0, 0, -99),
          ),
        },
        // ★ 经典水体调色（2026-09-14 用户"质感差"）：
        //   参考 tuxalin/water-shader（Unity 经典水面）：Surface (0.0078,0.5176,0.7) 青蓝 /
        //   Deep (0.0039,0.00196,0.145) 深蓝；按本管线 ×~10 的散射量级折算成 uniforms。
        //   旧值 (0.018,0.075,0.088) 偏灰绿、发白 → 换成更饱和的青蓝。
        uWaterScatter: { value: new THREE.Vector3(0.006, 0.055, 0.075) },
        uWaterAbsorb: { value: new THREE.Vector3(0.006, 0.014, 0.052) },
      }),
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.userData.decorShared = true; // ChunkManager.disposeVisual 跳过（全局共享）
    registerWallLightTarget(this);
    this.updateGerstner(0);   // ★ 初始化 Gerstner uniform（构造时 pack 一次）
    // ★ 离屏细节法线图（与 Gerstner uniform 共享同一批 Vector4 ⇒ 参数自动同步）
    this.detailRT = new NormalDetailRT(
      this.uniforms.uGerstnerA.value as THREE.Vector4[],
      this.uniforms.uGerstnerB.value as THREE.Vector4[],
    );
    this.uniforms.uDetailNormal.value = this.detailRT.texture;
  }

  /** 海况场就绪后热插 12 张 FFT 贴图（字节全部来自 OceanBaker worker）；
   *  ★ 失败可重试（旧实现一次性：失败即永久静态水面）——抖动已与海况解耦，不受影响 */
  /** ★ 每帧推进 Gerstner 波集（GPU Gems：随机参数 + 随时间把某个波淡出、再以不同参数淡入）。
   *   淡出淡入作用在**振幅**上 ⇒ 波形连续变化、不会突变。
   */
  public updateGerstner(dt: number): void {
    this.gerstnerTime += dt;
    updateWaveSet(this.gerstnerWaves, dt, this.gerstnerTime, OCEAN_SEED, GERSTNER_OPTS, 7, 0.4);
    const { a, b } = packWaves(this.gerstnerWaves);
    const uA = this.uniforms.uGerstnerA.value as THREE.Vector4[];
    const uB = this.uniforms.uGerstnerB.value as THREE.Vector4[];
    for (let i = 0; i < this.gerstnerWaves.length; i++) {
      uA[i].set(a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]);
      uB[i].set(b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]);
    }
  }

  /** ★ 渲染离屏细节法线图（每帧；GPU Gems 的 render target 法） */
  renderDetailRT(renderer: THREE.WebGLRenderer, time: number): void {
    this.detailRT?.render(renderer, time);
  }

  private lastOceanError = "";

  override dispose(): void {
    this.disposed = true;
    unregisterWallLightTarget(this);
    super.dispose();
  }

  /**
   * ★ 在世界点 (x,z) 注入一处水面剧烈波动（角色入水 / 炮弹近水）。
   * 顶点抬升 + 片元法线晃动，约 2s 自然衰减。
   *
   * ★★ 占用策略（2026-10-27 改）：**强度优先**，不再是「空槽优先 + 覆盖最旧」。
   *   起因：6 个槽会被「水中移动泛波」（每 0.2~0.34s 一次、强度仅 0.28~0.55）刷满，
   *   ⇒ **子弹落水（1.4）/敌人入水（0.8）这类强事件被弱涟漪挤掉** → 看起来"完全没反应"。
   *   新规则：
   *     ① 有空槽 ⇒ 直接占
   *     ② 无空槽 ⇒ 找【最弱】的槽；新涟漪**比它更弱** ⇒ 放弃（不挤掉更强的）
   *        强度相同 ⇒ 替换其中**最旧**的那个（保证新事件可见）
   *
   * ★★★ 视锥裁剪（2026-10-27 用户定：**先视锥裁剪再 LOD**）：
   *   视野外的涟漪**根本不占槽** ⇒ 有限的槽位全留给"看得见的"涟漪。
   *   判据 = 视锥内 ∧ 距离 < RIPPLE_VIEW_DIST（与 shader 的 uLodFar=55m 对齐：
   *   更远的涟漪本来就被 lodW 淡成 0，剔除它零视觉损失）。
   *   ⇒ LOD 已在 shader 侧完成（lodW：12m 全量 → 55m 淡出）。
   *
   * @param strength 波幅（米；步行入水 ~0.28~0.55，角色入水 0.8，敌人入水 0.8，
   *                     跳跃落水 ≤1.6，子弹落水 1.4）
   */
  addImpact(x: number, z: number, strength: number): void {
    // ★ 视锥 + 距离剔除（先裁剪，再谈 LOD）
    if (!this.rippleInView(x, z)) return;
    const arr = this.uniforms.uImpact.value as THREE.Vector4[];
    const now = performance.now() * 0.001;
    // ★★ 过期槽回收（2026-11-03）：槽位此前**永不释放** ⇒ 6 个槽被入水/子弹涟漪占满后，
    //   玩家涉水的弱涟漪（0.28~0.55）因「强度优先」进不去 ⇒「一开始有，后面就没了」。
    const LIFE = 2.15;   // 与 shader 的 2s 衰减一致 + 余量
    // ① 空槽 / 过期槽优先（过期 ⇒ 视觉已消失，槽位应释放）
    let expired = -1, expiredTime = Infinity;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].w < 0) { arr[i].set(x, z, strength, now); return; }
      if (arr[i].w + LIFE < now && arr[i].w < expiredTime) { expiredTime = arr[i].w; expired = i; }
    }
    if (expired >= 0) { arr[expired].set(x, z, strength, now); return; }
    // ② 无空槽：找最弱槽（同强度取最旧）
    let weakest = -1;
    let weakestStrength = Number.POSITIVE_INFINITY;
    let oldest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i].z;
      if (s < weakestStrength) { weakestStrength = s; weakest = i; oldest = arr[i].w; }
      else if (s === weakestStrength && arr[i].w < oldest) { oldest = arr[i].w; weakest = i; }
    }
    if (weakest < 0) return;
    // ★ 比最弱的还弱 ⇒ 放弃（不挤掉更强的涟漪）
    if (strength < weakestStrength) return;
    arr[weakest].set(x, z, strength, now);
  }

  // ============================================================
  // 视锥剔除（涟漪事件；CPU 侧）
  // ============================================================

  /** 每帧喂相机（用于涟漪事件的视锥剔除；WorldMode.render 调） */
  setViewCamera(cam: THREE.Camera | null): void {
    this.viewCamera = cam;
  }

  /**
   * 涟漪落点是否值得记录：视锥内 ∧ 距离够近。
   * 无相机（基地/室内等无 3D 视角的阶段）⇒ 一律接受（保守，不丢效果）。
   */
  private rippleInView(x: number, z: number): boolean {
    const cam = this.viewCamera;
    if (!cam) return true;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const dx = x - cx, dy = 0 - cy, dz = z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    // ★ 距离闸：超过 shader 的可见范围（uLodFar=55m）+ 余量 ⇒ 本来就看不见，直接丢
    if (dist > RIPPLE_VIEW_DIST) return false;
    // 视锥内？（用涟漪半径做球，避免边缘误杀）
    this.viewProj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.viewFrustum.setFromProjectionMatrix(this.viewProj);
    _rippleSphere.center.set(x, 0, z);
    _rippleSphere.radius = RIPPLE_VIEW_RADIUS;
    return this.viewFrustum.intersectsSphere(_rippleSphere);
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