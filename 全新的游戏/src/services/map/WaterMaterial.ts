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
    float wv = waterWaveY(wp.xz, uTime);
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
    // 竖面（|N.y|≈0）= 坑水帘；平面 = 水面
    float isFall = 1.0 - step(0.5, abs(N.y));
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 2.0);

    vec3 col;
    float alpha;
    if (isFall > 0.5) {
      // ★ 坑水帘（vUv.y = 0 唇 → 1 坑底）：唇沿亮白泡沫 → 中段流动 → 坑底融入暗部
      float t = vUv.y;
      vec3 lip = vec3(0.78, 0.90, 0.88);
      vec3 bottom = vec3(0.03, 0.09, 0.12);
      vec3 grad = mix(lip, bottom, smoothstep(0.0, 0.85, t));
      // 下滚亮纹（整体定向运动：uv+uTime，零额外纹理）
      float streak = 0.62 + 0.38 * sin(vUv.x * 11.0 - uTime * 3.2 + t * 5.0);
      // 唇沿白沫
      float foamEdge = 1.0 - smoothstep(0.0, 0.12, t);
      col = grad * (0.65 + 0.35 * streak) + vec3(foamEdge * 0.5);
      col *= uAmbientColor * 1.1 + uSunColor * 0.18 * uSunDay;
      alpha = 0.92;
    } else {
      // ★ 水面：浅水透出 pebble（低深半透明）、深水不透明偏深
      float depthT = clamp(vDeep / uMaxDeep, 0.0, 1.0);
      vec3 shallow = vec3(0.40, 0.72, 0.68);   // 岸浅水：透底泛青
      vec3 deepc = vec3(0.05, 0.16, 0.20);     // 深水：偏暗青绿
      vec3 base = mix(shallow, deepc, depthT);
      // 波纹亮纹（uTime 滚动；微扰横向细纹，无贴图）
      float sh = 0.5 + 0.5 * sin(vWorld.x * 2.1 + vWorld.z * 3.7 + uTime * 1.3);
      sh = 0.5 + 0.5 * sin(vWorld.z * 5.3 - vWorld.x * 2.7 + uTime * 0.9);
      float shimmer = (sh * 0.5 + 0.5) * 0.12;
      vec3 L = normalize(uSunDir);
      float spec = pow(max(dot(reflect(-L, N), V), 0.0), 96.0) * 0.45 * uSunDay;
      // 岸泡沫（浅水处白沿：深 0→0.35m 内）
      float foam = 1.0 - smoothstep(0.0, 0.35, vDeep);
      col = base * (uAmbientColor * 0.95 + uSunColor * (0.10 + fres * 0.30 * uSunDay))
        + uSunColor * spec + base * shimmer + vec3(foam * 0.35);
      alpha = clamp(mix(0.5, 0.85, depthT) + foam * 0.18, 0.0, 0.96);
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