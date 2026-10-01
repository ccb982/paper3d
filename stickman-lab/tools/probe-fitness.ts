// ============================================================
// probe-fitness —— 查"记录的历史最佳分"与"重新评估同一份基因组"为何不一致
// ============================================================
// 症状：verify-core 里 trainer.bestEverFitness = 35.45，但把 trainer.bestEver
//       拿去新 Sim 重放，只得到 1.558。两者必须相等（物理是确定性的）。
//
// 判据：逐代把 genomes[order[0]]（当代最高分个体）重新评估一次，和记录分对比。
//   ① 如果"记录分 = 重放分"永远成立 → 说明 bestEver 抄错了（拷贝时机/对象不对）。
//   ② 如果某代开始"记录分 ≠ 重放分" → 说明 Sim 之间有状态泄漏，物理不是每体独立的。
//
// 跑法：node tools/run.mjs probe-fitness

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import RAPIER from '@dimforge/rapier3d';
import { DEFAULT_CONFIG, buildSkeleton } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { Trainer, DEFAULT_TRAINER } from '../src/core/evolution';
import { BRAIN_SHAPE } from '../src/core/brain';

const require = createRequire(import.meta.url);
{
  const wasmPath: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  const instance = await WebAssembly.instantiate(compiled, imports);
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(instance.exports);
}

const sk = buildSkeleton(DEFAULT_CONFIG);
const simCfg = { ...DEFAULT_SIM, mode: 'walk' as const, duration: 4 };
const trainer = new Trainer(sk, BRAIN_SHAPE, simCfg, { ...DEFAULT_TRAINER, population: 24, seed: 12345 });

// 独立的重放器：不参与训练，只用来"重新评估"
const replay = new Sim(sk, BRAIN_SHAPE, simCfg);
function rescore(g: Float32Array): number {
  replay.begin(g);
  return replay.runToEnd();
}

console.log('\n=== 逐代：记录分 vs 重放分（当代最高分个体）===');
console.log('  代数   记录best   重放best   Δ        记录mean');
let firstBad = -1;
const seen: string[] = [];
while (trainer.gen < 40) {
  trainer.tick(4000);
  const h = trainer.history[trainer.history.length - 1];
  if (!h) continue;
  // 找当代最高分的基因组：genomes 与 fitness 一一对应
  let bi = 0;
  for (let i = 1; i < trainer.population; i++) {
    if (trainer.fitness[i] > trainer.fitness[bi]) bi = i;
  }
  const re = rescore(trainer.genomes[bi]);
  const d = re - h.best;
  if (trainer.gen % 5 === 0 || Math.abs(d) > 1e-6) {
    const flag = Math.abs(d) > 1e-6 ? '  ★不一致' : '';
    console.log(`  ${String(h.gen).padStart(4)}  ${h.best.toFixed(4).padStart(9)}  ` +
      `${re.toFixed(4).padStart(9)}  ${d.toFixed(4).padStart(8)}  ${h.mean.toFixed(3).padStart(8)}${flag}`);
  }
  if (firstBad < 0 && Math.abs(d) > 1e-6) firstBad = h.gen;
  seen.push(`${h.gen}:${d.toFixed(3)}`);
}

console.log(`\n  首次不一致出现在第 ${firstBad < 0 ? '（未出现）' : firstBad} 代`);

// ---- 同一份基因组，反复重放，看是否稳定（确定性检查） ----
console.log('\n=== 确定性：同一份基因组连续重放 5 次 ===');
{
  const g = trainer.bestEver;
  const vals: number[] = [];
  for (let i = 0; i < 5; i++) vals.push(rescore(g));
  console.log(`  ${vals.map((v) => v.toFixed(4)).join('  ')}`);
  console.log(`  ${new Set(vals.map((v) => v.toFixed(6))).size === 1 ? '✔ 完全相同（确定性 OK）' : '✘ 同基因组分不同 —— Sim 不独立'}`);
}

// ---- 交叉验证：把 bestEver 塞回训练器里的 sims[0] 跑，和独立 replay 比 ----
console.log('\n=== 交叉验证：训练器内的 Sim 重放 bestEver ===');
{
  const s0 = trainer.sims[0];
  s0.begin(trainer.bestEver);
  const a = s0.runToEnd();
  const b = rescore(trainer.bestEver);
  console.log(`  训练器内 sims[0] = ${a.toFixed(4)}   独立 replay = ${b.toFixed(4)}   ` +
    `${Math.abs(a - b) < 1e-6 ? '✔ 一致' : '✘ 不一致（Sim 间不独立）'}`);
}

console.log(`\n  bestEverFitness（对外宣称） = ${trainer.bestEverFitness.toFixed(4)}`);
console.log(`  bestEver 实际重放           = ${rescore(trainer.bestEver).toFixed(4)}`);
