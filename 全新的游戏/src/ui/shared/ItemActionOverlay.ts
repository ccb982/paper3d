// ============================================================
// ItemActionOverlay.ts —— 背包物品操作窗（复用加工模块数量窗 UI）
// ============================================================
// 点击背包物品 / 出击槽内的已装备物品时打开：
//   · 复用「物品使用页面 ui」整张素材（与 CraftModule 数量窗同一张图）
//   · 保留 图标 / 数量选择（最少 − 数值 + 最多）/ 取消 / 确定
//   · 新增动作选择按钮：使用·装备 / 转移到飞船·背包·基地 / 卸载
// 动作按钮只负责"选中"，真正执行由底部「确定」触发（数量按当前选择生效）。
// ============================================================

import type { GameSession } from '../../core/Session';
import type { ItemManager, UseItemResult } from '../../systems/inventory/ItemManager';
import { QTY_UI } from '../base/CraftModule';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import { compositeFrameToCanvas } from './ftxFrameToCanvas';

type LayerKey = keyof GameSession['inventories'];

interface TargetLayer {
  key: LayerKey;
  label: string;
}

interface ActionDef {
  key: string;
  label: string;
  /** 该动作一次可作用的最大数量（1 = 单件） */
  maxCount: number;
  run: (count: number) => UseItemResult;
}

/** 层短名（按钮文案用） */
const LAYER_SHORT: Record<string, string> = {
  base: '基地',
  ship: '飞船',
  player: '背包',
};

// ------------------------------------------------------------
// 背景素材（与 CraftModule 同一张「物品使用页面 ui」；模块级缓存只解码一次）
// ------------------------------------------------------------
let bgCache: { url: string; aspect: number } | null = null;
let bgLoading: Promise<void> | null = null;
function ensureQtyBg(): Promise<void> {
  if (bgCache) return Promise.resolve();
  if (!bgLoading) {
    bgLoading = (async () => {
      const asset = await FtxAsset.load('/ui/物品使用页面ui.ftx3.gz');
      const raw = compositeFrameToCanvas(asset, 0);
      bgCache = { url: raw.toDataURL(), aspect: raw.width / raw.height };
    })().catch((err) => {
      console.warn('[ItemActionOverlay] 物品使用页面 ui 素材载入失败:', err);
      bgLoading = null;
    });
  }
  return bgLoading;
}

/** 与 CraftModule 的 qtyCss 同口径（y 从底部起） */
function qtyCss(e: { x: number; b: number; w: number; h: number }): string {
  return [
    'position:absolute',
    `left:${e.x * 100}%`,
    `bottom:${e.b * 100}%`,
    `width:${e.w * 100}%`,
    `height:${e.h * 100}%`,
  ].join(';');
}

const BTN_BASE = [
  'min-width:104px', 'padding:7px 12px', 'border-radius:6px',
  'font:bold 13px "Microsoft YaHei",sans-serif', 'cursor:pointer',
  'transition:background 0.12s,color 0.12s',
].join(';');
const BTN_IDLE = 'background:rgba(18,28,52,0.82);color:#9fc4ff;border:1px solid #4466aa;';
const BTN_ACTIVE = 'background:#d9a441;color:#2a1a00;border:1px solid #f5d488;';

export interface ItemActionOverlayDeps {
  session: GameSession;
  itemManager: ItemManager;
  /** 统一图标出口（与背包网格/加工台同路径） */
  createIconElement: (itemId: string) => HTMLElement;
  /** 源层可转移到的目标层（沿用背包 transferTargets 配置） */
  transferTargetsFor: (layer: LayerKey) => TargetLayer[];
  /** 操作成功后的数据变更通知（宿主刷新背包） */
  onChanged: () => void;
  /** 轻提示 */
  onToast?: (text: string, ok: boolean) => void;
}

export class ItemActionOverlay {
  private overlay: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  private qtyLabel: HTMLDivElement | null = null;
  private stockEl: HTMLDivElement | null = null;
  private actionButtons: HTMLButtonElement[] = [];

  private itemId = '';
  private stackSize = 1;
  /** 固定库存显示（已装备物品 = 1）；null = 实时统计所有背包层 */
  private stockOverride: number | null = null;
  private actions: ActionDef[] = [];
  private selected = 0;
  private qtyValue = 1;

  constructor(private deps: ItemActionOverlayDeps) {}

  get isOpen(): boolean {
    return !!this.overlay;
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.panel = null;
    this.qtyLabel = null;
    this.stockEl = null;
    this.stockOverride = null;
    this.actionButtons = [];
  }

