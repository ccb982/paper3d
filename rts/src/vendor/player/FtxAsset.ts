import * as THREE from 'three';
import type { CharacterFxAssetSource } from '../../services/fx/AssetSource';
import { decodeMultiFrame, buildBaseHslData, buildResidualData } from './core/ftx';
import { FrameResolver, type FrameNameEntry } from './core/frameResolver';
import type { FrameTextureData, PaletteColor, PhysicsConfig } from './core/types';
import { FluidEffect } from './fluid/FluidEffect';
import { FramePlaybackController, type PlaybackConfig, type FramePlaybackCallbacks } from './core/controller';

// ============================================================
// FtxAsset —— 纯 FTX 纹理包（无 .scene.zip 结构）
// ============================================================
//
// 用途：主角立绘/静态纹理直接做成 FTX 包加载，不需要
// manifest/per_frame_data/regionEntities 等特效包结构。
//
// 合成策略：GPU 合成（webgl shader 每帧合成），CPU 只保留原始数据。
//   - 每帧持有 base(HSL Float32) + residual(Uint8) 两个 DataTexture
//   - getCompositeMaterial() 返回合成 shader（base+residual → RGB）
//   - 后续可对 residual 纹理做流体平流等操作（残差纹理保留可访问）
//
// ★ 帧名解析：解码时已读取每帧 name，FrameResolver 提供
//   getFrameNames()/resolveFrame(name) 等按名字取帧接口。

export class FtxAsset implements CharacterFxAssetSource {
  readonly frames: FrameTextureData[];
  readonly palette: PaletteColor[];
  readonly frameCount: number;

  /** 帧名解析器（名字 → 帧索引） */
  readonly resolver: FrameResolver;

  /** 每帧的 base + residual 纹理对 */
  private _frameTextures: { base: THREE.DataTexture; residual: THREE.DataTexture }[] = [];
  private _fluidEffects: Map<number, FluidEffect> = new Map();
  private _controllers: Set<FramePlaybackController> = new Set();

  constructor(buffer: ArrayBuffer) {
    const decoded = decodeMultiFrame(buffer);
    this.frames = decoded.frames;
    this.palette = decoded.palette;
    this.frameCount = decoded.frames.length;
    this.resolver = new FrameResolver(this.frames.map((f) => f.name));

    for (let i = 0; i < this.frames.length; i++) {
      const pair = this.buildFramePair(i);
      if (pair) this._frameTextures.push(pair);
    }
  }

  static async load(input: ArrayBuffer | Uint8Array | string): Promise<FtxAsset> {
    let buf: ArrayBuffer;
    if (typeof input === 'string') {
      buf = await (await fetch(input)).arrayBuffer();
    } else if (input instanceof Uint8Array) {
      buf = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
    } else {
      buf = input;
    }
    return new FtxAsset(await maybeGunzip(buf));
  }

  /** 构建第 i 帧的 base + residual 纹理（数据保留，合成在 GPU） */
  private buildFramePair(index: number): { base: THREE.DataTexture; residual: THREE.DataTexture } | null {
    const frame = this.frames[index];
    if (!frame) return null;

    const baseHsl = buildBaseHslData(frame, this.palette);
    const residualData = buildResidualData(frame);
    if (!baseHsl || !residualData) return null;

    const base = new THREE.DataTexture(
      baseHsl.data, baseHsl.width, baseHsl.height,
      THREE.RGBAFormat, THREE.FloatType,
    );
    base.flipY = false;
    base.needsUpdate = true;
    base.minFilter = THREE.NearestFilter;
    base.magFilter = THREE.NearestFilter;
    base.wrapS = THREE.ClampToEdgeWrapping;
    base.wrapT = THREE.ClampToEdgeWrapping;

    const residual = new THREE.DataTexture(
      residualData.data, residualData.width, residualData.height,
      THREE.RGBAFormat, THREE.UnsignedByteType,
    );
    residual.flipY = false;
    residual.needsUpdate = true;
    residual.minFilter = THREE.NearestFilter;
    residual.magFilter = THREE.NearestFilter;
    residual.wrapS = THREE.ClampToEdgeWrapping;
    residual.wrapT = THREE.ClampToEdgeWrapping;

    return { base, residual };
  }

