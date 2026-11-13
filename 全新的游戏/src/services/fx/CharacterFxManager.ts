// ============================================================
// CharacterFxManager —— 角色表现特效运行时（角色基类自动管线）
// ============================================================
// 单例：模式层启动时 init(scene, renderer)。角色基类（CharacterBase）
// 自动处理的两类表现特效统一由此运行时提供资源与托管：
//   ① 死亡动画（DeathAnimEffect 实例列表：流体撕碎纹理 → 淡出 → 回收）
//   ② 受击染料（角色基类持有独立流体，创建时从这里取 renderer）
// 角色基类只调用静态方法，不感知管理器细节。
// 与实体完全解耦：实体销毁/掉落/结算不阻塞。

import * as THREE from 'three';
import { DeathAnimEffect, type DeathAnimOptions } from './DeathAnimEffect';
import type { FrameAssetSource } from './AssetSource';

/**
 * ★ 死亡特效 3 散度档（用户定 2026-09-30）：**每个敌人类型缓存 3 个**（池化复用不重建），
 * 死亡随机播一档——① 小散度快推 / ② 中散度中冲 / ③ 大散度猛冲；速度随机方向、大小可调。
 * 力度比旧默认（strength -30000、impulse 20~40）整体上调，"明显"可见。
 */
/** ★★ 扩散速度倍率（2026-11-14 用户："减慢扩散速度"）。
 *  原来黑雾几百 ms 就冲到纹理边界、被边界/暗角切掉 ⇒ 观感"闪一下没了"。
 *  ★ **只改这一个数就能整体加减速**（改小更慢、改大更快）；
 *    `explodeRadius` / `explodeDuration` 保持原值不动（前者改压力场尺度、后者是包络时长）。 */
const DEATH_SPREAD_SCALE = 0.55;
/** 一次性冲量的倍率（与散度源分开：冲量是"额外一脚"，散度是"主推力"） */
const DEATH_IMPULSE_SCALE = 0.6;

/** ★★ 死亡特效 3 档（**全部是固定值，禁止随机抖动** —— 求解器对 strength/duration 敏感） */
const DEATH_VARIANTS: readonly DeathAnimOptions[] = [
  {
    explodeStrength: -30000 * DEATH_SPREAD_SCALE, explodeRadius: 0.40, explodeDuration: 0.25,
    pushForce: 20, impulseMin: 20 * DEATH_IMPULSE_SCALE, impulseMax: 70 * DEATH_IMPULSE_SCALE,
  },
  {
    explodeStrength: -48000 * DEATH_SPREAD_SCALE, explodeRadius: 0.55, explodeDuration: 0.30,
    pushForce: 35, impulseMin: 60 * DEATH_IMPULSE_SCALE, impulseMax: 150 * DEATH_IMPULSE_SCALE,
  },
  {
    explodeStrength: -65000 * DEATH_SPREAD_SCALE, explodeRadius: 0.70, explodeDuration: 0.35,
    pushForce: 55, impulseMin: 110 * DEATH_IMPULSE_SCALE, impulseMax: 220 * DEATH_IMPULSE_SCALE,
  },
];
/** 每类型池上限（= 3 档 → 每档一个实例常驻复用） */
const DEATH_POOL_SIZE = DEATH_VARIANTS.length;

/** ★ 调试开关：`?fxdbg=1` 时打印每次死亡特效的时间线（排查"播得太快/闪一下"） */
const FX_DEBUG = typeof location !== 'undefined' && /[?&]fxdbg=1/.test(location.search);

export class CharacterFxManager {
  private static instance: CharacterFxManager | null = null;
  private active: DeathAnimEffect[] = [];
  /** ★ 死亡特效池（按敌人资产缓存；用户定 2026-09-30：每类 3 个、随机档、播完休眠复用） */
  private pools = new Map<unknown, DeathAnimEffect[]>();
  /** 不可池化（无流体/无原始帧）时的一次性实例（播完销毁） */
  private transient = new Set<DeathAnimEffect>();
  private scene: THREE.Scene | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  /** ★ 异步预建队列（每项 = 一个待建实例；`prewarmStep` 每帧消费一个） */
  private prewarmQueue: { asset: unknown; variant: DeathAnimOptions }[] = [];
  private prewarmFrameIndex = 0;
  private prewarmStats = { created: 0, bytes: 0, rawPx: 0 };
  /** ★ 累计新建次数（探针：验证"每类 3 个、之后全复用不再新建"） */
  private createdCount = 0;

  /** 模式层启动时注册（scene + renderer 供受击染料/死亡动画创建网格与流体） */
  static init(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
    const inst = CharacterFxManager.instance ?? new CharacterFxManager();
    inst.scene = scene;
    inst.renderer = renderer;
    CharacterFxManager.instance = inst;
  }

