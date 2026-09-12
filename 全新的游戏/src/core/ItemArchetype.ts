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
import type { HealProcDef } from '../services/combat/EffectSystem';

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

/** ★ 局内装备临时属性（穿戴生效、卸载即消失；与遗物永久加成区分）
 *   - maxHp/attackPower/defense/hpRegen：加算
 *   - attackPct/defensePct：对（基础+遗物）终值乘算（0.5 = +50%）
 *   - attackSpeed：方舟攻速点数（100 基准；实际间隔 = 基础间隔 × 100 /(100+X)）
 *   - damageReduction：庇护（受到的伤害降低比例 0-1；同名效果取最高）
 *   - critRate/dodgeRate/blockRate：概率 0-1（加算）；critMult/blockMult：倍率加值
 *   - healProc：治疗转伤害 proc（非数值；装备期间由模式层消费） */
export interface EquipmentStats {
  maxHp?: number;
  attackPower?: number;
  attackPct?: number;
  defense?: number;
  defensePct?: number;
  attackSpeed?: number;
  damageReduction?: number;
  hpRegen?: number;
  /** 暴击率（0-1 加算） */
  critRate?: number;
  /** 暴击倍率加值（基础 1.5） */
  critMult?: number;
  /** 闪避率（0-1 加算） */
  dodgeRate?: number;
  /** 格挡率（0-1 加算） */
  blockRate?: number;
  /** 格挡减伤倍率加值（基础 0.5，越低越强） */
  blockMult?: number;
  healProc?: HealProcDef;
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
  /** ★ 可部署为友军（背包友军槽位拖入条件） */
  readonly deployable: boolean;
  /** ★ 装备位（effects 里 type==='equip' 的 slot；非装备类为 null。装备栏拖入判定用） */
  readonly equipSlot: string | null;
  /** ★ 局内装备临时属性（穿戴在出击槽即生效，卸载即消失；与遗物永久加成区分） */
  readonly stats: EquipmentStats | null;
  private readonly _effects: ItemEffectDef[];

  constructor(data: any) {
    this.id = data.id;
    this.name = data.name;
    this.type = data.type;
    this.description = data.description ?? '';
    this.maxStack = data.maxStack ?? 99;
    this.color = data.color ?? { h: 0.5, s: 0.5, l: 0.5 };
    this.worldConfig = data.world ?? null;
    this.deployable = data.deployable ?? false;

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
    const equipDef = data.effects?.find((e: any) => e?.type === 'equip');
    this.equipSlot = equipDef?.slot ?? null;
    this.stats = data.stats ?? null;
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
      // ★ 效果上下文补上当前 itemId（装备类效果穿戴用）
      const result = handler(def, { ...ctx, itemId: this.id });
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