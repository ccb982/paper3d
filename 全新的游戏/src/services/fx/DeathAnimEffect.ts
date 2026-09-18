// ============================================================
// DeathAnimEffect —— 角色死亡动画（单纯特效，纯表现层）
// ============================================================
// 实体死亡 → 纹理所有权转移：冻结在死亡帧，交给独立流体求解器
// （矢量模式）先被散度爆炸推开、再缓缓漂离，最后淡出。实体正常销毁（掉落/结算不阻塞），
// 本类只做这几件事：
//   ① PUSH    —— 随机方向**小**推力（把纹理整体缓缓推离）
//   ② 速度冲击 —— 随机方向**小**冲量（轻推一下）
//   ③ 散度爆炸 —— 往散度场注入源项 → 压力投影把流体从中心**径向推开**
//   ④ FADE    —— alpha 平滑淡出 → 销毁
// ★ 2026-09-18（一）：解算改为**降频 1/30**（此前每帧 step）。
// ★ 2026-09-18（二）：推力 4000 → 20 px/s²，冲量 800~2000 → 20~40 px/s（"小力度"）。
// ★ 2026-09-18（三）用户定调："死亡动画速度上限改为200再加比较大的散度注入吧"
//   ⇒ 资产侧 `maxVelocity` 50 → **200 px/s**；并重新启用散度爆炸（见 DEATH_EXPLODE_*）。
//   ★ 力度判据仍是**稳态流速** `v_eq ≈ 1.63·g`（见常量注释）—— 上限是 200 时，
//     g=20 的 v_eq≈33 远在限内 ⇒ 小推力 + 大散度爆发的组合是成立的。
// 渲染：世界空间 quad 采样流体 composite 纹理，面向相机 billboard。

import * as THREE from 'three';
import type { CharacterFxAssetSource } from './AssetSource';
import type { FluidEffect } from '../../vendor/player/fluid/FluidEffect';

/** ★ 死亡动画力度常量
 *  ★★ 推力为什么是 20：`step` 里是 `v ← (v + g·dt) × velocityScale(0.98)`
 *     ⇒ 流速收敛到稳态 **v_eq ≈ g / (步率 × (1 − velocityScale)) = g / (30 × 0.02) ≈ 1.63·g**。
 *     判据是 **v_eq 必须 < 资产侧 `maxVelocity`**，否则被钳位、怎么调都是同一个结果。
 *     g = 20 ⇒ v_eq ≈ 33 px/s（上限 200 ⇒ 留足余量，是"小推力"）。
 *     （1.2s 寿命内漂移 ≈ 40px ⇒ 看得出在动，但不抢散度爆炸的戏。） */
const DEATH_PUSH_FORCE = 20; // px/s²，随机方向；原 4000
const DEATH_IMPULSE_MIN = 20; // px/s，一次性冲量（一次轻推后随 0.98 衰减）
const DEATH_IMPULSE_MAX = 40; // px/s

/** ★★ 散度爆炸（走 `FluidSolver.explode()`；在 step 3.6 写 divergenceGrid，**压力投影之前**）
 *  ★ 符号：**strength 必须为负才是"向外"**。两处证据：
 *    · `ExplosionConfig.strength` 文档："负 = 向外爆炸（源），正 = 向内收缩（汇）"；
 *    · 代码 `radialSpeed = -strength × envelope × 0.12`，而 `injectRadialVelocity`
 *      的约定是"正 = 向外推" ⇒ 需要 `-strength > 0` ⇒ `strength < 0`。
 *  ★ 量级参照旧库爆炸的 25000 量级（本处取 30000 = "比较大"）。
 *    注意：爆炸产生的径向流速最终仍受 `maxVelocity = 200 px/s` 钳制，
 *    所以 strength 主要决定"多快拉满"，而不是超过 200 的峰值。
 *  ★★ **本注入跑在"降频后"的节拍上**：`processExplosions()` 只在 `step()` 内被调（step 3.6），
 *    而 `DeathAnimEffect.update` 把 `step()` 降到 **30 次/s** ⇒ 0.25s 窗口内只注入 **7 次**
 *    （60fps 下是 14 次）。
 *    · `duration` 不失真：`ex.elapsed += dt` 用的是**累积真实 dt** ⇒ 仍是 0.25s 墙钟。
 *    · ★ 但 `envelope ×= decay` 是**按调用次数**衰减，而散度源 `strength × envelope` **不乘 dt**
 *      （对比：`radialSpeed × dt` 与 `velImpulse × dt` 都乘 dt ⇒ 那两项节拍无关）
 *      ⇒ **总散度注入量 ≈ 60fps 时的 68%**（Σenvelope 4.70 vs 6.94）。
 *    · ★ 峰值不受影响：当前 strength 大到「一步就顶到 `maxVelocity = 200`」
 *      ⇒ 两种情况峰值相同，只是 30/s 的尾巴短约 30%。**只有把 strength 调到不再饱和时，
 *      这 68% 才会真的显形**。
 *    · 想精确复刻 60fps 设计量：`strength × (6.94/4.70) ≈ -44000`。
 *  ★ 前提：`enablePressure` 必须为 true —— 散度源是**压力方程的源项**，
 *    压力投影关掉时没人消费它，注入等于白写（死亡流体一直是 true）。 */
