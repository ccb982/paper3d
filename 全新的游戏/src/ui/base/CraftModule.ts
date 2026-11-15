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

/**
 * ★★ 数量窗布局（2026-11-15）：坐标 = 「物品使用页面 ui」素材（955×512）的 0~1 归一化，
 *   **y 从底部起**（与标注 json / pageToCss 同口径）。素材背景本身已经画好了
 *   「最少 / − / 数值框 / + / 最多」和底部「取消 / 确认」⇒ 这里只铺**透明热区** + 文字。
 */
interface QtyRect { x: number; b: number; w: number; h: number }
export const QTY_UI = {
  cancel: { x: 0.002, b: 0.001, w: 0.501, h: 0.1215 },
  confirm: { x: 0.5053, b: 0.001, w: 0.4947, h: 0.1202 },
  minBtn: { x: 0.2863, b: 0.2953, w: 0.0899, h: 0.1124 },
  minus: { x: 0.3754, b: 0.2953, w: 0.0778, h: 0.1124 },
  value: { x: 0.4524, b: 0.2953, w: 0.0948, h: 0.1124 },
  plus: { x: 0.5456, b: 0.2953, w: 0.0747, h: 0.1124 },
  maxBtn: { x: 0.6203, b: 0.2941, w: 0.0906, h: 0.1135 },
  /** 右上「库存」浅灰框（标注 json 的「这个物品目前的已有数量」） */
  stock: { x: 0.827, b: 0.876, w: 0.137, h: 0.083 },
  /** ★ 中部内容区 —— 2026-11-15 终版（用户澄清「我让你改模块的位置」）：
   *  内容区铺满面板中部空白，**成品图标贴面板左缘、文字块贴面板右缘**
   *  （内部：图标在左、文字块在右，文字块内文字居中）。
   *  ★ 再改（用户「标题上移 + 内容一次显示4行，不够可以滚动」）：整块上移一点。
   *  ★ 高度定到 0.42（顶部 0.87，正好贴住右上库存框下沿 0.876 而不重叠）——
   *    这样「标题 + 4 行简介 + 材料行」= 约 142px 能**完整显示**，第 4 行不会被裁；
   *    真超长时仍可在文字块内滚动兜底。 */
  content: { x: 0.02, b: 0.45, w: 0.96, h: 0.42 },
} as const;
function qtyCss(e: QtyRect): string {
  return [
    'position:absolute',
    `left:${e.x * 100}%`,
    `bottom:${e.b * 100}%`,
    `width:${e.w * 100}%`,
    `height:${e.h * 100}%`,
  ].join(';');
}

export interface CraftModuleDeps {
  craftingManager: CraftingManager;
  itemManager: ItemManager;
  iconRegistry: ItemIconRegistry;
  /** 加工模块底图 dataURL（Overlay 加载后注入） */
  moduleBgDataURL: string;
  /** ★ 数量窗背景 dataURL（「物品使用页面 ui」整张面板；空 = 回落纯色） */
  qtyBgDataURL?: string;
  /** ★ 数量窗背景宽高比（955/512） */
  qtyBgAspect?: number;
  /** 数量窗挂载点（宿主 root） */
  host: HTMLElement;
  /** 点击模块时请求打开（宿主用它先关掉其它模块的窗，保证单开） */
  onRequestOpen: (m: CraftModule) => void;
  /** ★ 本模块完成一次加工后通知宿主（宿主刷新其它模块的材料数量） */
  onCrafted?: (m: CraftModule) => void;
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

  /** ★ 外部数据变化（如其它模块加工消耗了材料）后：重刷数量窗并钳制数量上限 */
  refreshQuantity(): void {
    if (!this.qtyPanel || this.qtyPanel.style.display === 'none') return;
    const max = this.maxCraftable();
    this.qtyValue = Math.max(0, Math.min(this.qtyValue, max));
    this.renderQuantityPanel();
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

  /** ★ 一键端点（「最少」/「最大」按钮）：最少 = 1 次（材料不足则 0）、最大 = 当前材料可加工上限。
   *  与 `stepQuantity` 共用 `maxCraftable()` 口径，避免两处算法漂移。 */
  private setQuantityExtreme(kind: 'min' | 'max'): void {
    const max = this.maxCraftable();
    this.qtyValue = kind === 'max' ? max : (max > 0 ? 1 : 0);
    this.renderQuantityPanel();
  }

  private buildQuantityPanel(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:300',
      'display:none', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.55)',
    ].join(';');

