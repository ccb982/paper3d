// ============================================================
// GachaOverlay.ts —— 抽卡页面覆盖层
// 行动后进入舰船时默认显示，涵盖抽卡 + 出击按钮
// ============================================================
// ★ 布局基于用户标注数据：
//    Layer 1: 背景 (全屏)
//    Layer 3: 普瑞赛斯 (0.60,0.31)~(0.77,0.63)
//    Layer 4: 抽卡按钮 (0.60,0.29)~(0.85,0.36)
//    Layer 4: 资源显示 (0.59,0.69)~(0.99,0.71)

import * as THREE from 'three';
import { FtxAsset } from '../../vendor/player/FtxAsset';
import { Asset } from '../../vendor/player/index';
import gachaPool from '../../config/gachaPool.json';
import itemsJson from '../../config/items.json';
import type { GameSession } from '../../core/Session';
import { addItemToGrid } from '../../core/Session';
import { RELIC_ITEM_CONFIG } from '../../config/relics';
import { ItemIconRegistry } from '../../services/item/ItemIconRegistry';

import { SaveSystem } from '../../core/SaveSystem';
import { applyShaderDebug } from '../../services/render/GameRenderer';
import { warmupMinimap } from '../../services/ui/MinimapWarmup';
import { FluidEffect } from '../../vendor/player/fluid/FluidEffect';
import type { PhysicsConfig } from '../../vendor/player/core/types';

// ============================================================
// 基础 HSL 合成 Shader（FTX 纹理渲染用，含 UV 偏移支持）
// ============================================================
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
  uniform vec4 uUvClip; // (x, y, w, h) 裁剪纹理区域，默认 (0,0,1,1)
  uniform float uGray; // 0=原色, 1=灰度

  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }

  void main() {
    vec2 uv = uUvClip.xy + vUv * uUvClip.zw;
    vec4 base = texture2D(uBase, uv);
    if (base.a < 0.5) discard;
    vec4 res = texture2D(uResidual, uv);
    float dH = (res.r * 2.0 - 1.0) * 0.5;
    float dS = (res.g * 2.0 - 1.0) * 0.5;
    float dL = (res.b * 2.0 - 1.0) * 0.5;
    float h = fract(base.r + dH);
    float s = clamp(base.g + dS, 0.0, 1.0);
    float l = clamp(base.b + dL, 0.0, 1.0);
    vec3 color = hsl2rgb(vec3(h, s, l));
    float gray = dot(color, vec3(0.299, 0.587, 0.114));
    gl_FragColor = vec4(mix(color, vec3(gray), uGray), base.a * uAlpha);
  }
`;

const HSL_FRAG_CHAR = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uBase;
  uniform sampler2D uResidual;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uDistortEnabled;
  uniform float uDistortAmplitude;
  uniform float uDistortFrequency;
  uniform float uDistortSpeed;
  uniform float uDistortRotation;

  vec3 hsl2rgb(vec3 c) {
    vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return c.z + c.y * (rgb - 0.5) * (1.0 - abs(2.0 * c.z - 1.0));
  }

  void main() {
    vec2 uv = vUv;
    // 呼吸式扭曲
    if (uDistortEnabled > 0.5) {
      float time = uTime;
      float cosDR = cos(uDistortRotation);
      float sinDR = sin(uDistortRotation);
      vec2 dUv = uv - 0.5;
      vec2 rotUv = vec2(dUv.x * cosDR - dUv.y * sinDR, dUv.x * sinDR + dUv.y * cosDR);
      rotUv += 0.5;
      float amplitude = uDistortAmplitude * (0.5 + 0.5 * sin(time * 0.4));
      float frequency = uDistortFrequency;
      float phase = time * uDistortSpeed + 0.5 * sin(time * 0.3);
      float offsetX = amplitude * sin(frequency * rotUv.y + phase);
      rotUv.x += offsetX;
      float secondaryAmp = amplitude * 0.3;
      float secondaryFreq = frequency * 1.8;
      float secondaryPhase = time * 2.5;
      rotUv.x += secondaryAmp * sin(secondaryFreq * rotUv.y + secondaryPhase);
      vec2 backUv = rotUv - 0.5;
      uv = vec2(backUv.x * cosDR + backUv.y * sinDR, -backUv.x * sinDR + backUv.y * cosDR);
      uv += 0.5;
    }
    vec4 base = texture2D(uBase, uv);
    if (base.a < 0.5) discard;
    vec4 res = texture2D(uResidual, uv);
    float dH = (res.r * 2.0 - 1.0) * 0.5;
    float dS = (res.g * 2.0 - 1.0) * 0.5;
    float dL = (res.b * 2.0 - 1.0) * 0.5;
    float h = fract(base.r + dH);
    float s = clamp(base.g + dS, 0.0, 1.0);
    float l = clamp(base.b + dL, 0.0, 1.0);
    gl_FragColor = vec4(hsl2rgb(vec3(h, s, l)), base.a * uAlpha);
  }
`;

/**
 * ★ 抽卡结果归属分类（决定结果卡挂什么牌子 + 图标查哪张表）：
 *   - 'inRun' 物资：进背包
 *   - 'outRun' 遗物：永久生效、进遗物面板、重置遗物保底
 *   - 'boss'  BOSS（普瑞赛斯）：唯一的 6★，牌子是「BOSS」不是「遗物」
 */
type GachaResultKind = 'inRun' | 'outRun' | 'boss';

interface GachaResultEntry {
  kind: GachaResultKind;
  id: string;
  name: string;
  rarity: number;
  description: string;
  isNew: boolean;
}

export class GachaOverlay {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private ready = false;
  private onDepart: (() => void) | null = null;

  // 点击区域（世界坐标 0..1）
  private buttonHit = {
    left: { x: 0, y: 0, w: 0, h: 0 },
    right: { x: 0, y: 0, w: 0, h: 0 },
  };

  // DOM 元素
  
  private resultOverlay: HTMLDivElement;
  private resultList: HTMLDivElement;
  private _charMats: THREE.ShaderMaterial[] = [];
  private bgFluidEffect: FluidEffect | null = null;
  private isPointerDown = false;
  private lastTickTime = 0;
  private _fluidStarted = false; // 首次交互后才步进流体模拟

  // 第三层元素
  private _pullCountSprite: THREE.Sprite | null = null;
  private _pullCountCanvas: HTMLCanvasElement | null = null;
  private _pullCountTexture: THREE.CanvasTexture | null = null;
  private _starsMesh: THREE.Mesh | null = null;
  private _questionMesh: THREE.Mesh | null = null;
  private _btnLeftMesh: THREE.Mesh | null = null; // 抽卡按钮左半（单抽）
  private _btnRightMesh: THREE.Mesh | null = null; // 抽卡按钮右半（十连）
  private _btnLeftDefaultScale: { x: number; y: number } | null = null;
  private _btnRightDefaultScale: { x: number; y: number } | null = null;
  private _isHoverLeft = false;
  private _isHoverRight = false;

  // ============================================================
  // ★ 行动按钮（2026-09-15 用户定调）
  //   抽完卡（单抽/十连）后，抽卡按钮 由 行动按钮 取代（同一槽位、同一比例适配）；
  //   常规 → 「开始行动」；已抽到 Boss 普瑞赛斯（未通关）→ 「开始突袭」。
  //   点击行动按钮才真正出击；抽完卡不再自动进战斗。
  // ============================================================
  private _departAsset: FtxAsset | null = null;
  private _departMesh: THREE.Mesh | null = null;
  private _departGlowMesh: THREE.Mesh | null = null;
  private _departDefaultScale: { x: number; y: number } | null = null;
  private _departGlowDef: { w: number; h: number; cy: number; texH: number } | null = null;
  private _isHoverDepart = false;
  /** 当前处于「行动」态（抽卡已完成，等待出击） */
  private _departMode = false;
  /** 行动按钮命中区（相机坐标，Y 已翻转） */
  private _departHit: { x: number; y: number; w: number; h: number } | null = null;
  /** ★ 按钮槽位（抽卡按钮 / 行动按钮 共用：位置与比例完全一致） */
  private _btnTexRect: { offX: number; offY: number; w: number; h: number; hitOffY: number } | null = null;

  // 按钮底部 glow 网格
  private _btnLeftGlowMesh: THREE.Mesh | null = null;
  private _btnRightGlowMesh: THREE.Mesh | null = null;
  private _btnGlowDefData: { cy: number; texH: number; lgW: number; lgH: number; rgW: number; rgH: number; leftGlowCx: number; rightGlowCx: number } | null = null;

  // 按钮动画
  private _btnAnimId: number | null = null;
  private _btnAnimData: { mesh: THREE.Mesh; defScale: { x: number; y: number }; sStart: number; sEnd: number; gStart: number; gEnd: number; t0: number }[] = [];

  // 概率显示页面
  private _probAsset: FtxAsset | null = null;
  private _probButtonHit: { x: number; y: number; w: number; h: number } | null = null;

