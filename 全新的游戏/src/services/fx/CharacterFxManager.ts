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
const DEATH_VARIANTS: readonly DeathAnimOptions[] = [
  { explodeStrength: -30000, explodeRadius: 0.40, explodeDuration: 0.25, pushForce: 20, impulseMin: 20, impulseMax: 70 },
  { explodeStrength: -48000, explodeRadius: 0.55, explodeDuration: 0.30, pushForce: 35, impulseMin: 60, impulseMax: 150 },
  { explodeStrength: -65000, explodeRadius: 0.70, explodeDuration: 0.35, pushForce: 55, impulseMin: 110, impulseMax: 220 },
];
/** 每类型池上限（= 3 档 → 每档一个实例常驻复用） */
const DEATH_POOL_SIZE = DEATH_VARIANTS.length;

export class CharacterFxManager {
  private static instance: CharacterFxManager | null = null;
  private active: DeathAnimEffect[] = [];
  /** ★ 死亡特效池（按敌人资产缓存；用户定 2026-09-30：每类 3 个、随机档、播完休眠复用） */
  private pools = new Map<unknown, DeathAnimEffect[]>();
  /** 不可池化（无流体/无原始帧）时的一次性实例（播完销毁） */
  private transient = new Set<DeathAnimEffect>();
  private scene: THREE.Scene | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
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
  }

  /** ★ 渲染资源：角色表现流体（受击染料等）创建时取渲染器；未初始化返回 null */
  static get renderer(): THREE.WebGLRenderer | null {
    return CharacterFxManager.instance?.renderer ?? null;
  }

  /** 每帧推进死亡动画（播完移除；billboard 面相机在 update 内处理） */
  static update(dt: number, camera: THREE.Camera): void {
    const inst = CharacterFxManager.instance;
    if (!inst) return;
    for (let i = inst.active.length - 1; i >= 0; i--) {
      const a = inst.active[i]!;
      if (a.update(dt, camera)) {
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
