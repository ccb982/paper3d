// ============================================================
// EffectFx —— 特效实例管理器（基本版）
// ============================================================
// 管理所有动画/特效实例（基于 FrameAnimatorBase 基类）：
//   - spawn / despawn（销毁回收）
//   - update(dt)：每帧驱动所有实例（时间轴推进）
//   - 实例上限（超限停最旧/最远，简化版先按创建顺序）
//
// 渲染由外部（RenderManager）逐实例驱动 renderer.render(state)，
// 本管理器只负责生命周期与动画推进。

import type { FrameAnimatorBase } from './FrameAnimatorBase';

export class EffectFx {
  private _instances: FrameAnimatorBase[] = [];
  private _maxInstances = 30;

  constructor(maxInstances = 30) {
    this._maxInstances = maxInstances;
  }

  /** 注册一个动画实例（受本管理器驱动） */
  attach(instance: FrameAnimatorBase): void {
    if (this._instances.length >= this._maxInstances) {
      // 超限：回收最早的实例
      const oldest = this._instances.shift();
      oldest?.dispose();
    }
    this._instances.push(instance);
  }

  /** 注销并销毁实例 */
  detach(instance: FrameAnimatorBase): void {
    const i = this._instances.indexOf(instance);
    if (i >= 0) {
      this._instances.splice(i, 1);
      instance.dispose();
    }
  }

  /** 每帧驱动所有实例的动画时间轴 */
  update(dt: number): void {
    for (const inst of this._instances) {
      inst.update(dt);
    }
  }

  /** 全部实例（供渲染遍历） */
  get instances(): readonly FrameAnimatorBase[] {
    return this._instances;
  }

  get count(): number {
    return this._instances.length;
  }

  /** 销毁全部（模式切换/场景卸载时调用） */
  clear(): void {
    for (const inst of this._instances) inst.dispose();
    this._instances.length = 0;
  }
}
