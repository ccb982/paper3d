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
import type { GameSession } from '../../core/Session';
import { createEmptyGrid } from '../../core/Session';
import { SaveSystem } from '../../core/SaveSystem';
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
  private tickets: number;
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

  // 按钮动画
  private _btnAnimId: number | null = null;
  private _btnAnimData: { mesh: THREE.Mesh; defScale: { x: number; y: number }; sStart: number; sEnd: number; gStart: number; gEnd: number; t0: number }[] = [];

  // 概率显示页面
  private _probAsset: FtxAsset | null = null;
  private _probOverlay: HTMLDivElement | null = null;
  private _probButtonHit: { x: number; y: number; w: number; h: number } | null = null;

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
  ) {
    this.tickets = (session as any).resources?.gachaTickets ?? 999;
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
      // ★ 抽完自动出击
      this.hide();
      this.onDepart?.();
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
    lgGrad.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    lgGrad.addColorStop(0.6, 'rgba(255,255,255,0.15)');
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
    rgGrad.addColorStop(0.3, 'rgba(255,200,0,0.5)');
    rgGrad.addColorStop(0.6, 'rgba(255,200,0,0.15)');
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
    this.root.appendChild(overlay);

    overlay.addEventListener('click', () => {
      overlay.remove();
      this._probOverlay = null;
    });

    this._probOverlay = overlay;
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

    // 概率显示按钮（透明按钮）
    const pb = this._probButtonHit;
    if (pb && wx >= pb.x && wx <= pb.x + pb.w && wy >= pb.y && wy <= pb.y + pb.h) {
      this.showProbabilityPage();
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
    if (this.tickets < count) {
      this.showResult([{ name: '招募凭证不足', rarity: 0, description: '需要 ' + count + ' 张招募凭证', isNew: false }]);
      return;
    }

    this.tickets -= count;
    if (!s.gacha) s.gacha = { pityCounter: 0, totalPulls: 0 };
    if (!s.allies.roster) s.allies.roster = [];

    const chars = gachaPool.characters;
    let totalWeight = 0;
    for (const ch of chars) totalWeight += ch.weight;

    const results: Array<{ name: string; rarity: number; description: string; isNew: boolean }> = [];
    for (let i = 0; i < count; i++) {
      s.gacha.totalPulls++;
      s.gacha.pityCounter++;

      let roll = Math.random() * totalWeight;
      let picked = chars[0];

      if (s.gacha.pityCounter >= 90) {
        const sixStars = chars.filter(c => c.rarity === 6);
        if (sixStars.length > 0) {
          picked = sixStars[Math.floor(Math.random() * sixStars.length)];
          s.gacha.pityCounter = 0;
        }
      } else {
        for (const ch of chars) {
          roll -= ch.weight;
          if (roll <= 0) { picked = ch; break; }
        }
      }

      const isNew = s.allies.roster.indexOf(picked.id) === -1;
      results.push({
        name: picked.name,
        rarity: picked.rarity,
        description: picked.description,
        isNew,
      });

      if (isNew) {
        s.allies.roster.push(picked.id);
        if (!s.inventories.allies) s.inventories.allies = {};
        if (!s.inventories.allies[picked.id]) {
          s.inventories.allies[picked.id] = createEmptyGrid(3, 2);
        }
      }
      if (picked.rarity === 6) s.gacha.pityCounter = 0;
    }

    this.updatePullCount();
    SaveSystem.save(s);
    this.showResult(results);
  }

  private showResult(results: Array<{ name: string; rarity: number; description: string; isNew: boolean }>): void {
    this.resultList.innerHTML = '';
    for (const r of results) {
      const item = document.createElement('div');
      let cls = 'rarity-3';
      if (r.rarity >= 6) cls = 'rarity-6';
      else if (r.rarity >= 5) cls = 'rarity-5';
      else if (r.rarity >= 4) cls = 'rarity-4';
      item.className = 'result-item ' + cls;
      item.style.cssText = [
        'display:flex', 'align-items:center', 'justify-content:space-between',
        'padding:10px 14px', 'background:rgba(255,255,255,0.05)',
        'border-radius:8px', 'border-left:3px solid #666',
      ].join(';');

      const rarityLabel = r.rarity >= 6 ? '\u26056' : r.rarity >= 5 ? '\u26055' : r.rarity >= 4 ? '\u26054' : '\u26053';
      const newBadge = r.isNew ? ' \uD83C\uDD95' : '';

      const nameDiv = document.createElement('div');
      nameDiv.innerHTML = '<div style="color:#eee;font-size:15px;font-weight:bold;">' + r.name + newBadge + '</div>' +
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

  // ============================================================
  // 显示/隐藏
  // ============================================================

  show(onDepart: () => void): void {
    this.onDepart = onDepart;
    this.root.style.display = 'block';
    this.syncSize();
    this.tick();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.resultOverlay.style.display = 'none';
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