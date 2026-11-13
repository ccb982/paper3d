// ============================================================
// src/fx/legacy/LegacyExplosion —— 迁移期适配器（临时过渡）
// ============================================================
// 把旧 services/fx/ExplosionFx 包成运行时接口，仅用于按效果灰度回退。
// 退出条件：爆炸在 src/fx 原生通道稳定后，本文件随 legacy/ 整体删除。
// ============================================================

import type { ExplosionPlayback } from '../channels/ExplosionChannel';
import type { FxExplosionSpec } from '../core/types';
import { ExplosionFx } from '../../services/fx/ExplosionFx';
import type { Scene } from 'three';

export class LegacyExplosion implements ExplosionPlayback {
  private readonly fx: ExplosionFx;
  private nextId = 1;

  constructor(scene: Scene) {
    this.fx = new ExplosionFx(scene);
  }

  spawn(spec: FxExplosionSpec): number {
    this.fx.spawn(spec.x, spec.y, spec.z, spec.radius);
    return this.nextId++;
  }

  kill(_id: number): void {
    // 旧实现按整批存活期回收，不支持单发撤销：句柄 dispose 退化为 no-op。
  }

  clear(): void {
    // ExplosionFx 无 clear；运行时在 reset 时会 dispose 并重建本适配器。
  }

  update(dt: number): void {
    this.fx.update(dt);
  }

  dispose(): void {
    this.fx.dispose();
  }
}
