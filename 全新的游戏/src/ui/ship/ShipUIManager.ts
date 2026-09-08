// ============================================================
// ShipUIManager.ts —— 舰船 UI 管理器
// 封装所有舰船 UI（三面板 + 背包 + 合成 + 抽卡 + 对话）
// 继承 BaseInteractionUI 统一管理弹窗栈。
// ============================================================

import { BaseInteractionUI, type PanelDef, Panel } from '../BaseInteractionUI';
import type { GameSession } from '../../core/Session';
import { ItemManager } from '../../systems/inventory/ItemManager';
import { CraftingManager } from '../../systems/inventory/CraftingManager';
import { InteractionManager } from '../../systems/interaction/InteractionManager';
import { InventoryPanel } from '../shared/InventoryPanel';
import { renderDialogBubble } from '../components/DialogBubble';
import { createButton } from '../components/Button';
import type { GachaOverlay } from './GachaOverlay';
import { ActionPanel, FormationPanel, OperatorPanel } from './ShipPanels';

type ShipPanel = 'action' | 'formation' | 'operator' | 'none';

export class ShipUIManager extends BaseInteractionUI {
  private currentPanel: ShipPanel = 'none';
  /** ★ 挂载中的编队面板实例（子视图刷新委托） */
  private formationPanel: FormationPanel | null = null;
  private root: HTMLDivElement;
  private panelContainer: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private inventoryPanel: InventoryPanel;
  private _gachaOverlay: GachaOverlay | null = null;

  /** 设置抽卡覆盖层（行动后触发） */
  setGachaOverlay(overlay: GachaOverlay): void {
    this._gachaOverlay = overlay;
  }

  constructor(
    private session: GameSession,
    private itemManager: ItemManager,
    private craftingManager: CraftingManager,
    private interactionManager: InteractionManager,
    private onDepart: (() => void) | null,
  ) {
    super();
    // ★ 独立背包模块：舰船模式显示全部三层 + 支持"转移到基地"
    this.inventoryPanel = new InventoryPanel({
      session,
      itemManager,
      layers: [
        { key: 'base', label: '🏠 基地仓库' },
        { key: 'ship', label: '🚀 飞船仓库' },
        { key: 'player', label: '🎒 玩家背包' },
      ],
      // 互相全通：基地↔飞船↔玩家 各自可转去另外两个
      transferTargets: {
        base: ['ship', 'player'],
        ship: ['base', 'player'],
        player: ['base', 'ship'],
      },
      defaultLayer: 'player',
      openPanel: (def) => this.openPanel(def),
      closePanel: (id) => this.closePanel(id),
      onDataChanged: () => {
        if (this.currentPanel !== 'none') this.refreshPanelContent();
      },
    });
    this.root = document.createElement('div');
    this.root.id = 'ship-ui-root';
    this.root.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
      'pointer-events:none', 'font-family:Microsoft YaHei,sans-serif', 'z-index:100',
    ].join(';');
    document.body.appendChild(this.root);

    // 标题
    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = [
      'position:absolute', 'top:12px', 'left:50%', 'transform:translateX(-50%)',
      'color:#aac', 'font-size:20px', 'font-weight:bold',
      'text-shadow:0 0 10px rgba(68,136,255,0.5)', 'pointer-events:none',
    ].join(';');
    this.titleEl.textContent = `罗德岛本舰 · 第 ${this.session.meta.day} 天`;
    this.root.appendChild(this.titleEl);

    // 面板容器
    this.panelContainer = document.createElement('div');
    this.panelContainer.id = 'ship-panel-container';
    this.panelContainer.style.cssText = [
      'position:absolute', 'top:60px', 'left:50%', 'transform:translateX(-50%)',
      'width:600px', 'max-height:calc(100vh - 160px)', 'overflow-y:auto',
      'background:rgba(20,20,40,0.92)', 'border:1px solid #4466aa',
      'border-radius:8px', 'padding:16px', 'display:none',
      'pointer-events:auto', 'color:#ccc',
    ].join(';');
    this.root.appendChild(this.panelContainer);

