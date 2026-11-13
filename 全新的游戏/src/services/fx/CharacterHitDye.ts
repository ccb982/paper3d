// ============================================================
// CharacterHitDye —— 角色受击染料（CharacterBase 组合件）
// ============================================================
// 从 CharacterBase 搬出（《实体架构.md》E1；行为零变化）：
//   FTX 残差通道染色（色相反转 + 提饱和提亮；计时到点释放恢复原样）。
//   ★ 现状 = **静态色斑**：注入速度 {0,0} + 无重力/持续源/爆炸 ⇒ 速度场恒 0。
//   ★ 仅最高档 LOD(0) 启用（远距离省算）；解算按 step 降频 + 持续注入。
// 注：FluidEffect 的解算/合成由 vendor 播放器提供，本类只做生命周期与注入。
// ============================================================

import type * as THREE from 'three';
import type { FluidEffect } from '../../vendor/player/fluid/FluidEffect';
import type { FrameAnimatorBase } from './FrameAnimatorBase';
import { CharacterFxManager } from './CharacterFxManager';

/** ★★ 全局并发上限（2026-11-13）：最多同时几个角色持有受击染料。
 *  为什么必须限：每个染料 = 一个独立 FluidEffect（composite RT + 多张场纹理 + 30 步/s 解算）。
 *  战斗里 10 个敌人挨打 ⇒ 10 套流体同时跑 ⇒ 300 次 GPU pass/s，这是受击染料最大的开销。
 *  3 个足够覆盖"玩家 + 眼前正在被打的 2 个"，远处的本来也是 LOD≥1 不启用。 */
const MAX_CONCURRENT = 3;
/** 当前持有配额的实例（先到先得；已持有者受击只续期、不重复占位） */
const _activeDyes = new Set<CharacterHitDye>();

export class CharacterHitDye {
  /** 受击染料开关（不需要的角色可关，默认开） */
  enabled = true;
  /** ★★ 免疫并发上限（玩家专用）：染料的"沉浸感"对玩家最重要，
   *  任何时候挨打都必须有反馈 ⇒ 不占 `MAX_CONCURRENT` 名额，也不会被 3 个敌人挤掉。
   *  总流体数 = MAX_CONCURRENT（敌人）+ 1（玩家）。 */
  bypassQuota = false;
  /** 受击染料时长（秒，默认 1.2） */
  duration = 1.2;
  /** ★ 渐入时长（秒）：染料从"无"过渡到满强度，避免受击瞬间整体颜色突变 */
  fadeIn = 0.12;
  /** ★ 渐出时长（秒）：**包含在 duration 内** —— 计时结束那一帧 mix 已降到 0，
   *  随后 dispose 恢复原纹理时视觉上没有跳变。 */
  fadeOut = 0.35;
  /** ★ 受击染料注入目标（写进 **残差场** colorGrid —— 0.5 才是"不变"，不是最终颜色！）
   *  合成公式（FluidSolver.buildCompositeMat / FTXQuad 同款）：
   *    finalH = fract(baseH + (h−0.5))、finalS/L = clamp(baseS/L + (s/l−0.5))、
   *    finalA = max(base.a, a)
   *  ⇒ 现值含义：
   *    h=0    → 色相 **−180°**（对任何底色都是最剧烈的反转，所以不需要"红"）；
   *    s=1    → 饱和度 **+0.5**（拉满）；
   *    l=0.8  → 明度 **+0.3**（显著提亮）；
   *    a=0.4  → ★ **只压"溢出体外"的色雾**：体内 base.a 恒为 1 → `max(1,0.4)=1`，
   *             染色强度不受影响；体外 base.a=0 → 色雾淡一档，不再糊一大团。
   *  ★ 目标不是"变红"而是"受击处最大对比"——色相反转 + 提饱和 + 提亮已是极限组合。 */
  color: [number, number, number, number] = [0.0, 1.0, 0.8, 0.4];
  /** 受击染料注入半径（bbox 归一化）。
   *  ★ 0.45 → 0.13：原来 `smoothstep(0.45, 0, d)` 覆盖 ≈90% 贴片宽 ⇒ 变化被摊薄成一大片淡染
   *    （这才是"不明显"的主因）。收到 0.13 后中心满染、边缘羽化 ⇒ 局部高对比"受击斑"。
   *  ★ uv 空间各向异性：竖直方向实际半径 = 0.13 × (bbox.h/bbox.w)，高瘦贴片上呈竖椭圆斑
   *    （躯干命中反而自然）。 */
  radius = 0.13;
  /** ★ 解算步长（秒）—— 累积到该步长才 step 一次（降频省算，也定义"持续注入"的节拍）。
   *  ★ 收益：解算次数从 ~60/s 降到 30/s ⇒ GPU pass 减半。
   *  ★★ **降频对观感的影响"按路径分"，不能一概而论**：
   *    · `scalar`（BOSS/无人机/祖宗/抽卡）：`decayRate 0.0588/步` ⇒ 降频真的更持久 ——
   *      60 步/s 一秒剩 2.5%、30 步/s 剩 15.7%（**6.4×**）；
   *    · `vector`（主角/普通敌人）：无衰减项 ⇒ 降频**只省算**。
   *  ★ 失稳风险：平流是半拉格朗日（无条件稳定）；子步数 = ceil(maxVel·dt / minGrid)。
   *    hit-dye 的 `maxVelocity` 现为 **50 px/s**（vector 路径，2026-09-18 由 3000 压下来）
   *    ⇒ 阈值 minGrid ≥ 50/30 ≈ **1.7px**，任何贴片都远大于它 ⇒ **恒定 1 个子步**，
   *      降频不会再换来额外子步 ⇒ 净收益 = 纯粹的 pass 减半。
   *  ⇒ 1/30 是安全点，与 `WorldMode` 祖宗流体、图标动画、死亡动画共用同一约定。 */
  step = 1 / 30;

