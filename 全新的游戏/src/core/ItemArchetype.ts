// ============================================================
// ItemArchetype.ts —— 物品原形（配置表的运行时镜像）
// ============================================================
// 职责：加载 items.json 生成的内存缓存。持有配置数据，
// 提供 use(ctx) 执行效果，以及 createWorldEntity() 工厂方法。
// 不可序列化，是配置层 → 背包数据层 → 世界实体层的桥梁。
// ============================================================

import * as THREE from 'three';
import type { EntityManager } from '../entity/EntityManager';
import type { ItemBase } from '../entity/ItemBase';
import type { ColliderShape } from '../services/physics/PhysicsWorld';
import { effectRegistry, type ItemEffectContext, type ItemEffectResult } from './ItemEffect';

/** 效果定义（配置表 effects 数组中的条目） */
export interface ItemEffectDef {
  type: string;
  value?: number;
  duration?: number;
  [key: string]: any;
}

/** 世界掉落参数 */
export interface ItemWorldShape {
  type: 'cuboid' | 'ball' | 'capsule';
  hx?: number;
  hy?: number;
  hz?: number;
  radius?: number;
  halfHeight?: number;
}

export interface ItemWorldConfig {
  shape: ItemWorldShape;
  scale?: number;
  pickupRadius?: number;
}

export class ItemArchetype {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly maxStack: number;
  readonly color: { h: number; s: number; l: number };
  readonly worldShape: ColliderShape;
  readonly worldScale: number;
  readonly pickupRadius: number;
  readonly worldConfig: ItemWorldConfig | null;
  private readonly _effects: ItemEffectDef[];

  constructor(data: any) {
    this.id = data.id;
    this.name = data.name;
    this.type = data.type;
    this.description = data.description ?? '';
    this.maxStack = data.maxStack ?? 99;
    this.color = data.color ?? { h: 0.5, s: 0.5, l: 0.5 };
    this.worldConfig = data.world ?? null;

    // 解析世界掉落参数
    const w = data.world;
    if (w?.shape) {
      this.worldShape = w.shape as ColliderShape;
    } else {
      this.worldShape = { type: 'cuboid', hx: 0.2, hy: 0.2, hz: 0.1 } as ColliderShape;
    }
    this.worldScale = w?.scale ?? 0.5;
    this.pickupRadius = w?.pickupRadius ?? 1.5;
    this._effects = data.effects ?? [];
  }

  /** ★ 背包中使用：遍历所有效果，逐条交给注册表执行 */
  use(ctx: ItemEffectContext): ItemEffectResult {
    let allSuccess = true;
    let lastMessage = '使用成功';
    let totalHeal = 0;
    let totalAmmo = 0;

    for (const def of this._effects) {
      const handler = effectRegistry.get(def.type);
      if (!handler) {
        console.warn(`[ItemArchetype] 未知效果类型: ${def.type}，跳过`);
        continue;
      }
      const result = handler(def, ctx);
      if (!result.success) {
        allSuccess = false;
        lastMessage = result.message ?? `效果 ${def.type} 执行失败`;
      } else if (result.message) {
        lastMessage = result.message;
      }
      if (result.healAmount) totalHeal += result.healAmount;
      if (result.ammoAmount) totalAmmo += result.ammoAmount;
    }

    return { success: allSuccess, message: lastMessage, healAmount: totalHeal, ammoAmount: totalAmmo };
  }

  /** ★ 世界实体工厂：生成一个 3D 掉落物 */
  async createWorldEntity(
    em: EntityManager,
    scene: THREE.Scene,
    x: number,
    y: number,
    z: number,
    itemManager: any, // 避免循环依赖，传入 ItemManager 实例
  ): Promise<ItemBase> {
    // 动态导入避免循环依赖
    const { ItemBase: IB } = await import('../entity/ItemBase');
    return new IB(em, scene, this, x, y, z, itemManager);
  }
}