  /** 背包格子里的物品：使用/装备 + 转移（按层配置） */
  openItem(layer: LayerKey, row: number, col: number): void {
    const grid = this.deps.session.inventories[layer];
    const slot = Array.isArray(grid) ? grid[row]?.[col] : null;
    if (!slot) return;

    const im = this.deps.itemManager;
    const itemId = slot.itemId;
    const arch = im.getArchetype(itemId);
    const actions: ActionDef[] = [];

    // ★ 能使用/装备的物品优先进入「使用/装备」模块（放在动作列表第一位 = 默认选中）
    const canEquip = im.isEquip(itemId) || im.isDeployable(itemId);
    const canUse = im.canUse(itemId);
    if (canEquip || canUse) {
      actions.push({
        key: 'use',
        label: canEquip ? '装备' : '使用',
        maxCount: canEquip ? 1 : slot.stackSize,
        run: (count) => {
          // 装备/可部署：放入出击槽（与拖入空槽同一条管线），不消耗
          if (canEquip) return im.equipToFirstFreeSlot(layer, row, col);
          // 消耗品：按数量逐个使用，失败即停
          let done = 0;
          let last: UseItemResult | null = null;
          for (let i = 0; i < count; i++) {
            last = im.useItem(layer, row, col);
            if (!last.success) break;
            done++;
          }
          if (done === 0) return last ?? { success: false, message: '无法使用' };
          return { success: true, message: done > 1 ? `已使用 ${done} 个` : (last?.message ?? '已使用') };
        },
      });
    }

    for (const target of this.deps.transferTargetsFor(layer)) {
      if (target.key === layer) continue;
      const short = LAYER_SHORT[target.key] ?? target.label;
      actions.push({
        key: `transfer-${target.key}`,
        label: `转移到${short}`,
        maxCount: slot.stackSize,
        run: (count) => (
          im.moveItem(layer, target.key, itemId, count)
            ? { success: true, message: `已转移到${short}` }
            : { success: false, message: '转移失败' }
        ),
      });
    }

    if (actions.length === 0) return;
    this.show({
      itemId,
      stackSize: slot.stackSize,
      title: arch?.name ?? itemId,
      description: arch?.description ?? '',
      actions,
    });
  }

  /** 出击槽内已装备物品：可卸载回背包 */
  openEquipped(slotIndex: number): void {
    const im = this.deps.itemManager;
    const itemId = im.getSlots()[slotIndex];
    if (!itemId) return;
    const arch = im.getArchetype(itemId);
    this.show({
      itemId,
      stackSize: 1,
      title: arch?.name ?? itemId,
      description: arch?.description ?? '',
      stockOverride: 1,
      actions: [{
        key: 'unequip',
        label: '卸载',
        maxCount: 1,
        run: () => (
          im.removeFromSlot(slotIndex)
            ? { success: true, message: '已卸载回背包' }
            : { success: false, message: '背包已满，无法卸载' }
        ),
      }],
    });
  }

  // ============================================================
  // 面板
  // ============================================================

