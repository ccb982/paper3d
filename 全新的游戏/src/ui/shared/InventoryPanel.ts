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
import { SLOT_COUNT, SLOT_COLS } from '../../systems/inventory/ItemManager';
import type { ItemIconRegistry } from '../../services/item/ItemIconRegistry';
import type { PanelDef } from '../BaseInteractionUI';
import { InventoryGridRenderer } from './InventoryGridRenderer';
import { createButton } from '../components/Button';
import { CSS } from './UIConstants';

/** ★ 装备位中文名（详情弹窗标注用；槽位本身已通用化） */
const EQUIP_SLOT_LABELS: Record<string, string> = {
  weapon: '武器',
  armor: '盔甲',
  headgear: '头盔',
};

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
  /** ★ 弹窗栈查询（详情是否仍在栈中；缺省视为未知=不启用"就地表刷新"保护） */
  isPanelOpen?: (id: string) => boolean;
  /** 物品变更（使用/转移/丢弃）后宿主如何刷新 */
  onDataChanged: () => void;
}

export class InventoryPanel {
  private gridRenderer: InventoryGridRenderer;
  /** 当前选中的层（跨渲染保持，转移/丢弃后仍停留在当前标签） */
  private currentLayer: keyof GameSession['inventories'] | null = null;
  /** ★ 当前打开的详情坐标（背景拾取刷新时用于"就地刷新详情、不打断"） */
  private openDetailRef: { layer: keyof GameSession['inventories']; row: number; col: number } | null = null;
  /** ★ 就地刷新（同 id 关→开）期间抑制 onClose 的整面板刷新（避免重复重建背包） */
  private suppressDetailCloseRefresh = false;

  constructor(private opts: InventoryPanelOptions) {
    this.gridRenderer = new InventoryGridRenderer(opts.itemManager, opts.iconRegistry);
  }

  /** ★ 详情弹窗是否仍打开（栈查询缺失时按本地记录近似） */
  get isDetailOpen(): boolean {
    if (!this.openDetailRef) return false;
    return this.opts.isPanelOpen ? this.opts.isPanelOpen('item-detail') : true;
  }

