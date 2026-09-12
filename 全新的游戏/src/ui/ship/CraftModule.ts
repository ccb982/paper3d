// ============================================================
// CraftModule.ts —— 加工模块（配方的基本单位）
// ============================================================
// 一个加工模块 = 一个配方。模块内部掌控自身全部 UI：
//   · 底图 + 输出图标/名字 + 材料图标（经共享 ItemIconRegistry
//     —— 与背包同一条绘制路径）
//   · 材料数量实时查询 ItemManager.countTotal（所有背包层总数）
//   · 点击 → 弹出由本模块自管的数量确认窗（挂到宿主 root）
// CraftingOverlay 只负责给每个槽位装配一个模块。
// ============================================================

import type { CraftingManager, Recipe } from '../../systems/inventory/CraftingManager';
import type { ItemManager } from '../../systems/inventory/ItemManager';
import type { ItemIconRegistry } from '../../services/item/ItemIconRegistry';

// ------------------------------------------------------------
// 加工台页面布局常量（drawing-export-2026-09-09，页面坐标、y 底部起）
// ------------------------------------------------------------
const SCREEN = { w: 0.99923, h: 0.84335, y0: 0.0773 };
/** ★ 六个加工模块区（横排阅读序：上排左→右、中排左→右、下排左→右；
 *  配方按此顺序填充——不是左列竖着排） */
export const MODULE_SLOTS = [
  { x: 0.3568, y: 0.6213, w: 0.3033, h: 0.1977 }, // 上排-左
  { x: 0.6643, y: 0.6213, w: 0.3050, h: 0.1992 }, // 上排-右
  { x: 0.3568, y: 0.4116, w: 0.3042, h: 0.1947 }, // 中排-左
  { x: 0.6651, y: 0.4101, w: 0.3033, h: 0.1977 }, // 中排-右
  { x: 0.3568, y: 0.1989, w: 0.3042, h: 0.1977 }, // 下排-左
  { x: 0.6651, y: 0.1989, w: 0.3050, h: 0.1962 }, // 下排-右
];

/** 槽位本身：页面坐标 → 屏幕 CSS（left/top/w/h） */
export function slotCss(s: { x: number; y: number; w: number; h: number }): string {
  return [
    `left:${(s.x / SCREEN.w) * 100}%`,
    `top:${(1 - (s.y + s.h - SCREEN.y0) / SCREEN.h) * 100}%`,
    `width:${(s.w / SCREEN.w) * 100}%`,
    `height:${(s.h / SCREEN.h) * 100}%`,
  ].join(';');
}

/** ★ 加工模块内部模板（真实标注，页面坐标、y 底部起），元素相对槽位锚定 */
const MODULE_TEMPLATE = {
  outIcon: { x: 0.358, b: 0.660, w: 0.116, h: 0.124 }, // 被合成物品（输出图标）
  outName: { x: 0.383, b: 0.629, w: 0.065, h: 0.025 }, // 被合成物品名字
  mats: [
    { icon: { x: 0.470, b: 0.679, w: 0.057, h: 0.071 }, cnt: { x: 0.487, b: 0.629, w: 0.026, h: 0.025 } }, // 原材料1 + 数量
    { icon: { x: 0.527, b: 0.676, w: 0.067, h: 0.076 }, cnt: { x: 0.548, b: 0.629, w: 0.025, h: 0.025 } }, // 原材料2 + 数量
    { icon: { x: 0.595, b: 0.682, w: 0.058, h: 0.063 }, cnt: { x: 0.606, b: 0.628, w: 0.032, h: 0.027 } }, // 原材料3 + 数量
  ],
};
/** ★ 模板是全局页面坐标；统一以参考槽位 MODULE_SLOTS[0] 换算 → 所有槽位复制同一套布局 */
const REF_SLOT = MODULE_SLOTS[0];
function pageToCss(_s: { x: number; y: number; w: number; h: number }, e: { x: number; b: number; w: number; h: number }): string {
  return [
    `left:${((e.x - REF_SLOT.x) / REF_SLOT.w) * 100}%`,
    `bottom:${((e.b - REF_SLOT.y) / REF_SLOT.h) * 100}%`,
    `width:${(e.w / REF_SLOT.w) * 100}%`,
    `height:${(e.h / REF_SLOT.h) * 100}%`,
  ].join(';');
}

export interface CraftModuleDeps {
  craftingManager: CraftingManager;
  itemManager: ItemManager;
  iconRegistry: ItemIconRegistry;
  /** 加工模块底图 dataURL（Overlay 加载后注入） */
  moduleBgDataURL: string;
  /** 数量窗挂载点（宿主 root） */
  host: HTMLElement;
  /** 点击模块时请求打开（宿主用它先关掉其它模块的窗，保证单开） */
  onRequestOpen: (m: CraftModule) => void;
}

