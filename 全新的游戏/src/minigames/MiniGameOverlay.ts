// ============================================================
// MiniGameOverlay.ts —— 小游戏通用面板外壳
// ============================================================
// 只管「壳」：遮罩 + 标题栏 + 内容区 + 返回按钮 + ESC 取消。
// 玩法一律不碰 —— 内容区整个交给小游戏自己 mount。
//
// 约定：
//   · z-index 300（对话是 280）→ 小游戏一定盖在对话之上，且先于对话关闭；
//   · 遮罩点击**不关闭**（小游戏多为点击判定，误触代价大）；关闭只能走返回键/ESC；
//   · finish / cancel 幂等：小游戏重复调用不会重复回调（它可能在 rAF 里调）。
// ============================================================

import { createBackButton } from '../ui/components/BackButton';
import type { MiniGame, MiniGameResult } from './MiniGameTypes';

export interface MiniGameOverlayOptions {
  game: MiniGame;
  onFinish: (result: MiniGameResult) => void;
  /** 主动放弃（不结算） */
  onCancel?: () => void;
}

export class MiniGameOverlay {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly game: MiniGame;
  private readonly onFinish: (r: MiniGameResult) => void;
  private readonly onCancel?: () => void;
  /** ★ 幂等锁：finish/cancel 只生效一次 */
  private settled = false;

  constructor(opts: MiniGameOverlayOptions) {
    this.game = opts.game;
    this.onFinish = opts.onFinish;
    this.onCancel = opts.onCancel;

    // ---- 遮罩 ----
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:300',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(4,8,14,0.72)',
      'font:15px/1.6 "Microsoft YaHei",sans-serif', 'color:#e8f0fa',
      'user-select:none', '-webkit-tap-highlight-color:transparent',
    ].join(';');

    // ---- 面板 ----
    this.panel = document.createElement('div');
    this.panel.style.cssText = [
      'width:min(620px,94vw)', 'max-height:88vh', 'display:flex', 'flex-direction:column',
      'background:rgba(9,15,25,0.96)', 'border:1px solid rgba(120,180,255,0.45)',
      'border-radius:12px', 'box-shadow:0 10px 40px rgba(0,0,0,0.6)',
      'overflow:hidden',
    ].join(';');

    // ---- 标题栏 ----
    const bar = document.createElement('div');
    bar.style.cssText = [
      'display:flex', 'align-items:center', 'gap:12px',
      'padding:10px 14px', 'border-bottom:1px solid rgba(110,160,220,0.28)',
      'background:rgba(18,30,48,0.9)',
    ].join(';');
    const back = createBackButton({ onClick: () => this.cancel(), height: 30 });
    const titleCol = document.createElement('div');
    titleCol.style.cssText = 'flex:1 1 auto;min-width:0;display:flex;flex-direction:column;';
    const title = document.createElement('div');
    title.textContent = this.game.title;
    title.style.cssText = 'font-size:16px;font-weight:bold;color:#8ac8ff;letter-spacing:1px;';
    titleCol.appendChild(title);
    if (this.game.hint) {
      const hint = document.createElement('div');
      hint.textContent = this.game.hint;
      hint.style.cssText = 'font-size:12px;color:#7fa8cd;margin-top:2px;';
      titleCol.appendChild(hint);
    }
    bar.append(back, titleCol);

    // ---- 内容区（交给小游戏）----
    this.content = document.createElement('div');
    this.content.style.cssText = 'position:relative;padding:16px;overflow:hidden;';

    this.panel.append(bar, this.content);
    this.root.appendChild(this.panel);
    document.body.appendChild(this.root);

    // ESC 取消（capture，别漏给游戏/对话）
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  /** 把内容区交给小游戏（构造后调用一次） */
  mount(): void {
    this.game.mount(this.content, {
      finish: (score, detail) => this.finish(score, detail),
      cancel: () => this.cancel(),
    });
  }

  // ============================================================
  // 结算（幂等）
  // ============================================================

  private finish(score: number, detail?: string): void {
    if (this.settled) return;
    this.settled = true;
    const result: MiniGameResult = {
      score: Math.max(0, Math.min(100, Math.round(score))),
      detail,
    };
    this.teardown();
    this.onFinish(result);
  }

  private cancel(): void {
    if (this.settled) return;
    this.settled = true;
    this.teardown();
    this.onCancel?.();
  }

  /** 统一收尾：先拆小游戏再拆 DOM（小游戏的 rAF 可能还在跑） */
  private teardown(): void {
    try {
      this.game.dispose();
    } catch (e) {
      console.warn('[小游戏] dispose 异常:', e);
    }
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
  }

  /** ★ 外部强制关闭（模式退出等）：不触发任何回调 */
  forceClose(): void {
    if (this.settled) return;
    this.settled = true;
    this.teardown();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
    }
  };
}
