// ============================================================
// WorldUIManager.ts —— 世界 UI 管理器
// 封装 HUD、小地图、准星、交互提示、浮动文字、对话气泡。
// 继承 BaseInteractionUI 统一管理弹窗栈。
// 对应原 services/ui/UILayer + Crosshair，合并为一个统一 UI 管理器。
// ============================================================

import { BaseInteractionUI } from '../BaseInteractionUI';
import type { GameSession, InventoryGrid } from '../../core/Session';
import type { WorldUIState } from '../../core/WorldUIState';
import { ItemManager } from '../../systems/inventory/ItemManager';
import { InteractionManager } from '../../systems/interaction/InteractionManager';
import { InventoryGridRenderer } from '../shared/InventoryGridRenderer';
import { Minimap } from '../../services/ui/Minimap';
import { PlayerHud } from '../../services/ui/PlayerHud';
import { Crosshair } from '../../services/ui/Crosshair';
import { RasterMap } from '../../services/map/RasterMap';
import { renderDialogBubble } from '../components/DialogBubble';
import { createButton } from '../components/Button';
import { CSS } from '../shared/UIConstants';

export class WorldUIManager extends BaseInteractionUI {
  private minimap: Minimap;
  private hud: PlayerHud;
  private crosshair: Crosshair;
  private interactPrompt: HTMLDivElement;
  private floatingTexts: { el: HTMLDivElement; life: number; maxLife: number }[] = [];
  private gridRenderer: InventoryGridRenderer;
  private inventoryOpen = false;

  constructor(
    private session: GameSession,
    private itemManager: ItemManager,
    private interactionManager: InteractionManager,
    raster: RasterMap,
  ) {
    super();
    this.gridRenderer = new InventoryGridRenderer(this.itemManager);

    // overlay 弹窗根
    this.overlayRoot = document.createElement('div');
    this.overlayRoot.className = CSS.overlay;
    document.body.appendChild(this.overlayRoot);

    this.minimap = new Minimap(raster);
    this.hud = new PlayerHud();
    this.crosshair = new Crosshair();

    // 交互提示
    this.interactPrompt = document.createElement('div');
    this.interactPrompt.className = CSS.interactPrompt;
    this.interactPrompt.textContent = '按 E 拾取';
    document.body.appendChild(this.interactPrompt);
  }

  /** 每帧更新（高频调用） */
  update(dt: number, ctx: WorldUIState): void {
    this.minimap.update(ctx.playerPosition.x, ctx.playerPosition.z, ctx.cameraYaw, ctx.entities);
    this.hud.update(ctx.playerStats.hp, ctx.playerStats.maxHp);

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
    el.className = CSS.floatingText;
    el.style.color = color;
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

  /** 打开/关闭背包面板 */
  toggleInventory(): void {
    this.inventoryOpen = !this.inventoryOpen;
    if (this.inventoryOpen) {
      this.renderInventoryPanel();
    } else {
      this.closePanel();
    }
  }

  private renderInventoryPanel(): void {
    const inv = this.session.inventories;
    const layers = Object.keys(inv) as (keyof typeof inv)[];

    // 用标签页切换显示各层
    let currentLayer = layers[0];

    const content = document.createElement('div');
    content.className = 'ui-panel-inner';

    // 标题
    const title = document.createElement('div');
    title.className = CSS.panelTitle;
    title.textContent = '背包';
    content.appendChild(title);

    // 标签栏
    const tabBar = document.createElement('div');
    tabBar.className = CSS.tabBar;
    for (const layer of layers) {
      const tab = document.createElement('button');
      tab.textContent = layer;
      tab.className = CSS.tabButton;
      tab.addEventListener('click', () => {
        currentLayer = layer;
        showGrid(currentLayer);
      });
      tabBar.appendChild(tab);
    }
    content.appendChild(tabBar);

    // 网格容器
    const gridView = document.createElement('div');
    gridView.id = 'world-inv-grid-view';
    content.appendChild(gridView);

    const showGrid = (layer: keyof typeof inv) => {
      const grid = inv[layer];
      if (Array.isArray(grid)) {
        const cols = grid[0]?.length ?? 0;
        const cellSize = Math.min(48, Math.floor(540 / cols));
        this.gridRenderer.render(gridView, grid, layer, (e) => {
          this.openItemDetail(e.layer as keyof GameSession['inventories'], e.row, e.col);
        }, cellSize);
      }
    };

    showGrid(currentLayer);

    this.openPanel({
      id: 'inventory-panel',
      onOpen: () => {},
      onClose: () => { this.inventoryOpen = false; },
      render: () => content,
    });
  }

  /** 物品详情（带使用/丢弃/转移） */
  private openItemDetail(layer: keyof GameSession['inventories'], row: number, col: number): void {
    if (layer === 'allies') return;
    const grid = this.session.inventories[layer] as InventoryGrid;
    const slot = grid?.[row]?.[col];
    if (!slot) return;
    const config = this.itemManager.getItemConfig(slot.itemId);

    this.openPanel({
      id: 'item-detail',
      onOpen: () => {},
      onClose: () => {},
      render: () => {
        const div = document.createElement('div');
        div.className = CSS.panel;
        div.innerHTML = `
          <h3 class="ui-detail-title">${slot.itemId}</h3>
          <p class="ui-panel-text">数量: ${slot.stackSize}</p>
          <p class="ui-panel-text">类型: ${config?.type ?? '未知'}</p>
          <p class="ui-panel-desc">${config?.description ?? ''}</p>
        `;

        // 使用按钮（消耗品）
        if (config?.type === 'consumable') {
          div.appendChild(createButton({
            label: '使用', size: 'sm', style: 'primary',
            onClick: () => {
              const result = this.itemManager.useItem(layer, row, col);
              if (result.success) {
                this.closePanel('item-detail');
                this.renderInventoryPanel();
              }
            },
          }));
        }

        // 转移到基地（非 base 层）
        if (layer !== 'base') {
          const btn = createButton({
            label: '转移到基地', size: 'sm', style: 'ghost',
            onClick: () => {
              const moved = this.itemManager.moveItem(layer, 'base', slot.itemId, 1);
              if (moved) {
                this.closePanel('item-detail');
                this.renderInventoryPanel();
              }
            },
          });
          btn.style.marginLeft = '8px';
          div.appendChild(btn);
        }

        // 丢弃按钮
        const dropBtn = createButton({
          label: '丢弃', size: 'sm', style: 'danger',
          onClick: () => {
            this.itemManager.removeItem(layer, slot.itemId, 1);
            this.closePanel('item-detail');
            this.renderInventoryPanel();
          },
        });
        dropBtn.style.marginLeft = '8px';
        div.appendChild(dropBtn);

        // 关闭按钮
        const closeBtn = createButton({
          label: '关闭', size: 'sm', style: 'ghost',
          onClick: () => this.closePanel('item-detail'),
        });
        closeBtn.style.marginTop = '8px';
        div.appendChild(closeBtn);
        return div;
      },
    });
  }

  /** 刷新背包面板（如果已打开） */
  refreshIfOpen(): void {
    if (this.inventoryOpen) {
      this.renderInventoryPanel();
    }
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