  // ============================================================
  // ★ 返回按钮（左上角，2026-09-15 用户定调）
  //   行为：只关闭抽卡页、回到基地主页面，不触发出击；
  //   出击仍由「行动」按钮负责（两者互不干扰，任何状态下都可用）。
  // ============================================================
  private _backAsset: FtxAsset | null = null;
  private _backMesh: THREE.Mesh | null = null;
  private _backDefaultScale: { x: number; y: number } | null = null;
  private _isHoverBack = false;
  /** 返回按钮命中区（指针空间：y=0 在屏幕顶部） */
  private _backHit: { x: number; y: number; w: number; h: number } | null = null;

  // 按钮动画
  private animateBtn(mesh: THREE.Mesh | null, defScale: { x: number; y: number } | null, sEnd: number, gEnd: number): void {
    if (!mesh || !defScale) return;
    const mat = mesh.material as THREE.ShaderMaterial;
    const sStart = mesh.scale.x / defScale.x;
    const gStart = mat.uniforms.uGray.value as number;
    if (sStart === sEnd && gStart === gEnd) return;
    this._btnAnimData.push({ mesh, defScale, sStart, sEnd, gStart, gEnd, t0: performance.now() });
    if (this._btnAnimId === null) {
      this._btnAnimId = requestAnimationFrame(() => this.tickBtnAnim());
    }
  }
  private tickBtnAnim(): void {
    this._btnAnimId = null;
    const DURATION = 150;
    const now = performance.now();
    const pending: typeof this._btnAnimData = [];
    for (const d of this._btnAnimData) {
      const t = Math.min(1, (now - d.t0) / DURATION);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const s = d.sStart + (d.sEnd - d.sStart) * ease;
      const g = d.gStart + (d.gEnd - d.gStart) * ease;
      d.mesh.scale.set(d.defScale.x * s, d.defScale.y * s, 1);
      (d.mesh.material as THREE.ShaderMaterial).uniforms.uGray.value = g;
      if (t < 1) pending.push(d);
    }
    this._btnAnimData = pending;

    // 更新 glow 位置和大小跟随按钮缩放
    if (this._btnLeftGlowMesh && this._btnRightGlowMesh && this._btnGlowDefData && this._btnLeftDefaultScale && this._btnRightDefaultScale) {
      const { cy, texH, lgW, lgH, rgW, rgH } = this._btnGlowDefData;
      // 左 glow
      const leftS = this._btnLeftMesh!.scale.x / this._btnLeftDefaultScale.x;
      this._btnLeftGlowMesh.scale.set(lgW * leftS, lgH * leftS, 1);
      this._btnLeftGlowMesh.position.y = cy - (texH * leftS) / 2 + (lgH * leftS) * 0.3 + 0.007;
      // 右 glow
      const rightS = this._btnRightMesh!.scale.x / this._btnRightDefaultScale.x;
      this._btnRightGlowMesh.scale.set(rgW * rightS, rgH * rightS, 1);
      this._btnRightGlowMesh.position.y = cy - (texH * rightS) / 2 + (rgH * rightS) * 0.3 + 0.007;
    }

    // ★ 行动按钮 glow 跟随缩放
    if (this._departGlowMesh && this._departMesh && this._departGlowDef && this._departDefaultScale) {
      const { w, h, cy, texH } = this._departGlowDef;
      const s = this._departMesh.scale.x / this._departDefaultScale.x;
      this._departGlowMesh.scale.set(w * s, h * s, 1);
      this._departGlowMesh.position.y = cy - (texH * s) / 2 + (h * s) * 0.3 + 0.007;
    }

    if (pending.length > 0) {
      this._btnAnimId = requestAnimationFrame(() => this.tickBtnAnim());
    }
  }

  // 按钮按压效果
  private pressLeftBtn(): void {
    this.animateBtn(this._btnLeftMesh, this._btnLeftDefaultScale, 1.15, 1);
  }
  private releaseLeftBtn(): void {
    const s = this._isHoverLeft ? 1.05 : 1;
    this.animateBtn(this._btnLeftMesh, this._btnLeftDefaultScale, s, this._isHoverLeft ? 0.2 : 0);
  }
  private pressRightBtn(): void {
    this.animateBtn(this._btnRightMesh, this._btnRightDefaultScale, 1.15, 1);
  }
  private releaseRightBtn(): void {
    const s = this._isHoverRight ? 1.05 : 1;
    this.animateBtn(this._btnRightMesh, this._btnRightDefaultScale, s, this._isHoverRight ? 0.2 : 0);
  }
  private setBtnHover(mesh: THREE.Mesh | null, defScale: { x: number; y: number } | null, isHover: boolean): void {
    const s = isHover ? 1.05 : 1;
    this.animateBtn(mesh, defScale, s, isHover ? 0.2 : 0);
  }
  private updateButtonHover(wx: number, wy: number): void {
    // ★ 返回按钮：任何状态下都参与 hover（左上角，不与抽卡/行动按钮重叠）
    const bk = this._backHit;
    const onBack = !!bk && wx >= bk.x && wx <= bk.x + bk.w && wy >= bk.y && wy <= bk.y + bk.h;
    if (onBack !== this._isHoverBack) {
      this._isHoverBack = onBack;
      this.animateBtn(this._backMesh, this._backDefaultScale, onBack ? 1.05 : 1, onBack ? 0.2 : 0);
    }

    // ★ 行动态：只判定行动按钮
    if (this._departMode) {
      const d = this._departHit;
      const on = !!d && wx >= d.x && wx <= d.x + d.w && wy >= d.y && wy <= d.y + d.h;
      if (on !== this._isHoverDepart) {
        this._isHoverDepart = on;
        this.animateBtn(this._departMesh, this._departDefaultScale, on ? 1.05 : 1, on ? 0.2 : 0);
      }
      return;
    }
    const { left, right } = this.buttonHit;
    const onLeft = wx >= left.x && wx <= left.x + left.w && wy >= left.y && wy <= left.y + left.h;
    const onRight = wx >= left.x + left.w && wx <= left.x + left.w + right.w && wy >= left.y && wy <= left.y + left.h;
    if (onLeft !== this._isHoverLeft) {
      this._isHoverLeft = onLeft;
      this.setBtnHover(this._btnLeftMesh, this._btnLeftDefaultScale, onLeft);
    }
    if (onRight !== this._isHoverRight) {
      this._isHoverRight = onRight;
      this.setBtnHover(this._btnRightMesh, this._btnRightDefaultScale, onRight);
    }
  }
  private clearHover(): void {
    if (this._isHoverBack) {
      this._isHoverBack = false;
      this.animateBtn(this._backMesh, this._backDefaultScale, 1, 0);
    }
    if (this._isHoverDepart) {
      this._isHoverDepart = false;
      this.animateBtn(this._departMesh, this._departDefaultScale, 1, 0);
    }
    if (this._isHoverLeft) {
      this._isHoverLeft = false;
      this.setBtnHover(this._btnLeftMesh, this._btnLeftDefaultScale, false);
    }
    if (this._isHoverRight) {
      this._isHoverRight = false;
      this.setBtnHover(this._btnRightMesh, this._btnRightDefaultScale, false);
    }
  }
  private handlePointerMove(e: PointerEvent): void {
    if (!this.ready) return;
    const rect = this.canvas.getBoundingClientRect();
    const aspect = window.innerWidth / window.innerHeight;
    let wx: number, wy: number;
    if (aspect > 1) {
      wx = ((e.clientX - rect.left) / rect.width) * aspect;
      wy = (e.clientY - rect.top) / rect.height;
    } else {
      wx = (e.clientX - rect.left) / rect.width;
      wy = ((e.clientY - rect.top) / rect.height) * (1 / aspect);
    }
    this.updateButtonHover(wx, wy);
    // 拖拽时持续注入流体
    if (this.isPointerDown && this.bgFluidEffect) {
      this.injectFluidAt(e);
    }
  }

  // 粒子效果
  private _particles: THREE.Points | null = null;
  private _particleCount = 40;
  private _particlePositions: Float32Array | null = null;
  private _particleData: Float32Array | null = null; // [velX, velY, phase, age, lifespan] 每粒子

  constructor(
    private session: GameSession,
    /** ★ 图标服务（与背包/加工台同一条绘制管线：色块兜底 / 六兄弟 FTX / 无人机动态 / 遗物 FTX） */
    private iconRegistry: ItemIconRegistry,
  ) {
    // 根容器
    this.root = document.createElement('div');
    this.root.id = 'gacha-overlay';
    this.root.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
      'z-index:150', 'display:none',
    ].join(';');
    document.body.appendChild(this.root);

