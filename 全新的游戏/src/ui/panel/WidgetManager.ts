// ============================================================
// panel/WidgetManager.ts —— 非模态 HUD 小部件管理层
// ============================================================
// 用于不阻断战斗的常驻/临时 UI：对话气泡、悬浮文字、交互提示等。
// 与模态 PanelManager 分层：Widget 不占弹窗栈、不触发指针解锁，
// 由各自 autoClose 管理生命周期。
// ============================================================

import type { WidgetHandle } from './types';

export interface WidgetOptions {
  /** 挂载容器；缺省为 overlay root */
  parent?: HTMLElement;
  /** 自动关闭毫秒数（可选） */
  autoCloseMs?: number;
  /** 自定义样式 */
  style?: string;
}

export class WidgetManager {
  private widgets: WidgetHandle[] = [];
  private parent: HTMLElement;

  constructor(parent: HTMLElement) {
    this.parent = parent;
  }

  /**
   * 添加一个小部件（由调用方创建元素并返回 handle）。
   */
  add(el: HTMLElement, opts: WidgetOptions = {}): WidgetHandle {
    const parent = opts.parent ?? this.parent;
    const handle: WidgetHandle = {
      el,
      close: () => {
        if (el.parentNode) el.parentNode.removeChild(el);
        const i = this.widgets.indexOf(handle);
        if (i !== -1) this.widgets.splice(i, 1);
      },
    };
    this.widgets.push(handle);
    parent.appendChild(el);
    if (opts.autoCloseMs) {
      setTimeout(() => handle.close(), opts.autoCloseMs);
    }
    return handle;
  }

  /** 常用：快速生成一个纯文本小部件（对话/提示） */
  text(text: string, opts: WidgetOptions = {}): WidgetHandle {
    const el = document.createElement('div');
    el.style.cssText =
      'position:fixed;' + (opts.style ?? '') +
      ' background:rgba(0,0,0,0.75);color:#fff;padding:10px 16px;border-radius:8px;' +
      'font-size:14px;z-index:400;pointer-events:none;white-space:pre-wrap;';
    el.textContent = text;
    return this.add(el, opts);
  }

  /** 清空所有小部件（宿主 exit 时调用） */
  clear(): void {
    for (const w of [...this.widgets]) w.close();
    this.widgets.length = 0;
  }
}
