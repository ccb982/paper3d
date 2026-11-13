// ============================================================
// src/fx/channels/BeamChannel —— 无人机激光束（统一运行时通道）
// ============================================================
// 从 services/render/DroneBeam 收敛而来（shader/衰减曲线/几何零变化），改动：
//   ① 生命周期归 FxRuntime；端点由句柄 setEndpoints 每帧刷新（目标会移动）；
//   ② **实例池化**：此前每次开火 new 3 个 mesh + 3 个 ShaderMaterial，
//      现在固定 MAX_BEAMS 条常驻复用（开火 100 次只建 4 套 GPU 资源）。
// 视觉口径（勿改）：外红内白、束宽默认 5、止于目标不穿透、两端光斑、
//   0.08s 亮起 → 保持 → 末端 25% 淡出、toneMapped=false 原样发光。
// ============================================================

import * as THREE from 'three';
import type { FxBeamSpec } from '../core/types';
import type { FxChannel } from '../runtime/FxChannel';

/** 同时最多几条束（每个 Ally 一束，同屏开火通常 ≤ 4） */
const MAX_BEAMS = 4;

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

interface BeamInst {
  id: number;
  active: boolean;
  elapsed: number;
  lifetime: number;
  width: number;
  readonly start: THREE.Vector3;
  readonly end: THREE.Vector3;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly originMesh: THREE.Mesh;
  readonly originMat: THREE.ShaderMaterial;
  readonly hitMesh: THREE.Mesh;
  readonly hitMat: THREE.ShaderMaterial;
}

/** 更新姿态用的复用向量（单线程顺序更新，共享安全） */
const _axis = new THREE.Vector3();
const _yAxis = new THREE.Vector3();
const _widthAxis = new THREE.Vector3();
const _toCam = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();

export class BeamChannel implements FxChannel {
  private readonly beams: BeamInst[] = [];
  private nextId = 1;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < MAX_BEAMS; i++) {
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
      // ★ 关闭 tone mapping：加色混合输出原样（否则 ACES 压暗 → 亮色被洗没）
      mat.toneMapped = false;

      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      scene.add(mesh);

      const originMat = makeSpotMaterial();
      const originMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), originMat);
      originMesh.frustumCulled = false;
      originMesh.visible = false;
      scene.add(originMesh);

      const hitMat = makeSpotMaterial();
      const hitMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hitMat);
      hitMesh.frustumCulled = false;
      hitMesh.visible = false;
      scene.add(hitMesh);

      this.beams.push({
        id: 0, active: false, elapsed: 0, lifetime: 0.55, width: 5,
        start: new THREE.Vector3(), end: new THREE.Vector3(),
        mesh, material: mat, originMesh, originMat, hitMesh, hitMat,
      });
    }
  }

  spawn(spec: FxBeamSpec): number {
    let beam = this.beams.find((b) => !b.active);
    if (!beam) {
      // 全在播 → 抢播得最久的（不新建、不掉帧）
      beam = this.beams[0];
      for (const b of this.beams) if (b.elapsed > beam.elapsed) beam = b;
    }

    beam.id = this.nextId++;
    beam.active = true;
    beam.elapsed = 0;
    beam.lifetime = spec.lifetime ?? 0.55;
    beam.width = spec.width ?? 5.0;
    beam.start.set(spec.start.x, spec.start.y, spec.start.z);
    beam.end.set(spec.end.x, spec.end.y, spec.end.z);

    const originSize = spec.originSize ?? 0.5;
    const hitSize = spec.hitSize ?? 0.75;
    beam.originMesh.scale.set(originSize, originSize, 1);
    beam.hitMesh.scale.set(hitSize, hitSize, 1);

    beam.mesh.visible = true;
    beam.originMesh.visible = true;
    beam.hitMesh.visible = true;
    // 先摆一次姿态（否则首帧落在原点，肉眼可见闪一下）
    this.applyPose(beam);
    return beam.id;
  }

  setEndpoints(id: number, start: FxBeamSpec['start'], end: FxBeamSpec['end']): void {
    const beam = this.find(id);
    if (!beam) return;
    beam.start.set(start.x, start.y, start.z);
    beam.end.set(end.x, end.y, end.z);
  }

  isPlaying(id: number): boolean {
    return this.find(id) !== null;
  }

  kill(id: number): void {
    const beam = this.find(id);
    if (beam) this.retire(beam);
  }

  clear(): void {
    for (const b of this.beams) if (b.active) this.retire(b);
  }

  update(dt: number, camera?: THREE.Camera): void {
    for (const b of this.beams) {
      if (!b.active) continue;
      b.elapsed += dt;
      const t = Math.min(1, b.elapsed / b.lifetime);
      if (t >= 1) {
        this.retire(b);
        continue;
      }
      // ★ 保持高亮：0.08s 快速亮起 → 全程 ~1 → 末端 25% 时间淡出
      const fade = t < 0.08 ? t / 0.08 : 1 - Math.max(0, (t - 0.75) / 0.25);
      const op = Math.max(0, Math.min(1, fade));
      b.material.uniforms.uOpacity.value = op;
      b.originMat.uniforms.uOpacity.value = op;
      b.hitMat.uniforms.uOpacity.value = op;
      this.applyPose(b, camera);
    }
  }

  dispose(): void {
    for (const b of this.beams) {
      for (const m of [b.mesh, b.originMesh, b.hitMesh]) {
        m.removeFromParent();
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    }
    this.beams.length = 0;
  }

  /** 束拉伸 + 端点光斑定位（圆柱 billboard 面向相机） */
  private applyPose(b: BeamInst, camera?: THREE.Camera): void {
    const { start, end, mesh } = b;
    const axis = _axis.copy(end).sub(start);
    const len = axis.length();
    if (len < 1e-5) return;
    axis.normalize();
    _mid.copy(start).addScaledVector(axis, len * 0.5);
    mesh.position.copy(_mid);

    // 视向 = 相机 → 束中点；无相机时退化为 +Z（首帧兜底，下一帧即被真实视向覆盖）
    if (camera) _toCam.copy(camera.position).sub(_mid).normalize();
    else _toCam.set(0, 0, 1);
    const widthAxis = _widthAxis.copy(axis).cross(_toCam);
    if (widthAxis.lengthSq() < 1e-6) widthAxis.set(0, 1, 0).cross(axis);
    widthAxis.normalize();
    const yAxis = _yAxis.copy(widthAxis).cross(axis).normalize();
    mesh.quaternion.setFromRotationMatrix(_mat4.makeBasis(axis, yAxis, widthAxis));
    mesh.scale.set(len, b.width, 1);

    b.originMesh.position.copy(start);
    b.hitMesh.position.copy(end);
    if (camera) {
      b.originMesh.quaternion.copy(camera.quaternion);
      b.hitMesh.quaternion.copy(camera.quaternion);
    }
  }

  private find(id: number): BeamInst | null {
    if (id <= 0) return null;
    for (const b of this.beams) if (b.active && b.id === id) return b;
    return null;
  }

  private retire(b: BeamInst): void {
    b.active = false;
    b.elapsed = 0;
    b.mesh.visible = false;
    b.originMesh.visible = false;
    b.hitMesh.visible = false;
  }
}
