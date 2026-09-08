// ============================================================
// ShipUIManager.ts —— 舰船 UI 管理器
// 封装所有舰船 UI（三面板 + 背包 + 合成 + 抽卡 + 对话）
// 继承 BaseInteractionUI 统一管理弹窗栈。
// ============================================================

import { BaseInteractionUI, type PanelDef } from '../BaseInteractionUI';
import type { GameSession } from '../../core/Session';
import { createEmptyGrid, countItemsInGrid, addItemToGrid } from '../../core/Session';
import { ItemManager } from '../../systems/inventory/ItemManager';
import { CraftingManager } from '../../systems/inventory/CraftingManager';
import { InteractionManager } from '../../systems/interaction/InteractionManager';
import { InventoryPanel } from '../shared/InventoryPanel';
import { renderDialogBubble } from '../components/DialogBubble';
import { createButton } from '../components/Button';
import type { GachaOverlay } from './GachaOverlay';

type ShipPanel = 'action' | 'formation' | 'operator' | 'none';

export class ShipUIManager extends BaseInteractionUI {
  private currentPanel: ShipPanel = 'none';
  /** ★ 当前编队面板内容区块是否展示背包（刷新时保持停留） */
  private showingInventory = false;
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

    // overlay 弹窗根
    this.overlayRoot = document.createElement('div');
    this.overlayRoot.id = 'ship-overlay-root';
    this.overlayRoot.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
      'background:rgba(0,0,0,0.5)', 'display:none', 'z-index:200',
      'pointer-events:auto', 'align-items:center', 'justify-content:center',
    ].join(';');
    document.body.appendChild(this.overlayRoot);
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
    switch (panel) {
      case 'action': this.renderActionPanel(); break;
      case 'formation': this.renderFormationPanel(); break;
      case 'operator': this.renderOperatorPanel(); break;
    }
  }

  // ============================================================
  // 行动面板
  // ============================================================

  private renderActionPanel(): void {
    const s = this.session;
    const ship = s.ship;
    const inv = s.inventories;

    const div = document.createElement('div');
    div.innerHTML = `
      <h3 style="color:#8af;margin:0 0 12px 0;">行动准备</h3>
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>📅 第 ${s.meta.day} 天</div>
        <div>🚢 舰船: HP ${ship.hp}/${ship.maxHp} | 护盾 ${ship.shield} | 装甲 ${ship.armor}</div>
        <div>🛡 炮塔: ${ship.turrets.length} 座</div>
      </div>
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>🎒 背包状态:</div>
        <div>  基地仓库: ${countItemsInGrid(inv.base)} 件</div>
        <div>  飞船仓库: ${countItemsInGrid(inv.ship)} 件</div>
        <div>  玩家背包: ${countItemsInGrid(inv.player)} 件</div>
        <div>  队友背包: ${Object.keys(inv.allies).length} 人</div>
      </div>
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>🏆 藏品: ${s.relics.owned.length} 件 | 干员: ${s.allies.roster.length} 人</div>
        <div>🎰 抽卡保底: ${s.gacha.pityCounter} 抽</div>
      </div>
    `;

    if (s.dayProgress.hasDepartedToday) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#fa4;padding:8px;background:rgba(255,170,68,0.15);border-radius:4px;margin-bottom:12px;';
      msg.textContent = '今日已出击，休息等明天吧';
      div.appendChild(msg);
    } else {
      const departBtn = createButton({
        label: '🚀 出击', size: 'lg', fullWidth: true,
        onClick: () => this.onDepart?.(),
      });
      departBtn.style.background = '#4488ff';
      div.appendChild(departBtn);
    }

    this.panelContainer.appendChild(div);
  }

  // ============================================================
  // 编队面板
  // ============================================================

  private renderFormationPanel(): void {
    const div = document.createElement('div');
    div.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h3 style="color:#8af;margin:0;">编队管理</h3>
      </div>
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;">
      </div>
      <div id="ship-formation-content"></div>
    `;

    // 右上角关闭按钮
    const head = div.querySelector('div')!;
    head.appendChild(createButton({
      label: '✕ 关闭', size: 'sm', style: 'ghost',
      onClick: () => this.togglePanel('formation'),
    }));

    const btnBar = div.querySelectorAll('div')[1]!;
    btnBar.appendChild(createButton({ label: '🎒 打开背包', size: 'sm', style: 'secondary', onClick: () => this.renderInventoryView() }));
    btnBar.appendChild(createButton({ label: '🏆 藏品查看', size: 'sm', style: 'secondary', onClick: () => this.renderRelicsView() }));
    btnBar.appendChild(createButton({ label: '🔧 合成台', size: 'sm', style: 'secondary', onClick: () => this.openCrafting('ship') }));

    this.panelContainer.appendChild(div);
  }

  /** ★ 数据变更后刷新编队面板内容区，保持当前子视图（背包/藏品），不重置到面板根部 */
  private refreshPanelContent(): void {
    if (this.currentPanel !== 'formation') {
      this.renderPanel(this.currentPanel);
      return;
    }
    const content = this.panelContainer.querySelector('#ship-formation-content');
    if (!content) return;
    if (this.showingInventory) {
      this.renderInventoryView();
    } else {
      this.renderRelicsView();
    }
  }

  // ============================================================
  // 背包视图
  // ============================================================

  private renderInventoryView(): void {
    this.showingInventory = true;
    const content = this.panelContainer.querySelector('#ship-formation-content')!;

    let html = '<div style="padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;margin-bottom:8px;">';
    html += '<div id="inv-grid-view"></div></div>';

    content.innerHTML = html;

    const gridView = content.querySelector('#inv-grid-view') as HTMLElement;
    // ★ 独立背包模块渲染（标签页 + 网格）
    this.inventoryPanel.render(gridView);
  }

  // ============================================================
  // 藏品视图
  // ============================================================

  private renderRelicsView(): void {
    this.showingInventory = false;
    const content = this.panelContainer.querySelector('#ship-formation-content')!;
    const relics = this.session.relics;

    let html = `
      <div style="padding:8px;background:rgba(102,68,170,0.15);border-radius:4px;">
        <h4 style="color:#a8f;margin:0 0 8px 0;">藏品 (${relics.owned.length} 件)</h4>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
    `;
    for (const id of relics.owned) {
      html += `<span style="padding:4px 10px;background:rgba(102,68,170,0.3);border:1px solid #8866cc;border-radius:4px;font-size:12px;color:#caf;">${id}</span>`;
    }
    html += '</div></div>';
    content.innerHTML = html;
  }

  // ============================================================
  // 干员面板
  // ============================================================

  private renderOperatorPanel(): void {
    const s = this.session;
    const div = document.createElement('div');

    div.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <h3 style="color:#8af;margin:0;">干员管理</h3>
      </div>
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>已招募干员: ${s.allies.roster.length} 人</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
          ${s.allies.roster.length === 0
            ? '<span style="color:#666;">还没有干员，去招募吧</span>'
            : s.allies.roster.map(id => `<span style="padding:4px 10px;background:rgba(68,136,255,0.2);border:1px solid #4488ff;border-radius:4px;font-size:12px;color:#8af;">${id}</span>`).join('')
          }
        </div>
      </div>
    `;

    // 右上角关闭按钮
    div.querySelector('div')!.appendChild(createButton({
      label: '✕ 关闭', size: 'sm', style: 'ghost',
      onClick: () => this.togglePanel('operator'),
    }));

    this.panelContainer.appendChild(div);
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
    document.body.appendChild(bubble);
  }

  // ============================================================
  // 生命周期
  // ============================================================

  override dispose(): void {
    super.dispose();
    if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
    this.panelContainer.innerHTML = '';
  }
}