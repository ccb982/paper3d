import * as THREE from 'three';
import type { FluidGrid } from '../core/FluidGrid';
import { GPUOps } from '../core/GPUOps';

export type PressureBoundaryMode = 'dirichlet' | 'neumann';

export interface PressureSolveOptions {
  iterations: number;
  /** SOR 过松弛因子（1.5~1.8） */
  omega: number;
  /** 自由表面 φ 场（null = 全域求解）：提供时 φ>0 的空气区压力恒 0 */
  phiTex: THREE.Texture | null;
  boundaryMode: PressureBoundaryMode;
}

/**
 * 压力求解器：红-黑 SOR 泊松求解 ∇²p = ∇·u + f + 梯度修正。
 *
 * 从 FluidEditor 原地迁出（2026-08 架构整理）：shader / 材质 key / uniform
 * 更新语义逐字保留，行为零变更的纯结构重构。
 *
 * ★ 自由表面边界（真实感核心，见 流体架构.md §3.5）：
 *   φ<0 为液体；提供 phiTex 时 φ>0 的空气区压力恒 0、空气邻居按零压处理 ——
 *   液体成为有表面的不可压缩整体。
 *
 * 热启动约定：调用方决定是否清零压力场（enableWarmStart=false 时清），
 * 本类只做迭代求解。
 */
export class PressureSolver {
  constructor(
    private renderer: THREE.WebGLRenderer,
    private gpu: GPUOps,
  ) {}

  /**
   * 压力泊松方程求解：∇²p = ∇·u + f（f 为 divergenceGrid 的 R 通道）。
   * 每轮迭代含红+黑两个 Pass。
   */
  solve(
    pressureGrid: FluidGrid,
    velocityGrid: FluidGrid,
    divergenceGrid: FluidGrid,
    obstacleTex: THREE.Texture,
    resolution: { w: number; h: number },
    opts: PressureSolveOptions,
  ): void {
    for (let iter = 0; iter < opts.iterations; iter++) {
      // Pass 1: 红色像素 ((x+y) 为奇数)
      this.runSORPass(pressureGrid, velocityGrid, divergenceGrid, obstacleTex, resolution, 'red', opts);
      // Pass 2: 黑色像素 ((x+y) 为偶数)
      this.runSORPass(pressureGrid, velocityGrid, divergenceGrid, obstacleTex, resolution, 'black', opts);
    }
  }

