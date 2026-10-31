import * as THREE from 'three';
import type { FluidGrid } from '../core/FluidGrid';
import { GPUOps } from '../core/GPUOps';

/**
 * 速度场效果 pass：粘度扩散 + 边界处理。
 *
 * 从 FluidEditor 原地迁出（2026-08 架构整理）：shader / 材质 key 逐字保留，
 * 行为零变更的纯结构重构。
 */
export class VelocitySolver {
  constructor(
    private renderer: THREE.WebGLRenderer,
    private gpu: GPUOps,
  ) {}

  /**
   * ★ 粘度：速度场显式扩散 ∂v/∂t = ν∇²v（h=1 cell，离散 Laplacian = 四邻和−4·自身）。
   *
   * 稳定性（von Neumann）：显式扩散要求 ν·dt/h² ≤ 0.25 → 超出时子步分摊，
   * 子步数上限 MAX_STEPS=64（ν≈770@60fps 内精确，超过后等效粘度饱和不失稳）。
   *
   * 效果：剪切层/射流等小尺度结构按 e^{−νk²t} 最快衰减，大尺度运动保留 → 内聚感。
   */
  applyViscosity(
    velocityGrid: FluidGrid,
    obstacleTex: THREE.Texture,
    dt: number,
    nu: number,
  ): void {
    if (nu <= 0 || dt <= 0) return;

    const w = velocityGrid.resolution.w;
    const h = velocityGrid.resolution.h;
    const total = nu * dt;
    const MAX_DIFF = 0.2;   // 单步扩散稳定上限（<0.25）
    const MAX_STEPS = 64;   // 子步上限（性能护栏；放开到 64 支持大粘度自由调控）
    const steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(total / MAX_DIFF)));
    const perStep = Math.min(MAX_DIFF, total / steps);

    const mat = this.gpu.getMaterial('editor_viscosity_v1', {
      uVelocity: { value: velocityGrid.read },
      uObstacle: { value: obstacleTex },
      uInvRes: { value: new THREE.Vector2(1 / w, 1 / h) },
      uDtNu: { value: perStep },
    }, /* glsl */ `
      uniform sampler2D uVelocity;
      uniform sampler2D uObstacle;
      uniform vec2 uInvRes;
      uniform float uDtNu;
      varying vec2 vUv;
      void main() {
        // 墙内速度保持（与表面张力 pass 一致）
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = texture2D(uVelocity, vUv);
          return;
        }
        vec2 ts = uInvRes;
        vec2 vC = texture2D(uVelocity, vUv).rg;
        vec2 vL = texture2D(uVelocity, vUv - vec2(ts.x, 0.0)).rg;
        vec2 vR = texture2D(uVelocity, vUv + vec2(ts.x, 0.0)).rg;
        vec2 vB = texture2D(uVelocity, vUv - vec2(0.0, ts.y)).rg;
        vec2 vT = texture2D(uVelocity, vUv + vec2(0.0, ts.y)).rg;
        vec2 vel = vC + uDtNu * (vL + vR + vT + vB - 4.0 * vC);
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    for (let i = 0; i < steps; i++) {
      mat.uniforms.uVelocity.value = velocityGrid.read;  // swap 后刷新读取缓冲
      this.gpu.render(this.renderer, velocityGrid.write, mat);
      velocityGrid.swap();
    }
  }

  /**
   * 速度边界处理：边界像素取内邻值（零法向梯度，自由流出）。
   * ★ 分轴 eps：X/Y 分辨率不同时各用各的像素尺寸，避免非正方形网格边界判断偏移。
   */
  applyBoundary(velocityGrid: FluidGrid): void {
    const w = velocityGrid.resolution.w;
    const h = velocityGrid.resolution.h;

    const mat = this.gpu.getMaterial('boundary', {
      velTex: { value: velocityGrid.read },
      resolution: { value: new THREE.Vector2(w, h) },
    }, /* glsl */ `
      uniform sampler2D velTex;
      uniform vec2 resolution;
      varying vec2 vUv;
      void main() {
        vec2 vel = texture2D(velTex, vUv).rg;
        // ★ 分轴 eps：X/Y 分辨率不同时各用各的像素尺寸，避免非正方形网格边界判断偏移
        float epsX = 1.0 / resolution.x;
        float epsY = 1.0 / resolution.y;
        if (vUv.x < epsX) {
          vel = texture2D(velTex, vec2(vUv.x + epsX, vUv.y)).rg;
        } else if (vUv.x > 1.0 - epsX) {
          vel = texture2D(velTex, vec2(vUv.x - epsX, vUv.y)).rg;
        }
        if (vUv.y < epsY) {
          vel = texture2D(velTex, vec2(vUv.x, vUv.y + epsY)).rg;
        } else if (vUv.y > 1.0 - epsY) {
          vel = texture2D(velTex, vec2(vUv.x, vUv.y - epsY)).rg;
        }
        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, velocityGrid.write, mat);
    velocityGrid.swap();
  }
}
