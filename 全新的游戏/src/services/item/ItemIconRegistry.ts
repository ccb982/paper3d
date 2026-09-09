// ============================================================
// ItemIconRegistry —— 物品图标服务（物品 ID → 可视图标纹理）
// ============================================================
// 职责：根据 itemId 返回 THREE.Texture（优先从 ftx 加载，无则
// 用 SolidBulletAsset 生成色块兜底）。
// 与 ItemManager 配合，是配置层 → 表现层的桥梁。
// ============================================================

import { ItemManager } from '../../systems/inventory/ItemManager';
import { loadSixBrotherIcons } from './BasicMaterialsIcons';
import { loadDroneIcon } from './DroneIcon';

export interface ItemIconConfig {
  /** 色调 0-1 */
  h: number;
  /** 饱和度 0-1 */
  s: number;
  /** 明度 0-1 */
  l: number;
}

export class ItemIconRegistry {
  private cache = new Map<string, HTMLCanvasElement>();
  private sixBrothers: Map<string, HTMLCanvasElement> | null = null;
  private droneIcon: HTMLCanvasElement | null = null;

  constructor(private itemManager: ItemManager) {
    // 异步预载六区兄弟图标（六种基础材料），失败则回退色块
    loadSixBrotherIcons()
      .then((map) => { this.sixBrothers = map; })
      .catch((err) => console.warn('[ItemIconRegistry] 六区兄弟图标载入失败，回退色块:', err));
    // 异步预载「可露希尔的无人机」图标（三图层合成：主体+左/右翅膀）
    loadDroneIcon()
      .then((canvas) => { this.droneIcon = canvas; })
      .catch(() => { this.droneIcon = null; });
  }

  /** 获取物品图标画布（六区兄弟来自 FTX 纹理，其余为色块兜底） */
  getIcon(itemId: string): HTMLCanvasElement {
    if (this.droneIcon && itemId === 'kaltsit_drone') return this.droneIcon;
    if (this.sixBrothers?.has(itemId)) return this.sixBrothers.get(itemId)!;
    if (this.cache.has(itemId)) return this.cache.get(itemId)!;

    const arch = this.itemManager.getArchetype(itemId);
    const color = arch?.color || { h: 0.55, s: 0.8, l: 0.6 };
    // 色块兜底（装弹器/药水等无专用纹理物品）
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    const fill = `hsl(${color.h * 360}, ${color.s * 100}%, ${color.l * 100}%)`;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(32, 32, 27, 0, Math.PI * 2);
    ctx.stroke();
    this.cache.set(itemId, canvas);
    return canvas;
  }
}