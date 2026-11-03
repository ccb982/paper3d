// ============================================================
// normalRT —— ★ 离屏细节法线图（GPU Gems 1 Ch.1 的 render target 法）
// ============================================================
// GPU Gems 原文：
//   「在几何分辨率之下，我们继续把该技术应用到**纹理空间**。通过采样正弦叠加的**法线**，
//     用简单的像素着色器渲染到 **render target 纹理**，从而产生表面的法线图。」
//   「**水纹理中的细波主导了模拟的逼真度**。」
//
// ★ 为什么这样：
//   · 几何波（顶点）用**解析 Gerstner**（无采样 ⇒ 无接缝）
//   · 细节波（片元）用**这张 RT**（一次采样 ⇒ 主 pass 极省）
//   ⇒ 一张共用纹理 + 一次采样，兼顾"无接缝"与"细节丰富"。
//
// ★ 平铺：RT 里的法线是**周期函数**（按 uv 空间算）⇒ 主 pass 按世界坐标/period 采样
//   ⇒ 跨 chunk 天然连续、无接缝。
// ============================================================

import * as THREE from 'three';

const RT_SIZE = 512;

/** 离屏细节法线图 */
export class NormalDetailRT {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  constructor(gerstnerA: THREE.Vector4[], gerstnerB: THREE.Vector4[]) {
    this.target = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        // ★ 与水面材质**共享同一份 uniform 数组**（同一批 Vector4 对象）
        //   ⇒ Gerstner 的淡出/淡入会自动同步到这里，不用额外同步逻辑。
        uGerstnerA: { value: gerstnerA },
        uGerstnerB: { value: gerstnerB },
        uTime: { value: 0 },
        uPeriod: { value: 6.0 },      // 平铺周期（m）：细节波的空间尺度
        uDetailAmp: { value: 1.0 },    // 细节法线强度
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        #define GERSTNER_COUNT 8
        uniform vec4 uGerstnerA[GERSTNER_COUNT];
        uniform vec4 uGerstnerB[GERSTNER_COUNT];
        uniform float uTime;
        uniform float uPeriod;
        uniform float uDetailAmp;
        varying vec2 vUv;

        void main() {
          // uv 空间 = 周期域 ⇒ 平铺
          vec2 p = vUv * uPeriod;
          vec3 n = vec3(0.0, 1.0, 0.0);
          for (int i = 0; i < GERSTNER_COUNT; i++) {
            vec4 GA = uGerstnerA[i];
            vec4 GB = uGerstnerB[i];
            float amp = GA.w;
            if (amp <= 0.0) continue;
            float k = GA.z, steep = GB.x, om = GB.y;
            float f = k * (GA.x * p.x + GA.y * p.y) - om * uTime;
            float cf = cos(f), sf = sin(f);
            n.x += -GA.x * k * amp * cf;
            n.y += -steep * k * amp * sf;
            n.z += -GA.y * k * amp * cf;
          }
          n = normalize(n);
          // ★ 细节层：把大尺度部分去掉，只留**小波纹**的斜率 ⇒ 与几何波不重复
          vec2 slope = vec2(n.x, n.z) * uDetailAmp;
          gl_FragColor = vec4(clamp(slope * 0.5 + 0.5, 0.0, 1.0), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    // 全屏三角形
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, -1, 0, 3, -1, 0, -1, 3, 0,
    ]), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  /** 更新 uniform（时间 / 周期 / 强度） */
  setParams(time: number, period?: number, detailAmp?: number): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    if (period !== undefined) u.uPeriod.value = period;
    if (detailAmp !== undefined) u.uDetailAmp.value = detailAmp;
  }

  /** 渲染到 RT（每帧一次） */
  render(renderer: THREE.WebGLRenderer, time: number): void {
    this.setParams(time);
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
  }

  /** RT 纹理（给水面材质采样） */
  get texture(): THREE.Texture { return this.target.texture; }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
