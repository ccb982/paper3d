// ============================================================
// HealthBar —— 头顶血条（EntityEffect 实例，走批量渲染）
// ============================================================
// ★ 2026-11-13：从"每实体一套 2 几何 + 2 材质 + Group"改为**槽位租赁**——
//   全实体共享 `HealthBarBatch` 的 2 个 InstancedMesh（底条 + 前景条）。
//   本类只持一个槽号 + CPU 端状态，类名/构造签名/方法面全部不变，
//   3 个调用点（EnemyBase / CoverEntity / ItemBase）零改动。
//
// 纯表现：不参与物理/索引/伤害逻辑。跟随实体头顶，每帧按 hp 比例收缩前景条。

import type * as THREE from 'three';
import type { EntityEffect } from './EntityEffect';
import type { EntityBase } from '../../entity/EntityBase';
import { healthBarBatch } from './HealthBarBatch';

export interface HealthBarOptions {
  /** 条宽（世界单位，默认 0.8） */
  width?: number;
  /** 条高（默认 0.1） */
  height?: number;
  /** 头顶偏移（默认 2.3） */
  offsetY?: number;
  /** 颜色（默认红） */
  color?: number;
}

export class HealthBar implements EntityEffect {
  private readonly target: EntityBase;
  private readonly offsetY: number;
  /** 槽号（-1 = 批量缓冲已满，本实体不显示血条） */
  private readonly slot: number;
  private readonly maxHp: number;

  constructor(scene: THREE.Scene, target: EntityBase, opts?: HealthBarOptions) {
    this.target = target;
    this.offsetY = opts?.offsetY ?? 2.3;
    // ★ 上限取实体的 maxHp；实体尚未写 maxHp 时（= 0）回退当时 hp。
    //   ⚠ 不能只写 `= target.hp`：蜂群升格路径（WorldMode.createEnemyEntity）是
    //   「先 new EnemyBase(hp=受损值) 挂血条 → 再补 enemy.maxHp = 真实上限」，
    //   构造那一刻 target.hp 已是残血 → 快照当上限 → 比例恒 = 1（永远满血）。
    this.maxHp = target.maxHp > 0 ? target.maxHp : target.hp;
    this.slot = healthBarBatch.acquire(scene, {
      width: opts?.width ?? 0.8,
      height: opts?.height ?? 0.1,
      color: opts?.color ?? 0xff3333,
    });
  }

  /** 每帧：跟随实体头顶 + 按 hp 比例缩放 */
  update(_dt: number, x: number, y: number, z: number): boolean {
    if (this.slot < 0) return false;
    // ★ 上限每帧从实体读（含"构造后才写入 maxHp"的升格路径 / 上限被 buff 改动）
    const maxHp = this.target.maxHp > 0 ? this.target.maxHp : this.maxHp;
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, this.target.hp / maxHp)) : 0;
    healthBarBatch.updateState(this.slot, x, y + this.offsetY, z, ratio);
    return false; // 常驻（随实体销毁）
  }

  /** 渲染：全 billboard 面相机（朝向与矩阵写入都在批量层完成） */
  render(camera: THREE.Camera): void {
    if (this.slot < 0) return;
    healthBarBatch.render(this.slot, camera);
  }

  /**
   * ★ 可见性（2026-11-07 架构重构；2026-11-13 改批量后仍必须保留）。
   * ★ 为什么需要：血条是**独立场景对象**，不随主贴片的 renderer.setVisible 走
   *   ⇒ 实体出视锥 / 降格回收后，血条仍留在屏幕上（幽灵血条）。
   *   ⇒ 由 EffectSlots.setVisible → EntityBase.setCulled/visible 统一驱动。
   */
  setVisible(visible: boolean): void {
    if (this.slot < 0) return;
    healthBarBatch.setVisible(this.slot, visible);
  }

  dispose(): void {
    if (this.slot < 0) return;
    healthBarBatch.release(this.slot);
  }
}