const DEATH_EXPLODE_STRENGTH = -30000; // 负 = 向外推（符号推导见上）
const DEATH_EXPLODE_RADIUS = 0.4; // 归一化半径
const DEATH_EXPLODE_DURATION = 0.25; // 秒（包络指数衰减，默认 decay 0.9/步）

export interface DeathAnimOptions {
  /** 世界尺寸（quad 边长，默认 2.0；角色贴片约 2m 高） */
  worldSize?: number;
  /** 推力大小（px/s²，随机方向；**默认 20**，原 4000）。
   *  ★ 判据不是"比谁小"，而是**稳态流速**：`v_eq ≈ 1.63·g` 必须 < 资产侧 `maxVelocity`，
   *    否则照样被钳掉、调了等于没调（g=160 ⇒ v_eq≈261 ⇒ 顶格）。 */
  pushForce?: number;
  /** 前段（推力段）时长（秒，默认 0.3）；**只用于推后 `fadeStart`**，不改变推力大小 */
  pushDuration?: number;
  /** ★ 散度爆炸强度：**必须为负**才向外推（见 `DEATH_EXPLODE_STRENGTH` 的符号说明） */
  explodeStrength?: number;
  /** ★ 散度爆炸半径（归一化，默认 0.4） */
  explodeRadius?: number;
  /** ★ 散度爆炸时长（秒，默认 0.25） */
  explodeDuration?: number;
  /** 淡出时长（秒，默认 1.2） */
  fadeDuration?: number;
  /** 硬性寿命上限（秒，默认 2.5） */
  maxLifetime?: number;
}

export class DeathAnimEffect {
  private mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private fluid: FluidEffect | null;
  private elapsed = 0;
  private fadeStart: number;
  private maxLifetime: number;
  private fadeDuration: number;
  private worldSize: number;
  /** ★ 推力（px/s²，随机方向）：小力度，让残差纹理**缓缓漂离**而不是被撕飞（默认 `DEATH_PUSH_FORCE`） */
  private pushForce: number;
  /** ★ 散度爆炸参数（见模块常量 `DEATH_EXPLODE_*`；strength 必须为负才是向外） */
  private explodeStrength: number;
  private explodeRadius: number;
  private explodeDuration: number;
  private scaleX = 1;
  private scaleY = 1;
  /** ★ 降频解算：累积到这个步长才 `step` 一次（与受击染料 / 祖宗流体共用 1/30 约定）。
   *  ★ 计时仍走真实 dt（`elapsed`）⇒ 总寿命/淡出节奏完全不变，只是解算次数减半。
   *  ★ 本效应走 **vector 路径（无衰减项）** ⇒ 降频在这里是**纯省算**，不改观感。 */
  private solveAccum = 0;
  private readonly solveStep = 1 / 30;

