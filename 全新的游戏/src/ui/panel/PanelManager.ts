// ============================================================
// panel/PanelManager.ts —— 统一模态面板栈管理器
// ============================================================
// 职责：
//   · 维护 LIFO 弹窗栈，每次只渲染栈顶
//   · 统一生命周期：open → onOpen，close → onClose，销毁时全清
//   · 打开面板时若同 id 已存在则先关闭旧实例（避免重复）
//   · 内置 overlay 根（全屏遮罩），可注入到 document.body
//   · 暴露 hasModalOpen / activeId 供上游（指针锁定、输入屏蔽）联动
// 兼容两种用法：声明式 PanelDef 与类式 Panel 子类。
// ============================================================

import type { PanelDef } from './Panel';
import { Panel } from './Panel';
import type { PanelRenderOptions } from './types';

interface StackEntry {
  id: string;
  title?: string;
  actions?: PanelDef['actions'];
  closable: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  /** 渲染回调：PanelDef 用 render；Panel 类用 build */
  renderContent: (opts: PanelRenderOptions) => HTMLElement;
  /** 是否命中了默认标题栏渲染（title 存在且未自定义） */
  usesDefaultHeader: boolean;
}

export class PanelManager {
  private stack: StackEntry[] = [];
  private overlayRoot: HTMLElement;

  constructor(private opts: { zIndex?: number } = {}) {
    this.overlayRoot = document.createElement('div');
    const z = opts.zIndex ?? 300;
    this.overlayRoot.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
      'background:rgba(0,0,0,0.5)', 'display:none', 'z-index:' + z,
      'pointer-events:auto', 'align-items:center', 'justify-content:center',
    ].join(';');
  }

  /** 挂载到文档（宿主 enter 时调用） */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.overlayRoot);
  }

  /** 是否有任意模态面板打开 */
  get hasModalOpen(): boolean {
    return this.stack.length > 0;
  }

  /** 当前栈顶面板 id */
  get activeId(): string | null {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1].id : null;
  }

  /** 指定 id 面板是否在栈中 */
  isOpen(id: string): boolean {
    return this.stack.some(e => e.id === id);
  }

  /** 打开一个声明式面板 */
  open(def: PanelDef): void {
    // 同 id 已存在 → 先关闭旧的
    if (this.isOpen(def.id)) this.close(def.id);

    const entry: StackEntry = {
      id: def.id,
      title: def.title,
      actions: def.actions,
      closable: def.closable ?? true,
      onOpen: def.onOpen,
      onClose: def.onClose,
      renderContent: (opts) => def.render(opts),
      usesDefaultHeader: !!def.title,
    };
    this.push(entry);
  }

  /** 打开一个类式面板 */
  openPanelClass<P>(panel: Panel<P>): void {
    const close = () => this.close(entryId);
    // 先探测 id：基类没有约定 id 字段，这里用构造器名兜底。
    // 子类可覆写 get id()。
    const entryId = (panel as unknown as { id?: string }).id ?? panel.constructor.name;

    if (this.isOpen(entryId)) this.close(entryId);

    const entry: StackEntry = {
      id: entryId,
      title: undefined,
      closable: true,
      onOpen: () => panel.onOpen(),
      onClose: () => panel.onClose(),
      renderContent: (opts) => panel.render({ ...opts, close }),
      usesDefaultHeader: false,
    };
    this.push(entry);
  }

  private push(entry: StackEntry): void {
    entry.onOpen?.();
    this.stack.push(entry);
    this.renderStack();
  }

  /** 关闭指定面板（或栈顶） */
  close(id?: string): void {
    if (id) {
      const idx = this.stack.findIndex(e => e.id === id);
      if (idx === -1) return;
      const [removed] = this.stack.splice(idx, 1);
      removed.onClose?.();
    } else {
      const top = this.stack.pop();
      top?.onClose?.();
    }
    this.renderStack();
  }

  /** 关闭所有面板 */
  closeAll(): void {
    while (this.stack.length > 0) {
      this.stack.pop()!.onClose?.();
    }
    this.renderStack();
  }

  /** 渲染栈顶（或隐藏遮罩） */
  private renderStack(): void {
    this.overlayRoot.innerHTML = '';
    if (this.stack.length === 0) {
      this.overlayRoot.style.display = 'none';
      return;
    }
    this.overlayRoot.style.display = 'flex';
    const top = this.stack[this.stack.length - 1];
    const opts: PanelRenderOptions = {
      root: this.overlayRoot,
      close: () => this.close(top.id),
    };
    const content = top.renderContent(opts);

    // 需要默认标题栏 → 包装内容
    if (top.title) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'background:rgba(20,20,40,0.95);border:1px solid #4466aa;border-radius:8px;padding:16px;min-width:300px;max-width:90vw;max-height:90vh;overflow-y:auto;';
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;';
      const t = document.createElement('h3');
      t.style.cssText = 'color:#8af;margin:0;';
      t.textContent = top.title;
      head.appendChild(t);
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;';
      for (const a of top.actions ?? []) {
        const btn = document.createElement('button');
        btn.textContent = a.label ?? '';
        btn.style.cssText = 'padding:4px 12px;font-size:12px;background:transparent;color:#8af;border:1px solid #4466aa;border-radius:6px;cursor:pointer;';
        btn.addEventListener('click', a.onClick);
        actions.appendChild(btn);
      }
      if (top.closable) {
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕ 关闭';
        closeBtn.style.cssText = 'padding:4px 12px;font-size:12px;background:transparent;color:#8af;border:1px solid #4466aa;border-radius:6px;cursor:pointer;';
        closeBtn.addEventListener('click', () => this.close(top.id));
        actions.appendChild(closeBtn);
      }
      head.appendChild(actions);
      wrapper.appendChild(head);
      wrapper.appendChild(content);
      this.overlayRoot.appendChild(wrapper);
    } else {
      this.overlayRoot.appendChild(content);
    }
  }

  /** 销毁：清空面板栈 + 移除遮罩 */
  destroy(): void {
    this.closeAll();
    if (this.overlayRoot.parentNode) {
      this.overlayRoot.parentNode.removeChild(this.overlayRoot);
    }
  }
}
