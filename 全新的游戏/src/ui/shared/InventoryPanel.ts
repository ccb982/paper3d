// ============================================================
// InventoryPanel.ts —— 独立背包模块（纯 UI + 操作装配）
// ============================================================
// 封装"标签页 + 网格 + 物品详情"完整交互，不依赖宿主生命周期：
//   · 容器（overlay 弹窗 或 嵌入式面板）由宿主提供
//   · 详情弹窗通过注入的 openPanel/closePanel 挂到宿主弹窗栈
//   · 物品变更后通过 onDataChanged 通知宿主刷新
// ShipUIManager / WorldUIManager 均可复用；转移目标由配置的层
// 动态生成（源层取自其它层，地图模式仅暴露 ship/player）。
// ============================================================

import type { GameSession, InventoryGrid } from '../../core/Session';
import type { ItemManager, UseItemResult } from '../../systems/inventory/ItemManager';
import { ALLY_SLOT_COUNT } from '../../systems/inventory/ItemManager';
import type { ItemIconRegistry } from '../../services/item/ItemIconRegistry';
import type { PanelDef } from '../BaseInteractionUI';
import { InventoryGridRenderer } from './InventoryGridRenderer';
import { createButton } from '../components/Button';
import { CSS } from './UIConstants';

/** ★ 装备栏槽位定义（player.equips 键 → 中文名） */
const EQUIP_BAR_SLOTS: { slot: 'weapon' | 'armor' | 'headgear'; label: string }[] = [
  { slot: 'weapon', label: '武器' },
  { slot: 'armor', label: '盔甲' },
  { slot: 'headgear', label: '头盔' },
];
const EQUIP_SLOT_LABELS: Record<string, string> = Object.fromEntries(
  EQUIP_BAR_SLOTS.map((s) => [s.slot, s.label]),
);

export interface InventoryLayerOption {
  key: keyof GameSession['inventories'];
  label: string;
}

export interface InventoryPanelOptions {
  session: GameSession;
  itemManager: ItemManager;
  /** 展示的层（顺序即标签顺序） */
  layers: InventoryLayerOption[];
  /** 默认选中的层；缺省 = layers[0] */
  defaultLayer?: keyof GameSession['inventories'];
  /**
   * 各源层可转移到的目标层（key → 目标列表）。
   * 缺省 = 除自己外的所有 layers；只列出此处配置的层。
   */
  transferTargets?: Partial<Record<keyof GameSession['inventories'], Array<keyof GameSession['inventories']>>>;
  /** 是否显示"使用"按钮（消耗品） */
  allowUse?: boolean;
  /** ★ 可选注入共享图标服务（与加工台同路径）；缺省网格内部自建 */
  iconRegistry?: ItemIconRegistry;
  /** 网格区最小宽度（格子自适应：min(48, minWidth/cols)） */
  minWidth?: number;
  /** 宿主弹窗栈操作（BaseInteractionUI.open/closePanel） */
  openPanel: (def: PanelDef) => void;
  closePanel: (id?: string) => void;
  /** 物品变更（使用/转移/丢弃）后宿主如何刷新 */
  onDataChanged: () => void;
}

export class InventoryPanel {
  private gridRenderer: InventoryGridRenderer;
  /** 当前选中的层（跨渲染保持，转移/丢弃后仍停留在当前标签） */
  private currentLayer: keyof GameSession['inventories'] | null = null;

  constructor(private opts: InventoryPanelOptions) {
    this.gridRenderer = new InventoryGridRenderer(opts.itemManager, opts.iconRegistry);
  }

  /** 当前选中的层（宿主可读取用于刷新指示） */
  get activeLayer(): keyof GameSession['inventories'] | null {
    return this.currentLayer;
  }

