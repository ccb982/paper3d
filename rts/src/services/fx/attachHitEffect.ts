// ============================================================
// attachHitEffect —— 击中特效挂载（服务层公共函数）
// ============================================================
// 与 applyDamage/executeAttack 同级的行为入口：
//   ① 创建 HitEffectView（矢量动画播放器）
//   ② 命中实体 → 记录「击中点相对实体」偏移 + attachEffect（击中点跟随实体走）
//   ③ 命中地形 → 返回 fx 由调用方固定点播放管理（每帧重传同一坐标）
// 任何弹体/近战/范围技能共用；不再各自复制创建+偏移+挂载逻辑。

import * as THREE from 'three';
import type { EntityBase } from '../../entity/EntityBase';
import { HitEffectView } from '../../vendor/player';
import type { HitEffectShapeExport, HitEffectViewOptions } from '../../vendor/player';

export interface HitEffectSpawnOptions extends HitEffectViewOptions {
  /** 特效槽名（挂实体槽用；默认 'hit'） */
  slotName?: string;
}

/**
 * ★ 击中特效挂载入口。
 * @returns 命中实体 → null（已挂实体槽，随实体骨架驱动/回收）；
 *          命中地形/无目标 → 播放中的 fx（调用方负责 update/render/dispose）
 */
export function attachHitEffect(
  scene: THREE.Scene,
  shapes: HitEffectShapeExport[],
  hitPoint: { x: number; y: number; z: number },
  target: EntityBase | null,
  options?: HitEffectSpawnOptions,
): HitEffectView | null {
  if (shapes.length === 0) return null;

  const fx = new HitEffectView(scene, shapes, options);
  fx.play(hitPoint.x, hitPoint.y, hitPoint.z);

  if (target) {
    const e = target.entity.position;
    // ★ 击中点相对实体偏移：实体槽每帧传实体位置 → 特效 = 实体位置 + 偏移 = 击中点跟随
    fx.setFollowOffset(hitPoint.x - e.x, hitPoint.y - e.y, hitPoint.z - e.z);
    target.attachEffect(options?.slotName ?? 'hit', fx);
    return null;
  }
  return fx;
}
