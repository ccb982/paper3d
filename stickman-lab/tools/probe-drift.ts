/**
 * probe-drift.ts —— 锁定机制修好之后，重新定位**残余横向漂移源**
 * 现象：latwaist 消融后 com.z 末仍为 −96mm（往 −z 跑），目标 +161mm。
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
const { DEFAULT_STEP_PARAMS } = await import('../src/core/systems/step');
const { DEFAULT_BALANCE_PARAMS } = await import('../src/core/systems/balance');

const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const DEG = 180 / Math.PI;
const { jointIndexByName } = await import('../src/core/skeleton');
const SP1 = jointIndexByName(sk, 'spine1');

interface C { ld: number; kd: number; tone: number; ks: number }
const CS: C[] = [];
for (const ks of [0.6, 1.0, 1.4, 2.0])
  for (const kd of [0.8, 1.0, 1.4])
    CS.push({ ld: kd, kd, tone: 0.5, ks });
log('══ 残余漂移源 + 权限扫描（锁定已生效）══');
log('   消融                          FMAX 腰限幅  最小X3  驻留  腰峰   vz峰   com.z末  存活  翻转');
for (const c of CS) {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    step: { ...DEFAULT_STEP_PARAMS, shiftFMax: 0 },
    balance: { ...DEFAULT_BALANCE_PARAMS, waistKp: 0.6, waistKd: c.kd, latDamp: c.ld, postureLoadGain: c.tone, latStiff: c.ks },
  });
  let vzMax = 0, zEnd = 0, dzMin = 1e9, alive = 0, flips = 0, prevSup = '';
  let run = 0, bestRun = 0, wMax = 0, spMax = 0;
  for (let i = 0; i < 120 * 6 && !sim.finished; i++) {
    if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
    sim.advance(1);
    if (i % 2) continue;
    const s = ctrl.snapshot;
    const dz = Math.abs(s.com.z - s.legs[s.supportLeg].footZ);
    dzMin = Math.min(dzMin, dz);
    if (dz <= 0.05) { run++; bestRun = Math.max(bestRun, run); } else run = 0;
    vzMax = Math.max(vzMax, Math.abs(s.com.vz));
    wMax = Math.max(wMax, Math.abs(s.waistTrim ?? 0));
    const sp: any = s.axes.find((a: any) => a.joint === SP1 && a.axis === 0);
    spMax = Math.max(spMax, Math.abs(sp?.pos ?? 0));
    zEnd = s.com.z;
    if (prevSup && s.supportLeg !== prevSup) flips++;
    prevSup = s.supportLeg;
    if (s.tiltDeg >= 25) break;
    alive = s.t;
  }
  log(`   ${c.ks.toFixed(1).padStart(6)}× ${c.ld.toFixed(1).padStart(6)}×`
    + ` ${(dzMin * 1000).toFixed(0).padStart(6)}mm`
    + ` ${(bestRun / 60).toFixed(2).padStart(5)}s${bestRun / 60 >= 1 ? '✓' : '✗'}`
    + ` ${(wMax * DEG).toFixed(1).padStart(5)}° ${(spMax * DEG).toFixed(1).padStart(6)}°`
    + ` ${(vzMax * 1000).toFixed(0).padStart(5)}`
    + ` ${(zEnd * 1000).toFixed(0).padStart(6)}mm`
    + ` ${alive.toFixed(2)}s ${flips}`);
}
