/**
 * probe-conflict.ts —— **同轴冲突抓现行**（谁在谁之后写了什么）
 *
 * 用法：`node tools/run.mjs probe-conflict [秒数=1.6]`
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
  const bg = bgNs as any; const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) { const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name); (im[i.module] ??= {})[i.name] = f; }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECS = Number(ARGS[0] ?? 1.6);
const HZ = 120, DT = 1 / HZ, PER = 2;
const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER, gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' } });
const rs = ctrl.rs;
console.log('══ probe-conflict：逐拍抓同轴冲突（state/sup/sw) ══');
let seen = 0;
const seenKeys = new Set<string>();
for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
  if (i % PER === 0) sim.doll.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  if (i % PER !== 0) continue;
  // ⚠ `axisConflicts` **每拍清空**（`beginTick`）⇒ 必须每拍读（原写法用累计长度会漏）
  const cs = ctrl.snapshot.axisConflicts;
  for (const c of cs) {
    const key = `${c.joint}/${c.axis} ${c.mode}<-${c.by} vs ${c.against}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key); seen++;
    console.log(`  t=${(i / HZ).toFixed(3)} ${c.joint}/${c.axis} 新写=${c.mode}<-${c.by}  既有=${c.against}`
      + `  状态=${rs.state} sup=${rs.supportLeg()} sw=${rs.swingLeg()} roleSup=${String(rs.roleSup)} roleSw=${String(rs.roleSw)}`);
  }
}
console.log(`  共 ${seen} 条`);