  /** 世界位置（管理器每帧更新） */
  readonly position = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    asset: CharacterFxAssetSource,
    frameIndex: number,
    renderer: THREE.WebGLRenderer,
    opts?: DeathAnimOptions,
  ) {
    this.worldSize = opts?.worldSize ?? 2.0;
    this.fadeDuration = opts?.fadeDuration ?? 1.2;
    this.maxLifetime = opts?.maxLifetime ?? 2.5;
    this.pushForce = opts?.pushForce ?? DEATH_PUSH_FORCE;
    this.explodeStrength = opts?.explodeStrength ?? DEATH_EXPLODE_STRENGTH;
    this.explodeRadius = opts?.explodeRadius ?? DEATH_EXPLODE_RADIUS;
    this.explodeDuration = opts?.explodeDuration ?? DEATH_EXPLODE_DURATION;

    // ★ 独立流体实例（矢量模式：残差缓慢流动 → 纹理缓缓漂离）
    this.fluid = asset.createDeathFluidEffect(renderer, frameIndex);

    // ★ 世界宽高比：按死亡帧 bbox 比例（与角色贴片 setScaleKeepAspect 一致，
    //   竖长/横长纹理不被压扁）。worldSize 作为贴片高度，宽 = 高 × 宽高比
    const ftxFrame = asset.getFtxFrame(frameIndex);
    const aspect = ftxFrame ? ftxFrame.bbox.w / Math.max(1, ftxFrame.bbox.h) : 1;
    this.scaleY = this.worldSize;
    this.scaleX = this.worldSize * aspect;

    // ★ 渲染 quad（采样流体 composite 纹理；无流体时兜底显示原始帧对）
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uFluidTex: { value: this.fluid?.getCompositeTexture() ?? null },
        uUseFluid: { value: this.fluid ? 1 : 0 },
        uOpacity: { value: 1 },
        uColorTex: { value: null as THREE.Texture | null },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uFluidTex;
        uniform sampler2D uColorTex;
        uniform float uUseFluid;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          // ★ 纹理数据 row0=顶部（flipY=false）→ quad UV v=0 在底部，翻转 v
          vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
          vec4 c;
          if (uUseFluid > 0.5) {
            c = texture2D(uFluidTex, uv);
          } else {
            c = texture2D(uColorTex, uv);
          }
          c.a *= uOpacity;
          gl_FragColor = c;
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
    this.material = mat;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.mesh.scale.set(this.scaleX, this.scaleY, 1);
    // ★ 底部锚点（与角色贴片一致）：贴片底边在地面，中心抬升半高 → 不埋地
    this.mesh.frustumCulled = false;
    this.mesh.visible = true;
    scene.add(this.mesh);

    // 无流体兜底：用死亡帧的静态纹理对（残差仍可显示，只是不流动）
    if (!this.fluid) {
      const pair = asset.getFramePair(frameIndex);
      if (pair) {
        this.material.uniforms.uColorTex.value = pair.base;
        this.material.uniforms.uUseFluid.value = 0;
      }
    }

    // ★ 阶段规划：先推一段（`pushDuration`），再开始淡出。
    //  ★ 散度爆炸的**源项注入**发生在 `play()`（见下），这里只排淡出时间点。
    this.fadeStart = (opts?.pushDuration ?? 0.3) + 0.15;
  }

  /** 启动死亡动画：散度爆炸 + 随机方向小推力 + 一次性小冲量（底部锚点：中心抬升半高） */
  play(x: number, y: number, z: number): void {
    this.position.set(x, y + this.scaleY / 2, z);
    this.mesh.position.copy(this.position);

    // ★ PUSH：随机方向推力（全向随机，把纹理整体**缓缓**推离）
    //  ★★ 小力度（2026-09-18）：4000 → 20 px/s²（稳态流速 v_eq ≈ 33 px/s，上限已放宽到 200）。
    const angle = Math.random() * Math.PI * 2;
    const force = this.pushForce;
    this.fluid?.solver.updateConfig({
      gravity: { x: Math.cos(angle) * force, y: Math.sin(angle) * force },
    });

    // ★ 随机速度冲击（一次性**轻推**）
    //  ★★ 小力度（2026-09-18）：800 + rand·1200（800~2000）→ 20 ~ 40 px/s。
    const speed = DEATH_IMPULSE_MIN + Math.random() * (DEATH_IMPULSE_MAX - DEATH_IMPULSE_MIN);
    const vAngle = Math.random() * Math.PI * 2; // 随机方向
    this.fluid?.solver.queueInjection({
      enabled: true,
      position: { x: 0.5, y: 0.5 },
      radius: 0.5,
      velocity: {
        x: Math.cos(vAngle) * speed,
        y: Math.sin(vAngle) * speed,
      },
      rate: 1.0,
    });

    // ★★ 散度爆炸（2026-09-18 用户定调"加比较大的散度注入"）
    //  · 在 step 3.6 往 divergenceGrid 写**源项**，压力投影（step 4）消费它
    //    ⇒ ∇²p = ∇·u + f，压力梯度把流体从中心**径向推开** = 真正的"炸开"而非平移。
    //  · ★ strength 必须**为负**才是向外（符号推导见 `DEATH_EXPLODE_STRENGTH`）。
    //  · ★ 必须是"一次"注入：`explode()` 自己按指数包络衰减（decay 0.9/步、duration 0.25s），
    //    不要每帧调 —— 那会持续往散度场灌，压力解不完（旧注释就警告过"填满纹理"）。
    this.fluid?.solver.explode({
      cx: 0.5,
      cy: 0.5,
      radius: this.explodeRadius,
      strength: this.explodeStrength,
      duration: this.explodeDuration,
    });
  }

  /** 每帧推进：流体 step → 淡出 → 播完返回 true */
  update(dt: number, camera: THREE.Camera): boolean {
    this.elapsed += dt;
    if (this.elapsed >= this.maxLifetime) return true;

    // 流体推进（★ 降频：按 solveStep 累积后再 step；有实例才 step，静态兜底直接走淡出）
    if (this.fluid) {
      this.solveAccum += dt;
      if (this.solveAccum >= this.solveStep) {
        // 单步上限 1/10s：卡顿一帧 300ms 时不会把一次解算推进 300ms（防突兀跳变）
        this.fluid.step(Math.min(this.solveAccum, 1 / 10));
        this.solveAccum = 0;
      }
    }

    // ★ FADE：淡出阶段 alpha 平滑衰减
    let opacity = 1;
    if (this.elapsed >= this.fadeStart) {
      const t = Math.min(1, (this.elapsed - this.fadeStart) / this.fadeDuration);
      opacity = 1 - t;
      if (opacity <= 0.02) return true;
    }
    this.material.uniforms.uOpacity.value = opacity;
    this.material.uniforms.uFluidTex.value = this.fluid?.getCompositeTexture() ?? null;

    // ★ billboard 面相机
    this.mesh.quaternion.copy(camera.quaternion);
    return false;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.fluid?.dispose();
    this.fluid = null;
  }
}
