// ============================================================
// InventoryPanel.ts —— 独立背包模块（纯 UI + 操作装配）
// ============================================================
// 封装"标签页 + 网格 + 物品操作窗"完整交互，不依赖宿主生命周期：
//   · 容器（overlay 弹窗 或 嵌入式面板）由宿主提供
//   · 物品点击 → 复用加工模块数量窗 UI 的操作覆盖层（ItemActionOverlay）
//   · 物品变更后通过 onDataChanged 通知宿主刷新
// ShipUIManager / WorldUIManager 均可复用；转移目标由配置的层
// 动态生成（源层取自其它层，地图模式仅暴露 ship/player）。
// ============================================================

import type { GameSession, InventoryGrid } from '../../core/Session';
import type { ItemManager, UseItemResult } from '../../systems/inventory/ItemManager';
import { SLOT_COUNT, SLOT_COLS } from '../../systems/inventory/ItemManager';
import type { ItemIconRegistry } from '../../services/item/ItemIconRegistry';
import { InventoryGridRenderer } from './InventoryGridRenderer';
import { ItemActionOverlay } from './ItemActionOverlay';
import { CSS } from './UIConstants';

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
  /** ★ 可选注入共享图标服务（与加工台同路径）；缺省网格内部自建 */
  iconRegistry?: ItemIconRegistry;
  /** 网格区最小宽度（格子自适应：min(48, minWidth/cols)） */
  minWidth?: number;
  /** 物品变更（使用/转移/丢弃）后宿主如何刷新 */
  onDataChanged: () => void;
}

export class InventoryPanel {
  private gridRenderer: InventoryGridRenderer;
  /** ★ 物品操作窗（复用加工模块数量窗 UI：图标 / 数量 / 取消·确定 / 动作选择） */
  private actionOverlay: ItemActionOverlay;
  /** 当前选中的层（跨渲染保持，转移/丢弃后仍停留在当前标签） */
  private currentLayer: keyof GameSession['inventories'] | null = null;
  /** 最近一次渲染的挂载点（数据变更后就地刷新用） */
  private lastContainer: HTMLElement | null = null;

  constructor(private opts: InventoryPanelOptions) {
    this.gridRenderer = new InventoryGridRenderer(opts.itemManager, opts.iconRegistry);
    this.actionOverlay = new ItemActionOverlay({
      session: opts.session,
      itemManager: opts.itemManager,
      createIconElement: (itemId) => this.gridRenderer.createIconElement(itemId),
      transferTargetsFor: (layer) => this.targetsFor(layer),
      onChanged: () => {
        const prev = this.lastContainer;
        this.opts.onDataChanged?.();
        // ★ 宿主未重建背包（如舰内嵌入式背包页）时就地刷新网格，避免操作后显示残留
        //   宿主若已重建，lastContainer 会换成新容器 —— 跳过，避免重复渲染
        if (prev && prev === this.lastContainer && prev.isConnected) this.render(prev);
      },
      onToast: (text, ok) => this.flash(text, ok),
    });
  }

  /** ★ 物品操作窗是否打开 */
  get isDetailOpen(): boolean {
    return this.actionOverlay.isOpen;
  }

  /**
   * ★ 背景数据变化（如拾取新物品）：操作窗是独立覆盖层，无需重建背包，
   *   返回 true 让宿主跳过整面板刷新；真正关闭时由 onChanged 再刷新。
   */
  refreshOpenDetail(): boolean {
    return this.actionOverlay.isOpen;
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
    this.lastContainer = container;
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
        // ★ 点击图标 = 打开物品操作窗（复用加工模块 UI：图标/数量/取消·确定 + 动作选择）
        this.actionOverlay.openItem(
          e.layer as keyof GameSession['inventories'], e.row, e.col,
        );
      }, cellSize, flashItemId, {
        dragItemIds: allItems,
        // ★ 右键同样进入物品操作窗（与左键统一）
        onSlotContextMenu: (e) => {
          this.actionOverlay.openItem(e.layer as keyof GameSession['inventories'], e.row, e.col);
        },
        // ★ 网格内自由整理（同层移动/交换；跨层走物品操作窗"转移"）
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
        // ★ 点击已装备物品 = 打开同一物品操作窗（可选择卸载）
        cell.addEventListener('click', () => this.actionOverlay.openEquipped(s));
      } else {
        cell.textContent = '空槽';
        cell.style.cssText += 'color:#4a5a8a;';
      }
      // 接收拖入：背包物品 → 放入该槽；槽位物品 → 槽间移动/交换（一格一个，违规拒绝）
      cell.addEventListener('dragover', (ev) => ev.preventDefault());
      cell.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const fromSlot = ev.dataTransfer?.getData('text/x-slot');
        const itemId2 = ev.dataTransfer?.getData('text/x-item');
        let result: UseItemResult | null = null;
        if (fromSlot) {
          // ★ 槽位间移动/交换：目标空 = 移动，目标占用 = 互换
          const fromIdx = Number(fromSlot);
          if (Number.isInteger(fromIdx)) {
            result = this.opts.itemManager.swapSlots(fromIdx, s);
          }
        } else if (itemId2) {
          const src = ev.dataTransfer?.getData('text/x-src');
          if (src) {
            const [l, r, c] = src.split(',');
            if (l && Number.isInteger(Number(r)) && Number.isInteger(Number(c))) {
              // ★ 空槽 = 放入；已占用 = 与槽内物品互换（可装备/可部署均支持）
              result = this.opts.itemManager.swapIntoSlot(s, l as keyof GameSession['inventories'], Number(r), Number(c));
            }
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

  /** ★ 轻提示（操作结果）：底部居中浮一条，1.4s 自动消失 */
  private flash(text: string, ok: boolean): void {
    if (!text) return;
    for (const old of Array.from(document.querySelectorAll('.ui-inv-toast'))) old.remove();
    const el = document.createElement('div');
    el.className = 'ui-inv-toast';
    el.textContent = text;
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:64px', 'transform:translateX(-50%)',
      'z-index:500', 'pointer-events:none', 'white-space:pre-line',
      'padding:8px 18px', 'border-radius:6px', 'font:13px/1.5 "Microsoft YaHei",sans-serif',
      `color:${ok ? '#d8ffd8' : '#ffd0c0'}`,
      `background:${ok ? 'rgba(24,48,30,0.94)' : 'rgba(58,24,20,0.94)'}`,
      `border:1px solid ${ok ? 'rgba(120,220,140,0.55)' : 'rgba(230,120,90,0.6)'}`,
      'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }
}
