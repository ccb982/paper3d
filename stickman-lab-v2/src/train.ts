/**
 * train.ts —— ★ 腰椎训练台（v2 版页面；训练内核在 `core/lumbarTrain.ts`，命令行共用）
 *
 * 流程：随机条件（随机方向/力度）→ (1+1)-ES → 最优写 localStorage（`…lumbar.v3`）
 *      → 主页面启动自动加载。判定 = 回到盆骨位置 + 竖直 + 冲量少（见内核模块）。
 * 渲染：画布实时显示"正在训练的那个个体"；待机时用最优策略跑随机扰动预览。
 */
import { initRapierWasm } from './core/rapierWasm';
import { World } from './core/world';
import { ControlModule } from './core/control';
import { Viewer } from './render/viewer';
import {
  DEFAULT_LUMBAR, LUMBAR_BOUNDS, applyLumbar, clearLumbar, loadLumbar, saveLumbar,
  type LumbarParams, type LumbarMeta,
} from './core/lumbarPolicy';
import {
  advanceRun, chestY, evaluate, fixedScenarios, gridScenarios, GRID_MAGS, impulsePush,
  sampleScenarios, startRun, type RunState,
} from './core/lumbarTrain';

const KEYS = Object.keys(DEFAULT_LUMBAR) as (keyof LumbarParams)[];
const $ = (id: string): HTMLElement => document.getElementById(id)!;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const gauss = (): number => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
function fmtParams(p: LumbarParams): string {
  return KEYS.map((k) => `${p[k].toFixed(3)}`).join(' ');
}
function log(line: string, cls = ''): void {
  const logEl = $('log');
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = line;
  logEl.appendChild(div);
  while (logEl.childElementCount > 240) logEl.removeChild(logEl.firstChild!);
  logEl.scrollTop = logEl.scrollHeight;
}

// ─────────────────────────── ES 状态
const savedData = loadLumbar();
let best: LumbarParams = { ...(savedData?.p ?? DEFAULT_LUMBAR) };
let bestFit = savedData?.meta.fit ?? -Infinity;
let bestMeta: LumbarMeta = savedData?.meta ?? { fit: 0, iter: 0, time: '' };
let cur: LumbarParams = { ...best };
let sigma = 0.18, iter = 0, stale = 0;
let running = false, verifyMode = false, gridMode = false;
let evalQueue: RunState[] = [];
let curRun: RunState | null = null;
let evalIdx = 0;

// ─────────────────────────── 渲染 + 预览
let viewer: Viewer | null = null;
let preview: World | null = null;
let previewCtl: ControlModule | null = null;
let previewT = 0, nextPushAt = 2.0, previewResetAt = -1;

function advancePreview(dt: number): void {
  if (!preview || !previewCtl) return;
  previewT += dt;
  if (previewResetAt > 0 && previewT > previewResetAt) {
    preview.reset();
    previewT = 0; previewResetAt = -1; nextPushAt = 2.0;
  }
  previewCtl.warner.setComTarget(previewCtl.warner.opt.standX, 0);
  if (previewT >= nextPushAt && previewResetAt < 0) {
    const th = Math.random() * Math.PI * 2;
    impulsePush(preview, Math.cos(th), Math.sin(th), 0.15 + Math.random() * 0.2);
    nextPushAt = previewT + 3.5;
  }
  const steps = Math.max(1, Math.round(dt / preview.dt));
  for (let i = 0; i < steps; i++) preview.advance(1);
  if (chestY(preview) < 0.6 && previewResetAt < 0) previewResetAt = previewT + 1.2;
}

// ─────────────────────────── UI
function renderParams(): void {
  const tb = $('params').querySelector('tbody')!;
  tb.innerHTML = '';
  for (const k of KEYS) {
    const tr = document.createElement('tr');
    const d = best[k] - DEFAULT_LUMBAR[k];
    const rel = DEFAULT_LUMBAR[k] !== 0 ? d / Math.abs(DEFAULT_LUMBAR[k]) : d;
    tr.innerHTML =
      `<td>${k}</td><td>${best[k].toFixed(4)}</td><td>${DEFAULT_LUMBAR[k].toFixed(4)}</td>` +
      `<td class="${d > 0 ? 'delta-up' : d < 0 ? 'delta-dn' : ''}">${d >= 0 ? '+' : ''}${(rel * 100).toFixed(1)}%</td>` +
      `<td>${LUMBAR_BOUNDS[k][0]} – ${LUMBAR_BOUNDS[k][1]}</td>`;
    tb.appendChild(tr);
  }
}
function renderStats(): void {
  const t = bestMeta.time ? new Date(bestMeta.time).toLocaleTimeString() : '—';
  const curDesc = curRun
    ? `当前场景：${curRun.sc.label}${curRun.sc.type === 'push' ? ` dv=${curRun.sc.dv.toFixed(2)}` : ''}`
    : running ? '（评估收尾）' : '待机（预览最优策略）';
  $('stats').innerHTML =
    `迭代 <b>${iter}</b>　最优 fit <b>${isFinite(bestFit) ? bestFit.toFixed(1) : '—'}</b>` +
    `（第 ${bestMeta.iter || 0} 次 @ ${t}）　σ=<b>${sigma.toFixed(3)}</b><br><span class="note">${curDesc}</span>`;
}
function renderBar(): void {
  const total = Math.max(1, evalQueue.length);
  const done = evalIdx + (curRun ? 0.5 : 0);
  $('bar').firstElementChild!.setAttribute('style', `width:${Math.min(100, (done / total) * 100)}%`);
}

