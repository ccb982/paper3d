// ============================================================
// DroneBeam —— 无人机攻击射线特效（外红内白，纯表现层）
// ============================================================
// 三件套（同一个 0.55s 衰减曲线，Additive + toneMapped=false 原样发光）：
//   ① 光束本体：世界空间拉伸 quad，长轴 = 无人机→目标方向，**止于目标**（无穿透），
//      宽度 5m，圆柱 billboard 面向相机；
//   ② 射出点光斑：机头（无人机位置）白芯红晕小圆盘，满 billboard；
//   ③ 击中点光斑：目标位置的大冲击闪光（比机头大），目标死亡后停在最后落点。
// 光斑与束共享同一条 alpha 衰减（快速亮起 → 高亮保持 → 末端淡出）。

import * as THREE from 'three';

/** 端点光斑 shader（径向渐变：白芯 → 红外缘） */
const SPOT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const SPOT_FRAG = /* glsl */ `
  precision highp float;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;           // 0 芯 → 1 缘
    float core = 1.0 - smoothstep(0.05, 0.45, r);  // 白亮芯
    float glow = 1.0 - smoothstep(0.15, 1.0, r);   // 红外晕
    vec3 col = vec3(1.0, 0.08, 0.05) * (0.6 + 0.5 * glow)
             + vec3(1.0, 0.97, 0.90) * (0.5 + 0.9 * core);
    float a = uOpacity * glow;
    gl_FragColor = vec4(col * a, a);
  }
`;

function makeSpotMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1 } },
    vertexShader: SPOT_VERT,
    fragmentShader: SPOT_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  m.toneMapped = false;
  return m;
}

export class DroneBeamEffect {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  /** 射出点光斑（机头） */
  private originMesh: THREE.Mesh;
  private originMat: THREE.ShaderMaterial;
  /** 击中点光斑（目标） */
  private hitMesh: THREE.Mesh;
  private hitMat: THREE.ShaderMaterial;
  private elapsed = 0;
  private lifetime: number;
  private width: number;
  /** 目标消失后的落点保持（击中光斑不跳空） */
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
    opts?: { lifetime?: number; width?: number; originSize?: number; hitSize?: number },
  ) {
    this.lifetime = opts?.lifetime ?? 0.55;
    this.width = opts?.width ?? 5.0;
    const originSize = opts?.originSize ?? 0.5;
    const hitSize = opts?.hitSize ?? 0.75;

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
    // ★ 关闭 tone mapping：加色混合输出原样（否则 ACES 压暗 → 亮色被洗没）
    this.material.toneMapped = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // ★ 射出点光斑（机头）
    this.originMat = makeSpotMaterial();
    this.originMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.originMat);
    this.originMesh.scale.set(originSize, originSize, 1);
    this.originMesh.frustumCulled = false;
    scene.add(this.originMesh);

    // ★ 击中点光斑（目标；比机头大）
    this.hitMat = makeSpotMaterial();
    this.hitMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.hitMat);
    this.hitMesh.scale.set(hitSize, hitSize, 1);
    this.hitMesh.frustumCulled = false;
    scene.add(this.hitMesh);
  }

  /** 每帧推进：束拉伸 + 端点光斑跟随；播完返回 true */
  update(dt: number, start: THREE.Vector3, end: THREE.Vector3, camera: THREE.Camera): boolean {
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / this.lifetime);
    // ★ 保持高亮：0.08s 快速亮起 → 全程 ~1 → 末端 25% 时间淡出
    const fade = t < 0.08 ? t / 0.08 : 1 - Math.max(0, (t - 0.75) / 0.25);
    const op = Math.max(0, Math.min(1, fade));
    this.material.uniforms.uOpacity.value = op;
    this.originMat.uniforms.uOpacity.value = op;
    this.hitMat.uniforms.uOpacity.value = op;

    // ---- 光束本体：机头 → 目标（止于目标，无穿透延伸） ----
    this.lastEnd.copy(end);
    const axis = this._axis.copy(end).sub(start);
    const len = axis.length();
    axis.normalize();
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

    // ---- 端点光斑：机头（射出点）满 billboard 面向相机 ----
    this.originMesh.position.copy(start);
    this.originMesh.quaternion.copy(camera.quaternion);
    // ---- 击中点：真实目标位置（非延伸末端）；目标死亡停在最后落点 ----
    this.hitMesh.position.copy(end);
    this.hitMesh.quaternion.copy(camera.quaternion);
    return t >= 1;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.originMesh);
    this.originMesh.geometry.dispose();
    this.originMat.dispose();
    this.scene.remove(this.hitMesh);
    this.hitMesh.geometry.dispose();
    this.hitMat.dispose();
  }
}