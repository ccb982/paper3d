// ============================================================
// Crosshair —— 准星（UI 表现层）
// ============================================================
// 固定屏幕中心（游戏视角操作模式下，瞄准/交互以准星为基准，
// 与鼠标设备位置解耦——触屏/手柄同样以屏幕中心为瞄准点）。
// 纯表现：十字线 + 世界目标计算由调用方（模式层）做。
// 架构：UIEngine 就绪后迁入 Canvas 自绘组件，接口不变。

export class Crosshair {
  private el: HTMLDivElement;
  private disposers: Array<() => void> = [];

  constructor(container: HTMLElement = document.body) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:50%',
      'width:22px',
      'height:22px',
      'transform:translate(-50%,-50%)',
      'pointer-events:none',
      'z-index:999',
      'opacity:0.85',
    ].join(';');
    // 十字线（四条短线 + 中心点）
    this.el.innerHTML = `
      <style>
        .ch { position:absolute; background:#fff; box-shadow:0 0 2px rgba(0,0,0,0.9); }
        .ch-t { left:10px; top:0; width:2px; height:7px; }
        .ch-b { left:10px; bottom:0; width:2px; height:7px; }
        .ch-l { top:10px; left:0; height:2px; width:7px; }
        .ch-r { top:10px; right:0; height:2px; width:7px; }
        .ch-dot { left:9px; top:9px; width:4px; height:4px; border-radius:50%; background:#fff; }
      </style>
      <div class="ch ch-t"></div><div class="ch ch-b"></div>
      <div class="ch ch-l"></div><div class="ch ch-r"></div>
      <div class="ch ch-dot"></div>`;
    container.appendChild(this.el);
    this.disposers.push(() => this.el.remove());
  }

  /** 显示/隐藏 */
  setVisible(visible: boolean): void {
    this.el.style.display = visible ? 'block' : 'none';
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}
