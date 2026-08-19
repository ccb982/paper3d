// ============================================================
// PlayerHud —— 玩家血量 HUD（分段血条 + 低血量脉冲）
// ============================================================
// 左上角画布自绘，数据由模式层每帧传入（hp/maxHp）。
// 每 10% 一段，共 10 格；低血量时（<25%）透明度呼吸闪烁。
// ============================================================

export class PlayerHud {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 200;
  private h = 22;
  private readonly segCount = 10;
  private readonly gap = 1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.cssText = [
      'position:fixed;top:176px;left:8px;',
      `width:${this.w}px;height:${this.h}px;`,
      'z-index:998;pointer-events:none;',
    ].join('');
    this.ctx = this.canvas.getContext('2d')!;
    document.body.appendChild(this.canvas);
  }

  /** 每帧绘制：10 段血条 + 低血量呼吸 + HP 数字 */
  update(hp: number, maxHp: number): void {
    const ctx = this.ctx;
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    ctx.clearRect(0, 0, this.w, this.h);

    const pad = 2;
    const innerW = this.w - pad * 2;
    const innerH = this.h - pad * 2;
    const segW = (innerW - this.gap * (this.segCount - 1)) / this.segCount;
    const filledSegs = Math.ceil(ratio * this.segCount);

    // 低血量脉冲（< 25% 时透明度呼吸）
    let pulseAlpha = 1;
    if (ratio < 0.25) {
      const t = performance.now() * 0.005; // 约 0.8 秒一个完整周期
      pulseAlpha = 0.55 + 0.45 * Math.sin(t);
    }

    // 绘制 10 段
    for (let i = 0; i < this.segCount; i++) {
      const x = pad + i * (segW + this.gap);
      const isFilled = i < filledSegs;

      if (isFilled) {
        // 填充段：根据区间渐变颜色
        const segPos = (i + 1) / this.segCount;
        let color: string;
        if (segPos <= 0.25) {
          color = '#ff2222';       // 危急——亮红
        } else if (segPos <= 0.5) {
          color = '#e04545';       // 受伤——深红
        } else {
          color = '#d06040';       // 健康——橙红
        }
        ctx.globalAlpha = pulseAlpha;
        ctx.fillStyle = color;
        ctx.fillRect(x, pad, segW, innerH);
        ctx.globalAlpha = 1;
      } else {
        // 空段——暗底
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x, pad, segW, innerH);
      }

      // 段间细线
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x, pad, segW, innerH);
    }

    // 外边框
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(pad - 0.5, pad - 0.5, innerW + 1, innerH + 1);

    // HP 数字
    ctx.fillStyle = '#fff';
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.ceil(hp)} / ${maxHp}`, this.w / 2, this.h / 2);
  }

  dispose(): void {
    this.canvas.remove();
  }
}
