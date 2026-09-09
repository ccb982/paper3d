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
import { ScrollableModuleList } from '../shared/ScrollableModuleList';
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

// 加工台页面布局 JSON（下方换算均按"我的电脑屏幕大小"标注比例缩放）：
//   layer_1 屏幕标注 bbox（底部 y=0 起）：x 0.000~0.999，y 0.0773~0.9207
//   屏幕尺寸 = 宽 0.99923、高 0.84335（画布归一化）
//   layer_3 六个"加工模块"标注包围盒：x 0.3568~0.9702，底部起 y 0.1989~0.8206
// ➜ 映射到真实屏幕（宽除 screenW，高先减 screenY0 再除 screenH）：
//   left = 0.3568 / 0.99923 = 35.70%
//   width = 0.6134 / 0.99923 = 61.39%
//   bottom(top of released) = (0.8206-0.0773)/0.84335 = 88.13% → CSS top = 11.87%
//   height = (0.8206-0.0773)/0.84335 - (0.1989-0.0773)/0.84335 = 73.71%
const MODULE_AREA = { x: 0.3570, w: 0.6139, topY: 0.1187, h: 0.7371 };
const MODULE_COLUMNS = 2;
const MODULE_ROWS = 3;

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

  private moduleViewport: HTMLDivElement;
  private moduleList: ScrollableModuleList;
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

    this.moduleViewport = this.buildModuleViewport();
    this.moduleList = new ScrollableModuleList({
      columns: MODULE_COLUMNS,
      gap: 8,
    });
    this.moduleViewport.appendChild(this.moduleList.element);
    this.root.appendChild(this.moduleViewport);

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
  // 模块列表容器（按 JSON 包围盒定位，屏幕坐标 Y 翻转）
  // ============================================================

  private buildModuleViewport(): HTMLDivElement {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute',
      `left:${MODULE_AREA.x * 100}%`,
      `top:${MODULE_AREA.topY * 100}%`,
      `width:${MODULE_AREA.w * 100}%`,
      `height:${MODULE_AREA.h * 100}%`,
      'z-index:200', 'pointer-events:auto',
    ].join(';');
    return el;
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
      row.appendChild(this.iconRegistry.getIcon(input.itemId));
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
      this.moduleBgDataURL = compositeFrameToCanvas(moduleAsset, 0).toDataURL();
    } catch (err) {
      this.moduleBgDataURL = '';
      console.warn('[CraftingOverlay] 加工模块素材载入失败:', err);
    }

    this.ready = true;
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

    // 模块行高：3 行均分可用高度
    const gap = 8;
    const cellH = (this.moduleViewport.clientHeight - gap * (MODULE_ROWS - 1)) / MODULE_ROWS;
    this.moduleList.setRowHeight(cellH);
  }

  // ============================================================
  // 模块列表构建（每个配方一个加工模块，按序添加）
  // ============================================================

  private renderModuleList(): void {
    this.moduleList.clear();
    const recipes = this.craftingManager.getAvailableRecipes(this.station);
    for (const r of recipes) {
      this.moduleList.append(this.buildModuleEntry(r));
    }
  }

  private buildModuleEntry(r: Recipe): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = [
      'position:relative', 'border:none', 'cursor:pointer', 'padding:0',
      'border-radius:10px', 'overflow:hidden',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'color:#fff', 'font-weight:bold',
      'background:rgba(20,20,40,0.85)',
      this.moduleBgDataURL ? `background-image:url(${this.moduleBgDataURL});background-size:100% 100%;` : '',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });

    const name = document.createElement('div');
    name.textContent = r.name;
    name.style.cssText = [
      'position:absolute', 'top:6px', 'left:50%', 'transform:translateX(-50%)',
      'font-size:14px', 'text-shadow:1px 1px 2px rgba(0,0,0,0.8)',
    ].join(';');
    btn.appendChild(name);

    // 材料 DOM 叠加：图标 + 需求数量（此处先粗略排布，后续按 JSON 精细绘制）
    const mats = document.createElement('div');
    mats.style.cssText = [
      'position:absolute', 'bottom:20px', 'left:50%', 'transform:translateX(-50%)',
      'display:flex', 'gap:6px',
    ].join(';');
    for (const input of r.inputs) {
      const icon = document.createElement('div');
      icon.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';
      const cv = this.iconRegistry.getIcon(input.itemId);
      cv.style.width = '26px';
      cv.style.height = '26px';
      icon.appendChild(cv);
      const cnt = document.createElement('span');
      cnt.textContent = `${input.count}`;
      cnt.style.cssText = 'font-size:11px;text-shadow:1px 1px 2px rgba(0,0,0,0.8);';
      icon.appendChild(cnt);
      mats.appendChild(icon);
    }
    btn.appendChild(mats);

    btn.addEventListener('click', () => this.openQuantityPanel(r));
    return btn;
  }

  /** 占位加工模块：先填满 2×3 网格，再多追加若干以溢出可视区（检验滚动） */
  private renderPlaceholderModules(): void {
    this.moduleList.clear();
    const visible = MODULE_COLUMNS * MODULE_ROWS;
    const total = visible * 2;
    for (let i = 0; i < total; i++) {
      this.moduleList.append(this.buildPlaceholderEntry(i + 1));
    }
  }

  private buildPlaceholderEntry(no: number): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.style.cssText = [
      'position:relative', 'border:none', 'cursor:pointer', 'padding:0',
      'border-radius:10px', 'overflow:hidden',
      'display:flex', 'flex-direction:column',
      'align-items:center', 'justify-content:center',
      'color:#fff', 'font-weight:bold',
      'background:rgba(20,20,40,0.85)',
      this.moduleBgDataURL ? `background-image:url(${this.moduleBgDataURL});background-size:100% 100%;` : '',
    ].join(';');
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.85'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '1'; });

    const name = document.createElement('div');
    name.textContent = `占位模块 ${no}`;
    name.style.cssText = [
      'font-size:16px', 'text-shadow:1px 1px 2px rgba(0,0,0,0.8)',
    ].join(';');
    btn.appendChild(name);

    const hint = document.createElement('div');
    hint.textContent = '待接入配方';
    hint.style.cssText = [
      'font-size:11px', 'opacity:0.55', 'margin-top:4px',
    ].join(';');
    btn.appendChild(hint);

    btn.addEventListener('click', () => {
      window.alert(`占位模块 ${no}：配方待接入`);
    });
    return btn;
  }

  /** 占位模式：仅显示占位模块（尚未接入真实配方） */
  private placeholderOnly = true;

  // ============================================================
  // 显示/隐藏
  // ============================================================

  show(station: 'ship' | 'portable' = 'ship'): void {
    this.station = station;
    this.closeQuantityPanel();
    // ★ 先显示 + 同步尺寸（保证模块区有真实 clientHeight 可算行高），
    //   再渲染列表，避免条目在无行高时塌缩。
    this.root.style.display = 'block';
    this.syncSize();
    if (this.placeholderOnly) this.renderPlaceholderModules();
    else this.renderModuleList();
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
    this.moduleList.dispose();
    this.renderer.dispose();
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  }
}