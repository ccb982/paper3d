// ============================================================
// panel/SidePanel.ts —— 非模态"侧边嵌入式"面板基类
// ============================================================
// 与模态 PanelManager 弹窗不同：侧边面板渲染进宿主提供的固定容器
// （如舰船模式的 panelContainer），不占用弹窗栈、不触发指针解锁。
// 仍然继承统一 Panel 基类，获得一致的标题栏/关闭按钮与生命周期。
// ============================================================

import { Panel } from './Panel';
import type { PanelRenderOptions } from './types';

// 子类通过构造 props 传所需业务依赖；关闭行为由宿主经 ctx.close() 注入，
// 不再需要 SidePanel 声明 onClose 字段。

/** 侧边面板基类：子类实现 title() 与 body() */
export abstract class SidePanel<P = object> extends Panel<P> {
  protected abstract title(): string;

  /** 面板主体内容（不含标题栏） */
  protected abstract body(opts: PanelRenderOptions): HTMLElement;

  protected build(opts: PanelRenderOptions): HTMLElement {
    const wrap = document.createElement('div');
    // ★ 复用 Panel.header() 内置的「✕ 关闭」按钮（经 ctx.close() 触发宿主 close）
    wrap.appendChild(this.header(this.title()));
    wrap.appendChild(this.body(opts));
    return wrap;
  }
}
