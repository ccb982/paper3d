// ============================================================
// ScrollableModuleList.ts —— 滑动模块列表 DOM 基类
// ============================================================
// 通用"滑动模块"容器：配方/物品等模块按序填入，数量超出可视区
// 时支持上下滚动。滚动条隐藏、无滑块，仅滚轮/拖拽驱动滚动。
// 子类/调用方负责：setRowHeight、append(entryEl)、clear()。
// ============================================================

export interface ScrollableModuleOptions {
  columns?: number;
  gap?: number;
  rowHeight?: number;
}

export class ScrollableModuleList {
  protected viewport: HTMLDivElement;
  protected track: HTMLDivElement;
  private scrollY = 0;
  private maxScroll = 0;
  private rowHeight: number | null;
  private readonly gap: number;
  private readonly columns: number;
  private dragging = false;
  private dragStartY = 0;
  private dragStartScroll = 0;

  constructor(opts: ScrollableModuleOptions = {}) {
    this.columns = opts.columns ?? 1;
    this.gap = opts.gap ?? 8;
    this.rowHeight = opts.rowHeight ?? null;

    this.viewport = document.createElement('div');
    this.viewport.style.cssText = [
      'position:relative', 'width:100%', 'height:100%',
      'overflow:hidden',
      'scrollbar-width:none', '-ms-overflow-style:none',
      'user-select:none', '-webkit-user-select:none',
    ].join(';');
    this.viewport.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      this.scrollBy(e.deltaY);
    }, { passive: false });

    this.track = document.createElement('div');
    this.track.style.cssText = [
      'position:absolute', 'top:0', 'left:0', 'right:0',
      'display:flex', 'flex-wrap:wrap', 'align-content:flex-start',
      'gap:' + this.gap + 'px',
    ].join(';');
    this.viewport.appendChild(this.track);
  }

  /** 获取容器根元素（挂到宿主 DOM） */
  get element(): HTMLDivElement {
    return this.viewport;
  }

  /** 设置条目行高（px） */
  setRowHeight(h: number): void {
    this.rowHeight = h;
    this.layout();
  }

  /** 清空所有条目 */
  clear(): void {
    this.track.innerHTML = '';
    this.scrollY = 0;
    this.layout();
  }

  /** 追加一个条目 DOM（调用方负责构造内容） */
  append(entry: HTMLElement): void {
    const widthPct = 100 / this.columns;
    entry.style.cssText += [
      `;box-sizing:border-box`,
      `;width:calc(${widthPct}% - ${(this.gap * (this.columns - 1)) / this.columns}px)`,
      this.rowHeight ? `;height:${this.rowHeight}px` : '',
    ].join('');
    this.track.appendChild(entry);
    this.layout();
  }

  /** 内容滚动到底部 */
  scrollToBottom(): void {
    this.scrollY = this.maxScroll;
    this.applyScroll();
  }

  scrollBy(delta: number): void {
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY + delta));
    this.applyScroll();
  }

  /** 拖拽滚动开始（外部 pointer down 传入，须先在 element 上绑指针事件） */
  beginDrag(clientY: number): void {
    this.dragging = true;
    this.dragStartY = clientY;
    this.dragStartScroll = this.scrollY;
  }

  /** 已拖拽过（用于区分点击与拖拽） */
  hasDragged(clientY: number): boolean {
    return Math.abs(clientY - this.dragStartY) > 6;
  }

  moveDrag(clientY: number): void {
    if (!this.dragging) return;
    this.scrollBy(this.dragStartScroll - (clientY - this.dragStartY));
  }

  endDrag(): void {
    this.dragging = false;
  }

  /** 重新计算最大滚动量并应用布局 */
  layout(): void {
    if (this.rowHeight) {
      // ★ 行高就绪后统一赋给所有条目（不依赖 append 时机的先后）
      const widthPct = 100 / this.columns;
      for (const child of Array.from(this.track.children) as HTMLElement[]) {
        child.style.height = this.rowHeight + 'px';
        child.style.width = `calc(${widthPct}% - ${(this.gap * (this.columns - 1)) / this.columns}px)`;
        child.style.flexShrink = '0';
      }
      const rows = Math.ceil(this.track.children.length / this.columns);
      const contentH = rows * (this.rowHeight + this.gap) - this.gap;
      this.maxScroll = Math.max(0, contentH - this.viewport.clientHeight);
    } else {
      this.maxScroll = Math.max(0, this.track.scrollHeight - this.viewport.clientHeight);
    }
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY));
    this.applyScroll();
  }

  private applyScroll(): void {
    this.track.style.transform = `translateY(${-this.scrollY}px)`;
  }

  dispose(): void {
    this.viewport.remove();
  }
}