// ─────────────────────────── 训练循环（分片）
function beginEvaluation(): void {
  const scs = gridMode ? gridScenarios() : verifyMode ? fixedScenarios() : sampleScenarios();
  if (!verifyMode && !gridMode) {
    const desc = scs.slice(0, 4).map((sc) =>
      `${sc.label}${sc.dv.toFixed(2)}${sc.second ? '+二次' : ''}`).join(' / ');
    log(`── 本轮随机条件：${desc} ＋ jitter×2 ──`, 'note');
  }
  evalQueue = scs.map((sc) => startRun(sc, cur));
  evalIdx = 0;
  curRun = null;
  renderBar();
}
function tick(): void {
  if (!running && !verifyMode && !gridMode) return;
  if (!curRun) {
    if (evalIdx >= evalQueue.length) {
      const res = evaluate(evalQueue);
      for (const row of res.rows) log(row);
      if (verifyMode) {
        log(`【固定验证】回位 ${res.rec}/6　站立HF=${res.hs.toExponential(2)}　挺腰HF=${res.hp.toExponential(2)}　fit=${res.fit.toFixed(1)}`, 'note');
        verifyMode = false;
        running = false;
        ($('btn-run') as HTMLButtonElement).disabled = false;
        ($('btn-verify') as HTMLButtonElement).disabled = false;
        renderBar();
        return;
      }
      if (gridMode) {
        let pass = 0;
        log('── 方向×力度网格验证（当前最优参数）：0°=+前 · 90°=+左 · 180°=后 · 270°=右 ──', 'note');
        for (let k = 0; k < 8; k++) {
          const cells: string[] = [];
          for (let m = 0; m < GRID_MAGS.length; m++) {
            const r = evalQueue[k * GRID_MAGS.length + m]!;
            if (r.ok) pass++;
            cells.push(`${GRID_MAGS[m]!.toFixed(2)}${r.ok ? '✓' : '✗'}(${(r.retErr ?? 9).toFixed(2)})`);
          }
          log(`  θ${String(k * 45).padStart(3, ' ')}°：${cells.join('  ')}`);
        }
        log(`网格小结：${pass}/${evalQueue.length} 回位——✗ 集中在哪个方向/力度，就是结构需要补的地方（增益已调不动）`, 'ok');
        gridMode = false;
        running = false;
        ($('btn-run') as HTMLButtonElement).disabled = false;
        ($('btn-verify') as HTMLButtonElement).disabled = false;
        ($('btn-grid') as HTMLButtonElement).disabled = false;
        renderBar();
        return;
      }
      iter++;
      const candFit = res.fit;
      if (candFit > bestFit) {
        bestFit = candFit;
        best = { ...cur };
        bestMeta = { fit: candFit, iter, time: new Date().toISOString(), note: 'train.html', hp: res.hp };
        saveLumbar(best, bestMeta);
        // ★ 自动写文件：Vite dev 中间件落盘 data/lumbar/results.json（历史）+ best.json
        fetch('/api/lumbar-save', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ p: best, meta: bestMeta, fit: candFit, iter }),
        }).then((r) => (r.ok ? r.json() : null)).then((j: { ok?: boolean; count?: number } | null) => {
          $('save-hint').textContent = j?.ok
            ? `★ 已自动写入 data/lumbar/results.json（第 ${j.count} 条）+ localStorage`
            : '★ 已写入 localStorage（文件接口不可用，用"导出结果 JSON"）';
        }).catch(() => {
          $('save-hint').textContent = '★ 已写入 localStorage（非 dev 服务器：文件接口不可用，用"导出结果 JSON"）';
        });
        renderParams();
        log(`★ 新最优 fit=${candFit.toFixed(1)}（回位 ${res.rec}/4） ${fmtParams(best)}`, 'ok');
        stale = 0;
      } else {
        stale++;
        log(`候选 fit=${candFit.toFixed(1)} ≤ 最优 ${isFinite(bestFit) ? bestFit.toFixed(1) : '—'}`, 'note');
      }
      sigma = Math.max(0.02, sigma * 0.995);
      if (stale > 60) { sigma = 0.2; stale = 0; log('… 无进展，σ 重启', 'note'); }
      const next = { ...best };
      for (const k of KEYS) {
        const [lo, hi] = LUMBAR_BOUNDS[k];
        next[k] = clamp(best[k] + gauss() * sigma * (hi - lo), lo, hi);
      }
      cur = next;
      renderStats();
      beginEvaluation();
      setTimeout(tick, 0);
      return;
    }
    curRun = evalQueue[evalIdx]!;
    renderStats();
  }
  advanceRun(curRun);
  if (curRun.done) {
    evalIdx++;
    curRun = null;
  }
  renderBar();
  setTimeout(tick, 0);
}

