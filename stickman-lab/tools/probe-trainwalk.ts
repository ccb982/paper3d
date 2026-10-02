// probe-trainwalk —— 无头训练探针：验证"相位步态种子 + 新奖励"是否真的让 ES 学得动。
//
// 用途：浏览器里的训练要人看着，这里跑同样的 Trainer 但自己控制代数，
// 用来快速判断"奖励改动/种子改动到底有没有用"，并把每代的分项打出来。
//
// 用法：node tools/run.mjs probe-trainwalk [代数] [种子]

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { Trainer, DEFAULT_TRAINER, type TrainerConfig } from '../src/core/evolution';

const require = createRequire(import.meta.url);
{
  // 与 probe-gait 同一套加载方式：编译 wasm + 用 bg 模块的导入函数实例化，
  // 再把 exports 交给 rapier 的 bg 层。（直接 instantiate 字节会报 "expected magic word"，
  // 因为 resolve 到的 .js 不是 wasm。）
  const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const f = bg[imp.name];
    if (typeof f === 'function') (imports[imp.module] ??= {})[imp.name] = f;
  }
  const r = (await WebAssembly.instantiate(compiled, imports)) as unknown as
    { instance?: { exports: unknown }; exports?: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    r.instance ? r.instance.exports : r.exports,
  );
}

const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
// esbuild 打包后再跑，argv 下标会漂移 ⇒ 只取能解析成正数的那些参数（最后一个当种子）
const nums = process.argv.map(Number).filter((n) => Number.isFinite(n) && n > 0);
const GENS = nums[0] ?? 4;
const SEED = nums[1] ?? 20261001;
const cfg: TrainerConfig = { ...DEFAULT_TRAINER, population: 48, seedGait: true };
const tr = new Trainer(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 6 }, cfg, SEED);

console.log(`\n=== 无头训练 ${GENS} 代（walk，相位步态种子开，pop=48，每回合 6 s）===\n`);
// ⚠ 表头必须和下面的取值顺序**逐列对齐**（之前错位一格："换脚数"那列印的是 lift，
//   我据此误判了好几轮"抬腿在涨但换脚是 0"）。
console.log('  代   最好适应度   平均       σ        距离   速度跟踪  抬腿  换脚数  单腿分  重心转移  要动  倒');
const t0 = Date.now();
for (let g = 1; g <= GENS; g++) {
  // ★ Trainer.tick() 内部会在一代评完后自动繁殖，所以这里只管推进预算
  let guard = 0;
  while (tr.history.length < g && guard++ < 200000) tr.tick(2400);
  const h = tr.history[tr.history.length - 1];
  const t = h.bestTerms;
  const r = (v: number | undefined) => (v === undefined ? '—' : v.toFixed(2).padStart(5));
  console.log(`  ${String(g).padStart(3)}   ${h.best.toFixed(2).padStart(9)}   ${h.mean.toFixed(2).padStart(8)}`
    + `  ${h.sigma.toFixed(4)}  ${r(h.bestDist)}  ${r(t?.velTrack)}  ${r(t?.lift)}`
    + `  ${r(t?.altCount)}  ${r(t?.single)}  ${r(t?.shift)}  ${r(t?.lift)}  ${r(t?.jointMove)}`
    + `  ${h.bestFallen ? '是' : '否'}`);
  // ★ 逐关节明细：这就是"精确控制各个关节"要看到的东西
  const ent = (pre: string) => Object.entries(t ?? {}).filter(([k]) => k.startsWith(pre))
    .map(([k, v]) => `${k.slice(pre.length)}=${v.toFixed(2)}`);
  console.log(`        每关节移动: ${ent('mv.').join(' ')}`);
  {
    // ★ 自己扫一遍种群，把**同一个基因组**的 terms 和原始记账量并排打出来 ——
    //   之前一个用 bestTerms、一个用 bestEver，比的是两个不同个体，误判了好几轮。
    let bg: Float32Array | null = null, bf = -1e9, bt: Record<string, unknown> | null = null;
    for (const g of tr.genomes) {
      const s2 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 6 });
      s2.begin(g);
      while (!s2.finished) s2.advance(1);
      if (s2.fitness > bf) { bf = s2.fitness; bg = g; bt = s2.terms as unknown as Record<string, unknown>; }
    }
    if (bg) {
      const s2 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 6 });
      s2.begin(bg);
      while (!s2.finished) s2.advance(1);
      const g2 = s2.rawGround;
      const n = (v: unknown): string => (typeof v === 'number' ? v.toFixed(2) : '—');
      console.log(`        同一体: fitness=${bf.toFixed(2)} terms.lift=${n(bt?.lift)} single=${n(bt?.single)} altCount=${n(bt?.altCount)}`);
      console.log(`        接地帧: 0脚=${g2.n0} 1脚=${g2.n1} 2脚=${g2.n2}`
        + ` · accSingle=${g2.accSingle.toFixed(3)} accLift=${g2.accLift.toFixed(3)}`
        + ` switchQ=${g2.switchQ.toFixed(3)} alive=${g2.alive.toFixed(3)} altCount=${s2.terms.altCount}`);
    }
  }

}
console.log(`\n  用时 ${((Date.now() - t0) / 1000).toFixed(1)} s（${GENS} 代）`);

// ══════════════════════════════════════════════════════════════════════
// ★ 门禁：训练必须能"自己发现迈步"。这条直接盯着本轮最致命的那个 bug ——
//   "要动(jointMove)"项没有门控时，站着疯狂扭关节能拿 4.06 分，而走路项最多 ~0.3 分，
//   于是 ES 的最优解永远是"站着不动"（实测 6 代 altCount 一直是 0）。
//   门控之后（只在 nGround===1 时给分）同样的种子第 5 代就出现 altCount=6、第 6 代到 7。
//   所以：**奖励不能奖励"原地扭"**才是关键，种子会不会走是次要的。
let FAILS = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};
let bestAlt = 0, bestJm = 0;
for (const g of tr.genomes) {
  const s2 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 6 });
  s2.begin(g);
  while (!s2.finished) s2.advance(1);
  if ((s2.terms.altCount ?? 0) > bestAlt) { bestAlt = s2.terms.altCount ?? 0; bestJm = s2.terms.jointMove ?? 0; }
}
const lastJm = tr.history[tr.history.length - 1]?.bestTerms?.jointMove ?? 0;
check(`★ 训练 ${GENS} 代内出现真迈步个体（换支撑脚 ≥ 2 次）`, bestAlt >= 2, `最优 altCount=${bestAlt}`);
check('★ 最优个体"要动"分没盖过走路分（不许靠原地扭取胜）', lastJm <= 1.5, `jointMove=${lastJm.toFixed(2)}（单腿分 ${(tr.history[tr.history.length - 1]?.bestTerms?.single ?? 0).toFixed(2)}）`);
console.log('');
console.log(FAILS === 0 ? '★ steptrain 全绿' : `★ steptrain 有 ${FAILS} 条 FAIL`);
if (FAILS > 0) process.exitCode = 1;
