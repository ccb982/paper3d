/** _train-lumbar.ts —— 无头腰椎训练（与 train.html 同一内核 lumbarTrain.ts）。
 *  用法：node tools/run.mjs _train-lumbar   （BUDGET=25 控制评估次数）
 *  结果：打印最优参数 + 8×3 网格；同时写 OS 临时目录 lumbar_best.json。
 */
import './_boot';
import * as fs from 'node:fs';
import { DEFAULT_LUMBAR, LUMBAR_BOUNDS, type LumbarParams } from '../src/core/lumbarPolicy';
import {
  advanceRun, evaluate, gridScenarios, GRID_MAGS, sampleScenarios, startRun, type Scenario,
} from '../src/core/lumbarTrain';

const KEYS = Object.keys(DEFAULT_LUMBAR) as (keyof LumbarParams)[];
const BOUNDS = LUMBAR_BOUNDS;
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const gauss = (): number => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

function evalOn(p: LumbarParams, scs: Scenario[]): { fit: number; rec: number; hs: number; hp: number; rows: string[] } {
  const rs = scs.map((sc) => startRun(sc, p));
  for (const r of rs) { while (!r.done) advanceRun(r); }
  return evaluate(rs);
}

const BUDGET = Number(process.env.BUDGET ?? 25);
const BLOCK = Number(process.env.BLOCK ?? 4);   // 每批电池用于 BLOCK 轮迭代（同批对比，降噪）
/** 固定必训电池（FIXED=1）：确定性适应度，ES 才能收敛；覆盖前后(重点)/侧/斜 的必训带 */
const FIXED: Scenario[] = [
  { type: 'push', fx: -1, fz: 0, dv: 0.18, label: '后推' },
  { type: 'push', fx: -1, fz: 0, dv: 0.24, label: '后推' },
  { type: 'push', fx: 1, fz: 0, dv: 0.18, label: '前推' },
  { type: 'push', fx: 1, fz: 0, dv: 0.22, label: '前推' },
  { type: 'push', fx: 0, fz: 1, dv: 0.20, label: '侧推' },
  { type: 'push', fx: Math.cos(2.356), fz: Math.sin(2.356), dv: 0.20, label: '斜推' },
  { type: 'hfStand', fx: 0, fz: 0, dv: 0, label: '站jitter' },
  { type: 'rise', fx: 0, fz: 0, dv: 0, label: '蹬地挺腰' },
  { type: 'singleLeg', fx: 0, fz: 0, dv: 0, label: '单脚(动作全程)' },
];
const t0 = Date.now();
let best: LumbarParams = { ...DEFAULT_LUMBAR };
let battery: Scenario[] = process.env.FIXED === '1' ? FIXED : sampleScenarios();
let bestOn = evalOn(best, battery);
console.log(`起点 fit=${bestOn.fit.toFixed(1)}（回位 ${bestOn.rec}/4，立HF=${bestOn.hs.toExponential(1)}，挺HF=${bestOn.hp.toExponential(1)}）`);
for (const row of bestOn.rows) console.log('   ' + row);

let sigma = 0.18, stale = 0, batteryAge = 0, improved = 0;
for (let i = 1; i <= BUDGET; i++) {
  const cand = { ...best };
  for (const k of KEYS) {
    const [lo, hi] = BOUNDS[k];
    cand[k] = clamp(best[k] + gauss() * sigma * (hi - lo), lo, hi);
  }
  const res = evalOn(cand, battery);
  if (res.fit > bestOn.fit) {
    best = cand; bestOn = res; improved++;
    console.log(`★ #${i} 新最优 fit=${res.fit.toFixed(1)}（回位 ${res.rec}/4） ` +
      KEYS.map((k) => `${k}=${best[k].toFixed(3)}`).join(' '));
    stale = 0;
  } else {
    stale++;
  }
  sigma = Math.max(0.02, sigma * 0.995);
  if (stale > 40) { sigma = 0.2; stale = 0; }
  batteryAge++;
  if (batteryAge >= BLOCK && process.env.FIXED !== '1') {           // 换新电池：重算最优基线（同批对比）
    battery = sampleScenarios();
    bestOn = evalOn(best, battery);
    batteryAge = 0;
    console.log(`  ── 换电池（第 ${i} 次起）：最优基线 fit=${bestOn.fit.toFixed(1)}`);
  }
  if (i % 5 === 0) console.log(`… ${i}/${BUDGET}  best=${bestOn.fit.toFixed(1)} 改进 ${improved} 次  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

console.log('══ 最优结果（最终电池）══');
for (const row of bestOn.rows) console.log('   ' + row);
console.log(`建议参数：${KEYS.map((k) => `${k}=${best[k].toFixed(4)}`).join('  ')}`);

// 8×3 网格
console.log('══ 方向×力度网格（最优参数）══');
const grid = gridScenarios().map((sc) => startRun(sc, best));
for (const r of grid) { while (!r.done) advanceRun(r); }
let pass = 0;
for (let k = 0; k < 8; k++) {
  const cells: string[] = [];
  for (let m = 0; m < GRID_MAGS.length; m++) {
    const r = grid[k * GRID_MAGS.length + m]!;
    if (r.ok) pass++;
    cells.push(`${GRID_MAGS[m]!.toFixed(2)}${r.ok ? '✓' : '✗'}(${(r.retErr ?? 9).toFixed(2)})`);
  }
  console.log(`  θ${String(k * 45).padStart(3, ' ')}°：${cells.join('  ')}`);
}
console.log(`网格小结：${pass}/${grid.length} 回位（必训带 = 0.14~0.30 段，看 0.22 列）`);

// ── 结果落盘：每次训练追加历史 + 更新最新最优（都在仓库内，便于对比/回退）
const RESULT_DIR = 'data/lumbar';
try {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const record = {
    time: new Date().toISOString(),
    budget: BUDGET,
    fixed: process.env.FIXED === '1',
    block: BLOCK,
    improved,
    bestFit: bestOn.fit,
    gridPass: pass,
    gridTotal: grid.length,
    params: best,
  };
  const resultsPath = `${RESULT_DIR}/results.json`;
  let history: unknown[] = [];
  try { history = JSON.parse(fs.readFileSync(resultsPath, 'utf8')) as unknown[]; } catch { /* 首次 */ }
  history.push(record);
  fs.writeFileSync(resultsPath, JSON.stringify(history, null, 2));
  fs.writeFileSync(`${RESULT_DIR}/best.json`, JSON.stringify(record, null, 2));
  console.log(`已落盘：${RESULT_DIR}/results.json（历史 ${history.length} 条）与 ${RESULT_DIR}/best.json`);
} catch (e) {
  console.log('结果落盘失败：', e);
}