  /**
   * ★ 背景数据变化（如拾取新物品）时就地刷新详情：同 id 弹窗"关→开"仍居栈顶，
   *   不打断当前查看；详情所属格已空（用完/转移）→ 关闭详情。
   * @returns true = 详情已处理（调用方不要再整面板刷新）；false = 无详情可刷
   */
  refreshOpenDetail(): boolean {
    const ref = this.openDetailRef;
    if (!ref || !this.isDetailOpen) return false;
    const grid = this.opts.session.inventories[ref.layer] as InventoryGrid;
    const slot = grid?.[ref.row]?.[ref.col];
    if (!slot) {
      this.opts.closePanel('item-detail');
      return false;
    }
    // 同 id 关→开：旧实例 onClose 会触发，期间抑制"整面板刷新"（详情仍居栈顶）
    this.suppressDetailCloseRefresh = true;
    this.openItemDetail(ref.layer, ref.row, ref.col);
    this.suppressDetailCloseRefresh = false;
    return true;
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
        // ★ 网格内自由整理（同层移动/交换；跨层仍走详情面板"转移"）
        onCellDrop: (src, dstLayer, dstRow, dstCol) => {
          const [sl, sr, sc] = src.split(',');
          if (sl !== dstLayer) return;
          const r1 = Number(sr), c1 = Number(sc);
          if (!Number.isInteger(r1) || !Number.isInteger(c1)) return;
          if (this.opts.itemManager.swapCells(
            dstLayer as keyof GameSession['inventories'], r1, c1, dstRow, dstCol,
          )) {
            this.opts.onDataChanged?.();
            refresh();
          }
        },
      });
    };

    // ★ 出击槽池（SLOT_COUNT 格，2 行 × SLOT_COLS 列）：友军/装备任意混放。
    //   · 背包里的可部署/可装备物品拖入空槽 = 放入（装备在格即已穿戴，贴片全量叠加）
    //   · 槽位内物品拖回网格 = 放回玩家背包
    const slotPool = document.createElement('div');
    slotPool.title = `出击槽（${SLOT_COUNT} 格，2 行 × ${SLOT_COLS} 列：可部署友军 / 装备任意混放；在槽装备即已穿戴）`;
    slotPool.style.cssText = [
      'display:grid', `grid-template-columns:repeat(${SLOT_COLS},64px)`,
      'gap:6px', 'justify-content:center',
      'padding:8px 0', 'border-bottom:1px solid rgba(255,255,255,0.08)',
      'margin-bottom:8px',
    ].join(';');
    const slots = this.opts.itemManager.getSlots();
    for (let s = 0; s < SLOT_COUNT; s++) {
      const itemId = slots[s];
      const cell = document.createElement('div');
      cell.style.cssText = [
        `width:64px`, `height:64px`,
        'border-radius:4px', 'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'font-size:9px', 'position:relative', 'cursor:pointer',
        itemId
          ? 'background:rgba(90,120,220,0.18);border:1px solid #5599ff;'
          : 'background:rgba(255,255,255,0.04);border:1px dashed #3a4a7a;',
      ].join(';');
      if (itemId) {
        // 已放入：图标 + 名称 + 可拖回背包
        try {
          // ★ 统一图标出口（与网格一致）：无人机 → 活动画布（翅膀持续抖动，非随机帧快照）
          const iconEl = this.gridRenderer.createIconElement(itemId);
          iconEl.style.cssText = 'width:70%;height:70%;object-fit:contain;';
          cell.appendChild(iconEl);
        } catch {
          cell.textContent = itemId.slice(0, 4);
        }
        const label = document.createElement('span');
        label.textContent = this.opts.itemManager.getItemConfig(itemId)?.name ?? itemId;
        label.style.cssText = 'position:absolute;bottom:2px;font-size:8px;color:#9bf;';
        cell.appendChild(label);
        cell.draggable = true;
        cell.addEventListener('dragstart', (ev) => {
          ev.dataTransfer?.setData('text/x-slot', String(s));
          if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
        });
      } else {
        cell.textContent = '空槽';
        cell.style.cssText += 'color:#4a5a8a;';
      }
      // 接收拖入：背包里的可部署/可装备物品 → 放入该槽（一格一个，违规拒绝）
      cell.addEventListener('dragover', (ev) => ev.preventDefault());
      cell.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const itemId2 = ev.dataTransfer?.getData('text/x-item');
        if (!itemId2) return;
        const src = ev.dataTransfer?.getData('text/x-src');
        let result: UseItemResult | null = null;
        if (src) {
          const [l, r, c] = src.split(',');
          if (l && Number.isInteger(Number(r)) && Number.isInteger(Number(c))) {
            result = this.opts.itemManager.putIntoSlot(s, l as keyof GameSession['inventories'], Number(r), Number(c));
          }
        }
        if (result?.success) {
          this.opts.onDataChanged();
          refresh();
        }
      });
      slotPool.appendChild(cell);
    }

    // 网格兜底接收：出击槽拖出 → 放回玩家背包
    gridView.addEventListener('dragover', (ev) => ev.preventDefault());
    gridView.addEventListener('drop', (ev) => {
      const slotStr = ev.dataTransfer?.getData('text/x-slot');
      if (slotStr !== undefined && slotStr !== '') {
        ev.preventDefault();
        if (this.opts.itemManager.removeFromSlot(Number(slotStr))) {
          this.opts.onDataChanged();
          refresh();
        }
      }
    });

    showGrid(resolveLayer());

    container.innerHTML = '';
    container.appendChild(tabBar);
    container.appendChild(slotPool);
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
      // ★ 关闭时清坐标；真实关闭（非就地刷新）→ 借宿主刷新背包，把期间新拾取的物品补上格子
      onClose: () => {
        this.openDetailRef = null;
        if (!this.suppressDetailCloseRefresh) this.opts.onDataChanged?.();
      },
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
    // ★ openPanel 可能是"同 id 关→开"：旧实例 onClose 先清引用，这里最后落位
    this.openDetailRef = { layer, row, col };
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