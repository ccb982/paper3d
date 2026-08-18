// ============================================================
// InventoryGridRenderer —— 共享背包网格渲染器（纯展示）
// ============================================================
// 职责：接收网格数据（InventoryGrid）+ 物品图标服务 → 渲染为
// HTML 网格。不持有任何 Session 引用，只负责展示。
// ShipUIManager 和 WorldUIManager 均可复用。
// ============================================================

import type { InventoryGrid, ItemInstance } from '../../core/Session';
import type { ItemManager } from '../../systems/inventory/ItemManager';
import { ItemIconRegistry } from '../../services/item/ItemIconRegistry';

export interface InventorySlotClickEvent {
  layer: string;
  row: number;
  col: number;
  item: ItemInstance | null;
}

export class InventoryGridRenderer {
  private iconRegistry: ItemIconRegistry;

  constructor(itemManager: ItemManager) {
    this.iconRegistry = new ItemIconRegistry(itemManager);
  }

  /**
   * 渲染一个网格到容器
   * @param container 目标 HTMLElement
   * @param grid 数据网格
   * @param layerName 层级名（用于事件回调）
   * @param onSlotClick 点击回调
   * @param cellSize 格子大小（px）
   */
  render(
    container: HTMLElement,
    grid: InventoryGrid,
    layerName: string,
    onSlotClick?: (e: InventorySlotClickEvent) => void,
    cellSize = 48,
  ): void {
    container.innerHTML = '';
    const rows = grid.length;
    const cols = grid[0]?.length || 0;

    const gridDiv = document.createElement('div');
    gridDiv.style.cssText = `display:grid;grid-template-columns:repeat(${cols},${cellSize}px);gap:2px;justify-content:center;`;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const slot = grid[r][c];
        const cell = this.createCell(slot, cellSize, layerName, r, c, onSlotClick);
        gridDiv.appendChild(cell);
      }
    }
    container.appendChild(gridDiv);
  }

  private createCell(
    slot: ItemInstance | null,
    size: number,
    layer: string,
    row: number,
    col: number,
    onSlotClick?: (e: InventorySlotClickEvent) => void,
  ): HTMLElement {
    const el = document.createElement('div');
    el.style.cssText = [
      `width:${size}px`, `height:${size}px`,
      'background:rgba(255,255,255,0.05)',
      `border:1px solid ${slot ? '#4466aa' : '#2a2a4a'}`,
      'border-radius:2px',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-size:10px', 'color:#8af', 'position:relative',
      `cursor:${slot ? 'pointer' : 'default'}`,
      'overflow:hidden',
    ].join(';');

    if (slot) {
      // ★ 显示物品图标（纹理色块）
      try {
        const tex = this.iconRegistry.getIcon(slot.itemId);
        const canvas = document.createElement('canvas');
        canvas.width = tex.image.width;
        canvas.height = tex.image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(tex.image, 0, 0);
        const img = document.createElement('img');
        img.src = canvas.toDataURL();
        img.style.cssText = 'width:80%;height:80%;object-fit:contain;';
        el.appendChild(img);
      } catch {
        // 降级显示文字缩写
        el.textContent = slot.itemId.slice(0, 3);
      }

      // 数量角标
      if (slot.stackSize > 1) {
        const count = document.createElement('span');
        count.style.cssText = [
          'position:absolute', 'bottom:1px', 'right:3px',
          'font-size:9px', 'color:#6af', 'text-shadow:0 0 3px #000',
        ].join(';');
        count.textContent = `x${slot.stackSize}`;
        el.appendChild(count);
      }

      el.addEventListener('click', () => {
        onSlotClick?.({ layer, row, col, item: slot });
      });
    }

    return el;
  }
}