  /** 独立流体实例（首次受击创建；超时释放） */
  private effect: FluidEffect | null = null;
  /** 存活计时（超时释放 → 恢复原纹理） */
  private timer = 0;
  /** 本次染料已存活时间（渐入渐出用；timer = duration − age） */
  private age = 0;
  /** 当前混入系数（0 = 纯基础色，1 = 纯染料结果） */
  private mix = 0;
  /** 已累积的未解算时间（跨帧；新建流体/释放后不重置，只会让首步稍早发生） */
  private accum = 0;
  /** ★★ 持续注入：注入点（bbox 归一化 uv）—— 每个解算步都重注入到这里。
   *  ★ 为什么"量大"必须靠持续注入而非调数字：
   *    `injectDensity` 的 value 与 rate 都被 clamp 到 ≤1.0
   *    ⇒ `density = 1.0` 已是**天花板**，调不出"更大量"；`injectColor` 的 rate 同样 ≤1.0
   *    ⇒ 重注入是**覆盖**不是叠加。
   *  ★ 收益（scalar 路径）：`decayRate 0.0588/步` ⇒ 一次性注入 1 秒后只剩 15.7%，
   *    每步重注入则全程钉在 ≈0.94 → 全程满强度。
   *  ★ vector 路径：无衰减项 ⇒ 重注入**幂等**，那里的"看得见"靠注入速度。 */
  private at = { x: 0.5, y: 0.5 };
  /** ★ 注入速度（uv 空间的向量，px/s）：方向 = 贴片中心→命中点，
   *  只有资产声明 `hitDyeSpreadSpeed` 时才非零（vector 路径；scalar 路径保持 0）。 */
  private vel = { x: 0, y: 0 };
  /** 是否处于"持续注入"窗口（受击 → 计时结束/释放） */
  private active = false;
  /** ★ 注入掩码来源：当前帧的 base 纹理（其 alpha = 形状存在度）。
   *  透明区不注入 ⇒ 染料永远进不了纹理的透明边角。 */
  private animRef: FrameAnimatorBase | null = null;
  private alphaMask: THREE.Texture | null = null;

