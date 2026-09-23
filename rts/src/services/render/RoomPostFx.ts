// ============================================================
// RoomPostFx —— 基地 / 舰内房间的**轻量屏幕叠加**（2026-09-16 · 修正版）
// ============================================================
// ★ 重要教训（2026-09-16 用户反馈）：
//   一开始照搬经典实现的 EffectComposer 链（RenderPass → GTAO → Bloom → OutputPass），
//   结果**所有材质都被强制走 HDR 缓冲**：
//     · 立绘 / 装备贴片 / 无人机（自写 shader 直接输出 sRGB、无色调映射）被当成线性值
//       二次处理 → 颜色发灰发亮（sRGB 线性化问题）；
//     · `toneMapped:false` 的材质（访客脸、图标）被末端 OutputPass 强行套上 ACES；
//     · 立绘/贴片被挪出主渲染缓冲后**丢掉深度关系**（要么被后处理缓冲吃掉、要么被迫永远画在最上面）。
//   本项目的材质体系是"**直渲到屏幕**"的（大量自写 shader 不做色彩空间转换），
//   因此**不引入 RT 后处理链**，改为：
//     · 场景照旧 `renderer.render(scene, camera)` —— 色彩管线 / 深度关系零改动；
//     · 之后 `autoClear=false` 叠一层**全屏暗角**（黑底 alpha = 暗角强度），
//       属于"不改颜色、只压边角"的纯屏幕叠加，对任何材质都安全。
//   家具的接地感由 RoomDecor 的接触阴影 + 墙面 shader 的墙脚压暗负责（不依赖 GTAO）。

import * as THREE from 'three';

const VIGNETTE_SHADER = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform float uVignette;   // 暗角强度（0 = 关闭）
    void main() {
      vec2 p = vUv - 0.5;
      // 中心完全透明、四周渐暗（只压边角，不碰画面主体）
      float a = clamp(uVignette * dot(p, p) * 1.9, 0.0, 1.0);
      gl_FragColor = vec4(0.0, 0.0, 0.0, a);
    }
  `,
};

export class RoomPostFx {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private geometry = new THREE.PlaneGeometry(2, 2);

  constructor(vignette = 0.40) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uVignette: { value: vignette } },
      vertexShader: VIGNETTE_SHADER.vertexShader,
      fragmentShader: VIGNETTE_SHADER.fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(this.geometry, this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** ★ 在场景渲染之后调用：把暗角叠加上屏（autoClear 保持关闭，不抹掉场景） */
  render(renderer: THREE.WebGLRenderer): void {
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
