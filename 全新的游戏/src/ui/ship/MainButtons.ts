// ============================================================
// MainButtons —— 正交相机覆盖层上的 FTX 纹理按钮组
// ============================================================
// 从 ShipMode 抽取（2026-08-23 拆分 Phase1②，纯搬运零行为变更）：
//   - 自建 overlay Scene + OrthographicCamera，双 pass 渲染进主画布
//   - FTX 纹理梯形按钮 + 底部 glow + 装饰梯形 + 命中区域
//   - 指针事件（down/move/up 绑定 renderer.domElement）+ 透明度动画
//
// 对外接口：init / render / onPress / dispose
// 红线落实：
//   - render() 内 autoClear 保存/恢复同函数配对完成
//   - dispose() 尾部 renderer.resetState() 重同步 three 缓存（事故记录 #001）
// 业务路由（action→抽卡、其余→面板）由持有方通过 onPress 回调处理，
// 本类不感知任何业务。
// ============================================================

import * as THREE from 'three';
import { FtxAsset } from '../../vendor/player/FtxAsset';

// ============================================================
// 主页面按钮标注（屏幕坐标 0-1，Y=0 底部，Y=1 顶部）
// ============================================================
export type ButtonId = 'operator' | 'formation' | 'action';

interface ButtonAnno {
  id: ButtonId;
  label: string;
  /** 梯形四顶点：TL, TR, BL, BR */
  corners: { tl: { x: number; y: number }; tr: { x: number; y: number }; bl: { x: number; y: number }; br: { x: number; y: number } };
  /** 在 FTX 中的帧索引（假设 3 帧，每帧一个按钮） */
  frameIndex: number;
}

const BUTTON_ANNOTATIONS: ButtonAnno[] = [
  {
    id: 'action', label: '行动', frameIndex: 0,
    corners: {
      tl: { x: 0.600, y: 0.591 }, tr: { x: 1.000, y: 0.600 },
      bl: { x: 0.600, y: 0.785 }, br: { x: 1.000, y: 0.835 },
    },
  },
  {
    id: 'operator', label: '干员', frameIndex: 1,
    corners: {
      tl: { x: 0.750, y: 0.570 }, tr: { x: 0.931, y: 0.578 },
      bl: { x: 0.750, y: 0.436 }, br: { x: 0.931, y: 0.426 },
    },
  },
  {
    id: 'formation', label: '编队', frameIndex: 2,
    corners: {
      tl: { x: 0.581, y: 0.561 }, tr: { x: 0.740, y: 0.568 },
      bl: { x: 0.581, y: 0.446 }, br: { x: 0.740, y: 0.442 },
    },
  },
];

export class MainButtons {
  private renderer: THREE.WebGLRenderer | null = null;

  private _btnScene: THREE.Scene | null = null;
  private _btnCamera: THREE.OrthographicCamera | null = null;
  private _btnMeshes: THREE.Mesh[] = [];

  private _btnLabels: THREE.Sprite[] = [];
  private _btnHitAreas: { id: string; x: number; y: number; w: number; h: number }[] = [];
  private _btnMaterials: Map<string, THREE.MeshBasicMaterial> = new Map();
  private _btnGlowMats: Map<string, THREE.MeshBasicMaterial> = new Map();
  private _hoveredButton: string | null = null;
  private _btnOpacityAnims: Map<string, { start: number; from: number; to: number; startTime: number; glowFrom: number; glowTo: number }> = new Map();
  private _btnAnimFrame: number | null = null;
  private _btnBoundClick: ((e: PointerEvent) => void) | null = null;
  private _btnBoundMove: ((e: PointerEvent) => void) | null = null;
  private _btnBoundUp: (() => void) | null = null;
  private _debugReadbackDone = false;

  /** 按下回调（业务路由在持有方） */
  private _pressCb: ((id: ButtonId) => void) | null = null;
  /** 首帧像素回读调试：?dbg=1 才启用 */
  private readonly _debugEnabled: boolean;

  constructor() {
    this._debugEnabled = typeof location !== 'undefined'
      && new URLSearchParams(location.search).has('dbg');
  }

  /** 注册按下回调 */
  onPress(cb: (id: ButtonId) => void): void {
    this._pressCb = cb;
  }

  // ============================================================
  // IGameMode 渲染钩子（由 ShipMode.render 顺序调用）
  // ============================================================