  /**
   * 渲染完整背包视图（标签栏 + 网格）到指定容器。
   * @param container 宿主提供的挂载点（overlay 内容 或 嵌入式面板）
   * @param flashItemId 拾取后高亮该 itemId（可选）
   */
  render(container: HTMLElement, flashItemId?: string): void {
    const inv = this.opts.session.inventories;
    const layers = this.opts.layers;
    if (layers.length === 0) return;

    const defaultLayer = this.opts.defaultLayer ?? layers[0].key;
    const currentLayer = this.currentLayer ?? defaultLayer;
    const resolveLayer = () => {
      const active = this.currentLayer ?? defaultLayer;
      return layers.some(l => l.key === active) ? active : defaultLayer;
    };

    // 标签栏
    const tabBar = document.createElement('div');
    tabBar.className = CSS.tabBar;
    for (const layer of layers) {
      const tab = document.createElement('button');
      tab.textContent = layer.label;
      tab.className = CSS.tabButton;
      if (layer.key === currentLayer) tab.classList.add('ui-tab-btn-active');
      tab.addEventListener('click', () => {
        this.currentLayer = layer.key;
        showGrid(layer.key);
      });
      tabBar.appendChild(tab);
    }

    // 网格容器
    const gridView = document.createElement('div');
    const refresh = () => this.render(container, flashItemId);
    // ★ 可拖拽集合：可部署友军（→ 友军槽位）+ 可装备（→ 装备栏），跨全部层
    const allItems = new Set<string>();
    for (const key of Object.keys(inv) as (keyof GameSession['inventories'])[]) {
      for (const it of this.opts.itemManager.getItems(key)) {
        if (this.opts.itemManager.isDeployable(it.itemId) || this.opts.itemManager.isEquip(it.itemId)) {
          allItems.add(it.itemId);
        }
      }
    }
    const showGrid = (layer: keyof GameSession['inventories']) => {
      const grid = inv[layer];
      if (!Array.isArray(grid)) return;
      const cols = grid[0]?.length ?? 0;
      const minWidth = this.opts.minWidth ?? 540;
      const cellSize = Math.min(48, Math.floor(minWidth / cols));
      this.gridRenderer.render(gridView, grid, layer, (e) => {
        this.openItemDetail(e.layer as keyof GameSession['inventories'], e.row, e.col);
      }, cellSize, flashItemId, {
        dragItemIds: allItems,
      });
    };

    // ★ 友军槽位行（部署区）：可部署友军拖入 = 部署；槽位内物品可拖回网格 = 卸载
    const allyRow = document.createElement('div');
    allyRow.style.cssText = [
      'display:flex', 'gap:6px', 'justify-content:center',
      'padding:8px 0', 'border-bottom:1px solid rgba(255,255,255,0.08)',
      'margin-bottom:8px',
    ].join(';');
    const deployed = this.opts.itemManager.getDeployedAllies();
    for (let s = 0; s < ALLY_SLOT_COUNT; s++) {
      const itemId = deployed[s];
      const slotEl = document.createElement('div');
      slotEl.style.cssText = [
        `width:64px`, `height:64px`,
        'border-radius:4px', 'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'font-size:9px', 'color:#9bf', 'position:relative',
        itemId
          ? 'background:rgba(90,120,220,0.18);border:1px solid #5599ff;'
          : 'background:rgba(255,255,255,0.04);border:1px dashed #3a4a7a;',
        'cursor:pointer',
      ].join(';');
      if (itemId) {
        // 已部署：显示图标 + 可拖回背包
        try {
          const iconCanvas = this.gridRenderer.getIcon(itemId);
          const img = document.createElement('img');
          img.src = iconCanvas.toDataURL();
          img.style.cssText = 'width:70%;height:70%;object-fit:contain;';
          slotEl.appendChild(img);
        } catch {
          slotEl.textContent = itemId.slice(0, 4);
        }
        const label = document.createElement('span');
        label.textContent = this.opts.itemManager.getItemConfig(itemId)?.name ?? itemId;
        label.style.cssText = 'position:absolute;bottom:2px;font-size:8px;color:#9bf;';
        slotEl.appendChild(label);
        slotEl.draggable = true;
        slotEl.addEventListener('dragstart', (ev) => {
          ev.dataTransfer?.setData('text/x-ally', String(s));
          if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
        });
      } else {
        slotEl.textContent = `友军\n槽位`;
      }
      // 接收拖入：背包里的可部署物品 → 部署
      slotEl.addEventListener('dragover', (ev) => ev.preventDefault());
      slotEl.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const itemId2 = ev.dataTransfer?.getData('text/x-item');
        if (itemId2 && !itemId) {
          if (this.opts.itemManager.deployAlly(itemId2)) {
            this.opts.onDataChanged();
            refresh();
          }
        }
      });
      allyRow.appendChild(slotEl);
    }

    // ★ 装备栏行：装备类物品拖入 = 穿戴（旧装备自动回背包）；已穿戴可拖回网格 = 卸载
    const equipRow = document.createElement('div');
    equipRow.style.cssText = [
      'display:flex', 'gap:6px', 'justify-content:center',
      'padding:8px 0', 'border-bottom:1px solid rgba(255,255,255,0.08)',
      'margin-bottom:8px',
    ].join(';');
    const equips = this.opts.itemManager.getEquipped();
    for (const def of EQUIP_BAR_SLOTS) {
      const equippedId = equips[def.slot];
      const slotEl = document.createElement('div');
      slotEl.style.cssText = [
        `width:64px`, `height:64px`,
        'border-radius:4px', 'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'font-size:11px', 'position:relative',
        equippedId
          ? 'background:rgba(120,180,90,0.14);border:1px solid #77cc66;'
          : 'background:rgba(255,255,255,0.04);border:1px dashed #3a4a7a;',
        'cursor:pointer',
      ].join(';');
      if (equippedId) {
        // 已穿戴：图标 + 名称 + 可拖出（拖回背包 = 卸载）
        try {
          const iconCanvas = this.gridRenderer.getIcon(equippedId);
          const img = document.createElement('img');
          img.src = iconCanvas.toDataURL();
          img.style.cssText = 'width:70%;height:70%;object-fit:contain;';
          slotEl.appendChild(img);
        } catch {
          slotEl.textContent = equippedId.slice(0, 4);
        }
        const label = document.createElement('span');
        label.textContent = this.opts.itemManager.getItemConfig(equippedId)?.name ?? equippedId;
        label.style.cssText = 'position:absolute;bottom:2px;font-size:8px;color:#8d8;';
        slotEl.appendChild(label);
        slotEl.draggable = true;
        slotEl.addEventListener('dragstart', (ev) => {
          ev.dataTransfer?.setData('text/x-equip', equips[def.slot] ?? '');
          if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
        });
      } else {
        slotEl.textContent = def.label;
        slotEl.style.cssText += 'color:#8af;';
      }
      // 接收拖入：背包里的同位置装备类物品 → 穿戴（源 cell 精确使用；旧装备回背包）
      slotEl.addEventListener('dragover', (ev) => ev.preventDefault());
      slotEl.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const itemId2 = ev.dataTransfer?.getData('text/x-item');
        if (!itemId2 || this.opts.itemManager.equipSlotOf(itemId2) !== def.slot) return;
        let result: UseItemResult | null = null;
        const src = ev.dataTransfer?.getData('text/x-src');
        if (src) {
          const [l, r, c] = src.split(',');
          if (l && Number.isInteger(Number(r)) && Number.isInteger(Number(c))) {
            result = this.opts.itemManager.equipCell(l as keyof GameSession['inventories'], Number(r), Number(c));
          }
        }
        if (!result) result = this.opts.itemManager.equipItem(itemId2);
        if (result.success) {
          this.opts.onDataChanged();
          refresh();
        }
      });
      equipRow.appendChild(slotEl);
    }

    // 网格兜底接收：友军槽位拖出 → 卸载放回背包；装备栏拖出 → 卸载放回背包
    gridView.addEventListener('dragover', (ev) => ev.preventDefault());
    gridView.addEventListener('drop', (ev) => {
      const ally = ev.dataTransfer?.getData('text/x-ally');
      if (ally !== undefined && ally !== '') {
        ev.preventDefault();
        if (this.opts.itemManager.undeployAlly(Number(ally))) {
          this.opts.onDataChanged();
          refresh();
        }
      }
      const equipSlot = ev.dataTransfer?.getData('text/x-equip');
      if (equipSlot) {
        ev.preventDefault();
        if (this.opts.itemManager.unequipItem(equipSlot)) {
          this.opts.onDataChanged();
          refresh();
        }
      }
    });

    showGrid(resolveLayer());

    container.innerHTML = '';
    container.appendChild(tabBar);
    container.appendChild(allyRow);
    container.appendChild(equipRow);
    container.appendChild(gridView);
  }

  /** 转移目标：优先用 transferTargets 定制，否则 = 除自己外的所有层 */
  private targetsFor(layer: keyof GameSession['inventories']): InventoryLayerOption[] {
    const custom = this.opts.transferTargets?.[layer];
    if (custom && custom.length > 0) {
      return custom
        .map(key => this.opts.layers.find(l => l.key === key))
        .filter((l): l is InventoryLayerOption => !!l);
    }
    return this.opts.layers.filter((t) => t.key !== layer);
  }

  /** 物品详情（使用/转移/丢弃/关闭） */
  private openItemDetail(layer: keyof GameSession['inventories'], row: number, col: number): void {
    const grid = this.opts.session.inventories[layer] as InventoryGrid;
    const slot = grid?.[row]?.[col];
    if (!slot) return;
    const config = this.opts.itemManager.getItemConfig(slot.itemId);

    this.opts.openPanel({
      id: 'item-detail',
      title: slot.itemId,
      onOpen: () => {},
      onClose: () => {},
      render: () => {
        const div = document.createElement('div');
        div.className = CSS.panel;
        const useable = config?.type === 'consumable' || config?.type === 'equip';
        div.innerHTML = `
          <p class="ui-panel-text">数量: ${slot.stackSize}</p>
          <p class="ui-panel-text">类型: ${config?.type ?? '未知'}${config?.type === 'equip' ? `（装备位：${EQUIP_SLOT_LABELS[this.opts.itemManager.equipSlotOf(slot.itemId) ?? ''] ?? '未知'}）` : ''}</p>
          <p class="ui-panel-desc">${config?.description ?? ''}</p>
        `;

        // 使用/装备按钮（消耗品 → 使用；装备 → 穿戴）
        if ((this.opts.allowUse ?? true) && useable) {
          div.appendChild(createButton({
            label: config?.type === 'equip' ? '装备' : '使用', size: 'sm', style: 'primary',
            onClick: () => {
              const result = this.opts.itemManager.useItem(layer, row, col);
              if (result.success) {
                this.opts.closePanel('item-detail');
                this.opts.onDataChanged();
              }
            },
          }));
        }

        // ★ 共用一个数量滑块，转移与丢弃都按该数量操作
        {
          const max = slot.stackSize;
          const countInput = document.createElement('input');
          countInput.type = 'range';
          countInput.min = '1';
          countInput.max = String(max);
          countInput.value = String(max);
          countInput.style.cssText = 'flex:1;min-width:120px;';
          const countLabel = document.createElement('span');
          countLabel.style.cssText = 'color:#aaa;font-size:12px;min-width:34px;text-align:right;';
          countLabel.textContent = String(max);
          countInput.addEventListener('input', () => {
            countLabel.textContent = countInput.value;
          });
          const count = () => Math.max(1, Math.min(max, Number(countInput.value) || 1));

          const countRow = document.createElement('div');
          countRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px;';
          countRow.appendChild(document.createTextNode('数量'));
          countRow.appendChild(countInput);
          countRow.appendChild(countLabel);
          div.appendChild(countRow);

          // 转移到其它背包（目标 = 该源层的配置目标；用上方滑块数量）
          const targets = this.targetsFor(layer);
          if (targets.length > 0) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:8px;';
            const select = document.createElement('select');
            select.style.cssText = 'background:#1a2238;color:#8af;border:1px solid #4466aa;border-radius:4px;padding:4px 8px;font-size:12px;';
            for (const t of targets) {
              const opt = document.createElement('option');
              opt.value = t.key;
              opt.textContent = t.label;
              select.appendChild(opt);
            }
            row.appendChild(select);
            row.appendChild(createButton({
              label: '转移', size: 'sm', style: 'ghost',
              onClick: () => {
                const dst = select.value as keyof GameSession['inventories'];
                if (dst === layer) return;
                const moved = this.opts.itemManager.moveItem(layer, dst, slot.itemId, count());
                if (moved) {
                  this.opts.closePanel('item-detail');
                  this.opts.onDataChanged();
                }
              },
            }));
            div.appendChild(row);
          }

          // 丢弃按钮（用上方滑块数量；带确认）
          const dropBtn = createButton({
            label: '丢弃', size: 'sm', style: 'danger',
            onClick: () => {
              this.confirmDiscard(() => {
                this.opts.itemManager.removeItem(layer, slot.itemId, count());
                this.opts.closePanel('item-detail');
                this.opts.onDataChanged();
              });
            },
          });
          dropBtn.style.marginTop = '8px';
          div.appendChild(dropBtn);
        }

        return div;
      },
    });
  }

  /** 丢弃确认弹窗 */
  private confirmDiscard(onConfirm: () => void): void {
    this.opts.openPanel({
      id: 'discard-confirm',
      title: '确认丢弃',
      onOpen: () => {},
      onClose: () => {},
      render: () => {
        const div = document.createElement('div');
        div.className = CSS.panel;
        div.innerHTML = `
          <p class="ui-panel-text">确定要丢弃这些物品吗？丢弃后无法找回。</p>
        `;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;margin-top:12px;';
        row.appendChild(createButton({
          label: '确认丢弃', size: 'sm', style: 'danger',
          onClick: () => {
            this.opts.closePanel('discard-confirm');
            onConfirm();
          },
        }));
        row.appendChild(createButton({
          label: '取消', size: 'sm', style: 'ghost',
          onClick: () => this.opts.closePanel('discard-confirm'),
        }));
        div.appendChild(row);
        return div;
      },
    });
  }
}