  /** ★ 受击：注入 FTX 残差染料（在命中点局部染色；已有则重置计时重新注入）。
   *  @param anim 动画源（取当前帧 + 资产能力）
   *  @param viewLod 当前 LOD（仅 0 档启用；远程省算、不干扰远焦）
   *  @param at 命中点（贴片 bbox 局部归一化 0~1） */
  spawn(anim: FrameAnimatorBase | null, viewLod: number, at: { x: number; y: number }): void {
    if (!this.enabled || viewLod !== 0) return;
    const renderer = CharacterFxManager.renderer;
    const source = anim?.source as unknown as {
      createHitDyeEffect?: (
        renderer: THREE.WebGLRenderer,
        frameIndex: number,
      ) => FluidEffect | null;
      /** ★ vector 路径的注入速度幅值（px/s）；scalar 路径不声明 → undefined ⇒ 不注入速度 */
      hitDyeSpreadSpeed?: number;
    };
    if (!renderer || !source?.createHitDyeEffect) return;

    const frameIndex = anim?.state.frameIndex ?? 0;
    // ★ 已在播（timer>0）→ 只续期，不重新抢配额、不重建流体
    const hasEffect = this.effect !== null && this.timer > 0;
    if (!hasEffect) {
      // ★★ 并发闸门：全局最多 MAX_CONCURRENT 个染料在跑。
      //   满了就**静默丢弃**这次染料（不排队、不抢占）——远处敌人本来就 LOD≥1 不启用，
      //   抢别人的只会让"眼前正在被打的那个"闪一下又断。
      //   ★ bypassQuota（玩家）直接跳过闸门：任何时候挨打都必须有反馈。
      if (!this.bypassQuota) {
        if (!_activeDyes.has(this) && _activeDyes.size >= MAX_CONCURRENT) return;
        _activeDyes.add(this);
      }
      this.effect?.dispose();
      this.effect = source.createHitDyeEffect(renderer, frameIndex) ?? null;
      if (!this.effect) {
        _activeDyes.delete(this);
        return;
      }
    }
    if (!this.effect) return;

    this.timer = this.duration;
    this.age = 0;
    this.mix = 0;   // 从透明起步（渐入）
    // ★ 注入点缓存（持续注入每个解算步都要复用）
    this.at.x = at.x;
    this.at.y = at.y;
    // ★ 注入速度：方向 = 贴片中心 → 命中点（"朝受击的那一侧晕开"）；幅值由资产给
    const speed = source.hitDyeSpreadSpeed ?? 0;
    if (speed > 0) {
      const dx = at.x - 0.5;
      const dy = at.y - 0.5;
      const len = Math.hypot(dx, dy);
      if (len > 1e-4) {
        this.vel.x = (dx / len) * speed;
        this.vel.y = (dy / len) * speed;
      } else {
        // 命中点正好在正中（退化）：随机方向，避免零向量不推
        const a = Math.random() * Math.PI * 2;
        this.vel.x = Math.cos(a) * speed;
        this.vel.y = Math.sin(a) * speed;
      }
    } else {
      this.vel.x = 0;
      this.vel.y = 0;
    }
    this.active = true;
    this.animRef = anim;
    this.refreshAlphaMask();
    this.queueInjection();
  }

  /**
   * ★★ 刷新"形状存在度"掩码（= 当前帧 base 纹理的 alpha）。
   *  为什么每步都要刷：角色会换帧，不同帧的轮廓不同；用旧帧掩码会在新露出的部位留空白。
   */
  private refreshAlphaMask(): void {
    const a = this.animRef;
    if (!a) { this.alphaMask = null; return; }
    const src = a.source as unknown as {
      getFramePair?: (i: number) => { base?: THREE.Texture | null } | null;
    };
    const pair = src?.getFramePair?.(a.state.frameIndex);
    this.alphaMask = (pair?.base as THREE.Texture | undefined) ?? null;
  }

