// ============================================================
// WaterMaterial —— 水体管线独立材质（不进 MAT_FN_INDEX，独享 GLSL）
// ============================================================
// 语义（《水体管线架构.md》§4）：
//   · 静止基面几何（WaterSurface）由本材质做着色/动画；水位=0，顶点 y 即世界高。
//   · 一个全局共享实例喂所有 chunk（材质不参与地形分发）；防 chunk 重建误杀：
//     userData.decorShared = true（ChunkManager.disposeVisual 跳过 shared 释放）。
//   · 光照喂值挂 wallRegistry（updateWallMaterialsLighting 昼夜同 feed，uTime 每帧）。
//   · 半透明：透明 pass 里 renderOrder=10（地形不透明之后）；depthWrite=false。
// ============================================================

import * as THREE from "three";
import { registerWallLightTarget, unregisterWallLightTarget } from "./TerrainMaterial";
import { WATER_MAX_DEEP } from "./WaterSurface";
import type { WaterSurfaceRaw } from "./WaterSurface";

const WATER_VERT = /* glsl */ `
  attribute float deep;
  attribute vec2 spin;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vDeep;
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  // ★ 水面波高（解析式；水面顶点 + 坑水帘唇沿共用，交界天然跟随）
  //   入参 p = 世界 xz（vec2：p.x=世界x，p.y=世界z）
  float waterWaveY(vec2 p, float t) {
    return 0.06 * ( 0.60 * sin(p.x * 0.55 + t * 1.40)
                  + 0.55 * sin(p.y * 0.75 - t * 1.10)
                  + 0.35 * sin((p.x + p.y) * 0.35 + t * 0.80) );
  }
  void main() {
    vUv = uv;
    vNormal = normalize(normal);
    vDeep = deep;
    float isFall = step(0.5, -deep);    // 竖面（水帘）：deep -1（坑帘）/ -2（boss4D 水幕）
    float isBoss = step(0.5, -deep - 1.5);  // boss4D 水幕：deep -2 → 自转 + 漂浮
    float isRoof = step(0.5, abs(deep + 3.0)); // 保护性斜边 deep=-3：不波动（稳定补抖动缝）
    vec3 pos = position;
    if (isBoss > 0.5) {
      // ★ 4D 自转：绕本幕竖直中心线旋转（几何以自身中心为原点）
      float ang = spin.x * uTime + spin.y;
      float sa = sin(ang), ca = cos(ang);
      float px = pos.x, pz = pos.z;
      pos.x = px * ca + pz * sa;
      pos.z = -px * sa + pz * ca;
    }
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWorld = wp.xyz;
    float wv = isRoof > 0.5 ? 0.0 : waterWaveY(wp.xz, uTime); // 斜边不波动
    if (isFall > 0.5) wv *= 1.0 - vUv.y * vUv.y; // 帘唇全量 → 坑底归零（vUv.y=0 唇/1 底）
    wp.y += wv;
    if (isBoss > 0.5) wp.y += 0.5 * sin(uTime * 0.9 + spin.y * 3.0); // 4D 漂浮微动
    vec4 mvPosition = viewMatrix * wp;
    #include <fog_vertex>
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform vec3 uAmbientColor;
  uniform vec3 uSunColor;
  uniform float uSunDay;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uMaxDeep;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying float vDeep;
  varying vec3 vWorld;

  #include <common>
  #include <fog_pars_fragment>

  void main() {
    vec3 N = normalize(vNormal);
    float isFall = 1.0 - step(0.5, abs(N.y));
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.0);

    vec3 col;
    float alpha;
    if (isFall > 0.5) {
      // ★ 水帘（vUv.y = 0 唇 → 1 坑底）：顶段保持水色 → 平缓下沉到坑底暗青（不再骤黑）
      float t = vUv.y;
      float isRoof = 1.0 - step(0.5, abs(vDeep + 3.0)); // 仅 deep==-3 斜边
      vec3 waterAlbedo = vec3(0.40, 0.72, 0.68);      // 与水面顶同色（交合规）
      vec3 bottom = vec3(0.10, 0.22, 0.25);           // 坑底：明亮些，避免幕布整体过深
      vec3 grad = mix(waterAlbedo, bottom, smoothstep(0.0, 0.85, t)); // 下沉更缓更久
      // 斜边恒定不脉动（uv 全同 → 原 streak 会让整片斜边整体闪动）；幕布保留流动
      float streak = isRoof > 0.5 ? 0.80 : 0.60 + 0.40 * sin(vUv.x * 11.0 - uTime * 3.0 + t * 5.0);
      col = grad * (0.80 + 0.20 * streak);
      float foamEdge = 1.0 - smoothstep(0.0, 0.08, t); // 唇沿薄泡沫
      col += vec3(foamEdge * 0.20);
      float glint = pow(max(dot(N, normalize(vec3(0.0, 0.6, 1.0) - V)), 0.0), 6.0); // 幕布竖向通透反光
      col += glint * vec3(0.18, 0.28, 0.30);
      col *= uAmbientColor * 1.1 + uSunColor * 0.32 * uSunDay;  // 提亮幕布光照档
      // 保护性斜边（deep=-3）：极浅，仅微遮交界缝，不显形
      col = mix(col, vec3(0.40, 0.72, 0.68) * (uAmbientColor * 0.95 + uSunColor * 0.10 * uSunDay), isRoof);
      alpha = mix(0.55, 0.15, isRoof); // 斜边透明度很浅
      // ★ 仅真实水面↔幕帘交界（坑帘 deep=-1；boss4D 水幕 deep=-2 无水面）：
      //   唇沿 20% 落差内向水面色过渡（加宽遮缝，交界一段全为水色），其余幕帘不做接缝处理
      float jb = (1.0 - step(0.5, -vDeep - 1.5)) * (1.0 - smoothstep(0.0, 0.20, t));
      col = mix(vec3(0.40, 0.72, 0.68) * (uAmbientColor * 0.95 + uSunColor * 0.10 * uSunDay), col, jb);
    } else {
      // ★ 水面：浅水透出 pebble（低深半透明）、深水不透明偏深
      float depthT = clamp(vDeep / uMaxDeep, 0.0, 1.0);
      vec3 shallow = vec3(0.36, 0.66, 0.62);   // 岸浅水：透底泛青（2026-09-07 略压，不再过亮）
      vec3 deepc = vec3(0.04, 0.13, 0.17);     // 深水：偏暗青绿
      vec3 base = mix(shallow, deepc, depthT);
      // ★ 波纹亮纹：原单一相干正弦 → 全水面 ~1m 规则斜纹（周期 2π/√(5.3²+2.7²)≈1.06m）
      //   已改多层非谐振正弦叠加：波长互不相干 → 无单一条带，只留碎闪微扰
      float a = sin(vWorld.x * 3.91 + vWorld.z * 3.11 + uTime * 1.35);
      float b = sin(vWorld.x * 5.27 - vWorld.z * 4.73 - uTime * 0.97);
      float c = sin(vWorld.x * 7.83 + vWorld.z * 5.19 + uTime * 0.44);
      float sh2 = a * 0.5 + b * 0.32 + c * 0.18;
      float shimmer = (sh2 * 0.5 + 0.5) * 0.10;
      vec3 L = normalize(uSunDir);
      float spec = pow(max(dot(reflect(-L, N), V), 0.0), 96.0) * 0.18 * uSunDay; // 0.30→0.18 远水面不 clip
      float foam = 1.0 - smoothstep(0.0, 0.35, vDeep);
      col = base * (uAmbientColor * 0.95 + uSunColor * (0.09 + fres * 0.10 * uSunDay)) // fres 0.24→0.10
        + uSunColor * spec + base * shimmer + vec3(foam * 0.32);
      alpha = clamp(mix(0.5, 0.85, depthT) + foam * 0.16, 0.0, 0.96);
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
    super({
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uAmbientColor: { value: new THREE.Color(0x9aa8c4).multiplyScalar(0.65) },
        uSunColor: { value: new THREE.Color(0xfff3e0).multiplyScalar(1.1) },
        uSunDay: { value: 1 },
        uSunDir: { value: new THREE.Vector3(-0.342, 1.0, 0.940).normalize() },
        uTime: { value: 0 },
        uMaxDeep: { value: WATER_MAX_DEEP },
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