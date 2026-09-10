// ============================================================
// CraftingOverlay.ts —— 加工台页面覆盖层（仿 GachaOverlay）
// 全屏 WebGL 覆盖层，0-1 归一化坐标 + aspect 适配。
// 背景：加工台背景ui.ftx3.gz（固定不变）
// 模块层：DOM 滑动模块列表，每个配方一个"加工模块"按钮，
//         按序添加、可上下滚动（无滑块），模块上用 加工模块.ftx3.gz
//         做按钮底图 + 材料 DOM 叠加。
// 点击模块 → 数量选择 + 确认面板（纯 DOM），可返回。
// ============================================================

import * as THREE from 'three';
import type { GameSession } from '../../core/Session';
import type { ItemManager } from '../../systems/inventory/ItemManager';
import type { CraftingManager, Recipe } from '../../systems/inventory/CraftingManager';
import type { ItemIconRegistry } from '../../services/item/ItemIconRegistry';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import { compositeFrameToCanvas } from '../shared/ftxFrameToCanvas';

const HSL_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = vec2(uv.x, 1.0 - uv.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HSL_FRAG = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uBase;
  uniform sampler2D uResidual;
  uniform float uAlpha;

  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }

  void main() {
    vec4 base = texture2D(uBase, vUv);
    if (base.a < 0.5) discard;
    vec4 res = texture2D(uResidual, vUv);
    float dH = (res.r * 2.0 - 1.0) * 0.5;
    float dS = (res.g * 2.0 - 1.0) * 0.5;
    float dL = (res.b * 2.0 - 1.0) * 0.5;
    float h = fract(base.r + dH);
    float s = clamp(base.g + dS, 0.0, 1.0);
    float l = clamp(base.b + dL, 0.0, 1.0);
    gl_FragColor = vec4(hsl2rgb(vec3(h, s, l)), base.a * uAlpha);
  }
