// ============================================================
// hud —— 面板绑定与训练曲线
// ============================================================
// 约定：本文件只碰 DOM，不碰物理也不碰进化逻辑；所有动作通过 hooks 回调出去，
// 保证"改 UI"和"改算法"互不影响。

import type { GenStat } from '../core/evolution';
import type { SimMode } from '../core/sim';
import type { RigSnapshot, SystemTag } from '../core/rigState';

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
  /** ★ 驱动源切换：ES 大脑 ↔ 手写平衡维持系统（调平衡时必须切到 teacher） */
  onDriver: (d: 'brain' | 'teacher') => void;
  /** ★ 单腿站立：强制支撑腿 + 不换脚（解耦「站稳」与「迈腿」） */
  onSingleLeg: (side: 'l' | 'r' | null, liftHold: number) => void;
  /** ★ 回合时长（改它要重建 Sim） */
  onDur: (d: number) => void;
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
  driver: 'brain' | 'teacher';
  singleLeg: 'l' | 'r' | null;
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
  private ownAxes: string[] = [];
  private ownParts: [string, string][] = [];
  private ownBuilt = false;

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
      // ── 「模块归属」面板（用户 2026-10-03）
      ownPhase: $('own-phase'), ownGround: $('own-ground'), ownMos: $('own-mos'),
      ownGate: $('own-gate'), ownGrid: $('own-grid'),
      ownRoleL: $('own-role-l'), ownRoleR: $('own-role-r'),
      ownAlpha: $('own-alpha'), ownCrit: $('own-crit'),
    };
    // 归属表头：轴 0/1/2 与身体部位一一对应（与 skeleton 的 AXIS_* 约定一致）
    this.ownAxes = ['轴0 内外旋', '轴1 外展', '轴2 屈伸'];
    this.ownParts = [
      ['neck', '颈'], ['shoulder_l', '左肩'], ['shoulder_r', '右肩'],
      ['elbow_l', '左肘'], ['elbow_r', '右肘'],
      ['hip_l', '左髋'], ['hip_r', '右髋'], ['knee_l', '左膝'], ['knee_r', '右膝'],
      ['foot_l', '左踝'], ['foot_r', '右踝'],
      ['spine1', '腰1'], ['spine2', '腰2'], ['spine3', '腰3'],
    ];
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
    // ★ 三档：走路 / **站立** / 战斗。站立必须在里面 —— 它是平衡的验收口径。
    const PHASE = ['walk', 'stand', 'fight'] as const;
    bindRange('i-speedgoal', 'vPhase',
      (v) => hooks.onPhase(PHASE[Math.round(v)] ?? 'stand'),
      (v) => ({ walk: '学走路', stand: '学站立', fight: '学战斗' })[PHASE[Math.round(v)] ?? 'stand']);

    const DRV = ['brain', 'teacher'] as const;
    bindRange('i-driver', 'vDriver',
      (v) => hooks.onDriver(DRV[Math.round(v)] ?? 'teacher'),
      (v) => (DRV[Math.round(v)] === 'teacher' ? '手写平衡模块' : 'ES 神经网络'));

    const SL = ['l', 'r', null] as const;
    let lift = 0.25;
    const pushSL = (v: number) => hooks.onSingleLeg(SL[Math.round(v)] ?? null, lift);
    bindRange('i-singleleg', 'vSingleLeg', pushSL,
      (v) => ({ l: '左腿支撑', r: '右腿支撑', null: '双脚（正常迈步）' })[Math.round(v)] ?? '双脚');
    bindRange('i-lifthold', 'vLiftHold', (v) => { lift = v; pushSL(Number((document.getElementById('i-singleleg') as HTMLInputElement).value)); },
      (v) => v.toFixed(2));
    bindRange('i-dur', 'vDur', (v) => hooks.onDur(v), (v) => `${v.toFixed(0)} s`);

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

  /**
   * ★★ 「模块归属 + 状态」面板 —— **只消费 `RigSnapshot`**。
   *
   *   ★ 契约（重构方案 §8）：UI **不做推导**。前后腿/承重/锁定/相位/判据
   *     全部由控制器直接产出，UI 只做上色与排版。
   *     冒烟测试（`tools/probe-uipanel.ts`）消费的是**同一份快照**，
   *     所以"你看到的"和"我回读的"在机械上必然一致。
   */
  setOwnership(d: RigSnapshot | null): void {
    const e = this.el;
    if (!d) {
      e.ownGate.textContent = '—（当前不是 controller 驱动）';
      e.ownGate.dataset.ok = '1';
      if (this.ownBuilt) { e.ownGrid.innerHTML = '<tr><td class="hint" colspan="5">切到「手写平衡模块」看归属</td></tr>'; }
      for (const r of [e.ownRoleL, e.ownRoleR]) { r.dataset.r = ''; r.querySelector('span')!.textContent = '—'; }
      e.ownPhase.textContent = '—'; e.ownGround.textContent = '—'; e.ownMos.textContent = '—';
      return;
    }

    // ---- 腿角色：承重 / 锁定 / 前后（全部来自快照，UI 不自己算）----
    for (const [el, s] of [[e.ownRoleL, 'l'], [e.ownRoleR, 'r']] as [HTMLElement, 'l' | 'r'][]) {
      const L = d.legs[s];
      const tags: string[] = [];
      if (L.isFront) tags.push('前腿'); else tags.push('后腿');
      tags.push(L.isBearer ? '★承重' : '摆动');
      if (L.locked) tags.push('🔒锁定');
      tags.push(L.grounded ? '接地' : `离地${(L.soleY * 1000).toFixed(0)}mm`);
      tags.push(`载荷${(L.loadFrac * 100).toFixed(0)}%`);
      el.dataset.r = L.locked ? 'stance' : (L.isFront ? 'front' : '');
      el.querySelector('span')!.textContent = tags.join(' · ');
    }

    const PH = { DOUBLE: '双脚支撑', SHIFT: '重心转移', SINGLE: '单支撑', STEP: '摆动相' } as Record<string, string>;
    e.ownPhase.textContent = `${PH[d.phase] ?? d.phase} ${d.phaseT.toFixed(2)}s`;
    e.ownGround.textContent = `${d.support.contactN} 只`;
    e.ownMos.textContent = `${(d.mos * 1000).toFixed(0)} mm`;
    e.ownAlpha.textContent = d.authority.toFixed(2);
    e.ownGate.textContent = `α(腰权限)=${d.authority.toFixed(2)}  ξ=(${d.dcm.x.toFixed(3)}, ${d.dcm.z.toFixed(3)})  倾角 ${d.tiltDeg.toFixed(1)}°`;
    e.ownGate.dataset.ok = '1';

    // ---- 判据逐条回显（"为什么没迈步"不用推断）----
    const cf = (c: typeof d.criteria.bearer): string =>
      Object.entries(c.flags).map(([k, v]) => `${v ? '✓' : '✗'}${k}`).join(' ');
    e.ownCrit.textContent =
      `承重 ${cf(d.criteria.bearer)} ${d.criteria.bearer.all ? '【达成】' : ''}
`
      + `解锁 ${cf(d.criteria.unlock)} ${d.criteria.unlock.all ? '【达成】' : ''}
`
      + `迈步 ${cf(d.criteria.stepPermit)} ${d.criteria.stepPermit.all ? '【放行】' : ''}`;
    e.ownCrit.dataset.ok = d.criteria.stepPermit.all ? '1' : '0';

    // ---- 关节 × 轴 归属网格（结构只建一次）----
    if (!this.ownBuilt) {
      const head = '<tr><th>部位</th><th>轴0 旋</th><th>轴1 展/倾</th><th>轴2 屈伸</th><th>被压制</th></tr>';
      const rows = this.ownParts.map(([key, label]) =>
        `<tr><td class="jn">${label}</td>`
        + [0, 1, 2].map((ax) => `<td class="ax"><span class="own-cell sw-none" id="oc-${key}-${ax}">—</span></td>`).join('')
        + `<td class="ax"><span class="own-cell sw-none" id="ocx-${key}">—</span></td></tr>`).join('');
      e.ownGrid.innerHTML = head + rows;
      this.ownBuilt = true;
    }
    const SW: Record<SystemTag, string> = { hold: 'sw-hold', step: 'sw-step', servo: 'sw-servo', none: 'sw-none' };
    for (const a of d.axes) {
      const cell = document.getElementById(`oc-${a.key.replace('/', '-')}`) as HTMLElement | null;
      if (!cell) continue;
      cell.className = `own-cell ${SW[a.tag]}`;
      cell.textContent = a.ownerLabel;
      cell.title = `${a.key} → ${a.owner}｜${a.ownerLabel}｜target=${a.target.toFixed(3)}`
        + ` pos=${(a.pos * 57.3).toFixed(1)}° vel=${a.vel.toFixed(2)}`
        + (a.suppressed.length ? `｜压制 ${a.suppressed.map((s) => s.system).join(',')}` : '')
        + (a.vetoed.length ? `｜锁定否决` : '') + (a.clamped ? '｜斜率限幅' : '');
    }
    for (const [key] of this.ownParts) {
      const x = document.getElementById(`ocx-${key}`) as HTMLElement | null;
      if (!x) continue;
      const mine = d.axes.filter((a) => a.key.startsWith(key + '/') && a.suppressed.length > 0);
      x.className = `own-cell ${mine.length ? 'sw-veto' : 'sw-none'}`;
      x.textContent = mine.length ? mine.map((a) => `${a.key.split('/')[1]}<${a.suppressed.map((s) => s.system).join('/')}`).join(' ') : '—';
    }
  }

  setStatus(text: string, isError = false): void {
    this.el.boot.textContent = text;
    this.el.boot.classList.toggle('err', isError);
  }

  setHistory(history: GenStat[]): void { this.history = history; }

  update(s: HudState): void {
    const e = this.el;
    e.stage.textContent = (s.mode === 'walk' ? '学走路' : (s.mode === 'fight' ? '学战斗' : '学站立'))
      + (s.driver === 'teacher'
        ? ` · ${s.singleLeg === null ? '双脚' : (s.singleLeg === 'l' ? '左腿支撑' : '右腿支撑')}`
        : ' · ES 脑');
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
