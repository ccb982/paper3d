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
import type { GachaOverlay } from './GachaOverlay';
import type { CraftingOverlay } from './CraftingOverlay';
import type { ItemIconRegistry } from '../../services/item/ItemIconRegistry';
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
  private _craftingOverlay: CraftingOverlay | null = null;

  /** 设置抽卡覆盖层（行动后触发） */
  setGachaOverlay(overlay: GachaOverlay): void {
    this._gachaOverlay = overlay;
  }

  /** 设置加工台覆盖层（替代原简单合成台弹窗） */
  setCraftingOverlay(overlay: CraftingOverlay): void {
    this._craftingOverlay = overlay;
  }

  constructor(
    private session: GameSession,
    private itemManager: ItemManager,
    private craftingManager: CraftingManager,
    private interactionManager: InteractionManager,
    private iconRegistry: ItemIconRegistry,
    private onDepart: (() => void) | null,
  ) {
    super();
    // ★ 独立背包模块：舰船模式显示全部三层 + 支持"转移到基地"
    //   图标服务注入共享实例（与加工台同一路径）
    this.inventoryPanel = new InventoryPanel({
      session,
      itemManager,
      iconRegistry,
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
        });
        this.formationPanel = p;
        content = this.buildSidePanel(p);
        break;
      }
      case 'operator': {
        const p = new OperatorPanel({
          session: this.session,
          iconRegistry: this.iconRegistry,
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
  // 加工台
  // ============================================================

  openCrafting(station: 'ship' | 'portable'): void {
    // ★ 复杂加工页面覆盖层（仿抽卡页面）；station 决定可用配方列表
    this._craftingOverlay?.show(station);
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