    // ★★ 面板 = 「物品使用页面 ui」整张素材（2026-11-15 用户定调）：
    //   背景自带 最少 / − / 数值框 / + / 最多 与底部 取消 / 确认 的按钮图形
    //   ⇒ DOM 只在对应位置铺**透明热区**和文字，不再另画按钮（否则两层叠在一起）。
    const aspect = (this.deps.qtyBgAspect ?? 0) > 0 ? this.deps.qtyBgAspect! : 955 / 512;
    const panel = document.createElement('div');
    panel.style.cssText = [
      'position:relative',
      // ★ 2026-11-15 用户「这个 ui 不需要这么大，缩小到 1/3」：上限 1160px → 390px
      //   （高 = 390/1.865 ≈ 209px）；字号同步按 vw 收小（见下），小屏再由 clamp 兜底。
      `width:min(693px, 92vw)`,
      `aspect-ratio:${aspect}`,
      this.deps.qtyBgDataURL
        ? `background-image:url(${this.deps.qtyBgDataURL});background-size:100% 100%;background-repeat:no-repeat;`
        : 'background:linear-gradient(135deg,rgba(20,20,40,0.98),rgba(40,40,70,0.98));border-radius:14px;',
      'padding:0', 'box-shadow:0 12px 48px rgba(0,0,0,0.55)',
      'color:#eee', 'font-family:inherit',
    ].join(';');

    // ---- 透明热区（落在素材按钮图形上；hover 轻微提亮做反馈）----
    const hit = (rect: QtyRect, onClick: () => void): HTMLDivElement => {
      const el = document.createElement('div');
      el.style.cssText = `${qtyCss(rect)};cursor:pointer;border-radius:6px;transition:background 0.12s;`;
      el.addEventListener('click', onClick);
      el.addEventListener('pointerenter', () => { el.style.background = 'rgba(255,255,255,0.10)'; });
      el.addEventListener('pointerleave', () => { el.style.background = 'transparent'; });
      return el;
    };

    // ---- 数量数字（素材的白色数值框内，深色字）----
    const qtyLabel = document.createElement('div');
    qtyLabel.style.cssText = `${qtyCss(QTY_UI.value)};display:flex;align-items:center;justify-content:center;`
      + 'font-size:clamp(14px,1.87vw,21px);font-weight:bold;color:#222;pointer-events:none;';

    // ---- 右上「库存」= 该成品当前已有数量 ----
    const stockEl = document.createElement('div');
    stockEl.style.cssText = `${qtyCss(QTY_UI.stock)};display:flex;align-items:center;justify-content:center;`
      + 'font-size:clamp(15px,1.45vw,19px);font-weight:bold;color:#333;pointer-events:none;';

    // ---- 中部内容区（2026-11-15 终版，用户澄清「我让你改模块的位置」）----
    //   ★ 我之前一直调的是「图标 vs 文字在内容区**内部**的相对关系」，方向错了：
    //     用户要的是这两个元素**在面板里**的位置 —— 成品图标贴**面板左缘**、
    //     文字块贴**面板右缘**（块内文字仍居中）。
    //   实现：内容区铺满面板中部空白（QTY_UI.content: x 0.02 / w 0.96）
    //     + `justify-content:center` ⇒ 整组居中；再 `translateX(-14px)` 整体左移一点。
    // ★ 隐藏滚动条（文字块可滚但不显示条）——全局注入一次
    if (!document.getElementById('craft-qty-scroll-style')) {
      const st = document.createElement('style');
      st.id = 'craft-qty-scroll-style';
      st.textContent = '.craft-qty-scroll::-webkit-scrollbar{display:none;width:0;height:0;}';
      document.head.appendChild(st);
    }

    const content = document.createElement('div');
    content.id = 'craft-qty-content';
    content.style.cssText = `${qtyCss(QTY_UI.content)};display:flex;flex-direction:row;`
      + 'align-items:center;justify-content:center;gap:12px;overflow:hidden;pointer-events:none;'
      + 'transform:translateX(-14px);';

    const outIcon = document.createElement('div');
    outIcon.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;justify-content:center;';
    outIcon.appendChild(this.makeIconEl(this.recipe.output.itemId, 'width:128px;height:128px;'));

    const textCol = document.createElement('div');
    textCol.className = 'craft-qty-scroll';
    // ★ 常规布局（用户 2026-11-15 定调：「图标和文字都尽可能居中，就是常规布局」）：
    //   图标在左、文字块在右，**整组在内容区水平居中** ⇒ 左右留白自然等距。
    //   文字块只保留宽度上限（简介过长时换行，不至于把图标挤到边上）。
    //   ★ 简介/材料超长时**文字块内部可滚动**（鼠标悬停其中滚轮下拉）。
    textCol.style.cssText = 'flex:0 1 auto;max-width:52%;min-width:0;display:flex;flex-direction:column;'
      + 'gap:4px;align-items:center;max-height:100%;overflow-y:auto;overflow-x:hidden;pointer-events:auto;';

