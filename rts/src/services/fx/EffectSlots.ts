// ============================================================
// EffectSlots —— 附属特效槽（EntityBase 组合件）
// ============================================================
// 从 EntityBase 搬出（《RTS架构.md》E1；行为零变化）：
//   血条/技能特效/受击/光环等"跟随实体"的 EntityEffect 槽位管理。
//   同名覆盖；生命周期（跟随位置/时间轴/回收）由持有者每帧驱动。
// ============================================================

import type * as THREE from 'three';
import type { EntityEffect } from './EntityEffect';

export class EffectSlots {
  private slots = new Map<string, EntityEffect>();

  /** 挂特效（同名覆盖） */
  attach(name: string, effect: EntityEffect): void {
    this.detach(name);
    this.slots.set(name, effect);
  }

  /** 卸特效 */
  detach(name: string): void {
    const fx = this.slots.get(name);
    if (fx) {
      fx.dispose();
      this.slots.delete(name);
    }
  }

  /** 取特效（子类/外部读取状态用） */
  get<T extends EntityEffect>(name: string): T | undefined {
    return this.slots.get(name) as T | undefined;
  }

  /** 每帧驱动（跟随位置 + 时间轴 + 回收）；返回本次是否有推进 */
  update(dt: number, x: number, y: number, z: number): void {
    if (this.slots.size === 0) return;
    for (const [name, fx] of this.slots) {
      const done = fx.update(dt, x, y, z);
      if (done) {
        fx.dispose();
        this.slots.delete(name);
      }
    }
  }

  /** 渲染（跟随主贴片渲染阶段） */
  render(camera: THREE.Camera): void {
    for (const fx of this.slots.values()) fx.render(camera);
  }

  /** 全部销毁 */
  disposeAll(): void {
    for (const fx of this.slots.values()) fx.dispose();
    this.slots.clear();
  }

  get size(): number {
    return this.slots.size;
  }
}
