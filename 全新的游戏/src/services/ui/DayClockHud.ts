// ============================================================
// DayClockHud —— 每日进度条（顶部）+ 计时/接敌/总攻时刻（右上角）
// ============================================================
// 用户定 2026-09-30：
//   · 顶部 = **每日进度条**（事态 p；80% 处一根总攻刻度线，随姿态换色/标签）；
//   · 右上角 = **计时**：落地起算的现实计时 + 游戏内时钟（SunCycle；900 现实秒 = 24h）+ 日期，
//     以及事件戳「接敌 mm:ss ｜ 总攻 mm:ss」（只在发生后显示，便于确知敌人第几分钟进舰）。
// 数据由 WorldMode 每 0.25s 推一次（本组件不主动查）。
// ============================================================

export interface DayClockState {
  /** 事态进度 p（0~1；蜂群事态函数） */
  p: number;
  /** 当前姿态（fortify/patrol/advance/mass/assault/withdraw） */
  posture: string;
  /** 落地起算的现实秒（= 模拟秒；HUD 主计时） */
  elapsedS: number;
  /** 游戏内时钟（0~24）与累计天数 */
  hour: number;
  day: number;
  /** 首敌进舰（≤24m）时刻（秒；-1 = 未发生） */
  contactS: number;
  /** 总攻开始时刻（秒；-1 = 未发生） */
  assaultS: number;
  /** Boss 局（顶部条标签提示"总攻锁定"） */
  boss: boolean;
}

const POSTURE_CN: Record<string, string> = {
  fortify: '布防', patrol: '巡逻', advance: '推进', mass: '集结', assault: '总攻', withdraw: '撤退',
};
const POSTURE_COLOR: Record<string, string> = {
  fortify: '#7f8fa6', patrol: '#4a90d9', advance: '#f0a020', mass: '#ff7043', assault: '#e53935', withdraw: '#8e8e8e',
};
const ASSAULT_P = 0.80;

function fmt(sec: number): string {
  if (sec < 0 || !Number.isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export class DayClockHud {
  /** 顶部进度条（居中，状态条下方） */
  private barRoot: HTMLDivElement;
  private barFill: HTMLDivElement;
  private barTick: HTMLDivElement;
  private barLabelL: HTMLSpanElement;
  private barLabelR: HTMLSpanElement;
  /** 右上角计时块 */
  private clockRoot: HTMLDivElement;
  private timeMain: HTMLDivElement;
  private timeWorld: HTMLDivElement;
  private timeEvents: HTMLDivElement;
  /** 上帧值（节流） */
  private last = { p: -1, posture: '', elapsed: -1, hour: -1, day: -1, contact: -2, assault: -2 };

  constructor() {
    // ---- 顶部进度条 ----
    const root = document.createElement('div');
    root.style.cssText = [
      'position:fixed', 'top:52px', 'left:50%', 'transform:translateX(-50%)',
      'width:360px', 'z-index:60', 'pointer-events:none',
      'font:11px/14px ui-monospace,Consolas,monospace', 'color:#cfd8e3',
      'display:none',
    ].join(';');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px;text-shadow:0 1px 2px rgba(0,0,0,.8)';
    const l = document.createElement('span'); l.textContent = '事态 0%';
    const r = document.createElement('span'); r.style.cssText = 'opacity:.7'; r.textContent = '总攻 80%';
    row.append(l, r);
    const bar = document.createElement('div');
    bar.style.cssText = 'position:relative;height:6px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.25);box-sizing:border-box';
    const fill = document.createElement('div');
    fill.style.cssText = 'position:absolute;left:0;top:0;bottom:0;width:0%;background:#7f8fa6;transition:width .2s linear,background .3s';
    const tick = document.createElement('div');
    tick.style.cssText = `position:absolute;left:${ASSAULT_P * 100}%;top:-2px;bottom:-2px;width:1px;background:rgba(255,255,255,.8)`;
    bar.append(fill, tick);
    root.append(row, bar);

    // ---- 右上角计时 ----
    const clock = document.createElement('div');
    clock.style.cssText = [
      'position:fixed', 'top:10px', 'right:12px', 'z-index:60', 'pointer-events:none',
      'text-align:right', 'font:12px/18px ui-monospace,Consolas,monospace', 'color:#e8eef5',
      'text-shadow:0 1px 3px rgba(0,0,0,.9)', 'display:none',
    ].join(';');
    const main = document.createElement('div');
    main.style.cssText = 'font-size:16px;font-weight:700;letter-spacing:.5px';
    const world = document.createElement('div');
    world.style.cssText = 'opacity:.85';
    const events = document.createElement('div');
    events.style.cssText = 'opacity:.85;color:#ffd24a';
    clock.append(main, world, events);

    document.body.append(root, clock);
    this.barRoot = root; this.barFill = fill; this.barTick = tick;
    this.barLabelL = l; this.barLabelR = r;
    this.clockRoot = clock; this.timeMain = main; this.timeWorld = world; this.timeEvents = events;
  }

  setVisible(v: boolean): void {
    this.barRoot.style.display = v ? 'block' : 'none';
    this.clockRoot.style.display = v ? 'block' : 'none';
  }

  /** 每 0.25s 推一次；未变不写 DOM */
  update(s: DayClockState): void {
    if (s.elapsedS !== this.last.elapsed) {
      this.timeMain.textContent = `落地 +${fmt(s.elapsedS)}`;
    }
    if (s.hour !== this.last.hour || s.day !== this.last.day) {
      const hh = Math.floor(s.hour);
      const mm = Math.floor((s.hour - hh) * 60);
      this.timeWorld.textContent = `游戏内 ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · 第${s.day + 1}天`;
    }
    if (s.contactS !== this.last.contact || s.assaultS !== this.last.assault) {
      const parts: string[] = [];
      if (s.contactS >= 0) parts.push(`接敌 ${fmt(s.contactS)}`);
      if (s.assaultS >= 0) parts.push(`总攻 ${fmt(s.assaultS)}`);
      this.timeEvents.textContent = parts.join(' ｜ ');
    }
    if (s.p !== this.last.p || s.posture !== this.last.posture) {
      const pct = Math.round(Math.max(0, Math.min(1, s.p)) * 100);
      const cn = POSTURE_CN[s.posture] ?? s.posture;
      this.barLabelL.textContent = `事态 ${pct}% · ${cn}${s.boss ? '（Boss 总攻锁定）' : ''}`;
      this.barFill.style.width = `${pct}%`;
      this.barFill.style.background = POSTURE_COLOR[s.posture] ?? '#7f8fa6';
    }
    this.last = { p: s.p, posture: s.posture, elapsed: s.elapsedS, hour: s.hour, day: s.day, contact: s.contactS, assault: s.assaultS };
  }

  dispose(): void {
    this.barRoot.remove();
    this.clockRoot.remove();
  }
}