  /** 第 i 帧的 base 纹理（HSL Float32，0~1） */
  getBaseTexture(index: number): THREE.DataTexture | null {
    return this._frameTextures[index]?.base ?? null;
  }

  /** 第 i 帧的 residual 纹理（Uint8 量化残差，可操作/平流） */
  getResidualTexture(index: number): THREE.DataTexture | null {
    return this._frameTextures[index]?.residual ?? null;
  }

  /** 原始 base+residual 对 */
  getFramePair(index: number): { base: THREE.DataTexture; residual: THREE.DataTexture } | null {
    return this._frameTextures[index] ?? null;
  }

  /**
   * 合成 shader 材质（GPU 每帧合成 base + residual → RGB）。
   * 游戏渲染 FTX 纹理时用它：
   *   material.uniforms.uBase.value = ftx.getBaseTexture(frameIdx)
   *   material.uniforms.uResidual.value = ftx.getResidualTexture(frameIdx)
   * 也可后续把 residual 换成"平流后的残差纹理"——同一 shader 继续工作。
   */
  static createCompositeMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: null },
        uResidual: { value: null },
        uResidualRangeH: { value: 0.5 },
        uResidualRangeSL: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uBase;
        uniform sampler2D uResidual;
        uniform float uResidualRangeH;
        uniform float uResidualRangeSL;
        varying vec2 vUv;

        vec3 hsl2rgb(vec3 hsl) {
          float h = hsl.x, s = hsl.y, l = hsl.z;
          vec3 rgb = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return l + s * (rgb - 0.5) * (1.0 - abs(2.0 * l - 1.0));
        }

        void main() {
          // ★ vUv 左下原点 → 翻转 v（纹理数据 row0=顶部，flipY=false），
          //   避免与 effects-player 相同的上下颠倒问题
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
          vec4 baseHSLA = texture2D(uBase, uv);
          vec4 residual = texture2D(uResidual, uv);

          float dH = (residual.r * 2.0 - 1.0) * uResidualRangeH;
          float dS = (residual.g * 2.0 - 1.0) * uResidualRangeSL;
          float dL = (residual.b * 2.0 - 1.0) * uResidualRangeSL;

          float finalH = fract(baseHSLA.r + dH);
          float finalS = clamp(baseHSLA.g + dS, 0.0, 1.0);
          float finalL = clamp(baseHSLA.b + dL, 0.0, 1.0);

          vec3 rgb = hsl2rgb(vec3(finalH, finalS, finalL));
          gl_FragColor = vec4(rgb, baseHSLA.a);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
  }

  /** 帧实际像素尺寸 */
  getFrameSize(index: number): { width: number; height: number } | null {
    const f = this.frames[index];
    if (!f) return null;
    return { width: f.bbox.w, height: f.bbox.h };
  }

  /**
   * ★ 物理流体参数注入：纯纹理 + 公共物理参数（.phys.json）→ 流体效果。
   * 纯纹理无实体边界 → 无障碍物（全图平流 + 连续源注入），
   * 同一份参数可注入任意纹理（物理与纹理解耦）。
   */
  getFluidEffect(index: number, renderer: THREE.WebGLRenderer, physics: PhysicsConfig): FluidEffect | null {
    const frame = this.frames[index];
    if (!frame) return null;
    const cached = this._fluidEffects.get(index);
    if (cached) return cached;
    const effect = new FluidEffect(renderer, physics, frame, this.palette, []);
    this._fluidEffects.set(index, effect);
    return effect;
  }

  /**
   * ★ 创建独立流体效果（死亡动画用）：不缓存、与共享实例隔离。
   * 纯纹理包：无实体边界 → 无障碍物（全图平流）。强制矢量模式。
   * ★★ 速度上限 20000 → **200 px/s**（2026-09-18 定稿）：20000 太猛（纹理瞬间飞离视野）、50 太温（散度爆炸被限死）⇒ 200 正好。⚠ 同时决定平流子步数 substeps = ceil(maxVel·dt/minGrid)，200 @1/30s = 6.7px/步 ⇒ 正常贴片仍 1 子步。
   *  ★ 小力度推力：`gravity` 4000 → **20 px/s²**。这里只是初值，
   *   `DeathAnimEffect.play()` 会立刻 `updateConfig` 覆盖成随机方向的 20（见其 DEATH_PUSH_FORCE）。
   *   ★ 判据 = 稳态流速 `v_eq ≈ 1.63·g` 必须 < `maxVelocity`；g=20 ⇒ ≈33 px/s，留足余量。
   */
  createDeathFluidEffect(renderer: THREE.WebGLRenderer, frameIndex: number): FluidEffect | null {
    const frame = this.frames[frameIndex];
    if (!frame) return null;
    const physics: PhysicsConfig = {
      enableAdvection: true,
      enablePressure: true,
      pressureIterations: 30,
      advectionMode: 'vector',
      gravity: { x: 0, y: 20 },
      velocityScale: 0.98,
      maxVelocity: 200,
      // ★ 2026-09-18：levelSet **开启**（此前 false）
      //  · 追踪模式（constrainLiquid=false）：φ 平流 + 每 reinitInterval 步重建 + 表面张力。
      //  · vector 模式下 φ 由 `colorGrid.alpha` 推断（`FluidSolver.initPhiField`）
      //    —— 死亡帧的残差 alpha 正好是角色剪影 ⇒ 张力把被炸散的残差收成"块"，不像烟雾。
      //  · ★ `surfaceTension > 0` 才真的施加（`FluidSolver.ts:1080`）；负值是"等效关闭"的写法。
      //  · ★ `reinitIterations` 在 step 里**没有兜底**（`FluidSolver.ts:1050`），必须显式给。
      //  · ★ reinitInterval 的单位是**解算步**：降频 1/30 后 10 步 ≈ 0.33s（不是 60fps 下的 0.17s）。
      //  · 开销：约 2 趟/步（advectPhi + surfaceTension）+ 每 10 步一次重建（≈0.4 趟/步）⇒ 很轻。
      levelSetConfig: {
        enabled: true,
        reinitInterval: 10,
        reinitIterations: 2,
        surfaceTension: 10000,
        smoothingRadius: 2,
        narrowBandWidth: 5,
        constrainLiquid: false,
        outwardDamping: 1,
        clampAirPhi: true,
        maxAirPhi: 0,
        compensateWaterPhi: true,
        waterCompensationRate: 0.1,
      },
    };
    return new FluidEffect(renderer, physics, frame, this.palette, []);
  }

  /** ★ 受击染料注入速度幅值（px/s）—— 由 `CharacterHitDye.spawn` 按
   *  "贴片中心 → 命中点"方向取用，并在每个解算步持续注入。
   *  ★ 只有本类（vector 路径）声明它；scalar 的 `Asset.createHitDyeEffect` 不声明
   *    ⇒ `hitDyeSpreadSpeed === undefined` ⇒ 那条路径不注入速度（保持它自己的浓度扩散）。 */
  readonly hitDyeSpreadSpeed = 40;

  /**
   * ★ 创建独立受击染料流体（角色受伤时注入 FTX 残差染料；矢量平流 + 压力投影，
   * 染料从注入点被水流带走 → "晕开"；dispose 即恢复原纹理）
   * ★★ 2026-09-18 起从"静态印章"改成"真晕开"：注入速度 + 恢复压力投影 + 限速 50。
   */
  createHitDyeEffect(renderer: THREE.WebGLRenderer, frameIndex: number): FluidEffect | null {
    const frame = this.frames[frameIndex];
    if (!frame) return null;
    const physics: PhysicsConfig = {
      enableAdvection: true,
      // ★★ 恢复压力投影（2026-09-18）：现在**有注入速度**了，速度场不再恒 0
      //    ⇒ 必须投影出无散场，否则局部推速会堆出"吹气球"式的假流动。
      //    代价：20 迭代 × 红黑两趟 = 40 趟 GPU pass/step —— 由 CharacterHitDye 的
      //    `step = 1/30` 降频抵消（解算次数本来就砍半）。
      //    （历史：此处曾为 false，因为那时注入 velocity = {0,0} ⇒ ∇·u ≡ 0 ⇒ 投影纯白烧。）
      enablePressure: true,
      pressureIterations: 20,
      advectionMode: 'vector',
      gravity: { x: 0, y: 0 },
      // 速度阻尼（★ 语义：FluidSolver.step 里**每 step 乘一次**，不按 dt 折算）。
      // 0.85 → 0.97：0.85 @30 步/s 一秒后只剩 0.76%，染料刚注入就被刹住 = 看不到晕开；
      // 0.97 留出"拖尾"的时间尺度（同时持续注入速度会把流速稳定顶在 maxVelocity）。
      velocityScale: 0.97,
      // ★ 3000 → 50（2026-09-18）：与 scalar 路径对齐，把"晕开"限制成可见的缓慢扩散。
      //   副作用（正向）：子步数 substeps = ceil(maxVel·dt/minGrid) 恒为 1
      //   ⇒ 降频不会再换来额外平流子步（见 CharacterHitDye.step 注释）。
      maxVelocity: 50,
    };
    return new FluidEffect(renderer, physics, frame, this.palette, []);
  }

  /** 第 index 帧的 FTX 帧数据 */
  getFtxFrame(index: number): import('./core/types').FrameTextureData | null {
    return this.frames[index] ?? null;
  }

  // ============ 帧名解析（FrameResolver） ============

  /** 全部帧清单（名字 + 索引） */
  getFrameNames(): FrameNameEntry[] {
    return this.resolver.list();
  }

  /** 全部帧名（按顺序） */
  frameNames(): string[] {
    return this.resolver.names();
  }

  /** 名字 → 帧索引；不存在返回 null */
  resolveFrame(name: string): number | null {
    return this.resolver.resolve(name);
  }

  /** 是否存在该帧名 */
  hasFrame(name: string): boolean {
    return this.resolver.contains(name);
  }

  /** 按名字跳帧（驱动所有已创建的播放控制器） */
  gotoFrame(name: string): boolean {
    const idx = this.resolver.resolve(name);
    if (idx === null) return false;
    for (const ctrl of this._controllers) ctrl.goto(idx);
    return true;
  }

  createController(config?: PlaybackConfig, callbacks?: FramePlaybackCallbacks): FramePlaybackController {
    const ctrl = new FramePlaybackController(this as any, this.frameCount, config, callbacks);
    this._controllers.add(ctrl);
    return ctrl;
  }

  /** 清除某帧（或全部）流体效果（重新注入参数后调用） */
  clearFluidEffect(index?: number): void {
    if (index === undefined) {
      for (const [, eff] of this._fluidEffects) eff.dispose();
      this._fluidEffects.clear();
      return;
    }
    const eff = this._fluidEffects.get(index);
    if (eff) {
      eff.dispose();
      this._fluidEffects.delete(index);
    }
  }

  dispose(): void {
    for (const ctrl of this._controllers) ctrl.dispose();
    this._controllers.clear();
    for (const pair of this._frameTextures) {
      pair.base.dispose();
      pair.residual.dispose();
    }
    this._frameTextures.length = 0;
    this.clearFluidEffect();
  }
}

/** 自动识别 gzip（1f 8b 魔数）并解压 */
async function maybeGunzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(buffer);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (!isGzip) return buffer;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).arrayBuffer();
  } catch (err) {
    throw new Error('Gzip 解压失败: ' + (err as Error).message);
  }
}
