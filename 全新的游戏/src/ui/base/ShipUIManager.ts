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
import { ActionPanel, OperatorPanel } from './ShipPanels';
import { computeCombatStats } from '../../core/Session';
import { RELIC_ITEM_CONFIG } from '../../config/relics';
import { CharacterStatsPanel, type CharacterStatsSnapshot } from '../shared/CharacterStatsPanel';

type ShipPanel = 'action' | 'formation' | 'operator' | 'none';

export class ShipUIManager extends BaseInteractionUI {
  private currentPanel: ShipPanel = 'none';
  /** ★ 编队 → 完整背包页（2026-09-12）：角色属性 + 背包网格 + 出击槽 */
  private characterStatsPanel = new CharacterStatsPanel();
  private inventoryPageOpen = false;
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

  /** 切换面板（公开供按钮点击调用）；★ 编队 → 直接打开完整背包页 */
  togglePanel(panel: ShipPanel): void {
    if (panel === 'formation') {
      this.toggleInventoryPage();
      return;
    }
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
    this.renderPanel(this.currentPanel);
  }

  // ============================================================
  // 编队 → 完整背包页（2026-09-12 用户定调：点击编队直接进入背包页面）
  // ============================================================

  private toggleInventoryPage(): void {
    if (this.inventoryPageOpen) {
      this.closePanel('base-inventory');
      return;
    }
    const content = document.createElement('div');
    content.className = 'ui-panel-inner';

    // 左右分栏：左 = 角色属性（橙色）；右 = 背包 + 出击槽
    const columns = document.createElement('div');
    columns.style.cssText =
      'display:flex;gap:12px;align-items:flex-start;width:min(94vw,1120px);box-sizing:border-box;';
    const statsRoot = document.createElement('div');
    this.characterStatsPanel.render(statsRoot, this.buildStatsSnapshot(), this.iconRegistry);
    columns.appendChild(statsRoot);
    const gridRoot = document.createElement('div');
    gridRoot.style.cssText = 'flex:1 1 auto;min-width:0;overflow-y:auto;overflow-x:hidden;';
    columns.appendChild(gridRoot);
    content.appendChild(columns);
    this.inventoryPanel.render(gridRoot);

    this.inventoryPageOpen = true;
    this.openPanel({
      id: 'base-inventory',
      title: '背包',
      render: () => content,
      onClose: () => { this.inventoryPageOpen = false; },
    });
  }

  /** ★ 角色属性快照（基地无实时实体：current = 永久 + 装备临时加成；不含限时 buff） */
  private buildStatsSnapshot(): CharacterStatsSnapshot {
    const base = this.session.player;
    const perm = computeCombatStats(this.session, RELIC_ITEM_CONFIG);
    const temp = this.itemManager.getEquipmentStats();
    const owned = this.session.outOfRun?.owned ?? {};
    const relics = Object.entries(owned)
      .filter(([, count]) => (count ?? 0) > 0)
      .map(([id, count]) => {
        const cfg = RELIC_ITEM_CONFIG[id];
        return {
          id,
          name: cfg?.name ?? id,
          count,
          iconFrame: cfg?.iconFrame ? cfg.iconFrame(count) : 0,
          description: cfg?.description ?? '',
        };
      });
    const curAtk = Math.floor(perm.attackPower * (1 + temp.attackPct)) + temp.attackPower;
    const curDef = Math.floor(perm.defense * (1 + temp.defensePct)) + temp.defense;
    const curMaxHp = perm.maxHp + temp.maxHp;
    const extras: { label: string; perm: number; temp: number; suffix?: string }[] = [
      { label: '攻击速度', perm: 100, temp: temp.attackSpeed },
      { label: '伤害减免', perm: 0, temp: Math.round(temp.damageReduction * 100), suffix: '%' },
      { label: '生命回复', perm: 0, temp: +temp.hpRegen.toFixed(2), suffix: '/s' },
    ];
    if (temp.critRate > 0) extras.push({ label: '暴击率', perm: 0, temp: Math.round(temp.critRate * 100), suffix: '%' });
    if (temp.dodgeRate > 0) extras.push({ label: '闪避率', perm: 0, temp: Math.round(temp.dodgeRate * 100), suffix: '%' });
    if (temp.blockRate > 0) extras.push({ label: '格挡率', perm: 0, temp: Math.round(temp.blockRate * 100), suffix: '%' });
    return {
      base: { maxHp: base.maxHp, attackPower: base.attackPower, defense: base.defense },
      perm: { maxHp: perm.maxHp, attackPower: perm.attackPower, defense: perm.defense },
      temp: { maxHp: curMaxHp - perm.maxHp, attackPower: curAtk - perm.attackPower, defense: curDef - perm.defense },
      current: { maxHp: curMaxHp, attackPower: curAtk, defense: curDef },
      extras,
      day: this.session.meta.day,
      deaths: this.session.meta.deaths ?? 0,
      relics,
    };
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
    this.inventoryPageOpen = false;
    if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
    this.panelContainer.innerHTML = '';
  }
}