// ============================================================
// ItemIconRegistry —— 物品图标服务（物品 ID → 可视图标纹理）
// ============================================================
// 职责：根据 itemId 返回 THREE.Texture（优先从 ftx 加载，无则
// 用 SolidBulletAsset 生成色块兜底）。
// 与 ItemManager 配合，是配置层 → 表现层的桥梁。
// ============================================================

import * as THREE from 'three';
import type { ItemManager } from '../../systems/inventory/ItemManager';
import { createSolidBulletAsset } from '../fx/SolidBulletAsset';

export interface ItemIconConfig {
  /** 色调 0-1 */
  h: number;
  /** 饱和度 0-1 */
  s: number;
  /** 明度 0-1 */
  l: number;
}

export class ItemIconRegistry {
  private cache = new Map<string, THREE.Texture>();

  constructor(private itemManager: ItemManager) {}

  /** 获取物品图标纹理（优先从缓存取，无则生成） */
  getIcon(itemId: string): THREE.Texture {
    if (this.cache.has(itemId)) return this.cache.get(itemId)!;

    const config = this.itemManager.getItemConfig(itemId);
    const color: ItemIconConfig = config?.color || { h: 0.55, s: 0.8, l: 0.6 };
    // 用 SolidBulletAsset 生成色块（后续可替换为真正的 ftx 加载）
    const asset = createSolidBulletAsset(64, color.h, color.s, color.l);
    const pair = asset.getFramePair(0);
    if (!pair) throw new Error(`无法生成物品图标: ${itemId}`);
    this.cache.set(itemId, pair.base);
    return pair.base;
  }
}