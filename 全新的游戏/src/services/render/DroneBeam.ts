// ============================================================
// DroneBeam —— 无人机攻击射线特效（外红内白，纯表现层）
// ============================================================
// 世界空间拉伸 quad：长轴 = 攻击方向（无人机→目标），宽度面向相机
// （圆柱 billboard：法线指向相机侧）。shader 沿宽度渐变——
// 宽红外晕 + 白亮内芯（外红内白）；加色混合（Additive）发光，不写深度。
// 生命周期 ~0.55s：0.08s 快速亮起 → 保持高亮 → 末端淡出（足够肉眼捕捉）。

import * as THREE from 'three';

export class DroneBeamEffect {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private elapsed = 0;
  private lifetime: number;
  private width: number;
  /** 目标消失后的落点保持（束不跳空） */
  private lastEnd = new THREE.Vector3();
  /** 复用向量（零分配） */
  private _axis = new THREE.Vector3();
  private _yAxis = new THREE.Vector3();
  private _widthAxis = new THREE.Vector3();
  private _toCam = new THREE.Vector3();
  private _mid = new THREE.Vector3();
  private _mat4 = new THREE.Matrix4();

  constructor(
    private scene: THREE.Scene,
    opts?: { lifetime?: number; width?: number },
  ) {
    this.lifetime = opts?.lifetime ?? 0.55;
    this.width = opts?.width ?? 5.0;

    const mat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 1 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          // ★ 外红内白：vUv.y 跨束宽（0 边 → 0.5 芯 → 1 边）；vUv.x 沿束长（0 机侧 → 1 末端）
          float d = abs(vUv.y - 0.5) * 2.0;           // 0=中心 1=边缘
          float edge = smoothstep(0.10, 1.0, d);       // 宽红外晕
          float core = 1.0 - smoothstep(0.02, 0.42, d); // 细白亮芯
          float tip = smoothstep(0.72, 0.98, vUv.x);   // 末端亮芯白斑（射穿感）
          vec3 red = vec3(1.0, 0.08, 0.05);
          vec3 white = vec3(1.0, 0.97, 0.90);
          vec3 col = red * (0.75 + 0.55 * edge) + white * (0.45 + 0.85 * core + 0.9 * tip);
          float a = uOpacity * (0.85 + 0.15 * core + 0.15 * tip);
          gl_FragColor = vec4(col * a, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.material = mat;
    // ★ 关闭 tone mapping：加色混合输出原样（否则 ACES 压暗 → 亮色被洗没，
    //   细到像一条线；这是"0.8m 看着像 0.8cm"的主因）
    this.material.toneMapped = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** 每帧推进：束起点→终点拉伸 + 圆柱 billboard 面向相机；播完返回 true */
  update(dt: number, start: THREE.Vector3, end: THREE.Vector3, camera: THREE.Camera): boolean {
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.lifetime);
    // ★ 保持高亮：0.08s 快速亮起 → 全程 ~1 → 末端 25% 时间淡出（不再一眨眼就消失）
    const fade = t < 0.08 ? t / 0.08 : 1 - Math.max(0, (t - 0.75) / 0.25);
    this.material.uniforms.uOpacity.value = Math.max(0, Math.min(1, fade));

    this.lastEnd.copy(end);
    const axis = this._axis.copy(end).sub(start);
    const dist = axis.length();
    axis.normalize();
    // ★ 射线穿过目标继续延伸（攻击圈近 → 光束不能只到目标就完）：
    //   长度 = max(距离×1.5, 最小 3m)，末端亮芯落在目标稍后 → 有"射穿"感
    const len = Math.max(dist * 1.5, 3.0);
    this._mid.copy(start).addScaledVector(axis, len * 0.5);
    this.mesh.position.copy(this._mid);

    // 圆柱 billboard：法线 = 束方向 × 视向 → 指向相机侧
    const widthAxis = this._widthAxis.copy(axis).cross(this._toCam.copy(camera.position).sub(this._mid).normalize());
    if (widthAxis.lengthSq() < 1e-6) {
      widthAxis.set(0, 1, 0).cross(axis);
    }
    widthAxis.normalize();
    const yAxis = this._yAxis.copy(widthAxis).cross(axis).normalize();
    this.mesh.quaternion.setFromRotationMatrix(this._mat4.makeBasis(axis, yAxis, widthAxis));
    this.mesh.scale.set(len, this.width, 1);
    return t >= 1;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}