// ============================================================
// ui/CopyInfoPanel —— 复制信息面板（调试；一键复制 seed + 舰落点 + 敌落点 + 相机）
// ============================================================
// 用途：把"定点复现所需参数"一键拷给他人/探针（飞船高原、敌落点诊断等）。
// 纯 UI，只读 `__rts` 数据；不参与任何指挥链。
// ============================================================

export interface CopyInfo {
  seed: number;
  ship: { x: number; z: number };
  landing: { x: number; z: number } | null;
  cam: { x: number; z: number };
}

export class CopyInfoPanel {
  private readonly root: HTMLDivElement;
  private readonly line: HTMLSpanElement;
  private readonly status: HTMLSpanElement;

  constructor(private readonly get: () => CopyInfo) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'right:10px', 'bottom:10px', 'z-index:955', 'width:300px',
      'padding:6px 8px', 'background:rgba(8,13,22,0.9)', 'border:1px solid rgba(110,170,235,0.35)',
      'border-radius:8px', 'color:#dce8f5', 'font:11px Consolas,monospace', 'user-select:text',
      'display:flex', 'align-items:center', 'gap:6px',
    ].join(';');
    this.line = document.createElement('span');
    this.line.style.cssText = 'flex:1 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    const btn = document.createElement('button');
    btn.textContent = '复制';
    btn.style.cssText = 'padding:2px 8px;font:11px Consolas,monospace;color:#dce8f5;'
      + 'background:rgba(40,70,110,0.6);border:1px solid rgba(110,170,235,0.35);border-radius:4px;cursor:pointer;';
    btn.onclick = () => this.copy();
    this.status = document.createElement('span');
    this.status.style.cssText = 'color:#7fe08a;width:34px;text-align:right;';
    this.root.append(this.line, btn, this.status);
    document.body.appendChild(this.root);
    this.refresh();
    setInterval(() => this.refresh(), 500);
  }

  /** 当前可复制文本（探针/自检可直读） */
  text(): string {
    const i = this.get();
    const f = (p: { x: number; z: number } | null): string => (p ? `${p.x.toFixed(0)},${p.z.toFixed(0)}` : '-');
    return `seed=${i.seed} ship=${f(i.ship)} landing=${f(i.landing)} cam=${f(i.cam)}`;
  }

  refresh(): void {
    this.line.textContent = this.text();
  }

  private copy(): void {
    const t = this.text();
    const clip = navigator.clipboard;
    if (clip && typeof clip.writeText === 'function') {
      void clip.writeText(t).then(
        () => { this.status.textContent = '已复制'; this.blink(); },
        () => this.fallback(t),
      );
    } else {
      this.fallback(t);
    }
  }

  /** 剪贴板不可用：选中文本（用户 Ctrl+C） */
  private fallback(t: string): void {
    const ta = document.createElement('textarea');
    ta.value = t;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    this.status.textContent = ok ? '已复制' : '请复制';
    if (!ok) {
      // 退化为全选面板文本：用户直接 Ctrl+C
      const sel = window.getSelection();
      if (sel) { const r = document.createRange(); r.selectNodeContents(this.line); sel.removeAllRanges(); sel.addRange(r); }
    }
    this.blink();
  }

  private blink(): void {
    window.setTimeout(() => { this.status.textContent = ''; }, 1200);
  }
}
