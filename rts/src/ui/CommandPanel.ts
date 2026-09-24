// ============================================================
// ui/CommandPanel —— 玩家发令面板（重写 P3；用户定 2026-09-25）
// ============================================================
// **全新 UI 面板**（替代中键临时入口）：所有玩家命令从这里出。
//   · 作用范围：近队(60m) / 全体 / 指定队（点队徽选中）
//   · 命令：行动 / 行军 / 驻守 / 巡逻 / 防御 / 保护 / 集结
//   · 目标：地图点击设定（main.ts 调 setTarget）
//   · 输出：onOrder(kind, target, scope) —— main.ts 接到 EngineBridge.playerOrder*
// 纯 DOM（无 three）；只读引擎状态（小队列表由 main 每帧喂入）。
// ============================================================

export type OrderScope = 'near' | 'all' | 'selected';

export interface PanelSquad {
  id: number;
  role: string;
  alive: number;
  selected: boolean;
}

/** 面板可选命令（与 engine/contracts 的复合/原子对齐） */
const KINDS: readonly { id: string; label: string }[] = [
  { id: 'act', label: '行动' },
  { id: 'march', label: '行军' },
  { id: 'garrison', label: '驻守' },
  { id: 'patrol', label: '巡逻' },
  { id: 'defend', label: '防御' },
  { id: 'protect', label: '保护' },
  { id: 'regroup', label: '集结' },
];

const SCOPE_LABEL: Record<OrderScope, string> = { near: '近队60m', all: '全体', selected: '指定队' };

export class CommandPanel {
  private readonly el: HTMLDivElement;
  private squads: PanelSquad[] = [];
  private scope: OrderScope = 'near';
  private target = { x: 0, z: 0 };
  /** 发令回调（main.ts 接线：EngineBridge.playerOrder*） */
  onOrder: ((kind: string, target: { x: number; z: number }, scope: OrderScope) => void) | null = null;
  /** 回显（最近一次发令结果） */
  lastText = '';

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'cmd-panel';
    this.el.style.cssText =
      'position:fixed;left:12px;bottom:12px;z-index:30;background:rgba(12,16,22,.86);'
      + 'border:1px solid #2a3648;border-radius:8px;padding:8px 10px;color:#cfe0f5;'
      + 'font:12px/1.7 system-ui,Segoe UI,sans-serif;min-width:300px;user-select:none';
    document.body.appendChild(this.el);
    this.render();
  }

  /** 每帧喂入小队列表（只读展示 + 指定队选择） */
  setSquads(list: PanelSquad[]): void {
    const sig = list.map((s) => `${s.id}:${s.role}:${s.alive}:${s.selected ? 1 : 0}`).join('|');
    if (sig === this._sig) return;
    this._sig = sig;
    this.squads = list;
    this.render();
  }

  /** 指定队（点队徽选中的）id 列表 */
  selectedIds(): number[] {
    return this.squads.filter((s) => s.selected).map((s) => s.id);
  }

  /** 地图点击 → 设定目标点 */
  setTarget(x: number, z: number): void {
    this.target.x = x;
    this.target.z = z;
    this.render();
  }

  private _sig = '';

  private render(): void {
    const scopeBtns = (['near', 'all', 'selected'] as OrderScope[])
      .map((s) => `<button data-scope="${s}" style="${this.btn(this.scope === s)}">${SCOPE_LABEL[s]}</button>`)
      .join(' ');
    const kindBtns = KINDS
      .map((k) => `<button data-kind="${k.id}" style="${this.btn(false, true)}">${k.label}</button>`)
      .join(' ');
    const chips = this.squads
      .map((s) => `<span data-sq="${s.id}" style="${this.chip(s.selected)}">#${s.id} ${s.role}×${s.alive}</span>`)
      .join(' ') || '<span style="opacity:.5">（无小队）</span>';
    this.el.innerHTML = `
      <div style="opacity:.85;margin-bottom:2px">发令面板 · 目标 <b>(${this.target.x.toFixed(0)}, ${this.target.z.toFixed(0)})</b>
        <span style="opacity:.6">（中键点地图设目标并发"行动"）</span></div>
      <div style="margin:2px 0">范围：${scopeBtns}</div>
      <div style="margin:2px 0">命令：${kindBtns}</div>
      <div style="margin-top:4px;max-width:340px">小队：${chips}</div>
      <div style="margin-top:3px;opacity:.75;min-height:16px">${this.lastText}</div>`;
    this.wire();
  }

  private btn(active: boolean, primary = false): string {
    const bg = active ? '#2f5d9e' : primary ? '#1d2a3d' : '#16202e';
    return `background:${bg};color:#cfe0f5;border:1px solid #33455e;border-radius:5px;`
      + 'padding:2px 8px;margin:0 2px 2px 0;cursor:pointer;font:inherit';
  }

  private chip(sel: boolean): string {
    return `display:inline-block;background:${sel ? '#2f5d9e' : '#1a2534'};border:1px solid #33455e;`
      + 'border-radius:10px;padding:0 7px;margin:0 3px 3px 0;cursor:pointer';
  }

  private wire(): void {
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-scope]')) {
      b.onclick = () => {
        this.scope = (b.dataset.scope ?? 'near') as OrderScope;
        this.render();
      };
    }
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('button[data-kind]')) {
      b.onclick = () => this.issue(b.dataset.kind ?? 'act');
    }
    for (const c of this.el.querySelectorAll<HTMLSpanElement>('span[data-sq]')) {
      c.onclick = () => {
        const id = Number(c.dataset.sq);
        for (const s of this.squads) if (s.id === id) s.selected = !s.selected;
        this.scope = 'selected';
        this._sig = '';
        this.render();
      };
    }
  }

  private issue(kind: string): void {
    this.lastText = `已发 ${kind}（${SCOPE_LABEL[this.scope]}）…`;
    this.render();
    this.onOrder?.(kind, { x: this.target.x, z: this.target.z }, this.scope);
  }
}
