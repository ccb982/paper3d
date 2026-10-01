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
console.log('  代   最好适应度   平均       σ        距离   换脚  迈步  保持  静止罚  抢步罚  倒  平衡罚');
const t0 = Date.now();
for (let g = 1; g <= GENS; g++) {
  // ★ Trainer.tick() 内部会在一代评完后自动繁殖，所以这里只管推进预算
  let guard = 0;
  while (tr.history.length < g && guard++ < 200000) tr.tick(2400);
  const h = tr.history[tr.history.length - 1];
  const t = h.bestTerms;
  const r = (v: number | undefined) => (v === undefined ? '—' : v.toFixed(2).padStart(5));
  console.log(`  ${String(g).padStart(3)}   ${h.best.toFixed(2).padStart(9)}   ${h.mean.toFixed(2).padStart(8)}`
    + `  ${h.sigma.toFixed(4)}  ${r(h.bestDist)}  ${String(h.bestSwitches ?? 0).padStart(4)}`
    + `  ${r(t?.step)}  ${r(t?.hold)}  ${r(t?.still)}  ${r(t?.rush)}  ${h.bestFallen ? '是' : '否'}`);
}
console.log(`\n  用时 ${((Date.now() - t0) / 1000).toFixed(1)} s（${GENS} 代）`);
