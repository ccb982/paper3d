// ============================================================
// CloudSolver —— 天空云朵 GPU 流体（512×512，附着穹顶）
// ============================================================
// 归 RenderManager 协调（实时渲染域）；与特效播放器同一套 FluidSolver 内核
// 的轻量封装，产出云场合成纹理供 SkyDome 采样叠加。
//
// 物理参数（2026-09-01 定稿）：
//   - 速度平流（半拉格朗日） ON + 压力投影（SOR）ON  → 云团内聚成蓬松形状
//   - maxVelocity = 600 px/s 限速
//   - 每秒只 step() 2 次（累积真实 dt，每帧 dt=0.5s）→ 低开销
//   - vector 模式：colorGrid HSLA，alpha = 云的遮盖度
//   - 小半径随机注入：周期在 512² 内随机取点，radius≈0.04~0.08
//   - 双缓冲过渡：每次结算把旧帧冻结进 prev，再以 prev→cur 逐帧 crossfade，
//     平滑掉 2 帧/秒结算的跳变（内核本身即乒乓纹理，此处是输出层的第二重过渡）
//
// 坐标系约定（与 FluidSolver 一致）：UV 0~1、Y 向下为正、flipY=false。
// ============================================================

import * as THREE from 'three';
import { FluidSolver, type FluidSolverConfig, type InjectionConfig } from '../../vendor/player/fluid/FluidSolver';

/** 云场分辨率（512×512，规格定死） */
const CLOUD_W = 512;
const CLOUD_H = 512;

/** 每秒 step 次数（2 帧/秒） */
const STEPS_PER_SECOND = 2;

/** 随机注入周期（秒）：每隔多久撒一团小云 */
const INJECT_INTERVAL = 3.0;

// ---- 云色随【时间】变化（纯 hour 推导，不依赖太阳采样）----
/** 白天云：近白暖调 HSLA */
const DAY_TINT: [number, number, number] = [0.09, 0.05, 0.92];
/** 晨昏云：暖橙/粉 HSLA */
const DUSK_TINT: [number, number, number] = [0.06, 0.40, 0.78];
/** 晨昏窗口（小时）：距日出/日落 ±1.5h 内渐变到暖色 */
const TWILIGHT_WINDOW = 1.5;
const SUNRISE_H = 6;
const SUNSET_H = 18;
/** 云遮盖度基准（alpha） */
const CLOUD_ALPHA = 0.5;

export class CloudSolver {
  readonly solver: FluidSolver;
  private renderer: THREE.WebGLRenderer;

  /** 随机注入累计计时器 */
  private injectTimer = 0;
  /** step 累计计时器（驱动 2 帧/秒） */
  private stepAccum = 0;
  /** 当前游戏时刻（小时 0..24；由 RenderManager 每帧喂） */
  private hour = 7.5;

  private resolution: { w: number; h: number } = { w: CLOUD_W, h: CLOUD_H };

  // ---- 双缓冲过渡：低 2 帧/秒结算 → 每帧在 prev↔cur 间 crossfade，消除跳变 ----
  /** 冻结的旧帧（上一结算帧的副本） */
  private prevRT: THREE.WebGLRenderTarget;
  /** 当前帧（= solver 的 compositeTarget，结算时更新） */
  private curTex: THREE.Texture;
  /** 过渡进度 0..1（一结算间隔内从 prev 插值到 cur） */
  private blendProgress = 1;

  // 全屏复制 pass（把 solver composite 拷入 prevRT）
  private copyScene = new THREE.Scene();
  private copyCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private copyMat: THREE.ShaderMaterial;
  private copyQuad: THREE.Mesh;

