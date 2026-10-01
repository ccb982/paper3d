// ============================================================
// probe-reset —— begin() 到底有没有把状态清干净（分离变量）
// ============================================================
// 症状：同一份基因组在同一个 Sim 上连续重放，得分 1.5578 / 35.4535 交替（周期 2）。
// 这要么是"残留状态没清"，要么是"物理对初值极其敏感"。本探针分离这两种可能：
//
//   A. 三个全新 Sim 各跑一次同一基因组  → 若互不相同 = 有全局共享状态（模块级）
//   B. 同一个 Sim 连跑 4 次同一基因组  → 看交替模式
//   C. 同一个 Sim 跑 G → 干扰基因组 → G → 看 G 第二次是否被污染
//   D. 记录过程中 max|线速度| / max|角速度| / max|关节速度| → 抓数值爆冲
//
// 跑法：node tools/run.mjs probe-reset

import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import RAPIER from '@dimforge/rapier3d';
import { DEFAULT_CONFIG, buildSkeleton } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints, brainParamCount } from '../src/core/brain';
import { makeRng, makeGaussian, randomGenome } from '../src/core/genome';

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
// ★ 网络形状跟着骨架走（脊柱分段后关节数不再是 9）
const SHAPE = shapeForJoints(sk.joints.length);
const CFG = { ...DEFAULT_SIM, mode: 'walk' as const, duration: 4 };

const rng = makeRng(4242);
const gauss = makeGaussian(rng);
const G = randomGenome(SHAPE, gauss, 1.2);
const NOISE = randomGenome(SHAPE, gauss, 2.0);

/** 跑一遍并采集过程峰值 —— 用来抓数值爆冲 */
function runTracked(sim: Sim) {
  let maxLin = 0, maxAng = 0, maxJV = 0, endTilt = 0;
  let upTicks = 0, tot = 0, lastTick = -1;
  const startX = sim.doll.torso().translation().x;
  while (!sim.finished) {
    sim.advance(1);
    for (const b of sim.doll.bodies) {
      const lv = b.linvel();
      const av = b.angvel();
      const l = Math.hypot(lv.x, lv.y);
      const a = Math.abs(av.z);
      if (l > maxLin) maxLin = l;
      if (a > maxAng) maxAng = a;
    }
    if (sim.tick !== lastTick) {
      lastTick = sim.tick;
      tot++;
      const tilt = Math.abs(sim.doll.tiltOf(sim.doll.torso()));
      if (tilt < 0.6) upTicks++;
      endTilt = tilt;
    }
    for (let i = 0; i < sim.doll.jointCount; i++) {
      const s = Math.abs(sim.doll.jointSpeed(i));
      if (s > maxJV) maxJV = s;
    }
  }
  const tp = sim.doll.torso().translation();
  return {
    fit: sim.fitness, x: tp.x - startX, up: tot ? upTicks / tot : 0,
    seconds: tot / 60, maxLin, maxAng, maxJV, endTilt, fallen: sim.fallen,
  };
}

const fmt = (r: ReturnType<typeof runTracked>) =>
  `fit=${r.fit.toFixed(3).padStart(8)}  Δx=${r.x.toFixed(2).padStart(6)}m  直立=${(r.up * 100).toFixed(0).padStart(3)}%  ` +
  `${r.seconds.toFixed(2)}s  峰|v|=${r.maxLin.toFixed(1).padStart(6)}  峰|ω|=${r.maxAng.toFixed(1).padStart(6)}  ` +
  `峰|关节ω|=${r.maxJV.toFixed(1).padStart(6)}  摔倒=${r.fallen ? '是' : '否'}`;

console.log('\n=== A. 三个全新 Sim 各跑一次同一基因组（查全局共享状态）===');
for (let i = 0; i < 3; i++) {
  const s = new Sim(sk, SHAPE, CFG);
  s.begin(G);
  console.log(`  fresh#${i}  ${fmt(runTracked(s))}`);
}

console.log('\n=== B. 同一个 Sim 连跑 4 次同一基因组（看交替）===');
{
  const s = new Sim(sk, SHAPE, CFG);
  for (let i = 0; i < 4; i++) {
    s.begin(G);
    console.log(`  第 ${i + 1} 次   ${fmt(runTracked(s))}`);
  }
}

console.log('\n=== C. 同一个 Sim：G → 干扰 → G（查是否被上一个个体污染）===');
{
  const s = new Sim(sk, SHAPE, CFG);
  s.begin(G);       const a = runTracked(s);
  s.begin(NOISE);   runTracked(s);
  s.begin(G);       const b = runTracked(s);
  s.begin(NOISE);   runTracked(s);
  s.begin(G);       const c = runTracked(s);
  console.log(`  G 第1次  ${fmt(a)}`);
  console.log(`  G 第2次  ${fmt(b)}`);
  console.log(`  G 第3次  ${fmt(c)}`);
  console.log(`  ${a.fit === b.fit && b.fit === c.fit ? '✔ 三次相同（状态清干净了）' : '✘ 被上一个个体污染'}`);
}

console.log('\n=== E. reset 后"头 6 步"的速度总和（定位残留从第几步开始起作用）===');
{
  const s = new Sim(sk, SHAPE, CFG);
  const lines: string[] = [];
  for (let run = 0; run < 3; run++) {
    s.begin(G);
    const sums: number[] = [];
    for (let k = 0; k < 6; k++) {
      s.advance(1);
      let sum = 0;
      for (const b of s.doll.bodies) {
        const v = b.linvel();
        sum += Math.abs(v.x) + Math.abs(v.y) + Math.abs(b.angvel().z);
      }
      sums.push(sum);
    }
    lines.push(sums.map((v) => v.toFixed(5).padStart(9)).join(''));
  }
  console.log('            step1    step2    step3    step4    step5    step6');
  lines.forEach((l, i) => console.log(`  第${i + 1}次  ${l}`));
  console.log('  → 若第 2/3 次从 step1 就与第 1 次不同 = Rapier 的约束暖启动缓存残留；');
  console.log('    若从第 2 步之后才分叉 = 动力学本身对初值敏感（混沌），不是残留。');
}

console.log('\n=== D. 峰值速度速查（判断是不是数值爆冲刷分）===');
{
  const s = new Sim(sk, SHAPE, CFG);
  const zero = new Float32Array(brainParamCount(SHAPE));
  s.begin(zero);
  console.log(`  零输出（站桩）  ${fmt(runTracked(s))}`);
  s.begin(G);
  console.log(`  随机基因组      ${fmt(runTracked(s))}`);
}
