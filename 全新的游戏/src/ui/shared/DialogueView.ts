// ============================================================
// DialogueView.ts —— 对话 UI（立绘 + 说话人 + 文本 + 分支选项）
// ============================================================
// 非模态覆盖层（底部对话框），基地/战斗共用：
//   · 无选项：点击面板或按 空格/回车/E 推进
//   · 有选项：点击选项按钮（或按 1~9）
//   · 立绘：FTX（优先"前"帧，缺省第 0 帧）CPU 合成 → dataURL（按 URL 缓存，加载中占位）
//     —— 与访客身体脸部取帧口径一致；画布按 contain 填满头像框（小纹理自动放大）
//   · ★ 点头像框 = UV 扭曲彩蛋：以点击点为圆心的径向涟漪 + 横向抖动，0.85s 衰减
//     （逐像素反向采样：经典 UV warp；不冒泡推进对话）
// 打开期间吞掉键盘事件（capture），避免与行走/开火抢键；世界输入另由
// 模式层按 DialogueSystem.isActive 屏蔽。
// ============================================================

import { compositeFrameToDataURL } from './ftxFrameToCanvas';
import { loadFtxCached } from '../../services/fx/FtxAssetCache';
import type {
  DialogueViewHandlers,
  DialogueViewLike,
  DialogueViewState,
} from '../../systems/dialogue/DialogueTypes';

const portraitDataUrlCache = new Map<string, string>();
/** 头像画布内部分辨率（= 头像框 CSS 尺寸） */
const PORTRAIT_W = 132;
const PORTRAIT_H = 168;
/** UV 扭曲时长（秒）与振幅参数 */
const DISTORT_SECONDS = 0.85;
const DISTORT_AMP = 5.5;
const DISTORT_WOBBLE = 1.4;

