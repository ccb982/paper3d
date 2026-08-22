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
    gl_FragColor = vec4(hsl2rgb(vec3(h, s, l)), base.a * uAlpha);
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

  constructor(
    private session: GameSession,
  ) {
    this.tickets = session.resources?.gachaTickets ?? 999;
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
    this.canvas.addEventListener('pointerleave', () => { this.isPointerDown = false; });

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
    const ui = await FtxAsset.load('/ui/抽卡页面第三层ui.ftx3.gz');
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

    // 第三层：累积抽卡数字 + 六颗星星
    const stars = await FtxAsset.load('/ui/六颗星星.ftx3.gz');
    this.renderThirdLayer(stars);

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
    const mat = this.makeHSLMat(pair.base, pair.residual);
    this.addQuad(mat, texW, texH, cx, cy, 0.2);
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

  private renderThirdLayer(starsAsset: FtxAsset): void {
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

    // 2. 六颗星星（JSON 区域：x:0.173~0.386, y:0.419~0.496）
    // 使用 FTX 纹理渲染，Y 使用原始 JSON 坐标（Y=0 顶部）
    const starPair = starsAsset.getFramePair(0);
    if (!starPair) return;
    const starF = starsAsset.frames[0];
    const starFw = starF?.bbox.w || 512;
    const starFh = starF?.bbox.h || 512;
    const starTexAspect = starFw / starFh;

    const starAreaX = 0.125 * aspect; // 左移
    const starAreaY = 0.37; // 略微下移
    const starAreaW = 0.3195 * aspect; // 1.5 倍
    const starAreaH = 0.1155; // 1.5 倍

    let sStarW = starAreaW;
    let sStarH = sStarW / starTexAspect;
    if (sStarH > starAreaH) {
      sStarH = starAreaH;
      sStarW = sStarH * starTexAspect;
    }
    const starCx = starAreaX + starAreaW / 2;
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
    const { left, right } = this.buttonHit;

    if (wx >= left.x && wx <= left.x + left.w + right.w &&
        wy >= left.y && wy <= left.y + left.h) {
      if (wx <= left.x + left.w) {
        this.doGacha(1);
      } else {
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
  private handlePointerMove(e: PointerEvent): void {
    if (!this.isPointerDown || !this.bgFluidEffect) return;
    this.injectFluidAt(e);
  }

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

  private tick(): void {
    if (this.root.style.display === 'none') return;
    const now = performance.now() / 1000;
    const dt = this.lastTickTime > 0 ? now - this.lastTickTime : 0;
    this.lastTickTime = now;

    // 步进流体模拟（首次交互后才启动）
    if (this.bgFluidEffect && this._fluidStarted) {
      this.bgFluidEffect.step(dt);
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
      this._starsMesh.material.dispose();
      this.scene.remove(this._starsMesh);
      this._starsMesh = null;
    }

    if (this.bgFluidEffect) {
      this.bgFluidEffect.dispose();
      this.bgFluidEffect = null;
    }
    this.renderer.dispose();
    document.body.removeChild(this.root);
  }
}