    const title = document.createElement('div');
    title.style.cssText = 'font-size:clamp(17px,1.87vw,23px);font-weight:bold;color:#fff;'
      + 'text-shadow:0 1px 3px rgba(0,0,0,0.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;'
      + 'max-width:100%;text-align:center;';
    // ★ 标题只放配方名（2026-11-15 用户定调：不再带 "×产出数量"）
    title.textContent = this.recipe.name;

    const descText = this.deps.itemManager.getArchetype(this.recipe.output.itemId)?.description ?? '';
    const descEl = document.createElement('div');
    descEl.textContent = descText;
    descEl.title = descText;
    descEl.style.cssText = 'display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;'
      + 'overflow:hidden;font-size:clamp(13px,1.15vw,16px);line-height:1.35;color:#b9c2d0;'
      + 'text-align:center;white-space:pre-wrap;max-width:100%;';

    const materials = document.createElement('div');
    materials.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px 14px;'
      + 'justify-content:center;align-items:center;margin-top:1px;max-width:100%;';

    textCol.append(title, ...(descText ? [descEl] : []), materials);
    content.append(outIcon, textCol);

    panel.append(
      hit(QTY_UI.minBtn, () => this.setQuantityExtreme('min')),
      hit(QTY_UI.minus, () => this.stepQuantity(-1)),
      hit(QTY_UI.plus, () => this.stepQuantity(1)),
      hit(QTY_UI.maxBtn, () => this.setQuantityExtreme('max')),
      hit(QTY_UI.cancel, () => this.closeQuantity()),
      hit(QTY_UI.confirm, () => this.confirmCraft()),
      qtyLabel, stockEl, content,
    );
    overlay.appendChild(panel);
    this.deps.host.appendChild(overlay);
    const hooked = overlay as HTMLDivElement & {
      _materials: HTMLDivElement; _qtyLabel: HTMLDivElement; _stock: HTMLDivElement;
    };
    hooked._materials = materials;
    hooked._qtyLabel = qtyLabel;
    hooked._stock = stockEl;
    return overlay;
  }

  private renderQuantityPanel(): void {
    if (!this.qtyPanel) return;
    const overlay = this.qtyPanel as HTMLDivElement & {
      _materials: HTMLDivElement; _qtyLabel: HTMLDivElement; _stock: HTMLDivElement;
    };
    const matEl = overlay._materials;
    matEl.innerHTML = '';
    for (const input of this.recipe.inputs) {
      const have = this.deps.itemManager.countTotal(input.itemId);
      // ★ 需求显示**单份配方需求**（input.count），不是 ×当前数量 ——
      //   否则数量为 0 时会显示成 "异铁 1/0"（需求 0，没有意义）。
      //   红/白仍按「够不够做当前这个数量」判定（needTotal = 单份 × 当前数量）。
      const needPer = input.count;
      const needTotal = needPer * this.qtyValue;
      const ok = this.qtyValue > 0 && have >= needTotal;
      const chip = document.createElement('div');
      chip.style.cssText = 'display:flex;align-items:center;gap:5px;flex:0 0 auto;';
      // ★ 先 append 图标再用 appendChild 加文字（原实现用 innerHTML += 会把图标整个清掉）
      chip.appendChild(this.makeIconEl(input.itemId, 'width:28px;height:28px;flex:0 0 auto;'));
      const t = document.createElement('span');
      const arch = this.deps.itemManager.getArchetype(input.itemId);
      t.textContent = `${arch?.name ?? input.itemId} ${have}/${needPer}`;
      t.style.cssText = `font-size:clamp(13px,1.15vw,16px);color:${ok ? '#dfe6f0' : '#ff8a8a'};`
        + 'text-shadow:0 1px 2px rgba(0,0,0,0.9);white-space:nowrap;';
      chip.appendChild(t);
      matEl.appendChild(chip);
    }
    overlay._qtyLabel.textContent = String(this.qtyValue);
    overlay._stock.textContent = String(this.deps.itemManager.countTotal(this.recipe.output.itemId));
  }

  private confirmCraft(): void {
    if (this.qtyValue <= 0) return;
    const planned = this.qtyValue;
    let done = 0;
    for (let i = 0; i < planned; i++) {
      if (this.deps.craftingManager.craft(this.recipe.id, 'player', 'player')) done++;
      else break;
    }
    if (done > 0) {
      this.renderQuantityPanel();
      this.refresh();
      // ★ 通知宿主：其它加工模块的材料数量同步刷新（2026-09-14 修复）；
      //   注意用 planned 判定部分成功（通知后数量窗会把 qtyValue 钳到剩余上限）
      this.deps.onCrafted?.(this);
      if (done < planned) {
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