`;

// 加工台页面布局 JSON（2026-09-09 用户新画）：
//   layer_1 = 屏幕标注（宽 0.99923 / 高 0.84335，底部起 y0=0.0773）
//   layer_3 = 六个「加工模块」区域（x/y 归一化，y 从屏幕底部起）
// ➜ CSS 换算：left = x/0.99923；top = 1-(y+h-0.0773)/0.84335；w/h 同除以屏宽高。
// ★ 素材用 cover 渲染（裁剪不拉伸）→ 圆形图标保持圆，矩形照旧。
const SCREEN = { w: 0.99923, h: 0.84335, y0: 0.0773 };
/** 六个加工模块区（布局 JSON 阅读序：左列上→中→下，右列上→中→下） */
const MODULE_SLOTS = [
  { x: 0.3568, y: 0.6213, w: 0.3033, h: 0.1977 }, // 左-上
  { x: 0.3568, y: 0.4116, w: 0.3042, h: 0.1947 }, // 左-中
  { x: 0.3568, y: 0.1989, w: 0.3042, h: 0.1977 }, // 左-下
  { x: 0.6643, y: 0.6213, w: 0.3050, h: 0.1992 }, // 右-上
  { x: 0.6651, y: 0.4101, w: 0.3033, h: 0.1977 }, // 右-中
  { x: 0.6651, y: 0.1989, w: 0.3050, h: 0.1962 }, // 右-下
];
/** ★ 加工模块内部模板（drawing-export-2026-09-09：真实标注，页面坐标、y 底部起）：
 *   frame 底图铺满整个槽位（加工页面.json：加工模块大小=整个模块区）；元素相对槽位锚定 */
const MODULE_TEMPLATE = {
  outIcon: { x: 0.358, b: 0.660, w: 0.116, h: 0.124 }, // 被合成物品（输出图标）
  outName: { x: 0.383, b: 0.629, w: 0.065, h: 0.025 }, // 被合成物品名字
  mats: [
    { icon: { x: 0.470, b: 0.679, w: 0.057, h: 0.071 }, cnt: { x: 0.487, b: 0.629, w: 0.026, h: 0.025 } }, // 原材料1 + 数量
    { icon: { x: 0.527, b: 0.676, w: 0.067, h: 0.076 }, cnt: { x: 0.548, b: 0.629, w: 0.025, h: 0.025 } }, // 原材料2 + 数量
    { icon: { x: 0.595, b: 0.682, w: 0.058, h: 0.063 }, cnt: { x: 0.606, b: 0.628, w: 0.032, h: 0.027 } }, // 原材料3 + 数量
  ],
};
/** 槽位本身：页面坐标 → 屏幕 CSS（left/top/w/h） */
function slotCss(s: { x: number; y: number; w: number; h: number }): string {
  return [
    `left:${(s.x / SCREEN.w) * 100}%`,
    `top:${(1 - (s.y + s.h - SCREEN.y0) / SCREEN.h) * 100}%`,
    `width:${(s.w / SCREEN.w) * 100}%`,
    `height:${(s.h / SCREEN.h) * 100}%`,
  ].join(';');
}
/** ★ 槽位内模板坐标 → CSS（left/bottom 百分百）。
 *  ★ 模板是「全局页面坐标」，页面上六个模块排在屏幕不同高度；若按每个槽位自己原点
 *    （e.b - s.y）换算，只有顶排槽位（y 恰在模板区间内）有内容，中/下排槽位
 *    内容溢出 100% 被 overflow:hidden 裁掉 → 模块空白。改为统一以参考槽位
 *    MODULE_SLOTS[0]（视觉已验证正常的一张）为换算基准 → 所有槽位复制同一套布局。 */
const REF_SLOT = MODULE_SLOTS[0];
function pageToCss(_s: { x: number; y: number; w: number; h: number }, e: { x: number; b: number; w: number; h: number }): string {
  return [
    `left:${((e.x - REF_SLOT.x) / REF_SLOT.w) * 100}%`,
    `bottom:${((e.b - REF_SLOT.y) / REF_SLOT.h) * 100}%`,
    `width:${(e.w / REF_SLOT.w) * 100}%`,
    `height:${(e.h / REF_SLOT.h) * 100}%`,
  ].join(';');
}

export class CraftingOverlay {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private ready = false;
  private rafId: number | null = null;
  private station: 'ship' | 'portable' = 'ship';

  private bgMesh: THREE.Mesh | null = null;
  private moduleBgDataURL = '';

  /** 六个加工模块槽位（布局 JSON 定位） */
  private moduleSlots: HTMLButtonElement[] = [];
  private quantityPanel: HTMLDivElement;
  private quantityRecipe: Recipe | null = null;
  private quantityValue = 1;

  private onResize = (): void => {
    if (this.root.style.display === 'none') return;
    this.syncSize();
  };

  constructor(
    private session: GameSession,
    private craftingManager: CraftingManager,
    private itemManager: ItemManager,
    private iconRegistry: ItemIconRegistry,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'crafting-overlay';
    this.root.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
      'z-index:150', 'display:none',
    ].join(';');
    document.body.appendChild(this.root);

    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
    this.root.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0a1a, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);

    // ★ 六个固定加工模块槽位（布局 JSON 区域；素材 cover 不拉伸 → 圆保持圆）
    for (const slot of MODULE_SLOTS) {
      const btn = document.createElement('button');
      btn.style.cssText = [
        'position:absolute', slotCss(slot),
        'border:none', 'cursor:pointer', 'padding:0',
        'border-radius:8px', 'overflow:hidden',
        'background:rgba(20,20,40,0.35)',
        'pointer-events:auto',
      ].join(';');
      this.moduleSlots.push(btn);
      this.root.appendChild(btn);
    }

    this.quantityPanel = this.buildQuantityPanel();

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ 关闭';
    closeBtn.style.cssText = [
      'position:absolute', 'top:12px', 'right:12px', 'z-index:300',
      'padding:8px 16px', 'font-size:14px', 'cursor:pointer',
      'color:#8af', 'background:rgba(20,20,40,0.85)',
      'border:1px solid #4466aa', 'border-radius:6px',
    ].join(';');
    closeBtn.addEventListener('click', () => this.hide());
    this.root.appendChild(closeBtn);

    window.addEventListener('resize', this.onResize);
  }

  // ============================================================
  // 数量选择 + 确认面板（纯 DOM）
  // ============================================================

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
    title.id = 'craft-qty-title';
    title.style.cssText = 'font-size:20px;font-weight:bold;color:#8af;margin-bottom:14px;text-align:center;';

    const materials = document.createElement('div');
    materials.id = 'craft-qty-materials';
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
    const qtyLabel = document.createElement('span');
    qtyLabel.id = 'craft-qty-label';
    qtyLabel.style.cssText = 'font-size:24px;font-weight:bold;min-width:48px;text-align:center;color:#fff;';
    const plus = this.makeQtyBtn('+');
    minus.addEventListener('click', () => this.stepQuantity(-1));
    plus.addEventListener('click', () => this.stepQuantity(1));
    qtyRow.append(minus, qtyLabel, plus);

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:center;gap:12px;';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = '确认加工';
    confirmBtn.style.cssText = this.qtyBtnStyle(true);
    confirmBtn.addEventListener('click', () => this.confirmCraft());
    const backBtn = document.createElement('button');
    backBtn.textContent = '返回';
    backBtn.style.cssText = this.qtyBtnStyle(false);
    backBtn.addEventListener('click', () => this.closeQuantityPanel());
    btnRow.append(confirmBtn, backBtn);

    panel.append(title, materials, qtyRow, btnRow);
    overlay.appendChild(panel);
    this.root.appendChild(overlay);
    return overlay;
  }

  private makeQtyBtn(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = this.qtyBtnStyle(false);
    btn.style.cssText += ';width:40px;height:40px;font-size:20px;padding:0;';
    return btn;
  }

  private qtyBtnStyle(primary: boolean): string {
    const base = [
      'padding:10px 22px', 'font-size:15px', 'cursor:pointer',
      'border-radius:8px', 'border:none', 'font-weight:bold',
      'transition:opacity 0.2s', 'color:#fff',
    ];
    base.push(primary
      ? 'background:#4488ff;'
      : 'background:#4466aa;');
    return base.join(';');
  }

  private stepQuantity(delta: number): void {
    const r = this.quantityRecipe;
    if (!r) return;
    const max = this.maxCraftable(r);
    this.quantityValue = Math.max(1, Math.min(max, this.quantityValue + delta));
    this.renderQuantityPanel();
  }

  private maxCraftable(r: Recipe): number {
    let max = Infinity;
    const grid = this.session.inventories.player;
    for (const input of r.inputs) {
      let have = 0;
      for (const row of grid) {
        for (const cell of row) {
          if (cell && cell.itemId === input.itemId) have += cell.stackSize;
        }
      }
      max = Math.min(max, Math.floor(have / input.count));
    }
    return Math.max(0, max);
  }

  private openQuantityPanel(r: Recipe): void {
    this.quantityRecipe = r;
    this.quantityValue = 1;
    const max = this.maxCraftable(r);
    if (max > 0) this.quantityValue = 1;
    else this.quantityValue = 0;
    this.renderQuantityPanel();
    this.quantityPanel.style.display = 'flex';
  }

  private closeQuantityPanel(): void {
    this.quantityRecipe = null;
    this.quantityPanel.style.display = 'none';
  }

  private renderQuantityPanel(): void {
    const r = this.quantityRecipe;
    if (!r) return;
    const title = this.quantityPanel.querySelector('#craft-qty-title') as HTMLDivElement;
    const giver = this.itemManager.getArchetype(r.output.itemId);
    title.textContent = `${r.name} ×${r.output.count}`;

    const matEl = this.quantityPanel.querySelector('#craft-qty-materials') as HTMLDivElement;
    matEl.innerHTML = '';
    const grid = this.session.inventories.player;
    for (const input of r.inputs) {
      let have = 0;
      for (const row of grid) {
        for (const cell of row) {
          if (cell && cell.itemId === input.itemId) have += cell.stackSize;
        }
      }
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;';
      const iconCanvas = this.cloneIcon(input.itemId);
      iconCanvas.style.width = '32px';
      iconCanvas.style.height = '32px';
      row.appendChild(iconCanvas);
      const arch = this.itemManager.getArchetype(input.itemId);
      const needTotal = input.count * this.quantityValue;
      const ok = have >= needTotal;
      row.innerHTML += `<span style="color:${ok ? '#eee' : '#f77'};">${arch?.name ?? input.itemId}  ${have}/${needTotal}</span>`;
      matEl.appendChild(row);
    }

    const label = this.quantityPanel.querySelector('#craft-qty-label') as HTMLSpanElement;
    label.textContent = String(this.quantityValue);
  }

  private confirmCraft(): void {
    const r = this.quantityRecipe;
    if (!r || this.quantityValue <= 0) return;
    let done = 0;
    for (let i = 0; i < this.quantityValue; i++) {
      if (this.craftingManager.craft(r.id, 'player', 'player')) done++;
      else break;
    }
    if (done > 0) {
      this.renderQuantityPanel();
      this.renderModuleList();
      if (done < this.quantityValue) {
        window.alert(`材料不足，已加工 ${done} 个`);
      }
    } else {
      window.alert('材料不足');
    }
  }

  // ============================================================
  // 资源加载
  // ============================================================

  async load(): Promise<void> {
    const bg = await FtxAsset.load('/ui/加工台背景ui.ftx3.gz');
    this.buildBackground(bg);

    // 加工模块按钮底图（frame 0 合成 → dataURL）
    try {
      const moduleAsset = await FtxAsset.load('/ui/加工模块.ftx3.gz');
      // ★ FTX 素材行序 = 页面底部在上（像素回读确认：名字条在本应处于底部的页面 y0.63，
      //   却落在画布第 14 行）→ 垂直翻转后才是绘制页的正确朝向（下半部分不再跑顶部）。
      const raw = compositeFrameToCanvas(moduleAsset, 0);
      const flipped = document.createElement('canvas');
      flipped.width = raw.width;
      flipped.height = raw.height;
      const fctx = flipped.getContext('2d')!;
      fctx.translate(0, flipped.height);
      fctx.scale(1, -1);
      fctx.drawImage(raw, 0, 0);
      this.moduleBgDataURL = flipped.toDataURL();
    } catch (err) {
      this.moduleBgDataURL = '';
      console.warn('[CraftingOverlay] 加工模块素材载入失败:', err);
    }

    this.ready = true;
  }

  /** ★ 图标画布克隆：getIcon 对同一 itemId 缓存返回同一 element，DOM 一个元素
   *  只能有唯一父节点 → 后挂的会从前一个位置摘下（图标"消失"）。
   *  每个使用点克隆独立副本（无人机动态图标除外：DroneIcon.register 每次已建新画布）。 */
  private cloneIcon(itemId: string): HTMLCanvasElement {
    const src = this.iconRegistry.getIcon(itemId);
    if (itemId === 'kaltsit_drone') return src;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d')!.drawImage(src, 0, 0);
    return c;
  }

  // ============================================================
  // 渲染辅助
  // ============================================================

  private buildBackground(bgAsset: FtxAsset): void {
    const pair = bgAsset.getFramePair(0);
    if (!pair) return;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: pair.base },
        uResidual: { value: pair.residual },
        uAlpha: { value: 1.0 },
      },
      vertexShader: HSL_VERT,
      fragmentShader: HSL_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.scene.add(this.bgMesh);
  }

  /** 让画布尺寸适配容器（带 CSS 缓存的位深） */
  private syncSize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);

    const aspect = w / h;
    if (aspect > 1) {
      this.camera.left = 0;
      this.camera.right = aspect;
      this.camera.top = 1;
      this.camera.bottom = 0;
      this.bgMesh?.scale.set(aspect, 1, 1);
      this.bgMesh?.position.set(aspect / 2, 0.5, 0);
    } else {
      this.camera.left = 0;
      this.camera.right = 1;
      this.camera.top = 1 / aspect;
      this.camera.bottom = 0;
      this.bgMesh?.scale.set(1, 1 / aspect, 1);
      this.bgMesh?.position.set(0.5, 0.5 / aspect, 0);
    }
    this.camera.updateProjectionMatrix();
  }

  // ============================================================
  // 模块列表构建（真配方 → 六个槽位；素材 cover 保持圆形图标不变形）
  // ============================================================

  private renderModuleList(): void {
    const recipes = this.craftingManager.getAvailableRecipes(this.station);
    for (let i = 0; i < this.moduleSlots.length; i++) {
      this.moduleSlots[i].replaceChildren();
      if (i < recipes.length) {
        this.fillModuleSlot(this.moduleSlots[i], recipes[i]);
      } else {
        // 空槽位：仅显示素材底框（无内容、不可点）
        this.moduleSlots[i].style.backgroundImage = this.moduleBgDataURL ? `url(${this.moduleBgDataURL})` : '';
        this.moduleSlots[i].style.backgroundSize = 'cover';
        this.moduleSlots[i].style.backgroundPosition = 'center';
        this.moduleSlots[i].style.pointerEvents = 'none';
        this.moduleSlots[i].onclick = null;
      }
    }
  }

  /** ★ 真实模块模板：按 drawing-export 标注放置 输出图标/名字/原材料图标/数量 */
  private fillModuleSlot(btn: HTMLButtonElement, r: Recipe): void {
    // 槽位自身即容器（页面坐标 = 槽位坐标），元素按模板相对槽位定位
    const slot = MODULE_SLOTS[this.moduleSlots.indexOf(btn)] ?? MODULE_SLOTS[0];

    // ---- 模块框：素材底图 cover 铺满整个槽位（不拉伸 → 圆图标保持圆） ----
    btn.style.backgroundImage = this.moduleBgDataURL ? `url(${this.moduleBgDataURL})` : '';
    btn.style.backgroundSize = 'cover';
    btn.style.backgroundPosition = 'center';
    btn.style.pointerEvents = 'auto';

    // ---- 输出（被合成物品图标 + 名字） ----
    const out = document.createElement('div');
    out.style.cssText = [
      'position:absolute', pageToCss(slot, MODULE_TEMPLATE.outIcon),
      'display:flex', 'align-items:center', 'justify-content:center',
      'pointer-events:none',
    ].join(';');
    const outIcon = this.cloneIcon(r.output.itemId);
    outIcon.style.cssText = 'width:92%;height:92%;object-fit:contain;';
    out.appendChild(outIcon);
    btn.appendChild(out);

    const name = document.createElement('div');
    name.textContent = r.name;
    name.style.cssText = [
      'position:absolute', pageToCss(slot, MODULE_TEMPLATE.outName),
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-size:1vw', 'font-weight:bold', 'white-space:nowrap', 'overflow:hidden',
      'color:#fff', 'text-shadow:1px 1px 2px rgba(0,0,0,0.9)',
      'pointer-events:none',
    ].join(';');
    btn.appendChild(name);

    // ---- 原材料图标 + 数量（配方不足 3 种则留空） ----
    for (let i = 0; i < MODULE_TEMPLATE.mats.length; i++) {
      const input = r.inputs[i];
      if (!input) continue;
      const t = MODULE_TEMPLATE.mats[i];
      const iconEl = document.createElement('div');
      iconEl.style.cssText = [
        'position:absolute', pageToCss(slot, t.icon),
        'display:flex', 'align-items:center', 'justify-content:center',
        'transform:translateY(-15%)',
        'pointer-events:none',
      ].join(';');
      const cv = this.cloneIcon(input.itemId);
      cv.style.cssText = 'width:120%;height:120%;object-fit:contain;';
      iconEl.appendChild(cv);
      btn.appendChild(iconEl);

      const cntEl = document.createElement('div');
      cntEl.textContent = `${input.count}`;
      cntEl.style.cssText = [
        'position:absolute', pageToCss(slot, t.cnt),
        'display:flex', 'align-items:center', 'justify-content:center',
        'font-size:0.85vw', 'color:#fff', 'font-weight:bold',
        'text-shadow:1px 1px 2px rgba(0,0,0,0.9)',
        'pointer-events:none',
      ].join(';');
      btn.appendChild(cntEl);
    }

    // onclick 单处理（重复渲染不累积监听器）
    btn.onclick = () => this.openQuantityPanel(r);
  }

  // ============================================================
  // 显示/隐藏
  // ============================================================

  show(station: 'ship' | 'portable' = 'ship'): void {
    this.station = station;
    this.closeQuantityPanel();
    // ★ 先显示 + 同步尺寸（背景/槽位按真实屏幕比例定位），再渲染配方列表
    this.root.style.display = 'block';
    this.syncSize();
    this.renderModuleList();
    this.startTick();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.closeQuantityPanel();
    this.stopTick();
  }

  /** 渲染循环（背景/后续元素动画共用） */
  private startTick(): void {
    if (this.rafId !== null) return;
    const tick = (): void => {
      if (this.root.style.display === 'none') { this.rafId = null; return; }
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopTick(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  dispose(): void {
    this.hide();
    this.stopTick();
    window.removeEventListener('resize', this.onResize);
    if (this.bgMesh) {
      const mat = this.bgMesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat.dispose();
      this.scene.remove(this.bgMesh);
      this.bgMesh = null;
    }
    this.moduleSlots = [];
    this.renderer.dispose();
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }
}