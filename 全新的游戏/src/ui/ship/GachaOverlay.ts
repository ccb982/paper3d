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
  
  private resultOverlay: HTMLDivElement;
  private resultList: HTMLDivElement;
  private debugAxis: HTMLDivElement;
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

    // 调试坐标轴
    this.debugAxis = document.createElement('div');
    this.debugAxis.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
      'z-index:999', 'pointer-events:none', 'font-size:11px', 'font-family:monospace',
      'color:#0ff', 'text-shadow:0 0 4px #000',
    ].join(';');
    this.debugAxis.innerHTML = [
      '<span style="position:absolute;top:0;left:0;">(0,0) 左上</span>',
      '<span style="position:absolute;top:0;right:0;">(1,0) 右上</span>',
      '<span style="position:absolute;bottom:0;left:0;">(0,1) 左下</span>',
      '<span style="position:absolute;bottom:0;right:0;">(1,1) 右下</span>',
    ].join('');
    this.root.appendChild(this.debugAxis);

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

    this.renderBackground(bg);
    if (charAsset) this.renderCharacter(charAsset);

    // 抽卡按钮（frame 0）→ 纹理位置使用原始坐标，hit area 需要 Y 翻转
    const aspect = window.innerWidth / window.innerHeight;
    const btnArea = {
      x: 0.605 * aspect,
      y: 0.103,               // 纹理渲染使用原始坐标
      w: (0.867 - 0.605) * aspect,
      h: 0.236 - 0.103,
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
    const hitOffY = (1 - 0.236) + (btnArea.h - sH0) / 2;
    this.buttonHit.left = { x: texOffX, y: hitOffY, w: sW0 / 2, h: sH0 };
    this.buttonHit.right = { x: texOffX + sW0 / 2, y: hitOffY, w: sW0 / 2, h: sH0 };

    // 调试：绘制点击区域
    this.debugDrawHitAreas();

    // 更新调试标注
    if (this.debugAxis) {
      const normX = texOffX / aspect;
      const normY = texOffY;
      const normHalfW = (sW0 / 2) / aspect;
      this.debugAxis.innerHTML = [
        '<span style="position:absolute;top:0;left:0;">(0,0) 左上</span>',
        '<span style="position:absolute;top:0;right:0;">(1,0) 右上</span>',
        '<span style="position:absolute;bottom:0;left:0;">(0,1) 左下</span>',
        '<span style="position:absolute;bottom:0;right:0;">(1,1) 右下</span>',
        '<span style="position:absolute;top:' + (normY * 100) + '%;left:' + (normX * 100) + '%;background:rgba(255,0,0,0.3);padding:1px 4px;border:1px solid #f00;font-size:10px;color:#f00;">抽卡按钮 左半</span>',
        '<span style="position:absolute;top:' + (normY * 100) + '%;left:' + ((normX + normHalfW) * 100) + '%;background:rgba(0,255,0,0.3);padding:1px 4px;border:1px solid #0f0;font-size:10px;color:#0f0;">抽卡按钮 右半</span>',
      ].join('');
    }

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
  // 调试：绘制点击区域
  // ============================================================

  private debugDrawHitAreas(): void {
    const leftMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.3, depthWrite: false, depthTest: false });
    const rightMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.3, depthWrite: false, depthTest: false });

    const l = this.buttonHit.left;
    const r = this.buttonHit.right;

    // 左半（单抽） - 红色半透明
    const leftMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), leftMat);
    leftMesh.scale.set(l.w, l.h, 1);
    leftMesh.position.set(l.x + l.w / 2, l.y + l.h / 2, 0.5);
    this.scene.add(leftMesh);

    // 右半（10抽） - 绿色半透明
    const rightMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), rightMat);
    rightMesh.scale.set(r.w, r.h, 1);
    rightMesh.position.set(r.x + r.w / 2, r.y + r.h / 2, 0.5);
    this.scene.add(rightMesh);
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
      // 纹理实际尺寸 = bbox 尺寸
      if (ftxFrame) { fw = ftxFrame.bbox.w; fh = ftxFrame.bbox.h; }
    } else {
      pair = charAsset.getFramePair(0);
      const f = charAsset.frames[0];
      if (f) { fw = f.bbox.w; fh = f.bbox.h; }
    }
    if (!pair) return;

    // ★ 标注区域
    const aspect = window.innerWidth / window.innerHeight;
    const areaX = 0.627 * aspect;
    const areaY = 0.103;
    const areaW = (0.867 - 0.627) * aspect;
    const areaH = 0.791 - 0.103;

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
    const mat = this.makeHSLMat(pair.base, pair.residual);
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

    // 纹理绘制在右上区域
    const aspect = window.innerWidth / window.innerHeight;
    const resX = 0.725 * aspect;
    const resY = 0.836;
    const resW = (1.001 - 0.725) * aspect;
    const resH = 0.911 - 0.836;

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