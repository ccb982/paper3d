// ============================================================
// ShipUIManager.ts —— 舰船 UI 管理器
// 封装所有舰船 UI（三面板 + 背包 + 合成 + 抽卡 + 对话）
// 继承 BaseInteractionUI 统一管理弹窗栈。
// ============================================================

import { BaseInteractionUI, type PanelDef } from '../BaseInteractionUI';
import type { GameSession, InventoryGrid } from '../../core/Session';
import { createEmptyGrid, countItemsInGrid, addItemToGrid } from '../../core/Session';
import { ItemManager } from '../../systems/inventory/ItemManager';
import { CraftingManager } from '../../systems/inventory/CraftingManager';
import { InteractionManager } from '../../systems/interaction/InteractionManager';
import { InventoryGridRenderer } from '../shared/InventoryGridRenderer';
import { renderDialogBubble } from '../components/DialogBubble';
import { createButton } from '../components/Button';
import type { GachaOverlay } from './GachaOverlay';

type ShipPanel = 'action' | 'formation' | 'operator' | 'none';

export class ShipUIManager extends BaseInteractionUI {
  private currentPanel: ShipPanel = 'none';
  private root: HTMLDivElement;
  private panelContainer: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private gridRenderer: InventoryGridRenderer;
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
    this.gridRenderer = new InventoryGridRenderer(this.itemManager);
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
      <h3 style="color:#8af;margin:0 0 12px 0;">编队管理</h3>
      <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;">
      </div>
      <div id="ship-formation-content"></div>
    `;

    const btnBar = div.querySelector('div')!;
    btnBar.appendChild(createButton({ label: '🎒 打开背包', size: 'sm', style: 'secondary', onClick: () => this.renderInventoryView() }));
    btnBar.appendChild(createButton({ label: '🏆 藏品查看', size: 'sm', style: 'secondary', onClick: () => this.renderRelicsView() }));
    btnBar.appendChild(createButton({ label: '🔧 合成台', size: 'sm', style: 'secondary', onClick: () => this.openCrafting('ship') }));

    this.panelContainer.appendChild(div);
  }

  // ============================================================
  // 背包视图
  // ============================================================

  private renderInventoryView(): void {
    const content = this.panelContainer.querySelector('#ship-formation-content')!;
    const inv = this.session.inventories;

    const layers: { key: keyof typeof inv; label: string }[] = [
      { key: 'base', label: '🏠 基地仓库' },
      { key: 'ship', label: '🚀 飞船仓库' },
      { key: 'player', label: '🎒 玩家背包' },
    ];

    let html = '<div style="padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;margin-bottom:8px;">';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px;">';
    for (const l of layers) {
      html += `<button class="inv-tab" data-layer="${l.key}" style="flex:1;padding:6px;background:#4466aa;color:#fff;border:none;border-radius:4px;cursor:pointer;">${l.label}</button>`;
    }
    html += '</div><div id="inv-grid-view"></div></div>';

    content.innerHTML = html;

    const showGrid = (layer: keyof typeof inv) => {
      const gridView = content.querySelector('#inv-grid-view') as HTMLElement;
      const grid = inv[layer];
      if (Array.isArray(grid)) {
        this.renderGrid(gridView, grid, layer);
      }
    };

    content.querySelectorAll('.inv-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = (btn as HTMLElement).dataset.layer as keyof typeof inv;
        showGrid(layer);
      });
    });

    showGrid('player');
  }

  private renderGrid(container: HTMLElement, grid: InventoryGrid, layer: string): void {
    if (!grid || grid.length === 0) {
      container.innerHTML = '<div style="color:#666;">空网格</div>';
      return;
    }
    const cols = grid[0]?.length ?? 0;
    const cellSize = Math.min(48, Math.floor(540 / cols));
    this.gridRenderer.render(
      container, grid, layer,
      (e) => this.openItemDetail(e.layer as keyof GameSession['inventories'], e.row, e.col),
      cellSize,
    );
  }

  // ============================================================
  // 藏品视图
  // ============================================================

  private renderRelicsView(): void {
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
      <h3 style="color:#8af;margin:0 0 12px 0;">干员管理</h3>
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
  // 物品详情
  // ============================================================

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
        div.style.cssText = 'background:rgba(20,20,40,0.95);border:1px solid #4466aa;border-radius:8px;padding:16px;min-width:250px;';
        div.innerHTML = `
          <h3 style="color:#8af;margin:0 0 8px 0;">${slot.itemId}</h3>
          <p style="margin:4px 0;color:#aaa;">数量: ${slot.stackSize}</p>
          <p style="margin:4px 0;color:#aaa;">类型: ${config?.type ?? '未知'}</p>
          <p style="margin:4px 0 12px 0;color:#888;font-size:12px;">${config?.description ?? ''}</p>
        `;

        if (config?.type === 'consumable') {
          div.appendChild(createButton({
            label: '使用', size: 'sm', style: 'primary',
            onClick: () => {
              const result = this.itemManager.useItem(layer, row, col);
              if (result.success) {
                super.closePanel('item-detail');
                this.renderPanel(this.currentPanel);
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
                this.renderPanel(this.currentPanel);
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
            this.renderPanel(this.currentPanel);
          },
        });
        dropBtn.style.marginLeft = '8px';
        div.appendChild(dropBtn);

        div.appendChild(createButton({
          label: '关闭', size: 'sm', style: 'ghost',
          onClick: () => this.closePanel('item-detail'),
        }));
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