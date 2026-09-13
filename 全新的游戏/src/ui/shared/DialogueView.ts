// ============================================================
// DialogueView.ts —— 对话 UI（立绘 + 说话人 + 文本 + 分支选项）
// ============================================================
// 非模态覆盖层（底部对话框），基地/战斗共用：
//   · 无选项：点击面板或按 空格/回车/E 推进
//   · 有选项：点击选项按钮（或按 1~9）
//   · 立绘：FTX 第 0 帧 CPU 合成 → dataURL（按 URL 缓存，加载中显示占位）
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

export class DialogueView implements DialogueViewLike {
  private root: HTMLDivElement;
  private portraitEl: HTMLImageElement;
  private portraitBox: HTMLDivElement;
  private speakerEl: HTMLDivElement;
  private textEl: HTMLDivElement;
  private choicesEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private handlers: DialogueViewHandlers | null = null;
  private open_ = false;
  /** 当前立绘 URL（异步加载完成后仅当仍匹配才写入） */
  private portraitUrl: string | null = null;

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
    this.portraitEl = document.createElement('img');
    this.portraitEl.style.cssText = 'max-width:100%;max-height:100%;display:block;';
    this.portraitBox.appendChild(this.portraitEl);

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
      this.portraitEl.src = '';
    }
    if (state.portrait) {
      const cached = portraitDataUrlCache.get(state.portrait);
      if (cached) {
        this.portraitEl.src = cached;
      } else if (!this.portraitEl.src) {
        const url = state.portrait;
        void loadFtxCached(url)
          .then((asset) => {
            const dataUrl = compositeFrameToDataURL(asset, 0);
            portraitDataUrlCache.set(url, dataUrl);
            if (this.portraitUrl === url) this.portraitEl.src = dataUrl;
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

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.handlers = null;
    this.root.style.display = 'none';
    this.choicesEl.innerHTML = '';
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
