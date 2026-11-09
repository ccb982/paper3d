// ============================================================
// src/fx/runtime/FxRuntime —— 游戏内唯一特效播放器的门面
// ============================================================
// 统一调度：spawn（创建实例）/ update（推进）/ reset（按效果清场）/ dispose。
// 具体通道（explosion=geo、moon=vat+离屏 RT）由 channels/ 实现；
// 按效果灰度回退通过 legacy/ 适配器包住旧实现，只允许临时存在。
// ============================================================

import type * as THREE from 'three';
import { ExplosionChannel, type ExplosionPlayback } from '../channels/ExplosionChannel';
import { MoonChannel } from '../channels/MoonChannel';
import type { MoonRenderBackend, MoonSource, MoonView } from '../channels/MoonChannel';
import type { FxEffectKind, FxHandle, FxSpawnSpec } from '../core/types';
import { LegacyExplosion } from '../legacy/LegacyExplosion';

export interface FxRuntimeOptions {
  readonly scene?: THREE.Scene;
  /** 逐效果灰度：true = 走旧实现（临时回退），false/缺省 = 走 src/fx 原生通道 */
  readonly legacy?: Partial<Record<FxEffectKind, boolean>>;
}

/** 从 URL 读取灰度开关：?fxLegacy=explosion,moon 或 ?fxLegacy=all */
function legacyFromQuery(): Partial<Record<FxEffectKind, boolean>> {
  if (typeof location === 'undefined') return {};
  const raw = new URLSearchParams(location.search).get('fxLegacy');
  if (!raw) return {};
  if (raw === 'all') return { explosion: true, moon: true };
  const out: Partial<Record<FxEffectKind, boolean>> = {};
  for (const part of raw.split(',')) {
    if (part === 'explosion' || part === 'moon') out[part] = true;
  }
  return out;
}

export class FxRuntime {
  private readonly scene: THREE.Scene | null;
  private readonly legacyFlags: Record<FxEffectKind, boolean>;
  private explosion: ExplosionChannel | null = null;
  private legacyExplosion: LegacyExplosion | null = null;
  private readonly moonChannels: MoonChannel[] = [];
  private readonly legacyMoons: MoonView[] = [];

  constructor(opts: FxRuntimeOptions = {}) {
    this.scene = opts.scene ?? null;
    const q = legacyFromQuery();
    this.legacyFlags = {
      explosion: opts.legacy?.explosion ?? q.explosion ?? false,
      moon: opts.legacy?.moon ?? q.moon ?? false,
    };
  }

  /** 运行时灰度开关：只影响之后的 spawn/attach（已在播的实例按原路径播完） */
  setLegacy(kind: FxEffectKind, enabled: boolean): void {
    this.legacyFlags[kind] = enabled;
  }

  isLegacy(kind: FxEffectKind): boolean {
    return this.legacyFlags[kind];
  }

  /** 生成一次效果实例；返回句柄只用于撤销该实例 */
  spawn(spec: FxSpawnSpec): FxHandle {
    switch (spec.kind) {
      case 'explosion': {
        const playback = this.ensureExplosion();
        const id = playback.spawn(spec);
        return {
          kind: 'explosion',
          dispose: () => playback.kill(id),
        };
      }
    }
  }

  /** 接入月亮视图（单例）；返回供 SkyDome 采样的 MoonView */
  attachMoon(source: MoonSource, backend: MoonRenderBackend): MoonView {
    if (this.legacyFlags.moon && source.createLegacyView) {
      const view = source.createLegacyView();
      this.legacyMoons.push(view);
      return view;
    }
    const channel = new MoonChannel(source, backend);
    this.moonChannels.push(channel);
    return channel;
  }

  /** 每帧推进瞬时效果（月亮由 SkyDome 的渲染节拍单独驱动，避免双推进） */
  update(dt: number): void {
    this.explosion?.update(dt);
    this.legacyExplosion?.update(dt);
  }

  /** 按效果清场（模式退出等）；不影响其他效果与运行时本身 */
  reset(kind: FxEffectKind): void {
    if (kind !== 'explosion') return;
    this.explosion?.clear();
    if (this.legacyExplosion) {
      this.legacyExplosion.dispose();
      this.legacyExplosion = null;
    }
  }

  dispose(): void {
    this.explosion?.dispose();
    this.explosion = null;
    this.legacyExplosion?.dispose();
    this.legacyExplosion = null;
    for (const m of this.moonChannels) m.dispose();
    this.moonChannels.length = 0;
    for (const m of this.legacyMoons) m.dispose();
    this.legacyMoons.length = 0;
  }

  private ensureExplosion(): ExplosionPlayback {
    if (this.legacyFlags.explosion) {
      if (!this.legacyExplosion) {
        if (!this.scene) throw new Error('[fx] 未注入 scene，无法创建爆炸效果');
        this.legacyExplosion = new LegacyExplosion(this.scene);
      }
      return this.legacyExplosion;
    }
    if (!this.explosion) {
      if (!this.scene) throw new Error('[fx] 未注入 scene，无法创建爆炸效果');
      this.explosion = new ExplosionChannel(this.scene);
    }
    return this.explosion;
  }
}
