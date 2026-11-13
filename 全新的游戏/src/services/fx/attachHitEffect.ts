// ============================================================
// attachHitEffect —— 击中特效挂载（服务层公共函数）
// ============================================================
// 与 applyDamage/executeAttack 同级的行为入口：
//   ① 向统一播放器预置形状（幂等）并借一个实例；
//   ② 命中实体 → 记录「击中点相对实体」偏移 + attachEffect（击中点跟随实体走）；
//   ③ 命中地形 → 返回句柄由调用方固定点播放（每帧重传同一坐标）。
// ★ 实例池、烘焙画布、纹理、材质全部归 src/fx 的 HitEffectChannel；
//   句柄的 dispose() = 归还池，所以 EntityEffect 槽的回收路径不用改。
// ============================================================

import type { EntityBase } from '../../entity/EntityBase';
import type { HitEffectShapeExport } from '../../vendor/player';
import type { FxRuntime } from '../../fx';
import type { EntityEffect } from './EntityEffect';

export interface HitEffectSpawnOptions {
  /** 世界尺寸（quad 边长；缺省 1.5，子弹命中传 3） */
  worldSize?: number;
  /** 特效槽名（挂实体槽用；默认 'hit'） */
  slotName?: string;
  /** 烘焙分辨率（仅首次建通道时生效，默认 128） */
  bakeSize?: number;
}

/**
 * ★ 击中特效挂载入口。
 * @returns 命中实体 → null（已挂实体槽，随实体骨架驱动/回收）；
 *          命中地形/无目标 → 播放中的句柄（调用方负责 update/render/dispose）
 */
export function attachHitEffect(
  fx: FxRuntime,
  shapes: HitEffectShapeExport[],
  hitPoint: { x: number; y: number; z: number },
  target: EntityBase | null,
  options?: HitEffectSpawnOptions,
): EntityEffect | null {
  if (shapes.length === 0) return null;

  fx.configureHitEffects({ shapes, bakeSize: options?.bakeSize });
  const handle = fx.spawn({
    kind: 'hit',
    x: hitPoint.x,
    y: hitPoint.y,
    z: hitPoint.z,
    worldSize: options?.worldSize,
  });

  if (target) {
    const e = target.entity.position;
    // ★ 击中点相对实体偏移：实体槽每帧传实体位置 → 特效 = 实体位置 + 偏移 = 击中点跟随
    handle.setFollowOffset(hitPoint.x - e.x, hitPoint.y - e.y, hitPoint.z - e.z);
    target.attachEffect(options?.slotName ?? 'hit', handle);
    return null;
  }
  return handle;
}
