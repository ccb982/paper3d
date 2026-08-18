// ============================================================
// BaseInteractionUI.ts —— UI 管理器基类
// 统一管理弹窗栈和生命周期，ShipUIManager / WorldUIManager 继承此基类。
// ============================================================

export interface PanelDef {
  id: string;
  onOpen: () => void;
  onClose: () => void;
  render: () => HTMLElement;
}

export class BaseInteractionUI {
  protected panelStack: PanelDef[] = [];
  protected overlayRoot: HTMLElement | null = null;

  /** 打开一个新面板（压入栈顶） */
  openPanel(def: PanelDef): void {
    this.closePanel(def.id);
    def.onOpen();
    this.panelStack.push(def);
    this.renderStack();
  }

  /** 关闭指定面板（或栈顶） */
  closePanel(id?: string): void {
    if (id) {
      const idx = this.panelStack.findIndex(p => p.id === id);
      if (idx === -1) return;
      const removed = this.panelStack.splice(idx, 1);
      removed.forEach(p => p.onClose());
    } else {
      const top = this.panelStack.pop();
      top?.onClose();
    }
    this.renderStack();
  }

  /** 关闭所有面板 */
  closeAllPanels(): void {
    while (this.panelStack.length > 0) {
      this.panelStack.pop()!.onClose();
    }
    this.renderStack();
  }

  /** 渲染栈顶面板（或隐藏 overlay） */
  private renderStack(): void {
    if (!this.overlayRoot) return;
    this.overlayRoot.innerHTML = '';
    if (this.panelStack.length === 0) {
      this.overlayRoot.style.display = 'none';
      return;
    }
    this.overlayRoot.style.display = 'flex';
    const top = this.panelStack[this.panelStack.length - 1];
    const el = top.render();
    this.overlayRoot.appendChild(el);
  }

  dispose(): void {
    this.closeAllPanels();
    if (this.overlayRoot?.parentNode) {
      this.overlayRoot.parentNode.removeChild(this.overlayRoot);
    }
    this.overlayRoot = null;
  }
}