    // Three.js 画布
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
    this.root.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    // ★ 默认关掉着色器错误回读：否则首次打开抽卡页会同步阻塞主线程
    applyShaderDebug(this.renderer);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0a1a, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);

    // 结果弹窗
    this.resultOverlay = document.createElement('div');
    this.resultOverlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
      'display:none', 'align-items:center', 'justify-content:center',
      'z-index:200',
    ].join(';');
    this.resultOverlay.innerHTML = [
      '<div id="gacha-result-panel" style="background:linear-gradient(135deg,rgba(20,20,40,0.98),rgba(40,20,60,0.98));border:2px solid #aa44aa;border-radius:16px;padding:24px;text-align:center;max-width:420px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 0 40px rgba(170,68,170,0.3);">',
      '<h2 style="color:#c8a0ff;margin:0 0 16px 0;font-size:20px;">招募结果</h2>',
      '<div id="gacha-result-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;"></div>',
      '<button id="gacha-close-result" style="margin-top:12px;padding:10px 32px;background:#aa44aa;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer;font-weight:bold;">确定</button>',
      '</div>',
    ].join('');
    this.root.appendChild(this.resultOverlay);
    this.resultList = this.resultOverlay.querySelector('#gacha-result-list')!;
    this.resultOverlay.querySelector('#gacha-close-result')!.addEventListener('click', () => {
      this.resultOverlay.style.display = 'none';
      // ★ 2026-09-15：抽卡按钮已在点击抽卡时换成行动按钮，这里只关结果弹窗；
      //   若素材缺失导致没换成行动按钮，则退回旧行为（关闭即出击），避免卡死。
      if (!this._departMode) {
        this.hide();
        this.onDepart?.();
      }
    });

    // 画布点击
    this.canvas.addEventListener('pointerdown', (e) => this.handleCanvasClick(e));
    this.canvas.addEventListener('pointermove', (e) => this.handlePointerMove(e));
    this.canvas.addEventListener('pointerup', () => { this.isPointerDown = false; });
    this.canvas.addEventListener('pointerleave', () => {
      this.isPointerDown = false;
      this.clearHover();
    });

    // 窗口大小变化
    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => {
    if (this.root.style.display === 'none') return;
    this.syncSize();
  };

  // ============================================================
  // 资源加载
  // ============================================================

  async load(): Promise<void> {
    const bg = await FtxAsset.load('/ui/抽卡背景页面.ftx3.gz');
    const ui = await FtxAsset.load('/ui/抽卡和资源显示ui.ftx3.gz');
    let charAsset: Asset | FtxAsset | null = null;
    try {
      charAsset = await Asset.load('/characters/enemies/普瑞赛斯.scene.zip');
    } catch {
      charAsset = null;
    }

    this.initBgFluidEffect(bg);
    if (charAsset) this.renderCharacter(charAsset);

    // 抽卡按钮（frame 0）→ 区域1：1.1倍，顶部位置不变
    const aspect = window.innerWidth / window.innerHeight;
    const btnArea = {
      x: 0.57749 * aspect,
      y: 0.0537,       // 顶部不变
      w: 0.31702 * aspect,
      h: 0.16093,
    };
    const f0 = ui.frames[0];
    const fw0 = f0?.bbox.w || 512;
    const fh0 = f0?.bbox.h || 512;
    const texAspect0 = fw0 / fh0;
    let sW0 = btnArea.w;
    let sH0 = sW0 / texAspect0;
    if (sH0 > btnArea.h) { sH0 = btnArea.h; sW0 = sH0 * texAspect0; }
    const texOffX = btnArea.x + (btnArea.w - sW0) / 2;
    const texOffY = btnArea.y + (btnArea.h - sH0) / 2;

    // 用精确位置渲染纹理
    this.renderButtonUI(ui, texOffX, texOffY, sW0, sH0);
    this.renderResourceUI(ui);

    // hit area 需要 Y 翻转（JSON y=0 底部 → camera y=0 顶部）
    const hitOffY = (1 - (btnArea.y + btnArea.h)) + (btnArea.h - sH0) / 2;
    this.buttonHit.left = { x: texOffX, y: hitOffY, w: sW0 / 2, h: sH0 };
    this.buttonHit.right = { x: texOffX + sW0 / 2, y: hitOffY, w: sW0 / 2, h: sH0 };

    // ★ 记录按钮槽位：行动按钮复用（位置 / 尺寸 / 居中适配规则完全一致）
    this._btnTexRect = { offX: texOffX, offY: texOffY, w: sW0, h: sH0, hitOffY };

    // ★ 行动按钮资源（抽完卡后替换抽卡按钮；缺资源时降级为不替换）
    try {
      this._departAsset = await FtxAsset.load('/ui/行动按钮.ftx3.gz');
    } catch {
      this._departAsset = null;
      console.warn('[GachaOverlay] 行动按钮素材缺失，抽完卡后不替换按钮（放入 public/ui/行动按钮.ftx3.gz 即生效）');
    }

    // 第三层：累积抽卡数字 + 六颗星星 + 问号
    const stars = await FtxAsset.load('/ui/六颗星星.ftx3.gz');
    const questionMark = await FtxAsset.load('/ui/问号.ftx3.gz');
    this.renderThirdLayer(stars, questionMark);

    // 概率显示透明按钮（JSON 区域：x:0.140~0.201, y:0.131~0.162）
    const probBtnW = 0.0611 * aspect;
    const probBtnH = 0.0314;
    this._probButtonHit = {
      x: 0.2835, // camera 坐标
      y: 0.90,
      w: probBtnW,
      h: probBtnH,
    };

    // 预加载概率显示纹理
    this._probAsset = await FtxAsset.load('/ui/概率显示.ftx3.gz');

    // ★ 返回按钮（左上角；点击回到基地主页面，不触发出击）
    try {
      this._backAsset = await FtxAsset.load('/ui/返回按钮.ftx3.gz');
      this.renderBackButton();
    } catch {
      this._backAsset = null;
      console.warn('[GachaOverlay] 返回按钮素材缺失，抽卡页左上角不显示返回按钮（放入 public/ui/返回按钮.ftx3.gz 即生效）');
    }

    // 创建粒子效果
    this.createParticles();

    this.ready = true;
  }

  // ============================================================
  // 渲染辅助
  // ============================================================

  private makeHSLMat(base: THREE.DataTexture, residual: THREE.DataTexture, uvClip?: { x: number; y: number; w: number; h: number }): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: base },
        uResidual: { value: residual },
        uAlpha: { value: 1.0 },
        uUvClip: { value: uvClip ? new THREE.Vector4(uvClip.x, uvClip.y, uvClip.w, uvClip.h) : new THREE.Vector4(0, 0, 1, 1) },
        uGray: { value: 0 },
      },
      vertexShader: HSL_VERT,
      fragmentShader: HSL_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
  }

  private addQuad(mat: THREE.ShaderMaterial, scaleX: number, scaleY: number, posX: number, posY: number, z: number): void {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.scale.set(scaleX, scaleY, 1);
    mesh.position.set(posX, posY, z);
    this.scene.add(mesh);
  }

  // ============================================================
  // 背景流体效果（Layer 1 - 向量模式速度注入）
  // ============================================================

  private initBgFluidEffect(bgAsset: FtxAsset): void {
    const frame = bgAsset.frames[0];
    if (!frame) {
      // 回退到无流体渲染
      const pair = bgAsset.getFramePair(0);
      if (pair) this.renderBackgroundFallback(pair);
      return;
    }

    const physics: PhysicsConfig = {
      enableAdvection: true,
      enablePressure: true,
      pressureIterations: 30,
      advectionMode: 'vector',
      velocityScale: 0.95,
      maxVelocity: 5000,
    };

    this.bgFluidEffect = new FluidEffect(
      this.renderer,
      physics,
      frame,
      bgAsset.palette,
      [],
    );

    this.renderFluidBackground();
  }

  private renderFluidBackground(): void {
    const compositeTex = this.bgFluidEffect?.getCompositeTexture();
    if (!compositeTex) {
      // 回退到无流体渲染（不会发生，仅防御）
      return;
    }

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColorTex: { value: compositeTex },
        uAlpha: { value: 1.0 },
      },
      vertexShader: HSL_VERT,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uColorTex;
        uniform float uAlpha;
        void main() {
          vec4 color = texture2D(uColorTex, vUv);
          gl_FragColor = vec4(color.rgb, color.a * uAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    const aspect = window.innerWidth / window.innerHeight;
    if (aspect > 1) {
      this.addQuad(mat, aspect, 1, aspect / 2, 0.5, 0);
    } else {
      this.addQuad(mat, 1, 1 / aspect, 0.5, 0.5 / aspect, 0);
    }
  }

  /** 无流体回退渲染 */
  private renderBackgroundFallback(pair: { base: THREE.DataTexture; residual: THREE.DataTexture }): void {
    const mat = this.makeHSLMat(pair.base, pair.residual);
    const aspect = window.innerWidth / window.innerHeight;
    if (aspect > 1) {
      this.addQuad(mat, aspect, 1, aspect / 2, 0.5, 0);
    } else {
      this.addQuad(mat, 1, 1 / aspect, 0.5, 0.5 / aspect, 0);
    }
  }

  private renderCharacter(charAsset: Asset | FtxAsset): void {
    let pair: { base: THREE.DataTexture; residual: THREE.DataTexture } | null = null;
    let fw = 512, fh = 512;
    let distortEnabled = false;
    let distortAmplitude = 0.06;
    let distortFrequency = 5.0;
    let distortSpeed = 1.2;
    let distortRotation = 0;

    if (charAsset instanceof Asset) {
      pair = charAsset.getFramePair(0);
      const ftxFrame = charAsset.getFtxFrame(0);
      if (ftxFrame) { fw = ftxFrame.bbox.w; fh = ftxFrame.bbox.h; }
      const f0 = charAsset.frames[0];
      if (f0) {
        distortEnabled = f0.distortEnabled ?? false;
        distortAmplitude = f0.distortAmplitude ?? 0.06;
        distortFrequency = f0.distortFrequency ?? 5.0;
        distortSpeed = f0.distortSpeed ?? 1.2;
        distortRotation = f0.distortRotation ?? 0;
      }
    } else {
      pair = charAsset.getFramePair(0);
      const f = charAsset.frames[0];
      if (f) { fw = f.bbox.w; fh = f.bbox.h; }
    }
    if (!pair) return;

    // ★ 标注区域（1.3倍）
    const aspect = window.innerWidth / window.innerHeight;
    const areaX = 0.591 * aspect;
    const areaY = -0.0002;
    const areaW = 0.312 * aspect;
    const areaH = 0.8944;

    const texAspect = fw / fh;

    // 在标注区域内居中放置，保持纹理比例
    let quadW = areaW;
    let quadH = quadW / texAspect;
    if (quadH > areaH) {
      quadH = areaH;
      quadW = quadH * texAspect;
    }

    const cx = areaX + areaW / 2;
    const cy = areaY + areaH / 2;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uBase: { value: pair.base },
        uResidual: { value: pair.residual },
        uAlpha: { value: 1.0 },
        uTime: { value: 0 },
        uDistortEnabled: { value: distortEnabled ? 1 : 0 },
        uDistortAmplitude: { value: distortAmplitude },
        uDistortFrequency: { value: distortFrequency },
        uDistortSpeed: { value: distortSpeed },
        uDistortRotation: { value: distortRotation },
      },
      vertexShader: HSL_VERT,
      fragmentShader: HSL_FRAG_CHAR,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this._charMats.push(mat);
    this.addQuad(mat, quadW, quadH, cx, cy, 0.1);
  }

  // ============================================================
  // 渲染抽卡按钮纹理（frame 0 - 右上）
  // ============================================================

  private renderButtonUI(uiAsset: FtxAsset, offX: number, offY: number, texW: number, texH: number): void {
    const pair = uiAsset.getFramePair(0);
    if (!pair) return;
    const cx = offX + texW / 2;
    const cy = offY + texH / 2;

    // 左半（单抽）
    const leftMat = this.makeHSLMat(pair.base, pair.residual, { x: 0, y: 0, w: 0.5, h: 1 });
    const leftHalfW = texW / 2;
    const leftCx = cx - leftHalfW / 2;
    this._btnLeftMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), leftMat);
    this._btnLeftMesh.scale.set(leftHalfW, texH, 1);
    this._btnLeftMesh.position.set(leftCx, cy, 0.2);
    this._btnLeftDefaultScale = { x: leftHalfW, y: texH };
    this.scene.add(this._btnLeftMesh);

    // 左按钮底部白光 glow
    const leftGlowCvs = document.createElement('canvas');
    leftGlowCvs.width = 64;
    leftGlowCvs.height = 64;
    const lgctx = leftGlowCvs.getContext('2d')!;
    const lgGrad = lgctx.createLinearGradient(0, 64, 0, 0);
    lgGrad.addColorStop(0, 'rgba(255,255,255,0.9)');
    lgGrad.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    lgGrad.addColorStop(0.85, 'rgba(255,255,255,0.15)');
    lgGrad.addColorStop(1, 'rgba(255,255,255,0)');
    lgctx.fillStyle = lgGrad;
    lgctx.fillRect(0, 0, 64, 64);
    const leftGlowTex = new THREE.CanvasTexture(leftGlowCvs);
    leftGlowTex.flipY = false;
    leftGlowTex.colorSpace = THREE.LinearSRGBColorSpace;
    const leftGlowMat = new THREE.MeshBasicMaterial({ map: leftGlowTex, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
    const leftGlowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), leftGlowMat);
    const lgW = leftHalfW * 0.96;
    const lgH = texH * 0.08;
    leftGlowMesh.scale.set(lgW, lgH, 1);
    // 左 glow：右侧对齐中线，左侧超出按钮
    const leftGlowCx = cx - lgW / 2;
    leftGlowMesh.position.set(leftGlowCx, cy - texH / 2 + lgH * 0.3 + 0.007, 0.19);
    this.scene.add(leftGlowMesh);
    this._btnLeftGlowMesh = leftGlowMesh;

    // 右半（十连）
    const rightMat = this.makeHSLMat(pair.base, pair.residual, { x: 0.5, y: 0, w: 0.5, h: 1 });
    const rightCx = cx + leftHalfW / 2;
    this._btnRightMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), rightMat);
    this._btnRightMesh.scale.set(leftHalfW, texH, 1);
    this._btnRightMesh.position.set(rightCx, cy, 0.2);
    this._btnRightDefaultScale = { x: leftHalfW, y: texH };
    this.scene.add(this._btnRightMesh);

    // 右按钮底部黄光 glow
    const rightGlowCvs = document.createElement('canvas');
    rightGlowCvs.width = 64;
    rightGlowCvs.height = 64;
    const rgctx = rightGlowCvs.getContext('2d')!;
    const rgGrad = rgctx.createLinearGradient(0, 64, 0, 0);
    rgGrad.addColorStop(0, 'rgba(255,200,0,0.9)');
    rgGrad.addColorStop(0.4, 'rgba(255,200,0,0.5)');
    rgGrad.addColorStop(0.75, 'rgba(255,200,0,0.15)');
    rgGrad.addColorStop(1, 'rgba(255,200,0,0)');
    rgctx.fillStyle = rgGrad;
    rgctx.fillRect(0, 0, 64, 64);
    const rightGlowTex = new THREE.CanvasTexture(rightGlowCvs);
    rightGlowTex.flipY = false;
    rightGlowTex.colorSpace = THREE.LinearSRGBColorSpace;
    const rightGlowMat = new THREE.MeshBasicMaterial({ map: rightGlowTex, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false, depthTest: false });
    const rightGlowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), rightGlowMat);
    const rgW = leftHalfW * 0.97;
    const rgH = texH * 0.08;
    rightGlowMesh.scale.set(rgW, rgH, 1);
    // 右 glow：左侧对齐中线，右侧超出按钮
    const rightGlowCx = cx + rgW / 2;
    rightGlowMesh.position.set(rightGlowCx, cy - texH / 2 + rgH * 0.3 + 0.007, 0.19);
    this.scene.add(rightGlowMesh);
    this._btnRightGlowMesh = rightGlowMesh;

    // 存储 glow 默认数据（供动画跟随使用）
    this._btnGlowDefData = { cy, texH, lgW, lgH, rgW, rgH, leftGlowCx, rightGlowCx };
  }

  // ============================================================
  // ★ 行动按钮（抽卡按钮的替代态）
  // ============================================================

  /**
   * 是否进入 Boss 突袭流程。
   * 与 WorldMode 的 bossRun 判定保持一致：已获得普瑞赛斯 且 尚未通关。
   */
  private isBossRun(): boolean {
    const bossId = (gachaPool as unknown as { boss?: { id: string } }).boss?.id ?? 'priestess';
    return !!this.session.outOfRun?.owned?.[bossId] && !this.session.meta?.bossCleared;
  }

  /** 抽卡按钮显隐（切换成行动按钮时隐藏，不销毁以便复用） */
  private setGachaButtonsVisible(visible: boolean): void {
    if (this._btnLeftMesh) this._btnLeftMesh.visible = visible;
    if (this._btnRightMesh) this._btnRightMesh.visible = visible;
    if (this._btnLeftGlowMesh) this._btnLeftGlowMesh.visible = visible;
    if (this._btnRightGlowMesh) this._btnRightGlowMesh.visible = visible;
  }

  /**
   * ★ 抽完卡后：把抽卡按钮换成行动按钮（点击抽卡的瞬间就切，不等关闭结果列表）。
   * - 槽位 / 比例：完全沿用抽卡按钮的适配结果（同一区域、保持纹理比例居中）
   * - 常规 → 「开始行动」；已抽到 Boss → 「开始突袭」
   * - 只在点击行动按钮时出击（不再自动进战斗）
   */
  private switchToDepartButton(): void {
    if (this._departMode) return;
    if (!this.renderDepartButton()) return; // 素材缺失：保留抽卡按钮，出击仍由结果弹窗「确定」兜底
    this._departMode = true;
    this.setGachaButtonsVisible(false);
    this.clearHover();
  }

  /** 渲染行动按钮（含底部 glow），沿用抽卡按钮槽位；成功返回 true */
  private renderDepartButton(): boolean {
    if (this._departMesh) return true;
    const asset = this._departAsset;
    const rect = this._btnTexRect;
    if (!asset || !rect || !asset.getFramePair(0)) return false;

    const raid = this.isBossRun();
    // 按帧名取：开始突袭 / 开始行动；取不到则退回索引（0=行动，1=突袭）
    const idx = (raid ? asset.resolveFrame('开始突袭') : asset.resolveFrame('开始行动'))
      ?? (raid ? 1 : 0);
    const pair = asset.getFramePair(idx) ?? asset.getFramePair(0);
    if (!pair) return false;

    const cx = rect.offX + rect.w / 2;
    const cy = rect.offY + rect.h / 2;

    const mat = this.makeHSLMat(pair.base, pair.residual);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.scale.set(rect.w, rect.h, 1);
    mesh.position.set(cx, cy, 0.2);
    this.scene.add(mesh);
    this._departMesh = mesh;
    this._departDefaultScale = { x: rect.w, y: rect.h };

    // 底部发光条：行动=冷白蓝，突袭=赤红
    const cvs = document.createElement('canvas');
    cvs.width = 64;
    cvs.height = 64;
    const g = cvs.getContext('2d')!;
    const grad = g.createLinearGradient(0, 64, 0, 0);
    const hot = raid ? '255,86,64' : '150,205,255';
    grad.addColorStop(0, `rgba(${hot},0.9)`);
    grad.addColorStop(0.5, `rgba(${hot},0.5)`);
    grad.addColorStop(0.85, `rgba(${hot},0.15)`);
    grad.addColorStop(1, `rgba(${hot},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cvs);
    tex.flipY = false;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    const glowMat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 1, side: THREE.DoubleSide,
      depthWrite: false, depthTest: false,
    });
    const glowW = rect.w * 0.96;
    const glowH = rect.h * 0.08;
    const glowMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glowMat);
    glowMesh.scale.set(glowW, glowH, 1);
    glowMesh.position.set(cx, cy - rect.h / 2 + glowH * 0.3 + 0.007, 0.19);
    this.scene.add(glowMesh);
    this._departGlowMesh = glowMesh;
    this._departGlowDef = { w: glowW, h: glowH, cy, texH: rect.h };

    // 命中区（与抽卡按钮同一槽位）
    this._departHit = { x: rect.offX, y: rect.hitOffY, w: rect.w, h: rect.h };

    // 出场：轻微缩放回弹（最终停在原始比例，与抽卡按钮尺寸一致）
    this.animateBtn(mesh, this._departDefaultScale, 1.06, 0.15);
    setTimeout(() => {
      if (this._departMesh === mesh) this.animateBtn(mesh, this._departDefaultScale, 1, 0);
    }, 160);
    return true;
  }

  private pressDepartBtn(): void {
    this.animateBtn(this._departMesh, this._departDefaultScale, 1.15, 1);
  }
  private releaseDepartBtn(): void {
    const s = this._isHoverDepart ? 1.05 : 1;
    this.animateBtn(this._departMesh, this._departDefaultScale, s, this._isHoverDepart ? 0.2 : 0);
  }

  // ============================================================
  // ★ 返回按钮（左上角）
  // ============================================================

  /**
   * 渲染左上角返回按钮。
   * - 尺寸：约 80px 高（1080p 基准，相机单位 0.075），保持纹理原始比例；
   * - 位置：左上角，留白 0.03（相机单位）；
   * - 只出现在抽卡页，不随「抽卡按钮 / 行动按钮」的切换而隐藏。
   *
   * 坐标系：相机 1 单位 = 屏幕短边像素；y 轴底原点。
   *   横屏 camTop = 1，竖屏 camTop = 1/aspect（与 syncSize 一致）。
   *   wx == 相机 x（两种朝向都成立），wy = camTop − 相机 y，
   *   所以命中矩形在 wy 空间的**尺寸与留白恰好等于相机单位的值** → 无需按朝向换算。
   */
  private renderBackButton(): void {
    const asset = this._backAsset;
    if (!asset) return;
    const pair = asset.getFramePair(0);
    if (!pair) return;

    const f = asset.frames[0];
    const texAspect = (f?.bbox.w || 252) / (f?.bbox.h || 88);

    const H = 0.075;          // 高度（相机单位，≈81px @1080p）
    const W = H * texAspect;  // 宽度按纹理比例（右侧不再留白）
    const MARGIN = 0.03;      // 左上角留白（相机单位，≈32px @1080p）

    const aspect = window.innerWidth / window.innerHeight;
    const camTop = aspect > 1 ? 1 : 1 / aspect;

    const cx = MARGIN + W / 2;
    const cy = camTop - MARGIN - H / 2; // 相机坐标（y 越大越靠上）

    const mat = this.makeHSLMat(pair.base, pair.residual);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.scale.set(W, H, 1);
    // z 高于抽卡/行动按钮（0.2），保证不被压住
    mesh.position.set(cx, cy, 0.21);
    this.scene.add(mesh);
    this._backMesh = mesh;
    this._backDefaultScale = { x: W, y: H };

    // 命中区：与 handleCanvasClick / handlePointerMove 的 wx / wy 同空间
    this._backHit = { x: MARGIN, y: MARGIN, w: W, h: H };
  }

  private pressBackBtn(): void {
    this.animateBtn(this._backMesh, this._backDefaultScale, 1.12, 1);
  }
  private releaseBackBtn(): void {
    const s = this._isHoverBack ? 1.05 : 1;
    this.animateBtn(this._backMesh, this._backDefaultScale, s, this._isHoverBack ? 0.2 : 0);
  }

  /** 复位回抽卡态（每次进入抽卡页时调用） */
  private resetToGachaState(): void {
    this._departMode = false;
    this._isHoverDepart = false;
    if (this._departMesh) {
      (this._departMesh.material as THREE.Material).dispose();
      this.scene.remove(this._departMesh);
      this._departMesh = null;
    }
    if (this._departGlowMesh) {
      (this._departGlowMesh.material as THREE.Material).dispose();
      this.scene.remove(this._departGlowMesh);
      this._departGlowMesh = null;
    }
    this._departDefaultScale = null;
    this._departGlowDef = null;
    this._departHit = null;
    if (!this._btnLeftMesh && !this._btnRightMesh) return;
    this.setGachaButtonsVisible(true);
  }

  // ============================================================
  // 渲染资源显示纹理（frame 1 - 右下）
  // ============================================================

  private renderResourceUI(uiAsset: FtxAsset): void {
    const pair = uiAsset.getFramePair(1);
    if (!pair) return;
    const f = uiAsset.frames[1];
    const fw = f?.bbox.w || 512;
    const fh = f?.bbox.h || 512;

    // 纹理绘制在右上区域（区域2：1.02倍，紧贴右上角）
    const aspect = window.innerWidth / window.innerHeight;
    const resX = 0.5956922368 * aspect;
    const resY = 0.89013376;
    const resW = 0.4043077632 * aspect;
    const resH = 0.10986624;

    const texAspect = fw / fh;
    let scaleW = resW;
    let scaleH = scaleW / texAspect;
    if (scaleH > resH) {
      scaleH = resH;
      scaleW = scaleH * texAspect;
    }
    // 在区域内居中对齐
    const cx = resX + resW / 2;
    const cy = resY + resH / 2;
    const mat = this.makeHSLMat(pair.base, pair.residual);
    this.addQuad(mat, scaleW, scaleH, cx, cy, 0.2);
  }

  // ============================================================
  // 第三层渲染（累积抽卡数字 + 六颗星星）
  // ============================================================

  private renderThirdLayer(starsAsset: FtxAsset, questionMark: FtxAsset): void {
    const aspect = window.innerWidth / window.innerHeight;

    // 1. 累积抽卡数字（JSON 区域：x:0.464~0.475, y:0.138~0.157）
    const numCx = 0.4693 * aspect + 0.002;
    const numCy = 0.078;
    const numW = 0.08 * aspect;
    const numH = 0.05;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    this._pullCountCanvas = canvas;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const totalPulls = this.session.gacha?.totalPulls ?? 0;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 70px "Arial", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(totalPulls), canvas.width / 2, canvas.height / 2);

    this._pullCountTexture = new THREE.CanvasTexture(canvas);
    this._pullCountTexture.needsUpdate = true;

    const numMat = new THREE.SpriteMaterial({
      map: this._pullCountTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const numSprite = new THREE.Sprite(numMat);
    numSprite.scale.set(numW, numH, 1);
    numSprite.position.set(numCx, numCy, 0.15);
    this.scene.add(numSprite);
    this._pullCountSprite = numSprite;

    // 2. 问号（左侧，缩小）
    const qPair = questionMark.getFramePair(0);
    if (!qPair) return;
    const qF = questionMark.frames[0];
    const qFw = qF?.bbox.w || 512;
    const qFh = qF?.bbox.h || 512;
    const qTexAspect = qFw / qFh;

    const starAreaX = 0.17 * aspect;
    const starAreaY = 0.37;
    const starAreaW = 0.3195 * aspect;
    const starAreaH = 0.1155;

    const qScale = 0.75;
    const qAreaH = starAreaH * qScale;
    const qAreaW = qAreaH * qTexAspect;
    const qAreaX = starAreaX;
    const qAreaY = starAreaY + (starAreaH - qAreaH) / 2; // 垂直居中

    const qMat = this.makeHSLMat(qPair.base, qPair.residual);
    this._questionMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), qMat);
    this._questionMesh.scale.set(qAreaW, qAreaH, 1);
    this._questionMesh.position.set(qAreaX + qAreaW / 2, qAreaY + qAreaH / 2, 0.15);
    this.scene.add(this._questionMesh);

    // 3. 六颗星星（问号右侧，占据剩余空间）
    const starPair = starsAsset.getFramePair(0);
    if (!starPair) return;
    const starF = starsAsset.frames[0];
    const starFw = starF?.bbox.w || 512;
    const starFh = starF?.bbox.h || 512;
    const starTexAspect = starFw / starFh;

    const qRight = qAreaX + qAreaW + 0.002 * aspect;
    const newStarAreaX = qRight;
    const newStarAreaW = (starAreaX + starAreaW) - qRight;

    let sStarW = newStarAreaW;
    let sStarH = sStarW / starTexAspect;
    if (sStarH > starAreaH) {
      sStarH = starAreaH;
      sStarW = sStarH * starTexAspect;
    }
    const starCx = newStarAreaX + sStarW / 2;
    const starCy = starAreaY + starAreaH / 2;
    const starMat = this.makeHSLMat(starPair.base, starPair.residual);
    this._starsMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), starMat);
    this._starsMesh.scale.set(sStarW, sStarH, 1);
    this._starsMesh.position.set(starCx, starCy, 0.15);
    this.scene.add(this._starsMesh);
  }

  /** 更新累积抽卡数字纹理 */
  private updatePullCount(): void {
    if (!this._pullCountCanvas || !this._pullCountTexture) return;
    const ctx = this._pullCountCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, this._pullCountCanvas.width, this._pullCountCanvas.height);
    const totalPulls = this.session.gacha?.totalPulls ?? 0;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 78px "Arial", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(totalPulls), this._pullCountCanvas.width / 2, this._pullCountCanvas.height / 2);
    this._pullCountTexture.needsUpdate = true;
  }

  // ============================================================
  // 概率显示页面（独立渲染器，简单直接）
  // ============================================================

  private showProbabilityPage(): void {
    if (!this._probAsset) return;

    const pair = this._probAsset.getFramePair(0);
    if (!pair) return;

    const f = this._probAsset.frames[0];
    const fw = f?.bbox.w || 512;
    const fh = f?.bbox.h || 512;

    const canvas = document.createElement('canvas');
    canvas.width = fw;
    canvas.height = fh;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true });
    applyShaderDebug(renderer);
    renderer.setSize(fw, fh, false);
    renderer.setClearColor(0x000000, 0);

    const mat = FtxAsset.createCompositeMaterial();
    mat.uniforms.uBase.value = pair.base;
    mat.uniforms.uResidual.value = pair.residual;
    mat.uniforms.uResidualRangeH.value = 0.5;
    mat.uniforms.uResidualRangeSL.value = 0.5;
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = false;
    mat.side = THREE.DoubleSide;

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.position.set(0.5, 0.5, 0);

    const scene = new THREE.Scene();
    scene.add(mesh);

    const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
    renderer.render(scene, camera);
    renderer.dispose();
    mat.dispose();

    // DOM 遮罩层
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:300',
      'display:flex', 'align-items:flex-start', 'justify-content:center',
      'padding-top:100px',
      'background:rgba(0,0,0,0.5)',
      'backdrop-filter:blur(12px)',
      '-webkit-backdrop-filter:blur(12px)',
    ].join(';');

    canvas.style.width = fw + 'px';
    canvas.style.height = fh + 'px';
    canvas.style.display = 'block';
    overlay.appendChild(canvas);
    // ★ 6★ 普瑞赛斯规则与当前保底计数（静态概率图不含此信息，这里动态补上）
    const pity = this.session.gacha?.bossPity ?? 0;
    const owned = !!this.session.outOfRun?.owned?.priestess;
    const info = document.createElement('div');
    info.style.cssText = [
      'position:absolute', 'left:50%', 'transform:translateX(-50%)', 'bottom:48px',
      'color:#ffe9b0', 'font:13px/1.9 "Microsoft YaHei",sans-serif', 'text-align:center',
      'text-shadow:0 1px 3px #000', 'background:rgba(12,9,4,0.82)', 'padding:10px 20px',
      'border:1px solid rgba(216,166,58,0.5)', 'border-radius:6px', 'pointer-events:none',
      'white-space:pre-line',
    ].join(';');
    const relicPity = this.session.gacha?.pityCounter ?? 0;
    info.textContent = owned
      ? `6★ 普瑞赛斯：已获得 —— 下一次出击进入「四维空间」，击败她即通关
遗物保底：每 10 抽内必出遗物（当前累计 ${relicPity} 抽）`
      : `6★ 普瑞赛斯（唯一 6★）：基础 2%；连续 50 抽未出后每抽 +2%；第 99 抽必出
当前已累计 ${pity} 抽（获得后重置）
遗物保底：每 10 抽内必出遗物（当前累计 ${relicPity} 抽）`;
    overlay.appendChild(info);
    this.root.appendChild(overlay);

    overlay.addEventListener('click', () => {
      overlay.remove();
    });

  }

  // ============================================================
  // 点击处理
  // ============================================================

  private handleCanvasClick(e: PointerEvent): void {
    if (!this.ready) return;

    const rect = this.canvas.getBoundingClientRect();
    const aspect = window.innerWidth / window.innerHeight;

    // 将鼠标坐标映射到相机世界坐标
    let wx: number, wy: number;
    if (aspect > 1) {
      wx = ((e.clientX - rect.left) / rect.width) * aspect;
      wy = (e.clientY - rect.top) / rect.height;
    } else {
      wx = (e.clientX - rect.left) / rect.width;
      wy = ((e.clientY - rect.top) / rect.height) * (1 / aspect);
    }

    // ★ 返回按钮（左上角）：关闭抽卡页，回到基地主页面（不触发出击）
    const bk = this._backHit;
    if (bk && wx >= bk.x && wx <= bk.x + bk.w && wy >= bk.y && wy <= bk.y + bk.h) {
      this.pressBackBtn();
      setTimeout(() => this.releaseBackBtn(), 150);
      setTimeout(() => this.hide(), 170);
      return;
    }

    // 概率显示按钮（透明按钮）
    const pb = this._probButtonHit;
    if (pb && wx >= pb.x && wx <= pb.x + pb.w && wy >= pb.y && wy <= pb.y + pb.h) {
      this.showProbabilityPage();
      return;
    }

    // ★ 行动态：只响应行动按钮，点击才出击
    if (this._departMode) {
      const d = this._departHit;
      if (d && wx >= d.x && wx <= d.x + d.w && wy >= d.y && wy <= d.y + d.h) {
        this.pressDepartBtn();
        setTimeout(() => this.releaseDepartBtn(), 150);
        setTimeout(() => {
          this.hide();
          this.onDepart?.();
        }, 170);
        return;
      }
      // 非按钮区域：继续背景流体交互
      this.isPointerDown = true;
      this.injectFluidAt(e);
      return;
    }

    const { left, right } = this.buttonHit;

    if (wx >= left.x && wx <= left.x + left.w + right.w &&
        wy >= left.y && wy <= left.y + left.h) {
      if (wx <= left.x + left.w) {
        // 左半（单抽）→ 按钮按下效果
        this.pressLeftBtn();
        setTimeout(() => this.releaseLeftBtn(), 150);
        this.doGacha(1);
      } else {
        // 右半（十连）→ 按钮按下效果
        this.pressRightBtn();
        setTimeout(() => this.releaseRightBtn(), 150);
        this.doGacha(10);
      }
      return; // ★ 按钮区域不注入流体
    }

    // 点击背景 → 注入流体
    this.isPointerDown = true;
    this.injectFluidAt(e);
  }

  /** 在鼠标位置注入水（颜色 + 速度） */
  private injectFluidAt(e: PointerEvent): void {
    if (!this.bgFluidEffect) return;
    if (!this._fluidStarted) this._fluidStarted = true;
    const rect = this.canvas.getBoundingClientRect();
    const uv = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    // 注入水和速度：水颜色 HSLA (浅蓝白)，速度向下驱动流动
    this.bgFluidEffect.solver.queueInjection({
      enabled: true,
      position: uv,
      radius: 0.08,
      velocity: { x: 0, y: 300 },
      color: [0.55, 0.3, 0.9, 0.9],
      rate: 1.0,
    });
  }

  /** 拖拽时持续注入流体 */

  // ============================================================
  // 抽卡逻辑
  // ============================================================

  private doGacha(count: number): void {
    const s = this.session;
    // ★ 抽卡完全免费：无票证、无资源消耗
    if (!s.gacha) s.gacha = { pityCounter: 0, totalPulls: 0 };
    if (!s.outOfRun) s.outOfRun = { owned: {} };
    if (!s.outOfRun.owned) s.outOfRun.owned = {};

    // ★ 单一综合池 = 物资（进背包）+ 遗物（永久生效）；kind 决定落账目标
    type PoolEntry = { kind: 'inRun' | 'outRun'; id: string; rarity: number; weight: number; name: string; description: string };
    const pool: PoolEntry[] = [];
    for (const it of (gachaPool.items ?? [])) {
      const cfg = itemsJson.items.find((i) => i.id === it.id);
      pool.push({
        kind: 'inRun',
        id: it.id,
        rarity: it.rarity,
        weight: it.weight,
        name: cfg?.name ?? it.id,
        description: cfg?.description ?? '',
      });
    }
    for (const o of (gachaPool.outOfRunItems ?? [])) {
      const cfg = RELIC_ITEM_CONFIG[o.id];
      pool.push({
        kind: 'outRun',
        id: o.id,
        rarity: o.rarity,
        weight: o.weight,
        name: cfg?.name ?? o.id,
        description: cfg?.description ?? '',
      });
    }

    if (pool.length === 0) {
      this.showResult([{ kind: 'inRun', id: '', name: '卡池为空', rarity: 0, description: '卡池还没有收录任何道具', isNew: false }]);
      return;
    }

    let totalWeight = 0;
    for (const p of pool) totalWeight += p.weight;
    // ★ 遗物保底（2026-09-13 用户定调）：连续 10 抽未出遗物 → 下一抽必出遗物
    const PITY_LIMIT = 10;

    // ★ 6★ 普瑞赛斯（唯一 6★）：明日方舟 6★ 规则——
    //   基础 2%；连续 50 抽未出 6★ → 第 51 抽起每抽 +2%（第 51 抽 4%）；
    //   第 99 抽必出（100%）；获得即重置计数
    const bossCfg = (gachaPool as unknown as { boss?: { id: string; rarity: number } }).boss;

    const results: GachaResultEntry[] = [];
    for (let i = 0; i < count; i++) {
      s.gacha.totalPulls++;
      s.gacha.pityCounter++;

      // ★ 普瑞赛斯优先判定（未拥有时）；命中则本次该抽归她
      if (bossCfg && !s.outOfRun.owned[bossCfg.id]) {
        s.gacha.bossPity = (s.gacha.bossPity ?? 0) + 1;
        const n = s.gacha.bossPity;
        // 明日方舟 6★ 概率：≤50 抽恒 2%；第 51 抽起 +2%/抽；第 99 抽 100%
        const chance = n <= 50 ? 0.02 : Math.min(1, 0.02 + 0.02 * (n - 50));
        if (Math.random() < chance) {
          s.outOfRun.owned[bossCfg.id] = 1;
          s.gacha.bossPity = 0;
          const cfg = RELIC_ITEM_CONFIG[bossCfg.id];
          results.push({
            // ★ 普瑞赛斯是 BOSS，不是遗物 → 结果卡挂「BOSS」牌
            kind: 'boss',
            id: bossCfg.id,
            name: cfg?.name ?? bossCfg.id,
            rarity: bossCfg.rarity,
            description: cfg?.description ?? '',
            isNew: true,
          });
          continue; // 该抽已归属普瑞赛斯
        }
      }

      let picked: PoolEntry;
      const relics = pool.filter((p) => p.kind === 'outRun');
      if (relics.length > 0 && s.gacha.pityCounter >= PITY_LIMIT) {
        // ★ 保底：必出遗物（物资不参与）
        picked = relics[Math.floor(Math.random() * relics.length)];
      } else {
        let roll = Math.random() * totalWeight;
        picked = pool[0];
        for (const p of pool) {
          roll -= p.weight;
          if (roll <= 0) { picked = p; break; }
        }
      }

      if (picked.kind === 'inRun') {
        // 局内道具 → 入玩家背包（同层合并；背包满 → 白抽警示）
        const added = addItemToGrid(s.inventories.player, picked.id, 1);
        results.push({
          kind: 'inRun',
          id: picked.id,
          name: picked.name,
          rarity: picked.rarity,
          description: added ? picked.description : picked.description + '（玩家背包已满，无法入账）',
          isNew: false,
        });
      } else {
        // 遗物 → 永久生效（数量叠加）
        const owned = s.outOfRun.owned[picked.id] ?? 0;
        s.outOfRun.owned[picked.id] = owned + 1;
        results.push({
          kind: 'outRun',
          id: picked.id,
          name: picked.name,
          rarity: picked.rarity,
          description: picked.description,
          isNew: owned === 0,
        });
      }
      // ★ 抽中遗物 → 保底计数重置（物资不重置；普瑞赛斯抽不占用遗物保底判定）
      if (picked.kind === 'outRun') s.gacha.pityCounter = 0;
    }

    this.updatePullCount();
    SaveSystem.save(s);
    // ★ 点击抽卡的瞬间就把抽卡按钮换成行动按钮（不等结果列表关闭）
    this.switchToDepartButton();
    this.showResult(results);
  }

  private showResult(results: GachaResultEntry[]): void {
    this.resultList.innerHTML = '';
    for (const r of results) {
      const item = document.createElement('div');
      let cls = 'rarity-3';
      if (r.rarity >= 6) cls = 'rarity-6';
      else if (r.rarity >= 5) cls = 'rarity-5';
      else if (r.rarity >= 4) cls = 'rarity-4';
      item.className = 'result-item ' + cls;
      item.style.cssText = [
        'display:flex', 'align-items:center', 'gap:12px',
        'padding:10px 14px', 'background:rgba(255,255,255,0.05)',
        'border-radius:8px', 'border-left:3px solid #666',
      ].join(';');

      const rarityLabel = r.rarity >= 6 ? '\u26056' : r.rarity >= 5 ? '\u26055' : r.rarity >= 4 ? '\u26054' : '\u26053';
      const newBadge = r.isNew ? ' \uD83C\uDD95' : '';

      // ★ 牌子三态：物资（蓝）/ 遗物（金）/ BOSS（赤红）—— 普瑞赛斯走 BOSS
      const badge = r.kind === 'boss'
        ? '<span style="color:#f96;font-size:12px;padding:1px 6px;background:rgba(255,86,64,0.15);border:1px solid rgba(255,86,64,0.45);border-radius:4px;margin-right:6px;">BOSS</span>'
        : r.kind === 'outRun'
          ? '<span style="color:#ff9;font-size:12px;padding:1px 6px;background:rgba(255,215,0,0.15);border:1px solid rgba(255,215,0,0.4);border-radius:4px;margin-right:6px;">遗物</span>'
          : '<span style="color:#9cf;font-size:12px;padding:1px 6px;background:rgba(68,136,255,0.15);border:1px solid rgba(68,136,255,0.45);border-radius:4px;margin-right:6px;">物资</span>';

      item.appendChild(this.makeResultIcon(r));

      const nameDiv = document.createElement('div');
      nameDiv.style.cssText = 'flex:1;text-align:left;';
      nameDiv.innerHTML = '<div style="color:#eee;font-size:15px;font-weight:bold;">' +
        badge + r.name + newBadge + '</div>' +
        (r.description ? '<div style="color:#888;font-size:12px;margin-top:2px;">' + r.description + '</div>' : '');

      const raritySpan = document.createElement('span');
      raritySpan.style.cssText = 'font-size:12px;padding:2px 8px;border-radius:4px;';
      if (r.rarity >= 6) raritySpan.style.cssText += 'color:#ffd700;background:rgba(255,215,0,0.2);';
      else if (r.rarity >= 5) raritySpan.style.cssText += 'color:#c8a0ff;background:rgba(170,68,170,0.2);';
      else if (r.rarity >= 4) raritySpan.style.cssText += 'color:#8af;background:rgba(68,136,255,0.2);';
      else raritySpan.style.cssText += 'color:#8c8;background:rgba(68,170,68,0.2);';
      raritySpan.textContent = rarityLabel;

      item.appendChild(nameDiv);
      item.appendChild(raritySpan);
      this.resultList.appendChild(item);
    }
    this.resultOverlay.style.display = 'flex';
  }

/** ★ 结果卡片图标：与背包/加工台同一条绘制管线（局外 FTX 纹理、局内物品色块/无人机动态播放） */
  private makeResultIcon(r: GachaResultEntry): HTMLElement {
    const box = document.createElement('div');
    const borderColor = r.rarity >= 5 ? '#c8a0ff' : r.rarity >= 4 ? '#8af' : '#8c8';
    box.style.cssText = [
      'width:48px', 'height:48px', 'border-radius:8px', 'overflow:hidden', 'flex:none',
      `border:2px solid ${borderColor}`, 'background:rgba(15,15,30,0.7)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');
    // ★ 多帧纹理：局外条目（遗物 / BOSS）按拥有数选帧（如砾小姐的爱：1件=帧1、≥2件=帧2）
    const isOutRun = r.kind !== 'inRun';
    const owned = isOutRun ? (this.session.outOfRun?.owned?.[r.id] ?? 0) : 0;
    const cfg = isOutRun ? RELIC_ITEM_CONFIG[r.id] : undefined;
    const frame = cfg?.iconFrame ? cfg.iconFrame(owned) : 0;
    const el = this.iconRegistry.createIconElement(r.id, frame);
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.objectFit = 'contain';
    box.appendChild(el);
    return box;
  }

  // ============================================================
  // 显示/隐藏
  // ============================================================

  show(onDepart: () => void): void {
    this.onDepart = onDepart;
    // ★ 抽卡页预热小地图（当天地图种子 + 出生格已知、地形色纯函数）：
    //   分帧算好 探索圆盘 / 底图 / LOD 边带索引 → 出击进世界时直接交接，首帧零成本。
    //   幂等（同种子直接返回）；换天换局换种子自动重算；失败一律回退冷路径。
    warmupMinimap(this.session);
    // ★ 每次进入抽卡页都回到「抽卡按钮」态（行动按钮由抽完卡触发）
    this.resetToGachaState();
    this.root.style.display = 'block';
    this.syncSize();
    this.tick();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.resultOverlay.style.display = 'none';
  }

  /** ★ 是否正在显示（基地提示/输入遮挡判定用） */
  isOpen(): boolean {
    return this.root.style.display !== 'none';
  }

  private syncSize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.setScissorTest(false);

    // 相机匹配窗口宽高比，保证 0-1 归一化坐标映射到正确屏幕位置
    const aspect = w / h;
    if (aspect > 1) {
      this.camera.left = 0;
      this.camera.right = aspect;
      this.camera.top = 1;
      this.camera.bottom = 0;
    } else {
      this.camera.left = 0;
      this.camera.right = 1;
      this.camera.top = 1 / aspect;
      this.camera.bottom = 0;
    }
    this.camera.updateProjectionMatrix();
  }

  /** 创建纯白粒子（从右下到左上缓慢飘飞） */
  private createParticles(): void {
    const count = this._particleCount;
    const positions = new Float32Array(count * 3);
    const data = new Float32Array(count * 5); // [velX, velY, phase, age, lifespan]
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count); // 0=黑, 1=白
    for (let i = 0; i < count; i++) {
      positions[i * 3] = Math.random();           // X 随机
      positions[i * 3 + 1] = Math.random();       // Y 随机
      positions[i * 3 + 2] = 0;
      data[i * 5] = -(0.02 + Math.random() * 0.04);     // velX 向左
      data[i * 5 + 1] = 0.02 + Math.random() * 0.04;    // velY 向上
      data[i * 5 + 2] = Math.random() * Math.PI * 2;    // phase
      data[i * 5 + 3] = Math.random() * 1.5;             // age 随机初始进度
      data[i * 5 + 4] = 1 + Math.random() * 2;           // lifespan 1~3 秒
      sizes[i] = 0;
      colors[i] = Math.random(); // 初始随机黑白
    }
    this._particlePositions = positions;
    this._particleData = data;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute float aSize;
        attribute float aColor;
        varying float vAlpha;
        varying float vColor;
        void main() {
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize;
          gl_Position = projectionMatrix * mvPosition;
          vAlpha = step(0.5, aSize);
          vColor = aColor;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vColor;
        void main() {
          float c = vColor;
          gl_FragColor = vec4(c, c, c, vAlpha);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this._particles = new THREE.Points(geo, mat);
    this._particles.position.set(0, 0, 0.2);
    this.scene.add(this._particles);
  }

  private tick(): void {
    if (this.root.style.display === 'none') return;
    const now = performance.now() / 1000;
    const dt = this.lastTickTime > 0 ? now - this.lastTickTime : 0;
    this.lastTickTime = now;

    // 步进流体模拟（首次交互后才启动）
    if (this.bgFluidEffect && this._fluidStarted) {
      this.bgFluidEffect.step(dt);
    }

    // 更新粒子
    if (this._particlePositions && this._particleData && this._particles) {
      const pos = this._particlePositions;
      const data = this._particleData; // [velX, velY, phase, age, lifespan]
      const sizeAttr = this._particles.geometry.attributes.aSize as THREE.BufferAttribute;
      const sizes = sizeAttr.array;
      const colorAttr = this._particles.geometry.attributes.aColor as THREE.BufferAttribute;
      const colors = colorAttr.array;
      const camW = this.camera.right - this.camera.left;
      const camH = this.camera.top - this.camera.bottom;
      for (let i = 0; i < this._particleCount; i++) {
        const idx = i * 5;
        // 推进 age
        data[idx + 3] += dt;
        // 生命周期结束，重置到随机位置
        if (data[idx + 3] >= data[idx + 4]) {
          data[idx + 3] = 0;
          data[idx + 4] = 1 + Math.random() * 2;
          pos[i * 3] = Math.random();
          pos[i * 3 + 1] = Math.random();
          data[idx] = -(0.02 + Math.random() * 0.04);
          data[idx + 1] = 0.02 + Math.random() * 0.04;
          data[idx + 2] = Math.random() * Math.PI * 2;
        }
        // 向右上移动
        pos[i * 3] += data[idx] * dt;       // X 向左
        pos[i * 3 + 1] += data[idx + 1] * dt; // Y 向上
        // 超出范围则重置
        if (pos[i * 3] < 0 || pos[i * 3 + 1] > 1) {
          data[idx + 3] = data[idx + 4]; // 强制结束生命周期
        }
        // 颜色黑白渐变（基于生命周期，缓慢变化）
        const colorPhase = (data[idx + 3] / data[idx + 4] + data[idx + 2] / (Math.PI * 2)) % 1;
        colors[i] = 0.5 + 0.5 * Math.sin(colorPhase * Math.PI * 2);
        // 淡入淡出
        const life = data[idx + 3] / data[idx + 4];
        const fadeIn = Math.min(life / 0.15, 1);
        const fadeOut = Math.min((1 - life) / 0.2, 1);
        sizes[i] = 4 * Math.min(fadeIn, fadeOut);
      }
      sizeAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;
      this._particles.scale.set(camW, camH, 1);
      this._particles.geometry.attributes.position.needsUpdate = true;
    }

    // 更新时间
    for (const mat of this._charMats) {
      if (mat.uniforms.uTime) mat.uniforms.uTime.value = now;
    }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.tick());
  }

  dispose(): void {
    this.hide();
    window.removeEventListener('resize', this.onResize);
    this._charMats.length = 0;

    // 清理第三层元素
    if (this._pullCountSprite) {
      this._pullCountSprite.material.dispose();
      this.scene.remove(this._pullCountSprite);
      this._pullCountSprite = null;
    }
    if (this._pullCountTexture) {
      this._pullCountTexture.dispose();
      this._pullCountTexture = null;
    }
    this._pullCountCanvas = null;
    if (this._starsMesh) {
      const mat = this._starsMesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat.dispose();
      this.scene.remove(this._starsMesh);
      this._starsMesh = null;
    }
    if (this._questionMesh) {
      const mat = this._questionMesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else mat.dispose();
      this.scene.remove(this._questionMesh);
      this._questionMesh = null;
    }
    if (this._btnLeftMesh) {
      (this._btnLeftMesh.material as THREE.Material).dispose();
      this.scene.remove(this._btnLeftMesh);
      this._btnLeftMesh = null;
    }
    if (this._btnRightMesh) {
      (this._btnRightMesh.material as THREE.Material).dispose();
      this.scene.remove(this._btnRightMesh);
      this._btnRightMesh = null;
    }
    // ★ 行动按钮（抽卡按钮替代态）
    if (this._departGlowMesh) {
      (this._departGlowMesh.material as THREE.Material).dispose();
      this.scene.remove(this._departGlowMesh);
      this._departGlowMesh = null;
    }
    if (this._departMesh) {
      (this._departMesh.material as THREE.Material).dispose();
      this.scene.remove(this._departMesh);
      this._departMesh = null;
    }
    this._departDefaultScale = null;
    this._departGlowDef = null;
    this._departHit = null;
    this._departMode = false;
    this._departAsset?.dispose();
    this._departAsset = null;
    // ★ 返回按钮（左上角）
    if (this._backMesh) {
      (this._backMesh.material as THREE.Material).dispose();
      this.scene.remove(this._backMesh);
      this._backMesh = null;
    }
    this._backDefaultScale = null;
    this._backHit = null;
    this._isHoverBack = false;
    this._backAsset?.dispose();
    this._backAsset = null;
    if (this._btnAnimId !== null) {
      cancelAnimationFrame(this._btnAnimId);
      this._btnAnimId = null;
    }
    this._btnAnimData = [];
    if (this._particles) {
      this._particles.geometry.dispose();
      (this._particles.material as THREE.Material).dispose();
      this.scene.remove(this._particles);
      this._particles = null;
    }

    if (this.bgFluidEffect) {
      this.bgFluidEffect.dispose();
      this.bgFluidEffect = null;
    }

    this.renderer.dispose();
    document.body.removeChild(this.root);
  }
}