  /** ★ 角色死亡入口（CharacterBase.onDeath 自动调用；asset 需支持 createDeathFluidEffect） */
  static spawnDeathAnim(
    asset: FrameAssetSource,
    frameIndex: number,
    x: number,
    y: number,
    z: number,
    options?: DeathAnimOptions,
  ): void {
    const inst = CharacterFxManager.instance;
    if (!inst?.scene || !inst.renderer) return; // 未初始化：静默跳过
    const creator = (asset as unknown as {
      createDeathFluidEffect?: (renderer: THREE.WebGLRenderer, frameIndex: number) => unknown;
    });
    if (!creator.createDeathFluidEffect) return; // 资产不支持：跳过

    // ★ 随机散度档（3 档）+ 选项合并（worldSize 等按调用方优先）
    // ★★ 2026-11-13 用户明确：**力度/持续时间一律不动**（求解器对参数敏感，抖动会不稳）。
    //    变体差异完全由 DEATH_VARIANTS 的 3 档固定参数承担，靠"预建 3 个实例随机用"实现。
    const variant = DEATH_VARIANTS[Math.floor(Math.random() * DEATH_VARIANTS.length)]!;
    const opts: DeathAnimOptions = { ...variant, ...options };
    const poolable = typeof (asset as { getFluidFrame?: unknown }).getFluidFrame === 'function';

    let pool = inst.pools.get(asset);
    if (poolable && !pool) { pool = []; inst.pools.set(asset, pool); }

    // ① 空闲实例 → 复用重播（换帧 + 换档，不重建）
    if (pool) {
      const idle = pool.find((a) => !a.inUse);
      if (idle && idle.replay(frameIndex, x, y, z, opts)) {
        if (!inst.active.includes(idle)) inst.active.push(idle);
        if (FX_DEBUG) {
          console.info(
            `[DeathFx] replay#${pool.indexOf(idle)} frame=${frameIndex}`
            + ` strength=${opts.explodeStrength} 预计 ${idle.plannedLifetime.toFixed(2)}s`
            + `（池 ${pool.length} 个，在用 ${pool.filter((p) => p.inUse).length}）`,
          );
        }
        return;
      }
      // ② 池未满 → 新建常驻
      if (pool.length < DEATH_POOL_SIZE) {
        const created = new DeathAnimEffect(inst.scene, asset as never, frameIndex, inst.renderer, opts);
        created.play(x, y, z);
        pool.push(created);
        inst.active.push(created);
        inst.createdCount++;
        return;
      }
      // ③ 3 个都在播 → 抢"最接近播完"的一个复用（不新建、不掉帧）
      let oldest = pool[0]!;
      for (const a of pool) if (a.elapsed > oldest.elapsed) oldest = a;
      if (oldest.replay(frameIndex, x, y, z, opts)) {
        if (!inst.active.includes(oldest)) inst.active.push(oldest);
        return;
      }
    }

    // ④ 不可池化/复用失败：一次性实例（播完销毁）
    const anim = new DeathAnimEffect(inst.scene, asset as never, frameIndex, inst.renderer, opts);
    anim.play(x, y, z);
    inst.transient.add(anim);
    inst.active.push(anim);
    if (FX_DEBUG) {
      console.info(
        `[DeathFx] 新建 transient（池不可复用）frame=${frameIndex}`
        + ` 预计 ${anim.plannedLifetime.toFixed(2)}s`,
      );
    }
  }

  /** ★ 渲染资源：角色表现流体（受击染料等）创建时取渲染器；未初始化返回 null */
  static get renderer(): THREE.WebGLRenderer | null {
    return CharacterFxManager.instance?.renderer ?? null;
  }

  /**
   * ★★ 开始预建（异步模式，2026-11-14）：**只入队，不建实例**。
   *  为什么要异步：单实例构造 = 分配流体场纹理 + 首批 shader 编译，10~20ms；
   *  33 个同步建完 = 300~600ms 卡在进战场那一帧。
   *  调用方在每帧 `prewarmStep()` 建 1 个 ⇒ 均匀摊到 ~33 帧（0.5s）。
   * @returns 待建实例数
   */
  static beginPrewarm(assets: readonly unknown[], frameIndex = 0): number {
    const inst = CharacterFxManager.instance;
    if (!inst?.scene || !inst.renderer) return 0;
    inst.prewarmQueue.length = 0;
    inst.prewarmFrameIndex = frameIndex;
    inst.prewarmStats = { created: 0, bytes: 0, rawPx: 0 };
    for (const asset of assets) {
      const a = asset as {
        createDeathFluidEffect?: unknown;
        getFluidFrame?: unknown;
        getFtxFrame?: (i: number) => { bbox?: { w: number; h: number } } | undefined;
      };
      if (typeof a.createDeathFluidEffect !== 'function') continue;
      if (typeof a.getFluidFrame !== 'function') continue;
      if (inst.pools.has(asset)) continue;
      inst.pools.set(asset, []);
      const bb = a.getFtxFrame?.(frameIndex)?.bbox;
      const px = bb ? bb.w * bb.h : 0;
      // ★ 3 档各 1 个（固定参数，不抖动）：变体差异靠档位，不靠随机
      for (const v of DEATH_VARIANTS) {
        inst.prewarmQueue.push({ asset, variant: v });
        inst.prewarmStats.rawPx += px;
      }
    }
    return inst.prewarmQueue.length;
  }