// ─────────────────────────── 按钮
$('btn-run').addEventListener('click', () => {
  if (running) { running = false; $('btn-run').textContent = '继续训练'; return; }
  running = true;
  $('btn-run').textContent = '暂停训练';
  if (evalQueue.length === 0 && !curRun) beginEvaluation();
  setTimeout(tick, 0);
});
$('btn-verify').addEventListener('click', () => {
  if (running || verifyMode) return;
  verifyMode = true;
  log('── 固定验证（后/前/侧 0.2/0.3 + jitter）──', 'note');
  beginEvaluation();
  setTimeout(tick, 0);
});
$('btn-grid').addEventListener('click', () => {
  if (running || verifyMode || gridMode) return;
  gridMode = true;
  log('── 方向×力度网格验证（8 方向 × 0.12/0.22/0.32；约 1~2 分钟）──', 'note');
  ($('btn-grid') as HTMLButtonElement).disabled = true;
  beginEvaluation();
  setTimeout(tick, 0);
});
$('btn-reset').addEventListener('click', () => {
  cur = { ...DEFAULT_LUMBAR };
  best = { ...DEFAULT_LUMBAR };
  bestFit = -Infinity;
  iter = 0;
  sigma = 0.18;
  log('已重置为默认参数（未写入存储）', 'note');
  renderParams();
  renderStats();
});
$('btn-export').addEventListener('click', () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const download = (obj: unknown, name: string): void => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  // ★ 优先导出**全套历史文件**（dev 服务器下 data/lumbar/results.json 可直接拉取）；
  //    拿不到（静态构建等）→ 退回当前最优。
  fetch('/data/lumbar/results.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((hist: unknown) => {
      download(hist, `lumbar_history_${stamp}.json`);
      log(`已导出全套历史 JSON（${Array.isArray(hist) ? hist.length : '?'} 条记录）`, 'note');
    })
    .catch(() => {
      download({ p: best, meta: bestMeta }, `lumbar_best_${stamp}.json`);
      log('历史文件不可用（非 dev 服务器）→ 已导出当前最优 JSON', 'note');
    });
});
$('btn-clear').addEventListener('click', () => {
  clearLumbar();
  $('save-hint').textContent = '已清空训练结果（主页面将回默认）';
  log('已清空 localStorage 训练结果', 'note');
});

// ─────────────────────────── 启动
void (async () => {
  await initRapierWasm();
  preview = new World();
  previewCtl = new ControlModule(preview, { postureTone: 8 });
  previewCtl.padEnabled = true;
  previewCtl.landing.opt.enabled = true;
  if (savedData) applyLumbar(previewCtl.warner.opt, savedData.p);
  preview.controller = previewCtl;
  preview.reset();
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  viewer = new Viewer(canvas, preview.sk, 1, { assetBase: '' });
  viewer.followShowcase = true;

  renderParams();
  renderStats();
  if (savedData) {
    $('save-hint').textContent = `已加载训练结果（fit=${savedData.meta.fit.toFixed(1)}）——主页面同源自动加载`;
    log(`已加载已有训练结果：fit=${savedData.meta.fit.toFixed(1)} ${fmtParams(savedData.p)}`, 'note');
  } else {
    log('无训练结果，从默认参数出发。点"开始训练"运行（建议让页面跑几分钟）。', 'note');
  }
  $('boot')?.remove();

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (curRun && viewer) {
      viewer.syncShowcase(curRun.w, dt);
    } else if (preview && viewer) {
      advancePreview(dt);
      viewer.syncShowcase(preview, dt);
    }
    viewer?.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
})();