export class CraftModule {
  private btn: HTMLButtonElement | null = null;
  /** 材料拥有/需求 实时显示元素 */
  private materialEls: { input: Recipe['inputs'][number]; haveEl: HTMLElement; need: number }[] = [];
  /** 本模块自管的数量确认窗 */
  private qtyPanel: HTMLDivElement | null = null;
  private qtyValue = 1;

  constructor(
    private recipe: Recipe,
    private deps: CraftModuleDeps,
  ) {}

  get id(): string {
    return this.recipe.id;
  }

  /** 是否打开了数量窗 */
  isOpen(): boolean {
    return !!this.qtyPanel && this.qtyPanel.style.display !== 'none';
  }

  // ============================================================
  // 模块本体 UI
  // ============================================================

  mount(btn: HTMLButtonElement): void {
    this.btn = btn;
    btn.replaceChildren();
    btn.style.backgroundImage = this.deps.moduleBgDataURL ? `url(${this.deps.moduleBgDataURL})` : '';
    btn.style.backgroundSize = 'cover';
    btn.style.backgroundPosition = 'center';
    btn.style.pointerEvents = 'auto';

    // ---- 输出（被合成物品图标 + 名字） ----
    const out = document.createElement('div');
    out.style.cssText = [
      'position:absolute', pageToCss(REF_SLOT, MODULE_TEMPLATE.outIcon),
      'display:flex', 'align-items:center', 'justify-content:center',
      'pointer-events:none',
    ].join(';');
    out.appendChild(this.makeIconEl(this.recipe.output.itemId, 'width:110%;height:110%;'));
    btn.appendChild(out);

    const name = document.createElement('div');
    name.textContent = this.recipe.name;
    name.style.cssText = [
      'position:absolute', pageToCss(REF_SLOT, MODULE_TEMPLATE.outName),
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-size:1vw', 'font-weight:bold', 'white-space:nowrap', 'overflow:hidden',
      'color:#fff', 'text-shadow:1px 1px 2px rgba(0,0,0,0.9)',
      'pointer-events:none',
    ].join(';');
    btn.appendChild(name);

    // ---- 原材料图标 + 拥有/需求（配方不足 3 种则留空） ----
    this.materialEls = [];
    for (let i = 0; i < MODULE_TEMPLATE.mats.length; i++) {
      const input = this.recipe.inputs[i];
      if (!input) continue;
      const t = MODULE_TEMPLATE.mats[i];

      const iconEl = document.createElement('div');
      iconEl.style.cssText = [
        'position:absolute', pageToCss(REF_SLOT, t.icon),
        'display:flex', 'align-items:center', 'justify-content:center',
        'transform:translateY(-15%)',
        'pointer-events:none',
      ].join(';');
      iconEl.appendChild(this.makeIconEl(input.itemId, 'width:120%;height:120%;'));
      btn.appendChild(iconEl);

      const haveEl = document.createElement('div');
      haveEl.style.cssText = [
        'position:absolute', pageToCss(REF_SLOT, t.cnt),
        'display:flex', 'align-items:center', 'justify-content:center',
        'font-size:0.85vw', 'font-weight:bold',
        'text-shadow:1px 1px 2px rgba(0,0,0,0.9)',
        'pointer-events:none',
      ].join(';');
      btn.appendChild(haveEl);
      this.materialEls.push({ input, haveEl, need: input.count });
    }

    btn.onclick = () => this.deps.onRequestOpen(this);
    this.refresh();
  }

  /** ★ 图标统一出口（与背包同路径）：静态 img(dataURL) / 无人机活动画布 */
  private makeIconEl(itemId: string, sizeCss: string): HTMLCanvasElement | HTMLImageElement {
    const el = this.deps.iconRegistry.createIconElement(itemId);
    el.style.cssText = `${sizeCss};object-fit:contain;`;
    return el;
  }

  /** 重查各材料拥有量（跨所有背包层）并标色 */
  refresh(): void {
    for (const m of this.materialEls) {
      const have = this.deps.itemManager.countTotal(m.input.itemId);
      m.haveEl.textContent = `${have}/${m.need}`;
      m.haveEl.style.color = have >= m.need ? '#fff' : '#f77';
    }
  }

  // ============================================================
  // 数量确认窗（模块自管）
  // ============================================================

  /** 打开数量确认窗（宿主已保证单开） */
  openQuantity(): void {
    if (!this.qtyPanel) this.qtyPanel = this.buildQuantityPanel();
    const max = this.maxCraftable();
    this.qtyValue = max > 0 ? 1 : 0;
    this.renderQuantityPanel();
    this.qtyPanel.style.display = 'flex';
  }

  closeQuantity(): void {
    if (this.qtyPanel) this.qtyPanel.style.display = 'none';
  }

  private maxCraftable(): number {
    let max = Infinity;
    for (const input of this.recipe.inputs) {
      const have = this.deps.itemManager.countTotal(input.itemId);
      max = Math.min(max, Math.floor(have / input.count));
    }
    return Math.max(0, max);
  }

