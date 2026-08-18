// ============================================================
// WorldUIManager.ts —— 世界 UI 管理器
// 封装 HUD、小地图、准星、交互提示、浮动文字、对话气泡。
// 继承 BaseInteractionUI 统一管理弹窗栈。
// 对应原 services/ui/UILayer + Crosshair，合并为一个统一 UI 管理器。
// ============================================================

import { BaseInteractionUI } from '../BaseInteractionUI';
import type { GameSession } from '../../core/Session';
import { ItemManager } from '../../systems/inventory/ItemManager';
import { InteractionManager } from '../../systems/interaction/InteractionManager';
import { Minimap } from '../../services/ui/Minimap';
import { PlayerHud } from '../../services/ui/PlayerHud';
import { Crosshair } from '../../services/ui/Crosshair';
import { RasterMap } from '../../services/map/RasterMap';
import { renderDialogBubble } from '../components/DialogBubble';

export class WorldUIManager extends BaseInteractionUI {
  private minimap: Minimap;
  private hud: PlayerHud;
  private crosshair: Crosshair;
  private interactPrompt: HTMLDivElement;
  private floatingTexts: { el: HTMLDivElement; life: number; maxLife: number }[] = [];

  constructor(
    private session: GameSession,
    private itemManager: ItemManager,
    private interactionManager: InteractionManager,
    raster: RasterMap,
  ) {
    super();
    this.minimap = new Minimap(raster);
    this.hud = new PlayerHud();
    this.crosshair = new Crosshair();

    // 交互提示
    this.interactPrompt = document.createElement('div');
    this.interactPrompt.style.cssText = [
      'position:fixed', 'bottom:120px', 'left:50%', 'transform:translateX(-50%)',
      'color:#fff', 'background:rgba(0,0,0,0.7)', 'padding:8px 16px',
      'border-radius:4px', 'display:none', 'z-index:200',
      'font-size:14px', 'pointer-events:none',
    ].join(';');
    this.interactPrompt.textContent = '按 E 拾取';
    document.body.appendChild(this.interactPrompt);
  }

  /** 每帧更新（高频调用） */
  update(dt: number, ctx: {
    px: number; pz: number; yaw: number;
    entities: any[];
    hp: number; maxHp: number;
    nearbyItem?: { itemId: string; distance: number } | null;
  }): void {
    this.minimap.update(ctx.px, ctx.pz, ctx.yaw, ctx.entities);
    this.hud.update(ctx.hp, ctx.maxHp);

    // 交互提示
    if (ctx.nearbyItem && ctx.nearbyItem.distance < 2) {
      this.interactPrompt.textContent = `按 E 拾取 ${ctx.nearbyItem.itemId}`;
      this.interactPrompt.style.display = 'block';
    } else {
      this.interactPrompt.style.display = 'none';
    }

    // 浮动文字更新
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= dt;
      if (ft.life <= 0) {
        ft.el.remove();
        this.floatingTexts.splice(i, 1);
      } else {
        ft.el.style.opacity = String(ft.life / ft.maxLife);
        ft.el.style.transform = `translate(-50%, ${-60 * (1 - ft.life / ft.maxLife)}px)`;
      }
    }
  }

  /** 显示浮动文字 */
  showFloatingText(x: number, y: number, text: string, color: string = '#ff4444'): void {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:50%',
      'color:' + color, 'font-size:18px', 'font-weight:bold',
      'pointer-events:none', 'z-index:250',
      'text-shadow:0 0 4px rgba(0,0,0,0.8)',
      'transform:translate(-50%, 0)',
      'transition:opacity 0.1s',
    ].join(';');
    el.textContent = text;
    document.body.appendChild(el);
    this.floatingTexts.push({ el, life: 1.5, maxLife: 1.5 });
  }

  /** 显示拾取结果 */
  showPickupResult(itemId: string, success: boolean): void {
    const msg = success ? `拾取了 ${itemId}` : `背包已满，无法拾取 ${itemId}`;
    this.showFloatingText(0, -50, msg, success ? '#44dd88' : '#ff4444');
  }

  /** 打开对话（世界轻量版） */
  openDialogue(npcId: string, text: string): void {
    const bubble = renderDialogBubble({ speaker: npcId, text, autoCloseMs: 3000 });
    document.body.appendChild(bubble);
  }

  /** 准星显隐 */
  setCrosshairVisible(v: boolean): void {
    this.crosshair.setVisible(v);
  }

  override dispose(): void {
    super.dispose();
    this.minimap.dispose();
    this.hud.dispose();
    this.crosshair.dispose();
    this.interactPrompt.remove();
    for (const ft of this.floatingTexts) ft.el.remove();
    this.floatingTexts = [];
  }
}