  constructor(renderer: THREE.WebGLRenderer) {
    const cfg: FluidSolverConfig = {
      resolution: { w: CLOUD_W, h: CLOUD_H },
      channels: { r: true, g: true, b: true, a: true },
      enableAdvection: true,
      enablePressure: true,
      pressureIterations: 10,
      pressureOmega: 1.7,
      pressureBoundaryMode: 'dirichlet',
      enableWarmStart: true,
      gravity: { x: 0, y: 0 },
      velocityScale: 1,
      maxVelocity: 600,            // ★ 限速 600 px/s
      viscosity: 0,
      colorBoundaryMode: 'repeat', // 云绕四周循环（无边界突变）
      advectionMode: 'vector',
      combineMode: 'add',
      scalarConfig: {
        hMultiplier: 1, sMultiplier: 1, lMultiplier: 1, aMultiplier: 1,
        baselineDensity: 1.0, decayRate: 0,
      },
      levelSetConfig: {
        enabled: false, reinitIterations: 2, surfaceTension: 0,
        smoothingRadius: 2, reinitInterval: 10, narrowBandWidth: 5,
        constrainLiquid: false, clampAirPhi: true, maxAirPhi: 0,
        compensateWaterPhi: false, waterCompensationRate: 0,
      },
      continuousSources: [],
    };
    this.renderer = renderer;
    this.solver = new FluidSolver(renderer, cfg, this.resolution);

    // ---- 双缓冲过渡初始化 ----
    this.prevRT = new THREE.WebGLRenderTarget(CLOUD_W, CLOUD_H, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });
    // curTex = solver 的实时合成纹理（结算时更新）
    this.curTex = this.solver.getCompositeTexture()!;
    // 全屏复制：把 cur 拷入 prev（冻结旧帧）
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: this.curTex } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(uTex, vUv); }
      `,
      depthWrite: false,
      depthTest: false,
    });
    this.copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.copyMat);
    this.copyScene.add(this.copyQuad);
  }

  /** 按当前时间（hour）推导云 HSLA 注入色：晨昏染暖，其余接近白 */
  private cloudTint(): [number, number, number, number] {
    const h = this.hour;
    // 距最近晨昏点的小时距离（取日出/日落中较近者）
    const dSunrise = Math.min(Math.abs(h - SUNRISE_H), 24 - Math.abs(h - SUNRISE_H));
    const dSunset = Math.min(Math.abs(h - SUNSET_H), 24 - Math.abs(h - SUNSET_H));
    const dTwilight = Math.min(dSunrise, dSunset);
    // 0..1：1=正好晨昏，0=距晨昏 ≥ TWILIGHT_WINDOW
    const wave = (TWILIGHT_WINDOW - dTwilight) / TWILIGHT_WINDOW;
    const twilight = Math.min(1, Math.max(0, wave));
    const hh = DAY_TINT[0] + (DUSK_TINT[0] - DAY_TINT[0]) * twilight;
    const ss = DAY_TINT[1] + (DUSK_TINT[1] - DAY_TINT[1]) * twilight;
    const ll = DAY_TINT[2] + (DUSK_TINT[2] - DAY_TINT[2]) * twilight;
    // 夜晚压低遮盖度（穹顶另用 uCloudDay 隐没）
    const night = Math.min(1, Math.max(0, (dTwilight - TWILIGHT_WINDOW) / 3.0));
    const alpha = CLOUD_ALPHA * (1.0 - 0.6 * night);
    return [hh, ss, ll, alpha];
  }

  /** 撒一小团云（随机位置、小半径、云色 + 柔和速度） */
  private injectPuff(): void {
    const px = Math.random();
    const py = Math.random();
    // 柔和漂移速度（水平为主，轻微竖直起伏）
    const vx = (Math.random() - 0.5) * 40;
    const vy = (Math.random() - 0.5) * 18;
    const inj: InjectionConfig = {
      enabled: true,
      position: { x: px, y: py },
      radius: 0.04 + Math.random() * 0.04,   // ★ 小注入半径
      velocity: { x: vx, y: vy },
      color: this.cloudTint(),
      rate: 0.5 + Math.random() * 0.3,
    };
    this.solver.queueInjection(inj);
  }

  /** 设定当前游戏时刻（小时 0..24；由 RenderManager 每帧喂，驱动云色随时间变） */
  setHour(hour: number): void {
    this.hour = hour;
  }

  /** 把当前合成帧（cur）拷入 prevRT 冻结（供 crossfade 起点） */
  private freezePrev(): void {
    this.copyMat.uniforms.uTex.value = this.curTex;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.prevRT);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.copyScene, this.copyCamera);
    this.renderer.setRenderTarget(prev);
  }

  /**
   * 每帧推进（按实时 dt）。内部按 2 帧/秒节流 step、周期随机注入云团，
   * 并在每次结算后把旧帧冻结、开启 prev→cur 的平滑 crossfade（消除低帧率跳变）。
   * 由 RenderManager.update 调用。
   */
  update(dt: number): void {
    if (dt <= 0 || !isFinite(dt)) return;
    const stepDt = 1 / STEPS_PER_SECOND;

    // 随机注入（只在实际结算云的那一半时间附近撒，避免过量）
    this.injectTimer += dt;
    if (this.injectTimer >= INJECT_INTERVAL) {
      this.injectTimer = 0;
      // 每次撒 1~2 团
      this.injectPuff();
      if (Math.random() < 0.35) this.injectPuff();
    }

    // 2 帧/秒 → 每 0.5s 累积到就 step 一次（每帧 dt=0.5s，CFL≈1 稳定）
    this.stepAccum += dt;
    let didStep = false;
    while (this.stepAccum >= stepDt) {
      this.stepAccum -= stepDt;
      // ① 先把"当前帧"冻结进 prev（此刻 cur 还是旧帧）
      this.freezePrev();
      // ② 结算出新帧 → cur 变为新帧
      this.solver.step(stepDt);
      didStep = true;
      // ③ 过渡从 0 重新开始：prev(旧) → cur(新)，平滑 0.5s
      this.blendProgress = 0;
    }
    if (didStep) this.solver.composite();

    // 每帧推进过渡进度（结算后才需走；最高封到 1）
    this.blendProgress = Math.min(1, this.blendProgress + dt / stepDt);
  }

  /** 旧帧纹理（crossfade 起点） */
  getPrevTexture(): THREE.Texture {
    return this.prevRT.texture;
  }

  /** 当前帧纹理（crossfade 终点 = solver 实时合成） */
  getCurrentTexture(): THREE.Texture {
    return this.curTex;
  }

  /** 过渡进度 0..1（每帧插值权重；由穹顶 shader 消费） */
  getBlend(): number {
    return this.blendProgress;
  }

  /** 清场并重置（进入 world 时调用） */
  reset(): void {
    this.injectTimer = 0;
    this.stepAccum = 0;
    this.blendProgress = 1;
    this.solver.reset();
    // 重置后立即把空/初帧冻结为 prev，并更新 cur 引用
    this.curTex = this.solver.getCompositeTexture()!;
    this.freezePrev();
  }

  dispose(): void {
    this.solver.dispose();
    this.prevRT.dispose();
    this.copyMat.dispose();
    (this.copyQuad.geometry as THREE.BufferGeometry).dispose();
    this.copyScene.clear();
  }
}