  private stepQuantity(delta: number): void {
    const max = this.maxCraftable();
    this.qtyValue = Math.max(1, Math.min(max, this.qtyValue + delta));
    this.renderQuantityPanel();
  }

  private buildQuantityPanel(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:300',
      'display:none', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.55)',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:linear-gradient(135deg,rgba(20,20,40,0.98),rgba(40,40,70,0.98))',
      'border:2px solid #4466aa', 'border-radius:16px',
      'padding:20px 24px', 'max-width:420px', 'width:90%',
      'color:#eee', 'box-shadow:0 0 40px rgba(68,136,255,0.25)',
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'font-size:20px;font-weight:bold;color:#8af;margin-bottom:14px;text-align:center;';
    title.textContent = `${this.recipe.name} ×${this.recipe.output.count}`;

    const materials = document.createElement('div');
    materials.style.cssText = [
      'display:flex', 'flex-direction:column', 'gap:8px',
      'margin-bottom:16px', 'font-size:14px',
    ].join(';');

    const qtyRow = document.createElement('div');
    qtyRow.style.cssText = [
      'display:flex', 'align-items:center', 'justify-content:center',
      'gap:14px', 'margin-bottom:18px',
    ].join(';');
    const minus = this.makeQtyBtn('−');
    minus.style.cssText += ';width:40px;height:40px;font-size:20px;padding:0;';
    const qtyLabel = document.createElement('span');
    qtyLabel.style.cssText = 'font-size:24px;font-weight:bold;min-width:48px;text-align:center;color:#fff;';
    const plus = this.makeQtyBtn('+');
    plus.style.cssText += ';width:40px;height:40px;font-size:20px;padding:0;';
    minus.addEventListener('click', () => this.stepQuantity(-1));
    plus.addEventListener('click', () => this.stepQuantity(1));
    qtyRow.append(minus, qtyLabel, plus);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:center;gap:12px;';
    const confirmBtn = this.makeQtyBtn('确认加工');
    confirmBtn.style.background = '#4488ff';
    confirmBtn.addEventListener('click', () => this.confirmCraft());
    const backBtn = this.makeQtyBtn('返回');
    backBtn.style.background = '#4466aa';
    backBtn.addEventListener('click', () => this.closeQuantity());
    btnRow.append(confirmBtn, backBtn);

    panel.append(title, materials, qtyRow, btnRow);
    overlay.appendChild(panel);
    this.deps.host.appendChild(overlay);
    (overlay as HTMLDivElement & { _materials: HTMLDivElement; _qtyLabel: HTMLSpanElement })._materials = materials;
    (overlay as HTMLDivElement & { _qtyLabel: HTMLSpanElement })._qtyLabel = qtyLabel;
    return overlay;
  }

  private makeQtyBtn(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'padding:10px 22px;font-size:15px;cursor:pointer;border-radius:8px;border:none;font-weight:bold;transition:opacity 0.2s;color:#fff;';
    return btn;
  }

  private renderQuantityPanel(): void {
    if (!this.qtyPanel) return;
    const overlay = this.qtyPanel as HTMLDivElement & { _materials: HTMLDivElement; _qtyLabel: HTMLSpanElement };
    const matEl = overlay._materials;
    matEl.innerHTML = '';
    for (const input of this.recipe.inputs) {
      const have = this.deps.itemManager.countTotal(input.itemId);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;';
      const iconEl = this.makeIconEl(input.itemId, 'width:32px;height:32px;');
      row.appendChild(iconEl);
      const arch = this.deps.itemManager.getArchetype(input.itemId);
      const needTotal = input.count * this.qtyValue;
      const ok = have >= needTotal;
      row.innerHTML += `<span style="color:${ok ? '#eee' : '#f77'};">${arch?.name ?? input.itemId}  ${have}/${needTotal}</span>`;
      matEl.appendChild(row);
    }
    overlay._qtyLabel.textContent = String(this.qtyValue);
  }

  private confirmCraft(): void {
    if (this.qtyValue <= 0) return;
    let done = 0;
    for (let i = 0; i < this.qtyValue; i++) {
      if (this.deps.craftingManager.craft(this.recipe.id, 'player', 'player')) done++;
      else break;
    }
    if (done > 0) {
      this.renderQuantityPanel();
      this.refresh();
      if (done < this.qtyValue) {
        window.alert(`材料不足，已加工 ${done} 个`);
      }
    } else {
      window.alert('材料不足');
    }
  }

  // ============================================================
  // 生命周期
  // ============================================================

  dispose(): void {
    this.closeQuantity();
    if (this.qtyPanel) {
      if (this.qtyPanel.parentNode) this.qtyPanel.parentNode.removeChild(this.qtyPanel);
      this.qtyPanel = null;
    }
    if (this.btn) {
      this.btn.onclick = null;
      this.btn.replaceChildren();
      this.btn = null;
      this.materialEls = [];
    }
  }
}