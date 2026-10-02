// ============================================================
// hud —— 面板绑定与训练曲线
// ============================================================
// 约定：本文件只碰 DOM，不碰物理也不碰进化逻辑；所有动作通过 hooks 回调出去，
// 保证"改 UI"和"改算法"互不影响。

import type { GenStat } from '../core/evolution';
import type { SimMode } from '../core/sim';

export interface HudHooks {
  onPause: () => void;
  onResetPopulation: () => void;
  onRespawn: () => void;
  onExport: () => void;
  onImport: () => void;
  onGhost: () => void;
  onJoints: () => void;
  onTextures: () => void;
  onSigma: (v: number) => void;
  onBudget: (v: number) => void;
  onSpeed: (v: number) => void;
  onPhase: (mode: SimMode) => void;
  /** ★ 步态奖励可调（用户 2026-10-01） */
  onGaitTune: (o: {
    velTrack?: number; lift?: number; single?: number; jointMove?: number;
    actRate?: number; lateral?: number; torque?: number;
    moveScale?: Record<string, number>;
  }) => void;
}

export interface HudState {
  paused: boolean;
  mode: 'walk' | 'fight' | 'stand';
  gen: number;
  evaluated: number;
  population: number;
  bestNow: number;
  bestEver: number;
  bestDist: number;
  bestFallen: boolean;
  hits: number;
  hurts: number;
  sigma: number;
  budgetMs: number;
  speed: number;
  stepsPerSec: number;
  frameMs: number;
  ghost: boolean;
  joints: boolean;
  textures: boolean;
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[hud] 缺少元素 #${id}`);
  return el;
}

export class Hud {
  private readonly el: Record<string, HTMLElement>;
  private readonly chart: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private history: GenStat[] = [];
  private lastPaintedGen = -1;

  constructor(hooks: HudHooks) {
    this.el = {
      stage: $('s-stage'), gen: $('s-gen'), pop: $('s-pop'),
      best: $('s-best'), top: $('s-top'), show: $('s-show'),
      tps: $('s-tps'), budget: $('s-budget'),
      vSigma: $('v-sigma'), vBudget: $('v-budget'), vSpeed: $('v-speed'), vPhase: $('v-speedgoal'),
      vVelTrack: $('v-veltrack'), vLift: $('v-lift'), vSingle: $('v-single'),
    vJointMove: $('v-jointmove'), vLateral: $('v-lateral'), vActRate: $('v-actrate'),
    vMHipL: $('v-mhip_l'), vMHipR: $('v-mhip_r'), vMKneeL: $('v-mknee_l'), vMKneeR: $('v-mknee_r'),
      boot: $('boot'), pause: $('b-pause'), ghost: $('b-ghost'),
      joints: $('b-joints'), tex: $('b-tex'),
    };
    this.chart = $('chart') as HTMLCanvasElement;
    const ctx = this.chart.getContext('2d');
    if (!ctx) throw new Error('[hud] 无法获取 2d 上下文');
    this.ctx = ctx;

    const wire = (id: string, ev: string, fn: () => void) => {
      const e = document.getElementById(id);
      if (e) e.addEventListener(ev, fn);
    };
    wire('b-pause', 'click', hooks.onPause);
    wire('b-reset', 'click', hooks.onResetPopulation);
    wire('b-respawn', 'click', hooks.onRespawn);
    wire('b-export', 'click', hooks.onExport);
    wire('b-import', 'click', hooks.onImport);
    wire('b-ghost', 'click', hooks.onGhost);
    wire('b-joints', 'click', hooks.onJoints);
    wire('b-tex', 'click', hooks.onTextures);

    const bindRange = (id: string, label: string, hooks2: (v: number) => void, fmt: (v: number) => string) => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      const out = this.el[label];
      if (!input || !out) return;
      const sync = () => { out.textContent = fmt(Number(input.value)); hooks2(Number(input.value)); };
      input.addEventListener('input', sync);
      sync();
    };
    bindRange('i-sigma', 'vSigma', hooks.onSigma, (v) => v.toFixed(2));
    bindRange('i-budget', 'vBudget', hooks.onBudget, (v) => `${v.toFixed(0)} ms`);
    bindRange('i-speed', 'vSpeed', hooks.onSpeed, (v) => `${v.toFixed(1)}×`);
    bindRange('i-speedgoal', 'vPhase', (v) => hooks.onPhase(v < 0.5 ? 'walk' : 'fight'),
      (v) => (v < 0.5 ? '学走路' : '学战斗'));

