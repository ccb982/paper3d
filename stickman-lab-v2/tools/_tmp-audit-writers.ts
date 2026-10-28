/** _tmp-audit-writers: 运行时审计 —— 每个腿关节轴到底有谁在写
 *
 *  打开 __WRITELOG / __PROPLOG，统计 squat 释放前后每个 dof 的提案来源。
 *  这是判断「架构乱不乱」的唯一硬依据。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const g = globalThis as unknown as { __PROPLOG?: Array<[number, string, number, string]> };
g.__PROPLOG = [];

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;

// 释放后跑 0.4s，统计这段时间的提案
const total = Math.round(2.4 / w.dt);
const relStep = Math.round(2.0 / w.dt);
for (let s = 0; s < total; s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  w.advance(1);
  squatFrame(w, ctl, court);
  if (s === relStep) g.__PROPLOG!.length = 0;   // 只统计释放后
}

const body = w.body;
const names = new Map<number, string>();
for (const d of body.dofs) {
  if (/^(hip|knee|foot|ankle)_/.test(d.name)) names.set(d.dofIndex, `${d.name}/${d.axis}`);
}

interface Acc { src: string; kind: string; n: number; tauSum: number }
const acc = new Map<number, Map<string, Acc>>();
for (const [dof, kind, val, src] of g.__PROPLOG!) {
  if (!names.has(dof)) continue;
  let m = acc.get(dof);
  if (!m) { m = new Map(); acc.set(dof, m); }
  const key = `${kind}|${src}`;
  const a = m.get(key) ?? { src, kind, n: 0, tauSum: 0 };
  a.n++; a.tauSum += val;
  m.set(key, a);
}

console.log('\n════ 释放后 0.4s 内，每个腿轴的提案来源（按次数）════');
console.log('  轴              | 写手（kind|src）                   | 次数 | 平均值');
const rows: string[] = [];
for (const [dof, label] of [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]))) {
  const m = acc.get(dof);
  if (!m || m.size === 0) { rows.push(`  ${label.padEnd(15)} | （无写手）`); continue; }
  const list = [...m.values()].sort((a, b) => b.n - a.n);
  const desc = list.map((a) => `${a.kind}|${a.src}`).join(' , ');
  const detail = list.map((a) => `${a.src}:${a.n}次/${(a.tauSum / a.n).toFixed(1)}`).join('  ');
  rows.push(`  ${label.padEnd(15)} | ${desc}`);
  rows.push(`  ${''.padEnd(15)} |   ${detail}`);
}
console.log(rows.join('\n'));
console.log(`\n  统计：共 ${g.__PROPLOG!.length} 条提案，涉及 ${acc.size} 个腿轴`);
const multi = [...acc.entries()].filter(([, m]) => m.size > 1);
console.log(`  ⚠ 同轴多写手（潜在对拉）：${multi.length} 个轴`);
for (const [dof, m] of multi) {
  console.log(`     ${names.get(dof)}  ← ${[...m.values()].map((a) => a.src).join(' + ')}`);
}