  /** ★★ 往解算队列塞一次染料注入（**每个解算步调一次** = 持续注入）。
   *  `step()` 开头处理队列、处理完立刻 `length = 0` ⇒ 每步重塞是安全的，不会累积重复注入。
   *  ★ 注意 `injectVelocity` 是**累加** ⇒ 持续注入速度会让流速顶到 `maxVelocity` 并保持。 */
  private queueInjection(): void {
    if (!this.effect || !this.active) return;
    this.effect.solver.queueInjection({
      enabled: true,
      position: { x: this.at.x, y: this.at.y },
      radius: this.radius,
      velocity: { x: this.vel.x, y: this.vel.y },
      color: this.color,
      density: 1.0,  // scalar 模式注入浓度（clamp ≤1.0，已是天花板），vector 模式忽略
      rate: 1.0,     // 中心直接走到目标残差（拿到最大变化量）
      // ★★ 只在"有颜色的地方"注入（base.a = 形状存在度）
      alphaMask: this.alphaMask ?? undefined,
    });
  }

  /** ★ 每帧驱动 —— **按 step 降频解算 + 持续注入**。
   *  计时按真实 dt 走（总时长不变），只把"解算次数"降频；
   *  单步 dt 用累积量 → 物理时间守恒（不是把流体变慢）。
   *  单步上限 1/10s：卡顿一帧 300ms 时不会把一次解算推进 300ms（防突兀跳变）。
   *  ★★ 每个解算步**先重注入再解算** → 浓度/残差被钉住。 */
  update(dt: number): void {
    if (this.effect && this.timer > 0) {
      this.timer -= dt;
      this.age += dt;
      this.accum += dt;
      // ★ 渐入渐出：min(已过/fadeIn, 剩余/fadeOut, 1)；计时结束时 mix 恰好为 0
      const fi = this.fadeIn > 1e-4 ? this.age / this.fadeIn : 1;
      const fo = this.fadeOut > 1e-4 ? (this.duration - this.age) / this.fadeOut : 1;
      this.mix = Math.max(0, Math.min(1, fi, fo));

      if (this.accum >= this.step) {
        // ★ 换帧后轮廓会变 → 每步刷新掩码
        this.refreshAlphaMask();
        // ★ 渐出阶段停止注入：否则每步重注入会把颜色钉在满强度，视觉上根本不淡出
        if (this.mix > 0.02) this.queueInjection();
        this.effect.step(Math.min(this.accum, 1 / 10));
        this.accum = 0;
      }
      if (this.timer <= 0) {
        // ★ 计时结束：释放流体 → 恢复原纹理（下次受击重建）
        this.active = false;
        this.mix = 0;
        this.effect.dispose();
        this.effect = null;
        _activeDyes.delete(this);
      }
    } else if (this.effect && this.timer <= 0) {
      this.active = false;
      this.mix = 0;
      this.effect.dispose();
      this.effect = null;
      _activeDyes.delete(this);
    }
  }

  /** ★ 渐入渐出系数（0~1）：渲染器用 `mix(基础色, 染料结果, mix)`。
   *  无染料时为 0（渲染器走普通贴片路径）。 */
  getFluidMix(): number {
    return this.effect ? this.mix : 0;
  }

  /** 合成纹理（FTXQuad 采样；无染料 = null → 普通贴片） */
  getCompositeTexture(): THREE.Texture | null {
    return this.effect ? this.effect.getCompositeTexture() : null;
  }

  /** ★ 销毁：释放受击染料流体（恢复原纹理资源）+ 归还并发配额 */
  dispose(): void {
    this.active = false;
    this.mix = 0;
    this.effect?.dispose();
    this.effect = null;
    this.animRef = null;
    this.alphaMask = null;
    _activeDyes.delete(this);
  }
}