    // ★ 模态面板栈挂载到 body（新 PanelManager 拥有遮罩层）
    this.panels.mount(document.body);
  }

  /** 更新标题（换天时调用） */
  updateTitle(): void {
    this.titleEl.textContent = `罗德岛本舰 · 第 ${this.session.meta.day} 天`;
  }

  // ============================================================
  // 面板切换
  // ============================================================

  /** 切换面板（公开供按钮点击调用） */
  togglePanel(panel: ShipPanel): void {
    if (this.currentPanel === panel) {
      this.closeCurrentPanel();
      return;
    }
    this.currentPanel = panel;
    this.renderPanel(panel);
  }

  private closeCurrentPanel(): void {
    this.currentPanel = 'none';
    this.panelContainer.style.display = 'none';
    this.panelContainer.innerHTML = '';
  }

  private renderPanel(panel: ShipPanel): void {
    this.panelContainer.style.display = 'block';
    this.panelContainer.innerHTML = '';
    let content: HTMLElement | null = null;
    switch (panel) {
      case 'action': {
        const p = new ActionPanel({
          session: this.session,
          onDepart: this.onDepart,
        });
        content = this.buildSidePanel(p);
        break;
      }
      case 'formation': {
        const p = new FormationPanel({
          session: this.session,
          itemManager: this.itemManager,
          craftingManager: this.craftingManager,
          inventoryPanel: this.inventoryPanel,
          openCrafting: (station) => this.openCrafting(station),
        });
        this.formationPanel = p;
        content = this.buildSidePanel(p);
        break;
      }
      case 'operator': {
        const p = new OperatorPanel({
          session: this.session,
        });
        content = this.buildSidePanel(p);
        break;
      }
      case 'none':
        break;
    }
    if (content) this.panelContainer.appendChild(content);
  }

  /** 用统一 Panel 基类渲染侧边面板，返回其根元素 */
  private buildSidePanel<P>(panel: Panel<P>): HTMLElement {
    return panel.render({ root: this.panelContainer, close: () => this.closeCurrentPanel() });
  }

  /** ★ 数据变更后刷新当前面板内容，保持子视图停留 */
  private refreshPanelContent(): void {
    if (this.currentPanel !== 'formation') {
      this.renderPanel(this.currentPanel);
      return;
    }
    this.formationPanel?.refresh();
  }

  // ============================================================
  // 合成台
  // ============================================================

  openCrafting(station: 'ship' | 'portable'): void {
    const recipes = this.craftingManager.getAvailableRecipes(station);
    this.openPanel({
      id: 'crafting-panel',
      onOpen: () => {},
      onClose: () => {},
      render: () => {
        const div = document.createElement('div');
        div.style.cssText = 'background:rgba(20,20,40,0.95);border:1px solid #4466aa;border-radius:8px;padding:16px;min-width:350px;';
        div.innerHTML = `<h3 style="color:#8af;margin:0 0 12px 0;">${station === 'ship' ? '舰船' : '便携'}合成台</h3>`;

        for (const r of recipes) {
          const canCraft = this.craftingManager.canCraft(r.id, 'player');
          const row = document.createElement('div');
          row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px;margin-bottom:4px;background:rgba(68,102,170,0.1);border-radius:4px;${canCraft ? '' : 'opacity:0.5;'}`;
          row.innerHTML = `<span style="flex:1;">${r.name}</span><span style="color:#888;font-size:12px;">${r.inputs.map(i => `${i.itemId}x${i.count}`).join(' + ')}</span><span style="color:#8f8;font-size:12px;">→ ${r.output.itemId}x${r.output.count}</span>`;

          if (canCraft) {
            const craftBtn = createButton({
              label: '合成', size: 'sm', style: 'primary',
              onClick: () => {
                if (this.craftingManager.craft(r.id, 'player', 'player')) {
                  super.closePanel('crafting-panel');
                  this.renderPanel('formation');
                }
              },
            });
            row.appendChild(craftBtn);
          } else {
            const need = document.createElement('span');
            need.style.cssText = 'color:#f44;font-size:11px;';
            need.textContent = '材料不足';
            row.appendChild(need);
          }
          div.appendChild(row);
        }

        const closeBtn = createButton({ label: '关闭', size: 'sm', style: 'ghost', onClick: () => this.closePanel('crafting-panel') });
        closeBtn.style.marginTop = '8px';
        div.appendChild(closeBtn);
        return div;
      },
    });
  }

  // ============================================================
  // 对话
  // ============================================================

  openDialogue(npcId: string, text: string): void {
    const bubble = renderDialogBubble({
      speaker: npcId, text,
      onClose: () => {},
    });
    // ★ 非模态 HUD 小部件：由 WidgetManager 统一管理与清理
    this.widgets.add(bubble);
  }

  // ============================================================
  // 生命周期
  // ============================================================

  override dispose(): void {
    super.dispose();
    this.formationPanel = null;
    if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
    this.panelContainer.innerHTML = '';
  }
}