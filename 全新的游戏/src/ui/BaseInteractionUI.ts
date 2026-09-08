// ============================================================
// BaseInteractionUI.ts —— UI 管理器基类（适配器，兼容旧接口）
// ============================================================
// 保留旧 openPanel/closePanel/closeAllPanels 接口，内部委托给
// 新的 PanelManager（模态面板栈）。对外同时暴露新系统的
// hasModalOpen / activeId 用于指针锁定联动。
// ShipUIManager / WorldUIManager 继承此基类。
// ============================================================

import type { PanelDef } from './panel/Panel';
import { PanelManager } from './panel/PanelManager';
import { WidgetManager } from './panel/WidgetManager';

export type { PanelDef } from './panel/Panel';
export { Panel } from './panel/Panel';
export { PanelManager } from './panel/PanelManager';
export { WidgetManager } from './panel/WidgetManager';

export class BaseInteractionUI {
  /** ★ 模态面板栈管理器（新核心） */
  protected panels = new PanelManager({ zIndex: 300 });
  /** ★ 非模态小部件管理器（对话/提示/悬浮文字） */
  protected widgets = new WidgetManager(document.body);

  /** 旧接口：overlay 根元素（供子类兼容读取） */
  protected get overlayRoot(): HTMLElement | null {
    return (this.panels as unknown as { overlayRoot: HTMLElement }).overlayRoot;
  }

  /** 旧接口：是否有任意面板打开（指针锁定联动） */
  get hasModalOpen(): boolean {
    return this.panels.hasModalOpen;
  }

  get activeId(): string | null {
    return this.panels.activeId;
  }

  /** 旧接口：打开一个声明式面板 */
  openPanel(def: PanelDef): void {
    this.panels.open(def);
  }

  /** 旧接口：关闭指定面板（或栈顶） */
  closePanel(id?: string): void {
    this.panels.close(id);
  }

  /** 旧接口：关闭所有面板 */
  closeAllPanels(): void {
    this.panels.closeAll();
  }

  dispose(): void {
    this.widgets.clear();
    this.panels.destroy();
  }
}