  /**
   * 覆盖层渲染：不清主场景背景（autoClear=false），完成后恢复。
   * ★ autoClear 的关闭/恢复必须在本函数内配对（编码红线 #2）。
   */
  render(renderer: THREE.WebGLRenderer): void {
    if (!this._btnScene || !this._btnCamera) return;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this._btnScene, this._btnCamera);
    renderer.autoClear = prevAutoClear;
    // 首次渲染后回读行动按钮像素（?dbg=1 才输出）
    if (!this._debugReadbackDone) {
      this._debugReadbackDone = true;
      if (this._debugEnabled) {
        this.debugReadbackActionButton(renderer);
      }
    }
  }

  // ============================================================
  // 加载与构建（原 ShipMode.loadMainButtons，逐行搬运）
  // ============================================================

  async init(renderer: THREE.WebGLRenderer): Promise<void> {
    // ★ 先用【旧】renderer 解绑旧监听并清空内容（dispose 内部会置空 this.renderer），
    //   之后再绑定新引用——顺序不能反，否则下面 domElement 绑定拿到 null。
    this.dispose();
    this.renderer = renderer;

    const btnAsset = await FtxAsset.load('/ui/主界面三个按钮.ftx3.gz');
    // ★ 加载期间模式可能已退出（dispose 置空 renderer）：静默放弃本次构建
    if (!this.renderer) return;
    if (!btnAsset || btnAsset.frameCount === 0) return;

    const aspect = window.innerWidth / window.innerHeight;

    // 创建覆盖层场景和相机
    this._btnScene = new THREE.Scene();
    this._btnCamera = new THREE.OrthographicCamera(0, aspect, 1, 0, -1, 1);

    this._btnHitAreas = [];

    console.log('[MainButtons] 按钮FTX帧数:', btnAsset.frameCount, '帧名:', btnAsset.frameNames());

    for (const anno of BUTTON_ANNOTATIONS) {
      const pair = btnAsset.getFramePair(anno.frameIndex);
      if (!pair) {
        console.warn('[MainButtons] 跳过无纹理按钮:', anno.label, '帧索引:', anno.frameIndex);
        continue;
      }
      // 调试：检查纹理数据
      const baseTex = pair.base;
      const baseData = baseTex.image.data as unknown as Float32Array;
      let alphaMax = 0, alphaCount = 0;
      const step = Math.max(1, Math.floor(baseData.length / 4000)); // 最多采样~1000个像素
      for (let i = 3; i < baseData.length; i += step * 4) {
        if (baseData[i] > alphaMax) alphaMax = baseData[i];
        if (baseData[i] > 0.5) alphaCount++;
      }
      alphaCount *= step; // 估算总数
      console.log(`[MainButtons] ${anno.label} 纹理:`, baseTex.image.width, 'x', baseTex.image.height, `alpha>0.5约:${alphaCount}px, maxAlpha:${alphaMax}`);

      // 创建梯形几何体
      const { tl, tr, bl, br } = this.screenToThree(anno.corners, aspect);
      const geo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        // 两个三角形组成梯形
        bl.x, bl.y, 0,   br.x, br.y, 0,   tr.x, tr.y, 0,
        bl.x, bl.y, 0,   tr.x, tr.y, 0,   tl.x, tl.y, 0,
      ]);
      const uvs = new Float32Array([
        0, 1,   1, 1,   1, 0,
        0, 1,   1, 0,   0, 0,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

      const mat = (() => {
        // sRGB → 线性转换
        const srgbToLinear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        // 将 HSL 数据 + 残差转成 Canvas 纹理（线性空间）
        const baseData = pair.base.image.data as unknown as Float32Array;
        const bw = pair.base.image.width;
        const bh = pair.base.image.height;
        const resTex = pair.residual;
        const resData = resTex.image.data as Uint8Array;
        const rw = resTex.image.width;
        const rh = resTex.image.height;
        // 如果残差尺寸不匹配，打印警告
        if (bw !== rw || bh !== rh) {
          console.warn(`[MainButtons] ${anno.label} 基础色和残差尺寸不匹配: base=${bw}x${bh} residual=${rw}x${rh}`);
        }
        const cvs = document.createElement('canvas');
        cvs.width = bw;
        cvs.height = bh;
        const ctx = cvs.getContext('2d')!;
        const imgData = ctx.createImageData(bw, bh);
        const w = bw, h = bh;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            let hVal = baseData[idx];
            let sVal = baseData[idx + 1];
            let lVal = baseData[idx + 2];
            const aVal = baseData[idx + 3];
            // 应用残差（如果尺寸匹配）
            if (bw === rw && bh === rh) {
              const dH = (resData[idx] / 255 * 2 - 1) * 0.5;
              const dS = (resData[idx + 1] / 255 * 2 - 1) * 0.5;
              const dL = (resData[idx + 2] / 255 * 2 - 1) * 0.5;
              hVal = (hVal + dH) % 1;
              if (hVal < 0) hVal += 1;
              sVal = Math.max(0, Math.min(1, sVal + dS));
              lVal = Math.max(0, Math.min(1, lVal + dL));
            }
            // HSL → RGB
            const c = (1 - Math.abs(2 * lVal - 1)) * sVal;
            const xc = c * (1 - Math.abs((hVal * 6) % 2 - 1));
            const m = lVal - c / 2;
            let r = 0, g = 0, b = 0;
            const hi = Math.floor(hVal * 6);
            switch (hi) {
              case 0: r = c; g = xc; break;
              case 1: r = xc; g = c; break;
              case 2: g = c; b = xc; break;
              case 3: g = xc; b = c; break;
              case 4: r = xc; b = c; break;
              default: r = c; b = xc; break;
            }
            imgData.data[idx] = srgbToLinear(r + m) * 255;
            imgData.data[idx + 1] = srgbToLinear(g + m) * 255;
            imgData.data[idx + 2] = srgbToLinear(b + m) * 255;
            imgData.data[idx + 3] = aVal * 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        const tex = new THREE.CanvasTexture(cvs);
        // 根据标注坐标判断是否需要翻转 Y
        tex.flipY = anno.corners.tl.y < anno.corners.bl.y;
        // Canvas 数据为 sRGB，但渲染器输出为 LinearSRGBColorSpace，
        // 设 LinearColorSpace 避免渲染器额外 sRGB 编码导致颜色翻倍
        tex.colorSpace = THREE.LinearSRGBColorSpace;
        return new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: false,
        });
      })();

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = 0.1;
      this._btnScene.add(mesh);
      this._btnMeshes.push(mesh);
      this._btnMaterials.set(anno.id, mat);

      // 底部发光阴影（黑色 glow，始终显示，自然过渡）
      const glowCanvas = document.createElement('canvas');
      glowCanvas.width = 64;
      glowCanvas.height = 64;
      const gctx = glowCanvas.getContext('2d')!;
      // 从按钮边缘（y=0）向下渐变，边缘最黑，快速渐隐
      const grad = gctx.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, 'rgba(0,0,0,0.9)');
      grad.addColorStop(0.08, 'rgba(0,0,0,0.4)');
      grad.addColorStop(0.2, 'rgba(0,0,0,0.1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      gctx.fillStyle = grad;
      gctx.fillRect(0, 0, 64, 64);
      const glowTex = new THREE.CanvasTexture(glowCanvas);
      glowTex.flipY = false;
      glowTex.colorSpace = THREE.LinearSRGBColorSpace;
      const glowMat = new THREE.MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        opacity: 0.6, // 始终显示
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      });
      this._btnGlowMats.set(anno.id, glowMat);
      const glowGeo = new THREE.BufferGeometry();
      const gw = 0.03; // 阴影向下延伸宽度
      // 确定实际底部边缘（Y值较小的那对，靠近屏幕底部Y=0）
      const topAvgY = (tl.y + tr.y) / 2;
      const botAvgY = (bl.y + br.y) / 2;
      const bottomIsTL = topAvgY < botAvgY;
      const bL = bottomIsTL ? tl : bl;
      const bR = bottomIsTL ? tr : br;
      const glowVerts = new Float32Array([
        bL.x, bL.y, 0,        bR.x, bR.y, 0,        bR.x, bR.y - gw, 0,
        bL.x, bL.y, 0,        bR.x, bR.y - gw, 0,   bL.x, bL.y - gw, 0,
      ]);
      glowGeo.setAttribute('position', new THREE.BufferAttribute(glowVerts, 3));
      // UV: 按钮边缘(y=bl.y)=opaque(0,0)，向下渐隐(0,1)
      const glowUVs = new Float32Array([
        0, 0,   1, 0,   1, 1,
        0, 0,   1, 1,   0, 1,
      ]);
      glowGeo.setAttribute('uv', new THREE.BufferAttribute(glowUVs, 2));
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.z = 0.09;
      this._btnScene.add(glowMesh);
      this._btnMeshes.push(glowMesh);

      // 点击区域（用梯形包围盒）
      const minX = Math.min(tl.x, tr.x, bl.x, br.x);
      const maxX = Math.max(tl.x, tr.x, bl.x, br.x);
      const minY = Math.min(tl.y, tr.y, bl.y, br.y);
      const maxY = Math.max(tl.y, tr.y, bl.y, br.y);
      this._btnHitAreas.push({ id: anno.id, x: minX, y: minY, w: maxX - minX, h: maxY - minY });

      // ★ 区域编号标签（已移除）
    }

    // ★ 装饰性透明灰色梯形 UI（根据标注文件，取四角）
    const DECO_TRAPEZOID = {
      tl: { x: 0.945, y: 0.425 },
      tr: { x: 0.999, y: 0.423 },
      bl: { x: 0.945, y: 0.576 },
      br: { x: 0.999, y: 0.578 },
    };
    const dtl = { x: DECO_TRAPEZOID.tl.x * aspect, y: DECO_TRAPEZOID.tl.y };
    const dtr = { x: DECO_TRAPEZOID.tr.x * aspect, y: DECO_TRAPEZOID.tr.y };
    const dbl = { x: DECO_TRAPEZOID.bl.x * aspect, y: DECO_TRAPEZOID.bl.y };
    const dbr = { x: DECO_TRAPEZOID.br.x * aspect, y: DECO_TRAPEZOID.br.y };
    const decoGeo = new THREE.BufferGeometry();
    const decoVerts = new Float32Array([
      dbl.x, dbl.y, 0,   dbr.x, dbr.y, 0,   dtr.x, dtr.y, 0,
      dbl.x, dbl.y, 0,   dtr.x, dtr.y, 0,   dtl.x, dtl.y, 0,
    ]);
    decoGeo.setAttribute('position', new THREE.BufferAttribute(decoVerts, 3));
    const decoMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a1a,
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    const decoMesh = new THREE.Mesh(decoGeo, decoMat);
    decoMesh.position.z = 0.05;
    this._btnScene!.add(decoMesh);
    this._btnMeshes.push(decoMesh);

    // 装饰梯形的底部黑光 glow
    const decoBottomY = (dtl.y + dtr.y) / 2 < (dbl.y + dbr.y) / 2 ? dtl.y : dbl.y;
    const decoBLeft = (dtl.y + dtr.y) / 2 < (dbl.y + dbr.y) / 2 ? dtl : dbl;
    const decoBRight = (dtl.y + dtr.y) / 2 < (dbl.y + dbr.y) / 2 ? dtr : dbr;
    const decoGlowCanvas = document.createElement('canvas');
    decoGlowCanvas.width = 64;
    decoGlowCanvas.height = 64;
    const dgctx = decoGlowCanvas.getContext('2d')!;
    const dgrad = dgctx.createLinearGradient(0, 0, 0, 64);
    dgrad.addColorStop(0, 'rgba(0,0,0,0.9)');
    dgrad.addColorStop(0.08, 'rgba(0,0,0,0.4)');
    dgrad.addColorStop(0.2, 'rgba(0,0,0,0.1)');
    dgrad.addColorStop(1, 'rgba(0,0,0,0)');
    dgctx.fillStyle = dgrad;
    dgctx.fillRect(0, 0, 64, 64);
    const decoGlowTex = new THREE.CanvasTexture(decoGlowCanvas);
    decoGlowTex.flipY = false;
    decoGlowTex.colorSpace = THREE.LinearSRGBColorSpace;
    const decoGlowMat = new THREE.MeshBasicMaterial({
      map: decoGlowTex,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    const decoGlowGeo = new THREE.BufferGeometry();
    const dgw = 0.03;
    const dglowVerts = new Float32Array([
      decoBLeft.x, decoBLeft.y, 0,        decoBRight.x, decoBRight.y, 0,        decoBRight.x, decoBRight.y - dgw, 0,
      decoBLeft.x, decoBLeft.y, 0,        decoBRight.x, decoBRight.y - dgw, 0,   decoBLeft.x, decoBLeft.y - dgw, 0,
    ]);
    decoGlowGeo.setAttribute('position', new THREE.BufferAttribute(dglowVerts, 3));
    const decoGlowUVs = new Float32Array([
      0, 0,   1, 0,   1, 1,
      0, 0,   1, 1,   0, 1,
    ]);
    decoGlowGeo.setAttribute('uv', new THREE.BufferAttribute(decoGlowUVs, 2));
    const decoGlowMesh = new THREE.Mesh(decoGlowGeo, decoGlowMat);
    decoGlowMesh.position.z = 0.04;
    this._btnScene!.add(decoGlowMesh);
    this._btnMeshes.push(decoGlowMesh);

    // 点击事件 + 悬停/抬起效果
    const onClick = (e: PointerEvent) => this.handleButtonClick(e);
    this._btnBoundClick = onClick;
    this.renderer.domElement.addEventListener('pointerdown', onClick);
    const onMove = (e: PointerEvent) => this.handleButtonHover(e);
    this._btnBoundMove = onMove;
    this.renderer.domElement.addEventListener('pointermove', onMove);
    const onUp = () => this.handleButtonUp();
    this._btnBoundUp = onUp;
    this.renderer.domElement.addEventListener('pointerup', onUp);
  }

  /** 将屏幕标注坐标（0-1，Y=0 底部）转为 Three.js 正交相机坐标（Y=0 底部） */
  private screenToThree(
    c: { tl: { x: number; y: number }; tr: { x: number; y: number }; bl: { x: number; y: number }; br: { x: number; y: number } },
    aspect: number,
  ): { tl: { x: number; y: number }; tr: { x: number; y: number }; bl: { x: number; y: number }; br: { x: number; y: number } } {
    return {
      tl: { x: c.tl.x * aspect, y: c.tl.y },
      tr: { x: c.tr.x * aspect, y: c.tr.y },
      bl: { x: c.bl.x * aspect, y: c.bl.y },
      br: { x: c.br.x * aspect, y: c.br.y },
    };
  }

  private animateOpacity(id: string, to: number): void {
    const mat = this._btnMaterials.get(id);
    if (!mat) return;
    const from = mat.opacity;
    if (from === to) return;
    this._btnOpacityAnims.set(id, { start: from, from, to, startTime: performance.now(), glowFrom: 0, glowTo: 0 });
    if (this._btnAnimFrame === null) {
      this._btnAnimFrame = requestAnimationFrame(() => this.tickOpacityAnims());
    }
  }

  private tickOpacityAnims(): void {
    this._btnAnimFrame = null;
    const now = performance.now();
    const DURATION = 150; // ms
    let hasPending = false;
    for (const [id, anim] of this._btnOpacityAnims) {
      const t = Math.min(1, (now - anim.startTime) / DURATION);
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOut
      const mat = this._btnMaterials.get(id);
      if (mat) mat.opacity = anim.from + (anim.to - anim.from) * ease;
      if (t < 1) {
        hasPending = true;
      } else {
        this._btnOpacityAnims.delete(id);
      }
    }
    if (hasPending) {
      this._btnAnimFrame = requestAnimationFrame(() => this.tickOpacityAnims());
    }
  }

  private handleButtonClick(e: PointerEvent): void {
    if (!this.renderer || !this._btnCamera) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const aspect = window.innerWidth / window.innerHeight;
    const px = (e.clientX / rect.width) * aspect;
    const py = 1 - (e.clientY / rect.height);

    for (const hit of this._btnHitAreas) {
      if (px >= hit.x && px <= hit.x + hit.w && py >= hit.y && py <= hit.y + hit.h) {
        this._pressCb?.(hit.id as ButtonId);
        // 点击时变透明（带过渡）
        this.animateOpacity(hit.id, 0.4);
        setTimeout(() => {
          this.animateOpacity(hit.id, this._hoveredButton === hit.id ? 0.7 : 1);
        }, 150);
        break;
      }
    }
  }

  private handleButtonHover(e: PointerEvent): void {
    if (!this.renderer || !this._btnCamera) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const aspect = window.innerWidth / window.innerHeight;
    const px = (e.clientX / rect.width) * aspect;
    const py = 1 - (e.clientY / rect.height);

    let found: string | null = null;
    for (const hit of this._btnHitAreas) {
      if (px >= hit.x && px <= hit.x + hit.w && py >= hit.y && py <= hit.y + hit.h) {
        found = hit.id;
        break;
      }
    }

    // 恢复上一个悬停按钮
    if (this._hoveredButton !== null && this._hoveredButton !== found) {
      this.animateOpacity(this._hoveredButton, 1);
    }
    // 设置新悬停
    if (found !== null && found !== this._hoveredButton) {
      this.animateOpacity(found, 0.7);
    }
    this._hoveredButton = found;
  }

  private handleButtonUp(): void {
    if (this._hoveredButton !== null) {
      this.animateOpacity(this._hoveredButton, 0.7);
    }
  }

  /** 回读行动按钮区域的像素值（调试用；?dbg=1 启用） */
  private debugReadbackActionButton(renderer: THREE.WebGLRenderer): void {
    const actionAnno = BUTTON_ANNOTATIONS.find(a => a.id === 'action');
    if (!actionAnno || !this._btnCamera) return;
    const gl = renderer.getContext();
    const canvas = renderer.domElement;
    const cw = canvas.width;
    const ch = canvas.height;
    const aspect = this._btnCamera.right;
    // 行动按钮中心在相机坐标
    const { tl, tr, bl, br } = actionAnno.corners;
    const cx = (tl.x + tr.x + bl.x + br.x) / 4;
    const cy = (tl.y + tr.y + bl.y + br.y) / 4;
    // 相机坐标 → 屏幕像素（readPixels Y=0 底部）
    const sx = Math.round(cx / aspect * cw);
    const sy = Math.round(cy * ch);
    // 读取 3x3 网格
    const pixels = new Uint8Array(9 * 4);
    gl.readPixels(sx - 1, sy - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const rows: string[] = [];
    for (let r = 0; r < 3; r++) {
      const cols: string[] = [];
      for (let c = 0; c < 3; c++) {
        const i = (r * 3 + c) * 4;
        cols.push(`(${pixels[i]},${pixels[i+1]},${pixels[i+2]},${pixels[i+3]})`);
      }
      rows.push(`  [${cols.join(', ')}]`);
    }
    console.log(`[MainButtons] 行动按钮回读 中心(${cx.toFixed(3)},${cy.toFixed(3)})→屏幕(${sx},${sy}) canvas=${cw}x${ch} aspect=${aspect.toFixed(3)}`);
    console.log(rows.join('\n'));
    // 额外读取干员和编队按钮中心对比
    for (const anno of BUTTON_ANNOTATIONS) {
      if (anno.id === 'action') continue;
      const acx = (anno.corners.tl.x + anno.corners.tr.x + anno.corners.bl.x + anno.corners.br.x) / 4;
      const acy = (anno.corners.tl.y + anno.corners.tr.y + anno.corners.bl.y + anno.corners.br.y) / 4;
      const asx = Math.round(acx / aspect * cw);
      const asy = Math.round(acy * ch);
      const apx = new Uint8Array(4);
      gl.readPixels(asx, asy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, apx);
      console.log(`[MainButtons] ${anno.label} 中心(${acx.toFixed(3)},${acy.toFixed(3)})→(${asx},${asy}): rgba(${apx[0]},${apx[1]},${apx[2]},${apx[3]})`);
    }
  }

  dispose(): void {
    if (this._btnBoundClick && this.renderer) {
      this.renderer.domElement.removeEventListener('pointerdown', this._btnBoundClick);
      this._btnBoundClick = null;
    }
    if (this._btnBoundMove && this.renderer) {
      this.renderer.domElement.removeEventListener('pointermove', this._btnBoundMove);
      this._btnBoundMove = null;
    }
    if (this._btnBoundUp && this.renderer) {
      this.renderer.domElement.removeEventListener('pointerup', this._btnBoundUp);
      this._btnBoundUp = null;
    }
    if (this._btnAnimFrame !== null) {
      cancelAnimationFrame(this._btnAnimFrame);
      this._btnAnimFrame = null;
    }
    this._btnOpacityAnims.clear();
    this._btnGlowMats.clear();
    for (const mesh of this._btnMeshes) {
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(m => m.dispose());
      } else {
        mesh.material.dispose();
      }
      this._btnScene?.remove(mesh);
    }
    this._btnMeshes = [];
    // 清理标签
    for (const sprite of this._btnLabels) {
      sprite.material.map?.dispose();
      sprite.material.dispose();
      this._btnScene?.remove(sprite);
    }
    this._btnLabels = [];
    this._btnHitAreas = [];
    this._btnScene = null;
    this._btnCamera = null;
    // ★ 编码红线 #2：销毁后重同步 three 状态缓存（事故记录 #001）
    this.renderer?.resetState();
    this.renderer = null;
  }
}
