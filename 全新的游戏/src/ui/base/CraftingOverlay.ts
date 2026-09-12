// ============================================================
// CraftingOverlay.ts —— 加工台页面覆盖层（编排器）
// ============================================================
// WebGL 背景覆盖层（0-1 归一化 + aspect 适配）+ 六个加工模块槽位。
// 每个槽位装配一个 CraftModule（配方的基本单位，内部自管 UI/数量窗），
// Overlay 只负责：背景、槽位定位、模块装配、单开数量窗仲裁、显隐/销毁。
// ============================================================

import * as THREE from 'three';
import type { ItemManager } from '../../systems/inventory/ItemManager';
import type { CraftingManager } from '../../systems/inventory/CraftingManager';
import type { ItemIconRegistry } from '../../services/item/ItemIconRegistry';
import { CraftModule, MODULE_SLOTS, slotCss } from './CraftModule';
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
  /** 已装配的加工模块（每个 = 一个配方） */
  private modules: CraftModule[] = [];
  /** 当前打开数量窗的模块（保证单开） */
  private activeModule: CraftModule | null = null;

  private onResize = (): void => {
    if (this.root.style.display === 'none') return;
    this.syncSize();
  };

  constructor(
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
  // 模块装配（真配方 → 六个槽位；每槽位一个 CraftModule）
  // ============================================================

  private renderModuleList(): void {
    const recipes = this.craftingManager.getAvailableRecipes(this.station);
    for (const m of this.modules) m.dispose();
    this.modules = [];
    for (let i = 0; i < this.moduleSlots.length; i++) {
      const btn = this.moduleSlots[i];
      btn.replaceChildren();
      if (i < recipes.length) {
        const mod = new CraftModule(recipes[i], {
          craftingManager: this.craftingManager,
          itemManager: this.itemManager,
          iconRegistry: this.iconRegistry,
          moduleBgDataURL: this.moduleBgDataURL,
          host: this.root,
          onRequestOpen: (m) => this.openModuleQuantity(m),
        });
        mod.mount(btn);
        this.modules.push(mod);
        btn.style.display = ''; // ★ 配方数量变化时恢复显示
      } else {
        // ★ 无配方的槽位：整块隐藏（不再显示空底框占位）
        btn.style.display = 'none';
        btn.style.backgroundImage = '';
        btn.onclick = null;
      }
    }
  }

  /** ★ 单开仲裁：先关其它模块的数量窗，再打开请求模块的窗 */
  private openModuleQuantity(m: CraftModule): void {
    if (this.activeModule && this.activeModule !== m) this.activeModule.closeQuantity();
    this.activeModule = m;
    m.openQuantity();
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

  // ============================================================
  // 显示/隐藏
  // ============================================================

  show(station: 'ship' | 'portable' = 'ship'): void {
    this.station = station;
    this.closeAllQuantity();
    // ★ 先显示 + 同步尺寸（背景/槽位按真实屏幕比例定位），再渲染配方模块
    this.root.style.display = 'block';
    this.syncSize();
    this.renderModuleList();
    this.startTick();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.closeAllQuantity();
    this.stopTick();
  }

  private closeAllQuantity(): void {
    if (this.activeModule) {
      this.activeModule.closeQuantity();
      this.activeModule = null;
    }
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
    for (const m of this.modules) m.dispose();
    this.modules = [];
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