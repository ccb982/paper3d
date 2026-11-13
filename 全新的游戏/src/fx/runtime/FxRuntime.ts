// ============================================================
// src/fx/runtime/FxRuntime —— 游戏内唯一特效播放器的门面
// ============================================================
// 统一调度：spawn（创建实例）/ update（推进）/ reset（按效果清场）/ dispose。
// 通道（channels/）自己持池与场景对象，但生命周期只由这里驱动：
//   explosion  —— 程序化爆炸（geo）
//   pickupGlow —— 拾取金色粒子（sprite 池）
//   beam       —— 无人机激光束（3 mesh 池，端点可每帧刷新）
//   moon       —— 月亮 VAT + 离屏 RT（走 attachMoon，由 SkyDome 的节拍驱动）
// ============================================================

import type * as THREE from 'three';
import { BeamChannel } from '../channels/BeamChannel';
import { ExplosionChannel, type ExplosionPlayback } from '../channels/ExplosionChannel';
import { HitEffectChannel, type FxHitHandle } from '../channels/HitEffectChannel';
import { MoonChannel } from '../channels/MoonChannel';
import type { MoonRenderBackend, MoonSource, MoonView } from '../channels/MoonChannel';
import { PickupGlowChannel } from '../channels/PickupGlowChannel';
import type { HitEffectShapeExport } from '../../vendor/player/core/types';
import type {
  FxBeamHandle,
  FxBeamSpec,
  FxEffectKind,
  FxHandle,
  FxHitSpec,
  FxSpawnSpec,
} from '../core/types';

export interface FxRuntimeOptions {
  readonly scene?: THREE.Scene;
}

/** 击中特效的预置参数（形状来自素材包 hit_effects.json） */
export interface FxHitEffectConfig {
  readonly shapes: HitEffectShapeExport[];
  readonly bakeSize?: number;
}

export class FxRuntime {
  private readonly scene: THREE.Scene | null;
  private explosion: ExplosionChannel | null = null;
  private pickupGlow: PickupGlowChannel | null = null;
  private beam: BeamChannel | null = null;
  /** 击中特效（形状预置后才有；三个子弹池共用同一份 shapes → 只建一次） */
  private hitEffects: HitEffectChannel | null = null;
  private hitShapes: HitEffectShapeExport[] | null = null;
  private readonly moonChannels: MoonChannel[] = [];

  constructor(opts: FxRuntimeOptions = {}) {
    this.scene = opts.scene ?? null;
  }

  /** 光束：返回的句柄可每帧刷新端点（目标移动） */
  spawn(spec: FxBeamSpec): FxBeamHandle;
  /** 击中特效：句柄实现 EntityEffect 契约（update/render/dispose），dispose = 归还池 */
  spawn(spec: FxHitSpec): FxHitHandle;
  /** 生成一次效果实例；返回句柄只用于撤销该实例 */
  spawn(spec: FxSpawnSpec): FxHandle;
  spawn(spec: FxSpawnSpec): FxHandle | FxBeamHandle | FxHitHandle {
    switch (spec.kind) {
      case 'explosion': {
        const playback = this.ensureExplosion();
        const id = playback.spawn(spec);
        return {
          kind: 'explosion',
          dispose: () => playback.kill(id),
        };
      }
      case 'pickupGlow': {
        const channel = this.ensurePickupGlow();
        const id = channel.spawn(spec);
        return {
          kind: 'pickupGlow',
          dispose: () => channel.kill(id),
        };
      }
      case 'beam': {
        const channel = this.ensureBeam();
        const id = channel.spawn(spec);
        const handle: FxBeamHandle = {
          kind: 'beam',
          get active() { return channel.isPlaying(id); },
          setEndpoints(start, end) { channel.setEndpoints(id, start, end); },
          dispose() { channel.kill(id); },
        };
        return handle;
      }
      case 'hit': {
        if (!this.hitEffects) {
          throw new Error('[fx] 未配置击中特效形状（先调 configureHitEffects）');
        }
        return this.hitEffects.spawn(spec.x, spec.y, spec.z, spec.worldSize);
      }
      default: {
        // 穷尽检查：将来加 kind 忘了处理，这里会编译报错
        const unhandled: never = spec;
        throw new Error(`[fx] 未实现的特效种类: ${String(unhandled)}`);
      }
    }
  }

