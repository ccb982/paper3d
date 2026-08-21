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
  private ticketsEl: HTMLSpanElement;
  private pityEl: HTMLSpanElement;
  private resultOverlay: HTMLDivElement;
  private resultList: HTMLDivElement;
  private departBtn: HTMLButtonElement;
  private tickets: number;

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

    // ---- 资源显示（FTX 纹理覆盖层，位于标注区域 (0.59,0.69)~(0.99,0.71)） ----
    // 使用 DOM 元素覆盖在 FTX 纹理上方显示文字
    const resourceBar = document.createElement('div');
    resourceBar.id = 'gacha-resource-bar';
    resourceBar.style.cssText = [
      'position:fixed', 'pointer-events:none', 'z-index:156',
      'display:flex', 'align-items:center', 'justify-content:center',
      'gap:20px', 'color:#ffd700', 'font-size:13px', 'font-weight:bold',
      'text-shadow:0 0 6px rgba(0,0,0,0.9)',
    ].join(';');
    resourceBar.innerHTML = [
      '<div style="display:flex;align-items:center;gap:4px;">',
      '<span style="font-size:16px;">&#x1F48E;</span>',
      '<span id="gacha-tickets">招募凭证: 999</span>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:4px;">',
      '<span style="font-size:16px;">&#x2B50;</span>',
      '<span id="gacha-pity">保底计数: 0</span>',
      '</div>',
    ].join('');
    this.root.appendChild(resourceBar);
    this.ticketsEl = resourceBar.querySelector('#gacha-tickets')!;
    this.pityEl = resourceBar.querySelector('#gacha-pity')!;

    // 保底提示
    const pityInfo = document.createElement('div');
    pityInfo.id = 'gacha-pity-info';
    pityInfo.style.cssText = [
      'position:fixed', 'bottom:80px', 'left:50%', 'transform:translateX(-50%)',
      'color:rgba(255,255,255,0.4)', 'font-size:12px', 'z-index:155',
      'pointer-events:none', 'text-shadow:0 0 4px rgba(0,0,0,0.8)',
    ].join(';');
    pityInfo.textContent = '每 90 抽必出 \u26056 干员';
    this.root.appendChild(pityInfo);

    // 出击按钮
    this.departBtn = document.createElement('button');
    this.departBtn.id = 'gacha-depart-btn';
    this.departBtn.style.cssText = [
      'position:fixed', 'bottom:30px', 'right:30px', 'z-index:155',
      'padding:14px 36px', 'font-size:18px', 'font-weight:bold',
      'background:linear-gradient(135deg,#4488ff,#2266dd)', 'color:#fff',
      'border:2px solid #66aaff', 'border-radius:12px',
      'cursor:pointer', 'box-shadow:0 0 20px rgba(68,136,255,0.4)',
      'transition:all 0.2s', 'display:none',
    ].join(';');
    this.departBtn.textContent = '\uD83D\uDE80 出击';
    this.departBtn.addEventListener('mouseenter', () => {
      this.departBtn.style.transform = 'scale(1.05)';
      this.departBtn.style.boxShadow = '0 0 30px rgba(68,136,255,0.6)';
    });
    this.departBtn.addEventListener('mouseleave', () => {
      this.departBtn.style.transform = 'scale(1)';
      this.departBtn.style.boxShadow = '0 0 20px rgba(68,136,255,0.4)';
    });
    this.departBtn.addEventListener('click', () => {
      this.hide();
      this.onDepart?.();
    });
    this.root.appendChild(this.departBtn);

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
    });

    // 画布点击
    this.canvas.addEventListener('pointerdown', (e) => this.handleCanvasClick(e));

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
    const btn = await FtxAsset.load('/ui/抽卡按钮.ftx3.gz');
    let charAsset: Asset | FtxAsset | null = null;
    try {
      charAsset = await Asset.load('/characters/enemies/普瑞赛斯.scene.zip');
    } catch {
      charAsset = null;
    }

    this.renderBackground(bg);
    if (charAsset) this.renderCharacter(charAsset);
    this.renderButtonUI(btn);
    this.renderResourceUI(btn);

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
  // 渲染背景（Layer 1 - 全屏）
  // ============================================================

  private renderBackground(bgAsset: FtxAsset): void {
    const pair = bgAsset.getFramePair(0);
    if (!pair) return;
    const mat = this.makeHSLMat(pair.base, pair.residual);
    const aspect = window.innerWidth / window.innerHeight;
    if (aspect > 1) {
      this.addQuad(mat, aspect, 1, aspect / 2, 0.5, 0);
    } else {
      this.addQuad(mat, 1, 1 / aspect, 0.5, 0.5 / aspect, 0);
    }
  }

  // ============================================================
  // 渲染普瑞赛斯（Layer 3 - 标注: x:0.627~0.867, y:0.103~0.791）
  //   保持纹理比例，不裁剪变形
  // ============================================================

  private renderCharacter(charAsset: Asset | FtxAsset): void {
    let pair: { base: THREE.DataTexture; residual: THREE.DataTexture } | null = null;
    let fw = 512, fh = 512;

    if (charAsset instanceof Asset) {
      pair = charAsset.getFramePair(0);
      const ftxFrame = charAsset.getFtxFrame(0);
      if (ftxFrame) { fw = ftxFrame.width; fh = ftxFrame.height; }
    } else {
      pair = charAsset.getFramePair(0);
      const f = charAsset.frames[0];
      if (f) { fw = f.width; fh = f.height; }
    }
    if (!pair) return;

    // ★ 标注区域 (0..1 纹理空间): x:0.627~0.867, y:0.103~0.791
    //   相机空间 x 需乘以 aspect
    const aspect = window.innerWidth / window.innerHeight;
    const areaX = 0.627 * aspect;
    const areaY = 0.103;
    const areaW = (0.867 - 0.627) * aspect; // 0.240 * aspect
    const areaH = 0.791 - 0.103; // 0.688

    const texAspect = fw / fh;

    // 在标注区域内居中放置，保持纹理比例
    let quadW = areaW;
    let quadH = quadW / texAspect;
    if (quadH > areaH) {
      quadH = areaH;
      quadW = quadH * texAspect;
    }

    const mat = this.makeHSLMat(pair.base, pair.residual);
    this.addQuad(mat, quadW, quadH, areaX + quadW / 2, areaY + quadH / 2, 0.1);
  }

  // ============================================================
  // 渲染抽卡按钮（Layer 4 - 标注: x:0.605~0.867, y:0.103~0.236）
  //   左半=单抽，右半=10抽
  // ============================================================

  private renderButtonUI(btnAsset: FtxAsset): void {
    const pair = btnAsset.getFramePair(0);
    if (!pair) return;
    const f = btnAsset.frames[0];
    const fw = f?.width || 512;
    const fh = f?.height || 512;

    // ★ 标注区域 (0..1 纹理空间): x:0.605~0.867, y:0.103~0.236
    const aspect = window.innerWidth / window.innerHeight;
    const btnX = 0.605 * aspect;
    const btnY = 0.103;
    const btnW = (0.867 - 0.605) * aspect; // 0.262 * aspect
    const btnH = 0.236 - 0.103; // 0.133

    // 保持纹理比例，适配标注区域
    const texAspect = fw / fh;
    let scaleW = btnW;
    let scaleH = scaleW / texAspect;
    if (scaleH > btnH) {
      scaleH = btnH;
      scaleW = scaleH * texAspect;
    }

    const mat = this.makeHSLMat(pair.base, pair.residual);
    this.addQuad(mat, scaleW, scaleH, btnX + scaleW / 2, btnY + scaleH / 2, 0.2);

    // 点击区域（左右平分，在相机空间）
    this.buttonHit.left = { x: btnX, y: btnY, w: scaleW / 2, h: scaleH };
    this.buttonHit.right = { x: btnX + scaleW / 2, y: btnY, w: scaleW / 2, h: scaleH };

    // 文字标签
    this.addButtonLabel(btnX, btnY, scaleW, scaleH);
  }
    // ============================================================
  // 渲染资源显示（Layer 4 - 标注: x:0.725~1.001, y:0.836~0.911）
  // ============================================================

  private renderResourceUI(btnAsset: FtxAsset): void {
    const pair = btnAsset.getFramePair(0);
    if (!pair) return;
    const f = btnAsset.frames[0];
    const fw = f?.width || 512;
    const fh = f?.height || 512;

    // ★ 标注区域 (0..1 纹理空间): x:0.725~1.001, y:0.836~0.911
    const aspect = window.innerWidth / window.innerHeight;
    const resX = 0.725 * aspect;
    const resY = 0.836;
    const resW = (1.001 - 0.725) * aspect; // 0.276 * aspect
    const resH = 0.911 - 0.836; // 0.075

    // 保持纹理比例，适配标注区域
    const texAspect = fw / fh;
    let scaleW = resW;
    let scaleH = scaleW / texAspect;
    if (scaleH > resH * 3) {
      scaleH = resH * 3;
      scaleW = scaleH * texAspect;
      const mat = this.makeHSLMat(pair.base, pair.residual, { x: 0, y: 0.7, w: 1, h: 0.3 });
      this.addQuad(mat, scaleW, scaleH, resX + scaleW / 2, resY + scaleH / 2, 0.2);
    } else {
      if (scaleH > resH) {
        scaleH = resH;
        scaleW = scaleH * texAspect;
      }
      const mat = this.makeHSLMat(pair.base, pair.residual);
      this.addQuad(mat, scaleW, scaleH, resX + scaleW / 2, resY + scaleH / 2, 0.2);
    }
  }

  private addButtonLabel(btnX: number, btnY: number, btnW: number, btnH: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 24px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('单抽', 64, 32);
    ctx.fillText('10抽', 192, 32);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(128, 8);
    ctx.lineTo(128, 56);
    ctx.stroke();

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
    this.addQuad(mat, btnW, btnH, btnX + btnW / 2, btnY + btnH / 2, 0.21);
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
    }
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

    SaveSystem.save(s);
    this.updateResources();
    this.showResult(results);
  }

  private updateResources(): void {
    const s = this.session;
    const pity = s.gacha?.pityCounter ?? 0;
    this.ticketsEl.textContent = '招募凭证: ' + this.tickets;
    this.pityEl.textContent = '保底计数: ' + pity;
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
    this.departBtn.style.display = 'block';
    this.syncSize();
    this.updateResources();
    this.tick();
  }

  hide(): void {
    this.root.style.display = 'none';
    this.resultOverlay.style.display = 'none';
    this.departBtn.style.display = 'none';
  }

  private syncSize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.setScissorTest(false);

    // 相机匹配窗口宽高比
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

    // 资源栏定位（基于标注区域 0.725,0.836 ~ 1.001,0.911）
    const bar = this.root.querySelector('#gacha-resource-bar') as HTMLElement;
    if (bar) {
      bar.style.left = (w * 0.725) + 'px';
      bar.style.top = (h * 0.836) + 'px';
      bar.style.width = (w * 0.276) + 'px';
    }

    // 出击按钮（右下角）
    this.departBtn.style.right = '30px';
    this.departBtn.style.bottom = '30px';
  }

  private tick(): void {
    if (this.root.style.display === 'none') return;
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this.tick());
  }

  dispose(): void {
    this.hide();
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    document.body.removeChild(this.root);
  }
}