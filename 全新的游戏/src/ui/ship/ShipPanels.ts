// ============================================================
// ship/ShipPanels.ts —— 舰船三个侧边面板（迁移到 Panel 基类）
// ============================================================
// 行动 / 编队 / 干员 三个侧边面板，继承 SidePanel（Panel 基类子类），
// 仍渲染进 panelContainer 固定容器，但获得统一标题栏与生命周期。
// ============================================================

import { SidePanel } from '../panel/SidePanel';
import type { PanelRenderOptions } from '../panel/types';
import type { GameSession } from '../../core/Session';
import { countItemsInGrid } from '../../core/Session';
import type { ItemManager } from '../../systems/inventory/ItemManager';
import type { CraftingManager } from '../../systems/inventory/CraftingManager';
import type { InventoryPanel } from '../shared/InventoryPanel';
import { createButton } from '../components/Button';
import { OUT_OF_RUN_ITEM_CONFIG } from '../../config/outOfRunItems';

// ------------------------------------------------------------
// 行动面板
// ------------------------------------------------------------
export interface ActionPanelProps {
  session: GameSession;
  onDepart?: (() => void) | null;
}

export class ActionPanel extends SidePanel<ActionPanelProps> {
  protected title(): string {
    return '行动准备';
  }

  protected body(): HTMLElement {
    const s = this.props.session;
    const ship = s.ship;
    const inv = s.inventories;

    const div = document.createElement('div');
    div.innerHTML = `
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
      </div>
      <div style="margin-bottom:12px;padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>🏆 藏品: ${s.relics.owned.length} 件 | 干员: ${s.allies.roster.length} 人</div>
        <div>🎁 局外道具: ${Object.keys(s.outOfRun?.owned ?? {}).length} 种 | 💀 累计死亡: ${s.meta?.deaths ?? 0} 次</div>
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
        onClick: () => this.props.onDepart?.(),
      });
      departBtn.style.background = '#4488ff';
      div.appendChild(departBtn);
    }
    return div;
  }
}

// ------------------------------------------------------------
// 编队面板
// ------------------------------------------------------------
export interface FormationPanelProps {
  session: GameSession;
  itemManager: ItemManager;
  craftingManager: CraftingManager;
  inventoryPanel: InventoryPanel;
  /** 打开合成台（站类型由调用方决定） */
  openCrafting: (station: 'ship' | 'portable') => void;
}

export class FormationPanel extends SidePanel<FormationPanelProps> {
  protected title(): string {
    return '编队管理';
  }

  protected body(): HTMLElement {
    const div = document.createElement('div');

    const btnBar = document.createElement('div');
    btnBar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;';
    btnBar.appendChild(createButton({ label: '🎒 打开背包', size: 'sm', style: 'secondary', onClick: () => this.renderInventoryView() }));
    btnBar.appendChild(createButton({ label: '🏆 藏品查看', size: 'sm', style: 'secondary', onClick: () => this.renderRelicsView() }));
    btnBar.appendChild(createButton({ label: '🔧 合成台', size: 'sm', style: 'secondary', onClick: () => this.props.openCrafting('ship') }));
    div.appendChild(btnBar);

    const content = document.createElement('div');
    content.id = 'ship-formation-content';
    div.appendChild(content);

    // 默认展示子视图：背包
    this.renderInventoryView();
    return div;
  }

  /** ★ 数据变更后刷新当前子视图，保持停留（背包/藏品） */
  refresh(): void {
    if (this.activeView === 'inventory') {
      this.renderInventoryView();
    } else {
      this.renderRelicsView();
    }
  }

  private activeView: 'inventory' | 'relics' = 'inventory';

  /** 子视图：背包 */
  private renderInventoryView(): void {
    this.activeView = 'inventory';
    const content = document.getElementById('ship-formation-content');
    if (!content) return;
    const box = document.createElement('div');
    box.style.cssText = 'padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;';
    const grid = document.createElement('div');
    grid.id = 'inv-grid-view';
    box.appendChild(grid);
    content.innerHTML = '';
    content.appendChild(box);
    this.props.inventoryPanel.render(grid);
  }

  /** 子视图：藏品 */
  private renderRelicsView(): void {
    this.activeView = 'relics';
    const content = document.getElementById('ship-formation-content');
    if (!content) return;
    this.renderRelicsContent(content);
  }

  private renderRelicsContent(content: HTMLElement): void {
    const relics = this.props.session.relics;
    let html = `
      <div style="padding:8px;background:rgba(102,68,170,0.15);border-radius:4px;">
        <h4 style="color:#a8f;margin:0 0 8px 0;">藏品 (${relics.owned.length} 件)</h4>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
    `;
    for (const id of relics.owned) {
      html += `<span style="padding:4px 10px;background:rgba(102,68,170,0.3);border:1px solid #8866cc;border-radius:4px;font-size:12px;color:#caf;">${id}</span>`;
    }
    html += '</div></div>';

    // ★ 局外道具（只可抽取、不入背包；拥有即全局永久生效）
    const outOwned = this.props.session.outOfRun?.owned ?? {};
    const outIds = Object.keys(outOwned);
    const deaths = this.props.session.meta?.deaths ?? 0;
    html += `
      <div style="padding:8px;background:rgba(204,170,68,0.12);border-radius:4px;margin-top:10px;">
        <h4 style="color:#ffc;margin:0 0 6px 0;">局外道具 (${outIds.length} 种 · 只可抽取 · 无需携带)</h4>
        <div style="color:#ca9;font-size:12px;margin-bottom:8px;">💀 当前累计死亡 ${deaths} 次</div>
        ${outIds.length === 0
          ? '<div style="color:#665;font-size:12px;">还没有局外道具，去招募池抽取吧</div>'
          : '<div style="display:flex;flex-direction:column;gap:6px;">' + outIds.map((id) => {
              const cfg = OUT_OF_RUN_ITEM_CONFIG[id];
              if (!cfg) return '';
              const count = outOwned[id] ?? 0;
              const stars = cfg.rarity >= 6 ? '★' : '☆';
              return `<div style="padding:6px 10px;background:rgba(255,215,0,0.08);border:1px solid ${cfg.rarity >= 6 ? '#ffd700' : '#c8a0ff'};border-radius:4px;font-size:12px;">
                <div style="color:#ffd;font-weight:bold;">${cfg.name} ${stars} ×${count}</div>
                <div style="color:#ca9;margin-top:2px;">${cfg.description}</div>
              </div>`;
            }).join('') + '</div>'
        }
      </div>`;
    content.innerHTML = html;
  }
}

// ------------------------------------------------------------
// 干员面板
// ------------------------------------------------------------
export interface OperatorPanelProps {
  session: GameSession;
}

export class OperatorPanel extends SidePanel<OperatorPanelProps> {
  protected title(): string {
    return '干员管理';
  }

  protected body(): HTMLElement {
    const s = this.props.session;
    const div = document.createElement('div');
    div.innerHTML = `
      <div style="padding:8px;background:rgba(68,102,170,0.15);border-radius:4px;">
        <div>已招募干员: ${s.allies.roster.length} 人</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
          ${s.allies.roster.length === 0
            ? '<span style="color:#666;">还没有干员，去招募吧</span>'
            : s.allies.roster.map(id => `<span style="padding:4px 10px;background:rgba(68,136,255,0.2);border:1px solid #4488ff;border-radius:4px;font-size:12px;color:#8af;">${id}</span>`).join('')
          }
        </div>
      </div>
    `;
    return div;
  }
}