  /**
   * 预置击中特效的形状定义（幂等：同一个 shapes 数组引用只建一次通道）。
   * ★ 三个子弹池传的是同一份 `hitEffectAsset.hitEffects` ⇒ 全项目只会有一个击中特效池。
   */
  configureHitEffects(config: FxHitEffectConfig): void {
    // ★ 空形状 = 什么都不做（**不要**清掉已有池）：`?? []` 每次都是新数组引用，
    //   若在这里记引用/重建，会让"资产某个时刻为空"把已建好的池拆掉。
    if (config.shapes.length === 0) return;
    if (this.hitEffects && this.hitShapes === config.shapes) return;
    this.hitEffects?.dispose();
    this.hitEffects = null;
    this.hitShapes = config.shapes;
    if (!this.scene) throw new Error('[fx] 未注入 scene，无法创建击中特效');
    this.hitEffects = new HitEffectChannel(this.scene, config.shapes, { bakeSize: config.bakeSize });
  }

  /** 击中特效是否已就绪（未配置形状时为 false） */
  get hasHitEffects(): boolean {
    return this.hitEffects !== null;
  }

  /** 换日：请求重烘焙一组新随机变体（在实例全部空闲时执行，不会打断正在播的） */
  requestHitEffectRebake(): void {
    this.hitEffects?.requestRebake();
  }

  /** 接入月亮视图（单例）；返回供 SkyDome 采样的 MoonView */
  attachMoon(source: MoonSource, backend: MoonRenderBackend): MoonView {
    const channel = new MoonChannel(source, backend);
    this.moonChannels.push(channel);
    return channel;
  }

  /**
   * 每帧推进瞬时效果。
   * @param camera billboard/视向计算用（beam 需要；其他通道忽略）
   * ★ 月亮由 SkyDome 的渲染节拍单独驱动，避免双推进。
   */
  update(dt: number, camera?: THREE.Camera): void {
    this.explosion?.update(dt);
    this.pickupGlow?.update(dt);
    this.beam?.update(dt, camera);
  }

  /** 按效果清场（模式退出等）；不影响其他效果与运行时本身 */
  reset(kind: FxEffectKind): void {
    switch (kind) {
      case 'moon':
        return; // 月亮视图归 SkyDome 持有，不在此清场
      case 'explosion':
        this.explosion?.clear();
        return;
      case 'pickupGlow':
        this.pickupGlow?.clear();
        return;
      case 'beam':
        this.beam?.clear();
        return;
      case 'hit':
        this.hitEffects?.clear();
        return;
      default: {
        const unhandled: never = kind;
        void unhandled;
        return;
      }
    }
  }

  dispose(): void {
    this.explosion?.dispose();
    this.explosion = null;
    this.pickupGlow?.dispose();
    this.pickupGlow = null;
    this.beam?.dispose();
    this.beam = null;
    this.hitEffects?.dispose();
    this.hitEffects = null;
    this.hitShapes = null;
    for (const m of this.moonChannels) m.dispose();
    this.moonChannels.length = 0;
  }

  private ensureExplosion(): ExplosionPlayback {
    if (!this.explosion) {
      if (!this.scene) throw new Error('[fx] 未注入 scene，无法创建爆炸效果');
      this.explosion = new ExplosionChannel(this.scene);
    }
    return this.explosion;
  }

  private ensurePickupGlow(): PickupGlowChannel {
    if (!this.pickupGlow) {
      if (!this.scene) throw new Error('[fx] 未注入 scene，无法创建拾取粒子');
      this.pickupGlow = new PickupGlowChannel(this.scene);
    }
    return this.pickupGlow;
  }

  private ensureBeam(): BeamChannel {
    if (!this.beam) {
      if (!this.scene) throw new Error('[fx] 未注入 scene，无法创建光束效果');
      this.beam = new BeamChannel(this.scene);
    }
    return this.beam;
  }
}
