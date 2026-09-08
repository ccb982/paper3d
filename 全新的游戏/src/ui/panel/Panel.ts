// ============================================================
// panel/Panel.ts —— 面板定义与面板基类
// ============================================================
// 两种用法（都交给 PanelManager 统一管理）：
//   1）声明式对象（PanelDef）：传 render/onOpen/onClose/title/actions ，
//      简单面板无需建类。
//   2）类式（继承 Panel）：适合内容复杂、状态多、需要拆方法的面板。
//      返回 its 根元素，或调用 this.close() 关闭。
// ============================================================

import type { PanelAction, PanelRenderOptions } from './types';

/** 声明式面板定义 */
export interface PanelDef {
  id: string;
  /** 标题（可选；提供则自动渲染标题栏，含默认关闭按钮） */
  title?: string;
  /** 右上角额外动作（可选） */
  actions?: PanelAction[];
  /** 是否显示默认“关闭”按钮（默认 true，提供 title 时生效） */
  closable?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  render: (opts: PanelRenderOptions) => HTMLElement;
}

/** 面板基类：复杂面板继承它 */
export abstract class Panel<P = undefined> {
  /** 注入的渲染上下文（由 PanelManager 设置） */
  protected ctx!: PanelRenderOptions;
  /** 构造参数（用于传递 session / itemManager 等） */
  constructor(protected props: P) {}

  /** PanelManager 调用来获取本面板根元素 */
  render(opts: PanelRenderOptions): HTMLElement {
    this.ctx = opts;
    return this.build(opts);
  }

  /** 子类实现：构建面板内容，返回根元素 */
  protected abstract build(opts: PanelRenderOptions): HTMLElement;

  /** 打开时回调（可覆写） */
  onOpen(): void {}
  /** 关闭时回调（可覆写，用于清理定时器/订阅） */
  onClose(): void {}

  /** 关闭自己（在事件处理器中调用） */
  protected close(): void {
    this.ctx.close();
  }

  /** 便捷：渲染标题栏（标题 + 关闭按钮） */
  protected header(title: string, extraActions: PanelAction[] = []): HTMLElement {
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;';
    const h = document.createElement('h3');
    h.style.cssText = 'color:#8af;margin:0;';
    h.textContent = title;
    head.appendChild(h);
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;';
    for (const a of extraActions) {
      const btn = document.createElement('button');
      btn.textContent = a.label ?? '';
      btn.style.cssText = 'padding:4px 12px;font-size:12px;background:transparent;color:#8af;border:1px solid #4466aa;border-radius:6px;cursor:pointer;';
      btn.addEventListener('click', a.onClick);
      actions.appendChild(btn);
    }
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ 关闭';
    closeBtn.style.cssText = 'padding:4px 12px;font-size:12px;background:transparent;color:#8af;border:1px solid #4466aa;border-radius:6px;cursor:pointer;';
    closeBtn.addEventListener('click', () => this.close());
    actions.appendChild(closeBtn);
    head.appendChild(actions);
    return head;
  }
}
