// ============================================================
// EntityEffect —— 实体附属特效接口（架构 3.3 特效槽）
// ============================================================
// ★ 挂在实体上的表现层（血条/技能特效/受击/光环）：
//   跟随实体位置 + 时间轴推进 + 生命周期回收。
//   与主贴片渲染管线不同：不参与物理/碰撞/空间索引，纯表现。
//   由 EntityBase.attachEffect/detachEffect 管理（特效管线属于实体基类）。

import type * as THREE from 'three';

export interface EntityEffect {
  /** 每帧驱动（x/y/z = 跟随的实体位置；返回 true = 播完待回收） */
  update(dt: number, x: number, y: number, z: number): boolean;
  /** 渲染（实体 render 时调用；billboard/朝向自行处理） */
  render(camera: THREE.Camera): void;
  /** 释放（detach/实体销毁时调用） */
  dispose(): void;
}