  private show(state: {
    itemId: string;
    stackSize: number;
    title: string;
    description: string;
    actions: ActionDef[];
    stockOverride?: number;
  }): void {
    this.close();
    this.itemId = state.itemId;
    this.stackSize = state.stackSize;
    this.stockOverride = state.stockOverride ?? null;
    this.actions = state.actions;
    this.selected = 0;
    this.qtyValue = 1;

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:450',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.55)',
      'font-family:"Microsoft YaHei",sans-serif',
    ].join(';');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.cancel();
    });

    const aspect = bgCache?.aspect ?? 955 / 512;
    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:relative',
      'width:min(693px, 92vw)',
      `aspect-ratio:${aspect}`,
      bgCache?.url
        ? `background-image:url(${bgCache.url});background-size:100% 100%;background-repeat:no-repeat;`
        : 'background:linear-gradient(135deg,rgba(20,20,40,0.98),rgba(40,40,70,0.98));border-radius:14px;',
      'padding:0', 'box-shadow:0 12px 48px rgba(0,0,0,0.55)',
      'color:#eee',
    ].join(';');

    // ---- 透明热区（与加工模块数量窗同一套坐标）----
    const hit = (rect: { x: number; b: number; w: number; h: number }, onClick: () => void): HTMLDivElement => {
      const el = document.createElement('div');
      el.style.cssText = `${qtyCss(rect)};cursor:pointer;border-radius:6px;transition:background 0.12s;`;
      el.addEventListener('click', onClick);
      el.addEventListener('pointerenter', () => { el.style.background = 'rgba(255,255,255,0.10)'; });
      el.addEventListener('pointerleave', () => { el.style.background = 'transparent'; });
      return el;
    };

    this.qtyLabel = document.createElement('div');
    this.qtyLabel.style.cssText = `${qtyCss(QTY_UI.value)};display:flex;align-items:center;justify-content:center;`
      + 'font-size:clamp(14px,1.87vw,21px);font-weight:bold;color:#222;pointer-events:none;';

    this.stockEl = document.createElement('div');
    this.stockEl.style.cssText = `${qtyCss(QTY_UI.stock)};display:flex;align-items:center;justify-content:center;`
      + 'font-size:clamp(15px,1.45vw,19px);font-weight:bold;color:#333;pointer-events:none;';

    // ---- 中部内容区：物品图标 + 名称/简介 + 动作选择按钮 ----
    const content = document.createElement('div');
    content.style.cssText = `${qtyCss(QTY_UI.content)};display:flex;flex-direction:row;`
      + 'align-items:center;justify-content:center;gap:14px;overflow:hidden;pointer-events:none;';

    const iconWrap = document.createElement('div');
    iconWrap.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;justify-content:center;';
    const icon = this.deps.createIconElement(state.itemId);
    icon.style.cssText = 'width:128px;height:128px;object-fit:contain;';
    iconWrap.appendChild(icon);

    const textCol = document.createElement('div');
    textCol.className = 'item-action-scroll';
    textCol.style.cssText = 'flex:1 1 auto;min-width:0;max-height:100%;overflow-y:auto;overflow-x:hidden;'
      + 'display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:auto;';

    const title = document.createElement('div');
    title.textContent = state.title;
    title.style.cssText = 'font-size:clamp(17px,1.87vw,23px);font-weight:bold;color:#fff;'
      + 'text-shadow:0 1px 3px rgba(0,0,0,0.9);white-space:nowrap;overflow:hidden;'
      + 'text-overflow:ellipsis;max-width:100%;text-align:center;';

    textCol.appendChild(title);
    if (state.description) {
      const desc = document.createElement('div');
      desc.textContent = state.description;
      desc.title = state.description;
      desc.style.cssText = 'display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;'
        + 'overflow:hidden;font-size:clamp(13px,1.15vw,16px);line-height:1.35;color:#b9c2d0;'
        + 'text-align:center;white-space:pre-wrap;max-width:100%;';
      textCol.appendChild(desc);
    }

    const buttonsCol = document.createElement('div');
    buttonsCol.style.cssText = 'flex:0 0 auto;display:flex;flex-direction:column;gap:8px;pointer-events:auto;';
    this.actionButtons = state.actions.map((action, index) => {
      const btn = document.createElement('button');
      btn.textContent = action.label;
      btn.style.cssText = `${BTN_BASE};${BTN_IDLE}`;
      btn.addEventListener('click', () => {
        this.selected = index;
        this.qtyValue = 1;
        this.renderState();
      });
      buttonsCol.appendChild(btn);
      return btn;
    });

    content.append(iconWrap, textCol, buttonsCol);

    panel.append(
      hit(QTY_UI.minBtn, () => this.setExtreme('min')),
      hit(QTY_UI.minus, () => this.stepQuantity(-1)),
      hit(QTY_UI.plus, () => this.stepQuantity(1)),
      hit(QTY_UI.maxBtn, () => this.setExtreme('max')),
      hit(QTY_UI.cancel, () => this.cancel()),
      hit(QTY_UI.confirm, () => this.confirm()),
      this.qtyLabel, this.stockEl, content,
    );
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.overlay = overlay;
    this.panel = panel;

    // 背景素材异步到位后再铺（尺寸用默认宽高比先撑开，避免闪烁）
    void ensureQtyBg().then(() => {
      if (!this.panel || !bgCache) return;
      this.panel.style.backgroundImage = `url(${bgCache.url})`;
      this.panel.style.backgroundSize = '100% 100%';
      this.panel.style.backgroundRepeat = 'no-repeat';
      this.panel.style.aspectRatio = String(bgCache.aspect);
    });

    this.renderState();
  }

  private currentAction(): ActionDef | null {
    return this.actions[this.selected] ?? null;
  }

  private maxQty(): number {
    return Math.max(1, Math.min(this.stackSize, this.currentAction()?.maxCount ?? 1));
  }

  /** 重绘数量/库存/按钮选中态 */
  private renderState(): void {
    const action = this.currentAction();
    if (!action) return;
    this.qtyValue = Math.max(1, Math.min(this.maxQty(), this.qtyValue));
    if (this.qtyLabel) this.qtyLabel.textContent = String(this.qtyValue);
    if (this.stockEl) {
      this.stockEl.textContent = String(
        this.stockOverride ?? this.deps.itemManager.countTotal(this.itemId),
      );
    }
    this.actionButtons.forEach((btn, i) => {
      btn.style.cssText = `${BTN_BASE};${i === this.selected ? BTN_ACTIVE : BTN_IDLE}`;
    });
  }

  private stepQuantity(delta: number): void {
    this.qtyValue = Math.max(1, Math.min(this.maxQty(), this.qtyValue + delta));
    this.renderState();
  }

  private setExtreme(kind: 'min' | 'max'): void {
    this.qtyValue = kind === 'max' ? this.maxQty() : 1;
    this.renderState();
  }

  private confirm(): void {
    const action = this.currentAction();
    if (!action) return;
    const result = action.run(this.qtyValue);
    if (!result.success) {
      // 失败留在窗内（如装备栏已满 / 背包无空位），只提示不关闭
      this.deps.onToast?.(result.message ?? '操作失败', false);
      return;
    }
    this.deps.onToast?.(result.message ?? '完成', true);
    this.close();
    this.deps.onChanged();
  }

  /** 取消 / 点遮罩：关闭并刷新一次背包（补上停留期间新拾取的物品） */
  private cancel(): void {
    this.close();
    this.deps.onChanged();
  }
}
