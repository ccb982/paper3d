// ============================================================
// AmmoHud —— 弹药 HUD（战斗道具播放 · 弹药类 UI）
// ============================================================
// 右下角画布自绘：弹药图标 + "×N" 实时数字；弹药归零 → 红色脉冲。
// 数据由 WorldUIManager 每帧传入（仅数字，UI 层不持有实体）。
// ============================================================

import type { ItemManager } from '../inventory/ItemManager';
import { ItemIconRegistry } from '../../services/item/ItemIconRegistry';

export class AmmoHud {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 140;
  private h = 34;
  private icon: HTMLCanvasElement | null = null;
  /** 弹药图标物品 id（弹药包图标 / 该弹药类型对应道具图标） */
  private readonly iconItemId = 'ammo_pack';

  constructor(itemManager: ItemManager) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.cssText = [
      'position:fixed;bottom:12px;right:12px;',
      `width:${this.w}px;height:${this.h}px;`,
      'z-index:998;pointer-events:none;',
    ].join('');
    this.ctx = this.canvas.getContext('2d')!;
    document.body.appendChild(this.canvas);

    // ★ 弹药图标（复用背包图标统一出口）
    try {
      const reg = new ItemIconRegistry(itemManager);
      this.icon = reg.getIcon(this.iconItemId);
    } catch {
      this.icon = null;
    }
  }

  /** 每帧绘制：图标 + ×N；弹药 0 → 红色脉冲 */
  update(count: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);

    const empty = count <= 0;
    // 归零脉冲（透明度呼吸，复刻 PlayerHud 低血量手法）
    let alpha = 1;
    if (empty) {
      const t = performance.now() * 0.005;
      alpha = 0.5 + 0.5 * Math.sin(t);
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    // 弹药图标（40px 居左）
    const iconSize = 28;
    if (this.icon) {
      try {
        ctx.drawImage(this.icon, 4, (this.h - iconSize) / 2, iconSize, iconSize);
      } catch {
        this.drawFallbackIcon();
      }
    } else {
      this.drawFallbackIcon();
    }

    // ×N 数字
    ctx.fillStyle = empty ? '#ff2222' : '#ffd27a';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`× ${Math.max(0, Math.floor(count))}`, 38, this.h / 2 + 1);

    ctx.restore();
  }

  private drawFallbackIcon(): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,210,122,0.35)';
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(18, this.h / 2, 11, 0, Math.PI * 2);
    ctx.stroke();
  }

  dispose(): void {
    this.canvas.remove();
  }
}