// ============================================================
// CharacterHitDye —— 角色受击染料（CharacterBase 组合件）
// ============================================================
// 从 CharacterBase 搬出（《RTS架构.md》E1；行为零变化）：
//   FTX 残差通道染色（色相反转 + 提饱和提亮；计时到点释放恢复原样）。
//   ★ 现状 = **静态色斑**：注入速度 {0,0} + 无重力/持续源/爆炸 ⇒ 速度场恒 0。
//   ★ 仅最高档 LOD(0) 启用（远距离省算）；解算按 step 降频 + 持续注入。
// 注：FluidEffect 的解算/合成由 vendor 播放器提供，本类只做生命周期与注入。
// ============================================================

import type * as THREE from 'three';
import type { FluidEffect } from '../../vendor/player/fluid/FluidEffect';
import type { FrameAnimatorBase } from './FrameAnimatorBase';
import { CharacterFxManager } from './CharacterFxManager';

export class CharacterHitDye {
  /** 受击染料开关（不需要的角色可关，默认开） */
  enabled = true;
  /** 受击染料时长（秒，默认 1.2） */
  duration = 1.2;
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
    if (!this.effect || this.timer <= 0) {
      // 首次受击（或已超时释放）：新建独立流体
      this.effect?.dispose();
      this.effect = source.createHitDyeEffect(renderer, frameIndex) ?? null;
    }
    if (!this.effect) return;

    this.timer = this.duration;
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
    this.queueInjection();
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
      this.accum += dt;
      if (this.accum >= this.step) {
        this.queueInjection();
        this.effect.step(Math.min(this.accum, 1 / 10));
        this.accum = 0;
      }
      if (this.timer <= 0) {
        // ★ 计时结束：释放流体 → 恢复原纹理（下次受击重建）
        this.active = false;
        this.effect.dispose();
        this.effect = null;
      }
    } else if (this.effect && this.timer <= 0) {
      this.active = false;
      this.effect.dispose();
      this.effect = null;
    }
  }

  /** 合成纹理（FTXQuad 采样；无染料 = null → 普通贴片） */
  getCompositeTexture(): THREE.Texture | null {
    return this.effect ? this.effect.getCompositeTexture() : null;
  }

  /** ★ 销毁：释放受击染料流体（恢复原纹理资源） */
  dispose(): void {
    this.active = false;
    this.effect?.dispose();
    this.effect = null;
  }
}
