// ============================================================
// PlayerHud —— 玩家血量 HUD（简易：血条 + 数字，canvas 自绘）
// ============================================================
// ★ 属于 UILayer（左上角小地图下方）；纯展示，不持有实体引用，
//   数据由模式层每帧传入（hp/maxHp）。

export class PlayerHud {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 200;
  private h = 22;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.cssText =
      `position:fixed;top:176px;left:8px;width:${this.w}px;height:${this.h}px;` +
      'z-index:998;pointer-events:none;';
    this.ctx = this.canvas.getContext('2d')!;
    document.body.appendChild(this.canvas);
  }

  /** 每帧绘制：背景条 + 血量条（按比例）+ HP 数字 */
  update(hp: number, maxHp: number): void {
    const ctx = this.ctx;
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    ctx.clearRect(0, 0, this.w, this.h);
    // 背景
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, this.w, this.h);
    // 血量条
    ctx.fillStyle = ratio > 0.3 ? '#e04545' : '#ff2222';
    ctx.fillRect(2, 2, (this.w - 4) * ratio, this.h - 4);
    // 边框
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, this.w - 1, this.h - 1);
    // 数字
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