  /** 执行单次红或黑 Pass（isRed=(x+y)&1 决定本轮更新哪一半像素）。 */
  private runSORPass(
    pressureGrid: FluidGrid,
    velocityGrid: FluidGrid,
    divergenceGrid: FluidGrid,
    obstacleTex: THREE.Texture,
    resolution: { w: number; h: number },
    color: 'red' | 'black',
    opts: PressureSolveOptions,
  ): void {
    const phiTex = opts.phiTex;
    // ★ 自由表面模式用独立材质 key（shader 不同，避免缓存串扰）
    const key = phiTex ? `sor_${color}_fs` : `sor_${color}_obstacle`;
    const mat = this.gpu.getMaterial(key, {
      uPressure: { value: pressureGrid.read },
      uVelocity: { value: velocityGrid.read },
      uDivSource: { value: divergenceGrid.read },
      uObstacle: { value: obstacleTex },
      uPhi: { value: phiTex ?? obstacleTex },
      uPhiOn: { value: phiTex ? 1 : 0 },
      uInvResolution: { value: new THREE.Vector2(1.0 / resolution.w, 1.0 / resolution.h) },
      uOmega: { value: opts.omega },
      uColor: { value: color === 'red' ? 0 : 1 },
      uBoundaryMode: { value: opts.boundaryMode === 'dirichlet' ? 1 : 0 },
    }, /* glsl */ `
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      uniform sampler2D uDivSource;
      uniform sampler2D uObstacle;
      uniform sampler2D uPhi;
      uniform int uPhiOn;         // 1=自由表面边界（φ>0 的空气区压力恒 0）
      uniform vec2 uInvResolution;
      uniform float uOmega;
      uniform int uColor;
      uniform int uBoundaryMode;  // 0=Neumann(零梯度), 1=Dirichlet(固定p=0)
      varying vec2 vUv;

      void main() {
        // ★ 墙体像素：压力强制为 0（墙体是不可压缩的硬边界）
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = vec4(0.0);
          return;
        }

        // ★ 自由表面：空气区（φ>0）压力强制为 0 —— 液体是有表面的不可压缩整体
        if (uPhiOn == 1 && texture2D(uPhi, vUv).r > 0.0) {
          gl_FragColor = vec4(0.0);
          return;
        }

        // Dirichlet 边界：边界像素压力固定为 0
        if (uBoundaryMode == 1) {
          if (vUv.x <= uInvResolution.x || vUv.x >= 1.0 - uInvResolution.x
           || vUv.y <= uInvResolution.y || vUv.y >= 1.0 - uInvResolution.y) {
            gl_FragColor = vec4(0.0);
            return;
          }
        }

        ivec2 pos = ivec2(vUv / uInvResolution);
        int isRed = (pos.x + pos.y) & 1;   // 1=红色, 0=黑色
        int target = 1 - uColor;            // uColor=0→target=1(红色), uColor=1→target=0(黑色)
        if (isRed != target) {
          // 不是本轮目标像素，直传旧值
          gl_FragColor = texture2D(uPressure, vUv);
          return;
        }

        vec2 ts = uInvResolution;

        // 采样四邻域压力（墙体邻居的压力视为 0）
        float pL = texture2D(uPressure, vUv + vec2(-ts.x, 0.0)).r;
        float pR = texture2D(uPressure, vUv + vec2( ts.x, 0.0)).r;
        float pT = texture2D(uPressure, vUv + vec2(0.0,  ts.y)).r;
        float pB = texture2D(uPressure, vUv + vec2(0.0, -ts.y)).r;

        // ★ 邻居是墙体/空气（自由表面模式）时，该方向压力视为 0（硬边界）
        if (texture2D(uObstacle, vUv + vec2(-ts.x, 0.0)).r > 0.5) pL = 0.0;
        if (texture2D(uObstacle, vUv + vec2( ts.x, 0.0)).r > 0.5) pR = 0.0;
        if (texture2D(uObstacle, vUv + vec2(0.0,  ts.y)).r > 0.5) pT = 0.0;
        if (texture2D(uObstacle, vUv + vec2(0.0, -ts.y)).r > 0.5) pB = 0.0;
        if (uPhiOn == 1) {
          if (texture2D(uPhi, vUv + vec2(-ts.x, 0.0)).r > 0.0) pL = 0.0;
          if (texture2D(uPhi, vUv + vec2( ts.x, 0.0)).r > 0.0) pR = 0.0;
          if (texture2D(uPhi, vUv + vec2(0.0,  ts.y)).r > 0.0) pT = 0.0;
          if (texture2D(uPhi, vUv + vec2(0.0, -ts.y)).r > 0.0) pB = 0.0;
        }

        // 计算散度（中心差分）
        vec2 vR = texture2D(uVelocity, vUv + vec2( ts.x, 0.0)).rg;
        vec2 vL = texture2D(uVelocity, vUv + vec2(-ts.x, 0.0)).rg;
        vec2 vT = texture2D(uVelocity, vUv + vec2(0.0,  ts.y)).rg;
        vec2 vB = texture2D(uVelocity, vUv - vec2(0.0, ts.y)).rg;

        float div = (vR.x - vL.x) * 0.5 * uInvResolution.x
                  + (vT.y - vB.y) * 0.5 * uInvResolution.y;
        // ★ 散度源项：∇²p = ∇·u + f（爆炸/源汇；负散度源 → 高压 → 向外推）
        div += texture2D(uDivSource, vUv).r;

        float pOld = texture2D(uPressure, vUv).r;
        float pNew = (pL + pR + pT + pB - div) / 4.0;
        pNew = (1.0 - uOmega) * pOld + uOmega * pNew;

        gl_FragColor = vec4(pNew, 0.0, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, pressureGrid.write, mat);
    pressureGrid.swap();
  }

  /**
   * 压力梯度修正：新速度 = 旧速度 − grad(p)，使速度场散度为零。
   * gradP = [ (pR−pL)/2, (pT−pB)/2 ] · resolution（标量梯度 → px/s）。
   */
  applyGradient(
    pressureGrid: FluidGrid,
    velocityGrid: FluidGrid,
    obstacleTex: THREE.Texture,
    resolution: { w: number; h: number },
  ): void {
    const mat = this.gpu.getMaterial('pressureGradient_obstacle', {
      uPressure: { value: pressureGrid.read },
      uVelocity: { value: velocityGrid.read },
      uObstacle: { value: obstacleTex },
      uInvResolution: { value: new THREE.Vector2(1.0 / resolution.w, 1.0 / resolution.h) },
    }, /* glsl */ `
      uniform sampler2D uPressure;
      uniform sampler2D uVelocity;
      uniform sampler2D uObstacle;
      uniform vec2 uInvResolution;
      varying vec2 vUv;

      void main() {
        // ★ 墙体像素：速度强制归零
        if (texture2D(uObstacle, vUv).r > 0.5) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }

        vec2 ts = uInvResolution;

        float pL = texture2D(uPressure, vUv + vec2(-ts.x, 0.0)).r;
        float pR = texture2D(uPressure, vUv + vec2( ts.x, 0.0)).r;
        float pT = texture2D(uPressure, vUv + vec2(0.0,  ts.y)).r;
        float pB = texture2D(uPressure, vUv + vec2(0.0, -ts.y)).r;

        // gradP = [ (pR-pL)/2, (pT-pB)/2 ] * resolution（标量压力梯度 → 像素/秒）
        vec2 gradP = vec2(pR - pL, pT - pB) * 0.5 / uInvResolution;
        vec2 vel = texture2D(uVelocity, vUv).rg;
        vel -= gradP;

        gl_FragColor = vec4(vel, 0.0, 1.0);
      }
    `);

    this.gpu.render(this.renderer, velocityGrid.write, mat);
    velocityGrid.swap();
  }
}