  /** ★ 建 1 个待建实例（每帧调一次）；返回剩余数量（0 = 建完，已打印统计） */
  static prewarmStep(): number {
    const inst = CharacterFxManager.instance;
    if (!inst?.scene || !inst.renderer) return 0;
    const item = inst.prewarmQueue.shift();
    if (!item) {
      CharacterFxManager.reportPrewarm();
      return 0;
    }
    const pool = inst.pools.get(item.asset);
    if (pool && pool.length < DEATH_POOL_SIZE) {
      const d = new DeathAnimEffect(
        inst.scene, item.asset as never, inst.prewarmFrameIndex, inst.renderer, item.variant,
      );
      d.sleep();
      pool.push(d);
      inst.createdCount++;
      inst.prewarmStats.created++;
      inst.prewarmStats.bytes += d.fluidBytes;   // 实际分配（已压缩）
    }
    if (inst.prewarmQueue.length === 0) CharacterFxManager.reportPrewarm();
    return inst.prewarmQueue.length;
  }

  /** 打印本次预建统计（只打一次） */
  private static reportPrewarm(): void {
    const inst = CharacterFxManager.instance;
    if (!inst) return;
    const s = inst.prewarmStats;
    if (s.created === 0) return;
    const mb = (b: number): string => (b / 1048576).toFixed(1);
    const rawBytes = s.rawPx * 54;
    console.info(
      `[DeathFx] 预建 ${s.created} 个死亡特效池｜流体场 ${mb(s.bytes)} MB`
      + `（未压缩需 ${mb(rawBytes)} MB，压缩 ${(rawBytes / Math.max(1, s.bytes)).toFixed(1)} 倍）`
      + '｜休眠，不参与解算',
    );
    inst.prewarmStats = { created: 0, bytes: 0, rawPx: 0 };
  }

  /** ★ 同步版（探针/测试用）：入队后一次性建完 */
  static prewarmDeathPools(assets: readonly unknown[], frameIndex = 0): number {
    CharacterFxManager.beginPrewarm(assets, frameIndex);
    const inst = CharacterFxManager.instance;
    const total = inst?.prewarmQueue.length ?? 0;
    while (CharacterFxManager.prewarmStep() > 0) { /* 建完 */ }
    return total;
  }

  /** ★ 换日：释放所有死亡特效池（连同流体场纹理显存），下一天重新预计算 */
  static resetPools(): void {
    const inst = CharacterFxManager.instance;
    if (!inst) return;
    for (const pool of inst.pools.values()) {
      for (const d of pool) d.dispose();
    }
    inst.pools.clear();
    for (const d of inst.transient) d.dispose();
    inst.transient.clear();
    inst.active.length = 0;
    inst.createdCount = 0;
  }

  /** 每帧推进死亡动画（播完移除；billboard 面相机在 update 内处理） */
  static update(dt: number, camera: THREE.Camera): void {
    const inst = CharacterFxManager.instance;
    if (!inst) return;
    for (let i = inst.active.length - 1; i >= 0; i--) {
      const a = inst.active[i]!;
      if (a.update(dt, camera)) {
        if (FX_DEBUG) {
          console.info(`[DeathFx] 结束 age=${a.age.toFixed(2)}s / 预计 ${a.plannedLifetime.toFixed(2)}s`);
        }
        inst.active.splice(i, 1);
        if (inst.transient.delete(a)) a.dispose();   // 一次性 → 销毁
        else a.sleep();                              // 池化 → 休眠复用（用户定 2026-09-30）
      }
    }
  }

  /** ★ 探针（__wire.fxDbg）：池/新建计数/在播数——验证"每类 3 个、复用不重建" */
  static dbg(): { created: number; transient: number; active: number; pools: { n: number; inUse: number }[] } {
    const inst = CharacterFxManager.instance;
    if (!inst) return { created: 0, transient: 0, active: 0, pools: [] };
    return {
      created: inst.createdCount,
      transient: inst.transient.size,
      active: inst.active.length,
      pools: [...inst.pools.values()].map((p) => ({ n: p.length, inUse: p.filter((a) => a.inUse).length })),
    };
  }

  /** 全部销毁（模式销毁/场景卸载时调用） */
  static dispose(): void {
    const inst = CharacterFxManager.instance;
    if (!inst) return;
    for (const a of inst.active) a.dispose();
    inst.active.length = 0;
    for (const pool of inst.pools.values()) for (const a of pool) a.dispose();
    inst.pools.clear();
    for (const a of inst.transient) a.dispose();
    inst.transient.clear();
    inst.scene = null;
    inst.renderer = null;
  }
}
