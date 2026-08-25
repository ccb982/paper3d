// ============================================================
// TerrainMaterial —— 地形双纹理材质（albedo × 光照图，烘焙域专属）
// ============================================================
// 合成公式（与 ChunkAppearance.bakeChunkMaps 的 lightmap 通道约定配套）：
//   final = albedo × (uAmbientColor × lightmap.g + uSunColor × lightmap.r)
//     lightmap.r = 直射项（N·L × 阴影可见度，烘焙期定死太阳方向）
//     lightmap.g = AO
//
// 昼夜循环（SunCycle）只调制两个 uniform：
//   - 白天：暖阳光 + 冷灰环境 → 地形全亮
//   - 夜晚：太阳项衰减 + 环境压暗偏蓝 → 地形自然入夜
//   - 阴影区只吃环境项 → 天黑时影子比亮部先"冷"下去，观感物理
//
// 职责边界：
//   - 材质不知道 SunCycle/RenderManager——被动接收 updateTerrainLighting
//   - 实体动态影子体系（SilhouetteShadow 等）独立于本材质，互不感知
// ============================================================

import * as THREE from 'three';

/** 地形光照调参入口（集中一处；数值锚点：正午平地合成亮度 ≈1.3 进 ACES） */
export const TERRAIN_LIGHT_TUNING = {
  /** 直射强度基准（乘 SunCycle.intensityScale） */
  sunIntensity: 0.95,
  /** 白昼环境色（冷灰蓝，天空主导）与强度 */
  ambientDay: 0x9aa8c4,
  ambientDayIntensity: 0.62,
  /** 夜晚环境色（深蓝）与强度 */
  ambientNight: 0x2a3552,
  ambientNightIntensity: 0.22,
};

const registry = new Set<TerrainMaterial>();

export class TerrainMaterial extends THREE.ShaderMaterial {
  constructor(albedo: THREE.Texture, lightmap: THREE.Texture) {
    super({
      // ★ ShaderMaterial 开 fog:true 时，雾 uniforms 必须自己备齐
      //   （fogColor/fogNear/fogFar，含 FogExp2 的 fogDensity 以防切换），
      //   否则渲染器每帧 refreshFogUniforms 读 undefined 直接崩。
      uniforms: Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
        uAlbedo: { value: albedo },
        uLightmap: { value: lightmap },
        uAmbientColor: { value: new THREE.Color(0x9aa8c4).multiplyScalar(TERRAIN_LIGHT_TUNING.ambientDayIntensity) },
        uSunColor: { value: new THREE.Color(0xfff3e0).multiplyScalar(TERRAIN_LIGHT_TUNING.sunIntensity) },
      }),
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        #include <common>
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAlbedo;
        uniform sampler2D uLightmap;
        uniform vec3 uAmbientColor;
        uniform vec3 uSunColor;
        varying vec2 vUv;
        #include <common>
        #include <fog_pars_fragment>
        void main() {
          vec3 alb = texture2D(uAlbedo, vUv).rgb;
          vec3 lm = texture2D(uLightmap, vUv).rgb;   // r=直射 / g=AO
          vec3 lit = alb * (uAmbientColor * lm.g + uSunColor * lm.r);
          gl_FragColor = vec4(lit, 1.0);
          #include <tonemapping_fragment>   // ★ 与全局 ACES 管线对齐（缺了会偏色）
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
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
