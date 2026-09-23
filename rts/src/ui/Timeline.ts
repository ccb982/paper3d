// ============================================================
// Timeline —— 时间轴（RTS 侧调试/演示 UI，外接）
//   拖动 = **绝对**设置当日进度（06:00→18:00，0~1）：事态函数/闸门/引擎令随之重算
//   标记：0.45 第一波 · 0.80 总攻；勾选「跟随实时」恢复自然时钟
// ============================================================
import type { SwarmCommander } from '../systems/swarm/SwarmCommander';

export class Timeline {
  /** ★ 时间变化回调（小地图/列表立即重绘用） */
  onChange: (() => void) | null = null;
  private readonly root: HTMLDivElement;
  private readonly slider: HTMLInputElement;
  private readonly infoEl: HTMLDivElement;
  private readonly follow: HTMLInputElement;
  private lastRefresh = 0;

  constructor(private readonly commander: SwarmCommander) {
    this.root = document.createElement('div');
    this.root.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:10px', 'transform:translateX(-50%)',
      'z-index:955', 'width:560px', 'padding:6px 12px 8px',
      'background:rgba(8,13,22,0.9)', 'border:1px solid rgba(110,170,235,0.35)',
      'border-radius:8px', 'color:#dce8f5', 'font:12px "Microsoft YaHei",sans-serif', 'user-select:none',
    ].join(';');
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const title = document.createElement('div');
    title.textContent = '时间轴 06:00 — 18:00';
    title.style.cssText = 'color:#8ac8ff;font-weight:bold;';
    this.infoEl = document.createElement('div');
    this.infoEl.style.cssText = 'flex:1 1 auto;text-align:right;color:#9fd0ff;font:11px Consolas,monospace;';
    const followLab = document.createElement('label');
    followLab.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;';
    this.follow = document.createElement('input');
    this.follow.type = 'checkbox';
    this.follow.checked = true;
    this.follow.onchange = () => { if (this.follow.checked) { this.commander.followRealtime(); this.onChange?.(); } };
    followLab.append(this.follow, document.createTextNode('跟随实时'));
    head.append(title, this.infoEl, followLab);

    this.slider = document.createElement('input');
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '1000';
    this.slider.value = '0';
    this.slider.style.cssText = 'width:100%;margin-top:4px;accent-color:#3399ff;';
    this.slider.oninput = () => {
      this.follow.checked = false;
      this.commander.scrubDay(Number(this.slider.value) / 1000);
      this.sync();
      this.onChange?.();
    };
    // 标记行：第一波 / 总攻
    const marks = document.createElement('div');
    marks.style.cssText = 'position:relative;height:14px;color:#ffd24a;font:10px Consolas,monospace;';
    const mk = (pct: number, text: string): HTMLSpanElement => {
      const s = document.createElement('span');
      s.textContent = text;
      s.style.cssText = `position:absolute;left:${pct}%;transform:translateX(-50%);`;
      return s;
    };
    marks.append(mk(45, '▲第一波'), mk(80, '▲总攻'));
    this.root.append(head, this.slider, marks);
    document.body.appendChild(this.root);
    this.sync();
  }

  /** 2Hz：跟随实时时同步滑块位置 + 状态文本 */
  refresh(): void {
    const now = performance.now();
    if (now - this.lastRefresh < 500) return;
    this.lastRefresh = now;
    if (this.follow.checked) this.slider.value = String(Math.round(this.commander.lastT01 * 1000));
    this.sync();
  }

  private sync(): void {
    const v = Number(this.slider.value) / 1000;
    const hour = 6 + v * 12;
    const hh = Math.floor(hour);
    const mm = Math.floor((hour - hh) * 60);
    const band = this.commander.fortifyBand;
    this.infoEl.textContent =
      `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${this.commander.stage}/${this.commander.battlePosture}`
      + ` · frontP=${band.frontP.toFixed(2)} · 下限=${band.minD > 0 ? band.minD.toFixed(0) : '-'}m`
      + ` · 上限=${band.maxD > 0 ? band.maxD.toFixed(0) : '-'}m · 前推+${band.pushM.toFixed(0)}m`
      + ` · 速度×${(globalThis as unknown as { __rts?: { speed?: number } }).__rts?.speed ?? 1}（, / . 调速）`;
  }
}