    // ---- 步态奖励可调项（用户 2026-10-01："做成可调的按钮，走直线和阈值都是可选项"）----
    bindRange('i-veltrack', 'vVelTrack', (v) => hooks.onGaitTune({ velTrack: v }), (v) => v.toFixed(2));
    bindRange('i-lift', 'vLift', (v) => hooks.onGaitTune({ lift: v }), (v) => v.toFixed(2));
    bindRange('i-single', 'vSingle', (v) => hooks.onGaitTune({ single: v }), (v) => v.toFixed(2));
    bindRange('i-jointmove', 'vJointMove', (v) => hooks.onGaitTune({ jointMove: v }), (v) => v.toFixed(2));
    bindRange('i-lateral', 'vLateral', (v) => hooks.onGaitTune({ lateral: v }), (v) => v.toFixed(2));
    bindRange('i-actrate', 'vActRate', (v) => hooks.onGaitTune({ actRate: v }), (v) => v.toFixed(2));
    for (const [id, key] of [['i-mhip_l', 'hip_l'], ['i-mhip_r', 'hip_r'], ['i-mknee_l', 'knee_l'], ['i-mknee_r', 'knee_r']] as [string, string][]) {
      // ★ label 的 id 必须和 index.html 里的完全一致（`v-mhip_l` 这种带短横），
      //   拼错的话 $() 取不到元素 ⇒ 数值一直显示 "—"（用户看到的就是这个）。
      bindRange(id, `v-m${key}`,
        (v) => hooks.onGaitTune({ moveScale: { [key]: v } }), (v) => v.toFixed(2));
    }
  }

  setStatus(text: string, isError = false): void {
    this.el.boot.textContent = text;
    this.el.boot.classList.toggle('err', isError);
  }

  setHistory(history: GenStat[]): void { this.history = history; }

  update(s: HudState): void {
    const e = this.el;
    e.stage.textContent = s.mode === 'walk' ? '学走路' : (s.mode === 'fight' ? '学战斗' : '学站立');
    e.gen.textContent = String(s.gen);
    e.pop.textContent = `${s.evaluated} / ${s.population}`;
    e.best.textContent = Number.isFinite(s.bestNow) ? s.bestNow.toFixed(2) : '—';
    e.top.textContent = Number.isFinite(s.bestEver) ? s.bestEver.toFixed(2) : '—';
    const fell = s.bestFallen ? '摔倒' : '站住';
    const extra = s.mode === 'fight' ? `  命中${s.hits}/受击${s.hurts}` : '';
    e.show.textContent = `${s.bestDist.toFixed(2)} m · ${fell}${extra}`;
    e.tps.textContent = `${Math.round(s.stepsPerSec).toLocaleString()} 步/秒`;
    e.budget.textContent = `${s.frameMs.toFixed(1)} ms`;
    e.pause.textContent = s.paused ? '继续' : '暂停';
    e.pause.dataset.on = s.paused ? '1' : '0';
    e.ghost.dataset.on = s.ghost ? '1' : '0';
    e.joints.dataset.on = s.joints ? '1' : '0';
    e.tex.dataset.on = s.textures ? '1' : '0';
    e.vSigma.textContent = s.sigma.toFixed(2);

    if (this.history.length && this.history.length !== this.lastPaintedGen) {
      this.paintChart();
      this.lastPaintedGen = this.history.length;
    }
  }

  private paintChart(): void {
    const c = this.ctx;
    const W = this.chart.width;
    const H = this.chart.height;
    c.clearRect(0, 0, W, H);

    const h = this.history;
    if (h.length < 2) {
      c.fillStyle = '#8a939c';
      c.font = '20px ui-monospace, monospace';
      c.fillText('等着看第一代…', 10, H / 2);
      return;
    }

    // 只画最近 240 代，避免曲线糊成一坨
    const view = h.slice(-240);
    let lo = Infinity, hi = -Infinity;
    for (const g of view) {
      lo = Math.min(lo, g.mean, g.best);
      hi = Math.max(hi, g.best, g.mean);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-6) { hi = lo + 1; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;

    const px = (i: number) => (i / (view.length - 1)) * (W - 4) + 2;
    const py = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 10);

    // 零线
    if (lo < 0 && hi > 0) {
      c.strokeStyle = '#dfe4e9';
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, py(0));
      c.lineTo(W, py(0));
      c.stroke();
    }

    const line = (get: (g: GenStat) => number, color: string, width: number) => {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.beginPath();
      view.forEach((g, i) => {
        const v = get(g);
        if (!Number.isFinite(v)) return;
        const x = px(i), y = py(v);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      });
      c.stroke();
    };

    line((g) => g.mean, '#9aa5b0', 2);   // 平均
    line((g) => g.best, '#b4331f', 3);   // 最佳

    c.fillStyle = '#5b6570';
    c.font = '18px ui-monospace, monospace';
    c.fillText(hi.toFixed(1), 6, 18);
    c.fillText(lo.toFixed(1), 6, H - 6);
  }
}
