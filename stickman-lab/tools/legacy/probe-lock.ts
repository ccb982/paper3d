/**
 * probe-lock.ts —— 锁定腿机制**能不能正常用**
 * 查两件事：
 *   ① `locked` 在跑动中到底有没有被置真（置过=机制活着）
 *   ② `locked` 为真时 `supportLeg()` 听不听它的（不听=机制是摆设）
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
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');

const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });

let everLockedL = 0, everLockedR = 0, bothLocked = 0;
let supportDisagreesWithLock = 0, flips = 0, prevSup = '';
let firstLockAt = -1;
for (let i = 0; i < 120 * 5 && !sim.finished; i++) {
  if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
  sim.advance(1);
  if (i % 2) continue;
  const s = ctrl.snapshot;
  const lk = s.locked;
  if (lk.l) everLockedL++;
  if (lk.r) everLockedR++;
  if (lk.l && lk.r) bothLocked++;
  // ★ 判据：锁定生效时 supportLeg 必须等于被锁定那条
  if (lk.l && !lk.r && s.supportLeg !== 'l') supportDisagreesWithLock++;
  if (lk.r && !lk.l && s.supportLeg !== 'r') supportDisagreesWithLock++;
  if (prevSup && s.supportLeg !== prevSup) flips++;
  if ((lk.l || lk.r) && firstLockAt < 0) firstLockAt = s.t;
  prevSup = s.supportLeg;
  if (s.tiltDeg >= 25) break;
}
const frames = Math.max(1, Math.round(ctrl.snapshot.t * 60));
log('══ 锁定腿机制可用性检查 ══');
log(`   运行帧数              ${frames}`);
log(`   locked.l 置真帧数     ${everLockedL}`);
log(`   locked.r 置真帧数     ${everLockedR}`);
log(`   两腿同时锁死帧数      ${bothLocked}`);
log(`   首次锁定时刻          ${firstLockAt < 0 ? '从未锁定' : firstLockAt.toFixed(2) + 's'}`);
log(`   ★锁定生效但 supportLeg 不符的帧数  ${supportDisagreesWithLock}`);
log(`   supportLeg 翻转次数   ${flips}`);
