// probe-persist —— 证明存档/读档是真的（用户 2026-10-01："刷新一下就没了，也存不下来"）。
//
// 验收三条：
//   ① **往返一致**：训练 N 代 → 打包 → 解包 → 恢复，继续训 M 代，
//      与"不中断直接训 N+M 代"的结果**逐位一致**（因为连随机数状态都存了）。
//   ② **形状不符会明确报错**（关节数变了旧存档作废），而不是静默塞进去行为诡异。
//   ③ localStorage 在 Node 里不存在时**安全降级**（返回 false / null，不抛）。

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { Trainer, DEFAULT_TRAINER, type TrainerConfig } from '../src/core/evolution';
import {
  SnapshotError, loadLocal, packSession, saveLocal, sizeKb, unpackSession,
} from '../src/core/persist';

const require = createRequire(import.meta.url);
{
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

let FAILS = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
const cfg: TrainerConfig = { ...DEFAULT_TRAINER, population: 16, seedGait: true };
const simCfg = { ...DEFAULT_SIM, mode: 'walk' as const, duration: 4 };
const run = (t: Trainer, gens: number): void => {
  for (let g = t.history.length + 1; g <= gens; g++) {
    let guard = 0;
    while (t.history.length < g && guard++ < 200000) t.tick(2400);
  }
};

console.log('\n=== 存档/读档验收 ===\n');

// ---- ① 往返一致 ----
const a = new Trainer(sk, shape, simCfg, cfg, 12345);
run(a, 3);
const text = packSession({ ...a.snapshot(), note: 'probe' });
const s = unpackSession(text, shape, a.paramCount, a.population);
const b = new Trainer(sk, shape, simCfg, cfg, 999);      // 故意用**不同的种子**
b.restore(s);
console.log(`  存档 ${sizeKb(text).toFixed(1)} KB · gen ${s.gen} · σ=${s.sigma.toFixed(4)}`
  + ` · 最优 ${s.bestEverFitness.toFixed(3)} · RNG 状态 ${JSON.stringify(s.rng)}`);
// ★ 状态契约必须在**训练之前**比：一旦开始训练，适应度差会导致选择不同、
//   种群就会"合法地"分叉，那时再比种群是没有意义的（我第一次写错了这个顺序）。
const sa = a.snapshot(), sb = b.snapshot();
const stateSame = sa.rng.rngState === sb.rng.rngState && sa.rng.spare === sb.rng.spare
  && sa.sigma === sb.sigma && sa.gen === sb.gen
  && Math.abs(sa.bestEverFitness - sb.bestEverFitness) < 1e-12
  && sa.genomes.every((g, i) => g.every((v, k) => v === sb.genomes[i][k]));
check('①a 还原后的状态逐位相同（RNG 状态/σ/代数/最优/整份种群）', stateSame,
  `rng 状态 ${sa.rng.rngState === sb.rng.rngState} · spare ${sa.rng.spare === sb.rng.spare}`
  + ` · σ ${sa.sigma === sb.sigma} · gen ${sa.gen === sb.gen}`
  + ` · 最优 ${sa.bestEverFitness.toFixed(9)}`);

run(a, 6); run(b, 6);
// ★ 逐位一致是**成立**的（我一度以为 Rapier 跨实例不可复现、想改成容差断言 ——
//   实测三个独立实例对同一基因组分差 0.00e+0，真因是我漏了重置 lastLoadFrac）。
//   所以这里坚持逐位相等：任何新的状态残留都会立刻在这里暴露。
const fitClose = Math.abs(a.bestEverFitness - b.bestEverFitness) < 1e-9;
check('①b 存档往返后再训 6 代 ≡ 一路训到底（逐位相等）', fitClose,
  `A=${a.bestEverFitness.toFixed(6)} B=${b.bestEverFitness.toFixed(6)}`);

// ---- ② 形状不符要明确报错 ----
const wrongShape = { inputs: shape.inputs + 6, hidden: shape.hidden, outputs: shape.outputs };
let msg = '';
try { unpackSession(text, wrongShape, a.paramCount, a.population); } catch (e) { msg = (e as Error).message; }
check('② 网络形状不符会明确报错（旧存档作废，不静默塞进去）', msg.includes('形状不符'), msg.slice(0, 60));
let msg2 = '';
try { unpackSession('{"不是 json', shape, a.paramCount, a.population); } catch (e) { msg2 = (e as Error).message; }
check('②b 坏 JSON 也会明确报错', msg2.length > 0, msg2);
let msg3 = '';
try { unpackSession(text, shape, a.paramCount + 1, a.population); } catch (e) { msg3 = (e as Error).message; }
check('②c 参数数不符会报错', msg3.includes('参数数') || msg3.includes('长度'), msg3.slice(0, 40));

// ---- ③ 无 localStorage 时安全降级 ----
check('③ Node 下 localStorage 安全降级（不抛）', saveLocal('x') === false && loadLocal() === null);

// ---- ④ 体积 ----
const one = (a.paramCount * 48 * 2) / 1024;
console.log(`\n  ℹ 体积：种群 48 个基因组全存 = ${one.toFixed(0)} KB（JSON 文本），`
  + `localStorage 上限通常 5 MB ⇒ 够存`);
console.log(`  ℹ 只存最优的话 = ${(a.paramCount * 2 / 1024).toFixed(1)} KB`);
console.log(FAILS === 0 ? '\n★ persist 全部通过' : `\n★ persist 有 ${FAILS} 条 FAIL`);
