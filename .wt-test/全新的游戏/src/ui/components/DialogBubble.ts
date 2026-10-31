// ============================================================
// DialogBubble.ts —— 共享 UI 组件：对话气泡
// 舰船和世界共用，样式统一。
// ============================================================

export interface DialogBubbleOptions {
  speaker: string;
  text: string;
  onClose?: () => void;
  autoCloseMs?: number;
}

export function renderDialogBubble(options: DialogBubbleOptions): HTMLElement {
  const container = document.createElement('div');
  container.style.cssText = [
    'position:fixed',
    'bottom:200px',
    'left:50%',
    'transform:translateX(-50%)',
    'background:rgba(0,0,0,0.85)',
    'color:#fff',
    'padding:16px 24px',
    'border-radius:8px',
    'max-width:400px',
    'z-index:150',
    'border:1px solid #4466aa',
  ].join(';');

  const speakerEl = document.createElement('div');
  speakerEl.style.cssText = 'font-weight:bold;color:#8af;margin-bottom:4px;font-size:13px;';
  speakerEl.textContent = options.speaker;
  container.appendChild(speakerEl);

  const textEl = document.createElement('div');
  textEl.style.cssText = 'font-size:14px;line-height:1.4;';
  textEl.textContent = options.text;
  container.appendChild(textEl);

  if (options.onClose) {
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText = 'margin-top:8px;padding:4px 12px;background:#4466aa;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;';
    closeBtn.addEventListener('click', () => {
      container.remove();
      options.onClose?.();
    });
    container.appendChild(closeBtn);
  }

  if (options.autoCloseMs && options.autoCloseMs > 0) {
    setTimeout(() => {
      if (container.parentNode) {
        container.remove();
        options.onClose?.();
      }
    }, options.autoCloseMs);
  }

  return container;
}