/**
 * probe-shift.ts —— 重心**主动侧移**增益扫描（迈步系统意图 vs 平衡系统保护）
 * 判据：L载荷峰 / SINGLE 占比 / CoP 侧缘最小余量 / 实加推力 / 存活
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any;
  const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name];
    if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { DEFAULT_STEP_PARAMS } = await import('../src/core/systems/step');

const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);

log('── 重心主动侧移增益扫描（step.shiftPushGain；balance 只做护栏）');
const gains = [0, 200, 400, 800, 1400];
const COP = new Float64Array(4);
const BB = new Float64Array(4);
for (const gain of gains) {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    step: { ...DEFAULT_STEP_PARAMS, shiftPushGain: gain },
  });
  let peakL = 0, singleT = 0, minMed = 1e9, maxPush = 0, alive = 0;
  let worstFail = '—', failCount = 99, tiltMax = 0, dzMin = 1e9;
  for (let i = 0; i < 120 * 14 && !sim.finished; i++) {
    if (i % 2 === 0) {
      const out = ctrl.step(1 / 60);
      sim.doll.setMotorTargets(out);
    }
    sim.advance(1);
    if (i % 2) continue;
    const s = ctrl.snapshot;
    peakL = Math.max(peakL, s.legs.l.loadFrac);
    if (s.phase === 'SINGLE') singleT += 1 / 60;
    sim.doll.readCoP(0, COP);
    sim.doll.footSoleBounds(0, BB);
    if (COP[3]! > 0) minMed = Math.min(minMed, COP[2]! - BB[2]!);
    maxPush = Math.max(maxPush, Math.abs(s.shiftPushTau ?? 0));
    tiltMax = Math.max(tiltMax, s.tiltDeg);
    // 统计"离 SINGLE 最近"的那一帧：哪些判据还在拖后腿
    const hv: any = (s.criteria as any).handover;
    if (hv) {
      let bad = 0; const names: string[] = [];
      if (s.legs.l.loadFrac > peakL - 0.02 && bad >= failCount) {
        bad = 99;   // 强制取载荷峰值附近的帧
      }
      const fl: any = hv.flags ?? {};
      for (const k of Object.keys(fl)) {
        if (!fl[k] && !k.startsWith('U')) { bad++; names.push(k); }
      }
      dzMin = Math.min(dzMin, Math.abs(s.com.z - s.legs.l.footZ));
      if (bad < failCount) { failCount = bad; worstFail = names.join('+') || '（全过）'; }
    }
    if (s.tiltDeg >= 25) break;
    alive = s.t;
  }
  log(`   gain=${String(gain).padStart(4)}  L峰=${(peakL * 100).toFixed(0).padStart(3)}%`
    + `  SINGLE=${singleT.toFixed(2)}s  侧缘余量=${(minMed * 1000).toFixed(0).padStart(4)}mm`
    + `  实加推力=${maxPush.toFixed(0).padStart(3)}N·m  存活=${alive.toFixed(2)}s`
    + `  倾角峰=${tiltMax.toFixed(0).padStart(2)}°`);
  log(`         └ |com.z − 左脚z| 最小 = ${(dzMin * 1000).toFixed(0)}mm （X3 门限 50mm）`);
  log(`         └ 交接最少差 ${failCount} 项: ${worstFail}`);
}