export class DialogueView implements DialogueViewLike {
  private root: HTMLDivElement;
  private portraitBox: HTMLDivElement;
  private portraitCanvas: HTMLCanvasElement;
  private portraitCtx: CanvasRenderingContext2D;
  private speakerEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private choicesEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private handlers: DialogueViewHandlers | null = null;
  private open_ = false;
  /** 当前立绘 URL（异步加载完成后仅当仍匹配才写入） */
  private portraitUrl: string | null = null;
  /** ★ 已发起加载的立绘 URL（防重复请求；不用 img.src 判定——空 src 会解析成页面 URL） */
  private loadingPortraitUrl: string | null = null;
  /** 当前头像位图（UV 扭曲的采样源；切换立绘时替换） */
  private portraitImg: HTMLImageElement | null = null;
  /** 一次性的源/目标像素缓冲与方向场（点击时构建） */
  private srcData: ImageData | null = null;
  private dstData: ImageData | null = null;
  private distortField: {
    rx: Float32Array; ry: Float32Array; dist: Float32Array; fall: Float32Array;
  } | null = null;
  private distortStart = 0;
  private distortRaf = 0;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:36px', 'transform:translateX(-50%)',
      'width:min(880px,92vw)', 'min-height:150px',
      'display:none', 'gap:18px', 'padding:16px 20px', 'box-sizing:border-box',
      'background:rgba(9,15,25,0.93)', 'border:1px solid rgba(120,180,255,0.45)',
      'border-radius:12px', 'box-shadow:0 8px 34px rgba(0,0,0,0.55)',
      'color:#e8f0fa', 'font:15px/1.7 "Microsoft YaHei",sans-serif',
      'z-index:280', 'pointer-events:auto', 'cursor:pointer', 'user-select:none',
    ].join(';');

    // 立绘框
    this.portraitBox = document.createElement('div');
    this.portraitBox.style.cssText = [
      'flex:0 0 132px', 'width:132px', 'height:168px', 'align-self:flex-end',
      'background:rgba(18,28,44,0.9)', 'border:1px solid rgba(110,160,220,0.35)',
      'border-radius:8px', 'overflow:hidden', 'display:flex',
      'align-items:flex-end', 'justify-content:center',
    ].join(';');
    // ★ 头像 = 画布（含 UV 扭曲彩蛋：点头像框触发径向涟漪）
    this.portraitCanvas = document.createElement('canvas');
    this.portraitCanvas.width = PORTRAIT_W;
    this.portraitCanvas.height = PORTRAIT_H;
    this.portraitCanvas.style.cssText = 'width:100%;height:100%;display:block;';
    this.portraitBox.appendChild(this.portraitCanvas);
    this.portraitCtx = this.portraitCanvas.getContext('2d')!;
    // 点头像框 → UV 扭曲（stopPropagation：别顺手把对话推进了）
    this.portraitBox.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pulseDistort(e.clientX, e.clientY);
    });

    // 右侧文本列
    const col = document.createElement('div');
    col.style.cssText = 'flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:6px;';
    this.speakerEl = document.createElement('div');
    this.speakerEl.style.cssText = 'font-size:16px;font-weight:bold;color:#8ac8ff;letter-spacing:1px;';
    this.textEl = document.createElement('div');
    this.textEl.style.cssText = 'min-height:54px;white-space:pre-wrap;';
    this.choicesEl = document.createElement('div');
    this.choicesEl.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:2px;';
    this.hintEl = document.createElement('div');
    this.hintEl.textContent = '点击继续 ▸';
    this.hintEl.style.cssText = 'align-self:flex-end;font-size:12px;color:#7fa8cd;';
    col.append(this.speakerEl, this.textEl, this.choicesEl, this.hintEl);
    this.root.append(this.portraitBox, col);

    // 点击面板（非选项）推进
    this.root.addEventListener('click', () => {
      if (this.choicesEl.childElementCount === 0) this.handlers?.onAdvance();
    });
    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  open(handlers: DialogueViewHandlers): void {
    this.handlers = handlers;
    this.open_ = true;
    this.root.style.display = 'flex';
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  render(state: DialogueViewState): void {
    this.speakerEl.textContent = state.speaker;
    this.textEl.textContent = state.text;
    this.hintEl.style.display = state.continueHint ? 'block' : 'none';

    // 立绘（缓存 dataURL；加载完成前占位）
    if (state.portrait !== this.portraitUrl) {
      this.portraitUrl = state.portrait ?? null;
      this.loadingPortraitUrl = null;
      this.clearPortrait();
    }
    if (state.portrait) {
      const url = state.portrait;
      const cached = portraitDataUrlCache.get(url);
      if (cached) {
        this.setPortrait(cached);
      } else if (this.loadingPortraitUrl !== url) {
        this.loadingPortraitUrl = url;
        void loadFtxCached(url)
          .then((asset) => {
            // ★ 与访客脸部同一取帧口径：优先"前"帧，缺省 0
            const frame = asset.resolveFrame('前') ?? 0;
            const dataUrl = compositeFrameToDataURL(asset, frame);
            portraitDataUrlCache.set(url, dataUrl);
            if (this.portraitUrl === url) this.setPortrait(dataUrl);
          })
          .catch((err) => console.warn('[对话] 立绘加载失败:', url, err));
      }
    }

    // 选项
    this.choicesEl.innerHTML = '';
    state.choices.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.textContent = c.label;
      btn.style.cssText = [
        'text-align:left', 'padding:7px 14px', 'cursor:pointer',
        'font:14px "Microsoft YaHei",sans-serif', 'color:#dceaf8',
        'background:rgba(26,44,68,0.9)', 'border:1px solid rgba(110,170,235,0.45)',
        'border-radius:8px',
      ].join(';');
      btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(40,66,98,0.95)'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(26,44,68,0.9)'; });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handlers?.onChoose(i);
      });
      this.choicesEl.appendChild(btn);
    });
  }

  // ============================================================
  // 头像（画布）+ ★ UV 扭曲彩蛋
  // ============================================================

  /** 立绘 dataURL → 位图 → 像素缓冲（contain 填满头像框，与 object-fit:contain 同口径） */
  private setPortrait(dataUrl: string): void {
    const img = new Image();
    this.portraitImg = img;
    img.onload = () => {
      if (this.portraitImg !== img) return; // 已切换立绘 → 丢弃
      this.buildPortraitSource(img);
    };
    img.src = dataUrl;
  }

  private buildPortraitSource(img: HTMLImageElement): void {
    const W = PORTRAIT_W;
    const H = PORTRAIT_H;
    const src = document.createElement('canvas');
    src.width = W;
    src.height = H;
    const sctx = src.getContext('2d')!;
    const k = Math.min(W / Math.max(1, img.width), H / Math.max(1, img.height));
    const w = img.width * k;
    const h = img.height * k;
    sctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    this.srcData = sctx.getImageData(0, 0, W, H);
    this.dstData = this.portraitCtx.createImageData(W, H);
    this.drawCleanPortrait();
  }

  private clearPortrait(): void {
    this.cancelDistort();
    this.portraitImg = null;
    this.srcData = null;
    this.dstData = null;
    this.distortField = null;
    this.portraitCtx.clearRect(0, 0, PORTRAIT_W, PORTRAIT_H);
  }

  private drawCleanPortrait(): void {
    if (this.srcData) this.portraitCtx.putImageData(this.srcData, 0, 0);
  }

  private cancelDistort(): void {
    if (this.distortRaf) cancelAnimationFrame(this.distortRaf);
    this.distortRaf = 0;
  }

  /** ★ 点击头像 → 以点击点为圆心的 UV 涟漪（径向推挤 + 横向抖动，0.85s 衰减） */
  private pulseDistort(clientX: number, clientY: number): void {
    if (!this.srcData) return;
    const rect = this.portraitCanvas.getBoundingClientRect();
    const cx = ((clientX - rect.left) / Math.max(1, rect.width)) * PORTRAIT_W;
    const cy = ((clientY - rect.top) / Math.max(1, rect.height)) * PORTRAIT_H;
    const W = PORTRAIT_W;
    const H = PORTRAIT_H;
    const n = W * H;
    const rx = new Float32Array(n);
    const ry = new Float32Array(n);
    const dist = new Float32Array(n);
    const fall = new Float32Array(n);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d = Math.hypot(dx, dy) || 1;
        rx[i] = dx / d;
        ry[i] = dy / d;
        dist[i] = d;
        fall[i] = Math.exp(-d * 0.03); // 离点击点越远越弱
      }
    }
    this.distortField = { rx, ry, dist, fall };
    this.distortStart = performance.now();
    this.cancelDistort();
    this.distortRaf = requestAnimationFrame(this.distortTick);
  }

  /** UV 扭曲帧：逐像素反向采样（经典 UV warp；alpha 0 = 采样越界） */
  private distortTick = (): void => {
    const f = this.distortField;
    const src = this.srcData;
    const dst = this.dstData;
    if (!f || !src || !dst) {
      this.distortRaf = 0;
      return;
    }
    const t = (performance.now() - this.distortStart) / 1000;
    if (t >= DISTORT_SECONDS) {
      this.distortRaf = 0;
      this.drawCleanPortrait();
      return;
    }
    const decay = 1 - t / DISTORT_SECONDS;
    const amp = DISTORT_AMP * decay;
    const wob = DISTORT_WOBBLE * decay;
    const W = PORTRAIT_W;
    const H = PORTRAIT_H;
    const s = src.data;
    const d = dst.data;
    const n = W * H;
    for (let i = 0; i < n; i++) {
      const x = i % W;
      const y = (i / W) | 0;
      const w = Math.sin(f.dist[i] * 0.32 - t * 17) * amp * f.fall[i];
      const sx = Math.round(x + f.rx[i] * w + Math.sin(y * 0.09 + t * 21) * wob);
      const sy = Math.round(y + f.ry[i] * w);
      const o = i * 4;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) {
        d[o + 3] = 0;
        continue;
      }
      const j = (sy * W + sx) * 4;
      d[o] = s[j];
      d[o + 1] = s[j + 1];
      d[o + 2] = s[j + 2];
      d[o + 3] = s[j + 3];
    }
    this.portraitCtx.putImageData(dst, 0, 0);
    this.distortRaf = requestAnimationFrame(this.distortTick);
  };

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.handlers = null;
    this.root.style.display = 'none';
    this.choicesEl.innerHTML = '';
    this.cancelDistort();
    this.drawCleanPortrait();
    window.removeEventListener('keydown', this.onKeyDown, true);
  }

  dispose(): void {
    this.close();
    this.root.remove();
  }

  /** 键盘：空格/回车/E 推进；1~9 选项（capture 阶段吞事件，防漏给游戏输入） */
  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.open_) return;
    const k = e.key.toLowerCase();
    const choiceCount = this.choicesEl.childElementCount;
    if (/^[1-9]$/.test(k) && choiceCount > 0) {
      const idx = Number(k) - 1;
      if (idx < choiceCount) {
        e.preventDefault();
        e.stopPropagation();
        this.handlers?.onChoose(idx);
      }
      return;
    }
    if (k === ' ' || k === 'enter' || k === 'e') {
      e.preventDefault();
      e.stopPropagation();
      if (choiceCount === 0) this.handlers?.onAdvance();
    }
  };
}
