/**
 * 适应度方向性检查：**分数和"站得久"到底是正相关还是负相关？**
 *
 * 动机：`probe-posture [C]` 里出现「最佳分 4.93 的个体只活 0.98 s，
 * 而分1.11 的个体活满 3.50 s」—— 若这不是噪声，则适应度函数在**奖励摔倒**，
 * 再多代数也只是把"倒得更快"优化得更好。
 *
 * ★ 为什么这个实验与代数无关：
 *   ES 每一代都在评估整个种群。把**所有代、所有个体**的 (适应度, 存活, 距离, …)
 *   打成点算相关系数，样本量是"代数 × 种群"，而不是"某一代的最佳"。
 *   负相关 ⇒ 适应度方向错了（再多代数也救不了）。
 *   正相关但斜率平 ⇒ 只是没训够。
 *
 * 判据（预先登记）：
 *   corr(适应度, 存活) < −0.3 ⇒ 方向反了，先修适应度，别碰控制器
 *   corr(适应度, 存活) ∈ [−0.3, 0.3] 且 corr(适应度, 净位移) 明显 ⇒ 适应度在买位移不是站立
 *   corr(适应度, 存活) > 0.3 ⇒ 方向对，代数不够
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const wasmPath: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const fn = bg[imp.name];
    if (typeof fn !== 'function') throw new Error(`[probe-fitdir] wasm 导入缺失 ${imp.module}::${imp.name}`);
    (imports[imp.module] ??= {})[imp.name] = fn;
  }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    (await WebAssembly.instantiate(compiled,imports)).exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Trainer, DEFAULT_TRAINER } = await import('../src/core/evolution');
const posture = await import('../src/core/posture');

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);   // ★ 12 关节；BRAIN_SHAPE 是 9 关节的默认值
const SHAPE = shapeForJoints(sk.joints.length);
const GENS = Number(process.argv[3] ?? 20) || 20;
const POP = Number(process.argv[4] ?? 24) || 24;
const DUR = Number(process.argv[5] ?? 3.5) || 3.5;
const log = console.log;

interface Row { fit: number; alive: number; dist: number; gen: number; terms: Record<string, number> }
const rows: Row[] = [];

const simCfg = { ...DEFAULT_SIM, duration: DUR, mode: 'stand' as const };
const trainer = new Trainer(sk, SHAPE, simCfg, { ...DEFAULT_TRAINER, population: POP });
const sim = new Sim(sk, SHAPE, simCfg);

log(`适应度方向性检查 —— GENS=${GENS} POP=${POP} DUR=${DUR}s mode=stand`);
log('');
log(' 代   最佳分    平均   σ     存活@最佳  净位移@最佳');

for (let g = 0; g < GENS; g++) {
  for (let i = 0; i < POP; i++) {
    const ind = trainer.genomes[i]!;
    sim.begin(ind);
    sim.runToEnd();
    rows.push({
      fit: sim.fitness, alive: sim.ticksDone / sim.cfg.controlHz,
      dist: sim.distance, gen: g, terms: { ...sim.terms },
    });
  }
  (trainer as unknown as { recordAndBreed(): void }).recordAndBreed();
  let best = rows[rows.length - 1]!;
  for (const r of rows.slice(-POP)) if (r.fit > best.fit) best = r;
  if (g % 2 === 0 || g === GENS - 1) {
    log(`${String(g).padStart(3)}  ${best.fit.toFixed(3).padStart(8)}  ${(trainer.history[trainer.history.length - 1]?.mean ?? 0).toFixed(2)}  `
      + `${trainer.sigma.toFixed(3)}  ${best.alive.toFixed(2).padStart(8)}s  ${best.dist.toFixed(3).padStart(9)}m`);
  }
}

const corr = (a: number[], b: number[]): number => {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i]! - ma, y = b[i]! - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(Math.max(1e-12, saa * sbb));
};
const fit = rows.map((r) => r.fit), alive = rows.map((r) => r.alive), dist = rows.map((r) => r.dist);

log('');
log(`样本 = ${rows.length} 个体（${GENS} 代 × ${POP}）`);
log(`  corr(适应度, 存活)   = ${corr(fit, alive).toFixed(3)}`);
log(`  corr(适应度, 净位移) = ${corr(fit, dist).toFixed(3)}`);
log(`  corr(存活, 净位移)   = ${corr(alive, dist).toFixed(3)}`);

// 分十档，看"高分档"的真实存活
rows.sort((a, b) => a.fit - b.fit);
const B = 10, sz = Math.floor(rows.length / B);
log('');
log('适应度十分位 → 实际存活 / 位移（如果方向对，两列都该单调上升）');
for (let i = 0; i < B; i++) {
  const ch = rows.slice(i * sz, (i + 1) * sz);
  if (!ch.length) continue;
  const m = (f: (r: Row) => number) => ch.reduce((s, r) => s + f(r), 0) / ch.length;
  log(`  D${String(i).padStart(2)}  分 ${m((r) => r.fit).toFixed(2).padStart(8)}`
    + `   存活 ${m((r) => r.alive).toFixed(2).padStart(5)}s`
    + `   位移 ${m((r) => r.dist).toFixed(3).padStart(7)}m`);
}

log('');
log('  ★ 判读：');
const c = corr(fit, alive);
if (c < -0.3) log(`  ✗✗ 适应度与存活**负相关** ${c.toFixed(2)} ⇒ 适应度在奖励摔倒，先修适应度`);
else if (c > 0.3) log(`  ✓ 适应度与存活正相关 ${c.toFixed(2)} ⇒ 方向对，是代数/种群不够`);
else log(`  ⚠ 相关性弱 ${c.toFixed(2)} ⇒ 适应度几乎没在管"站多久"，查权重表`);
void posture;