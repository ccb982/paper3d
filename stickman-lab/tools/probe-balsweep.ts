/** 平衡维持系统增益扫描 —— 只扫两个通道：矢状面髋策略、额状面躯干 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as Record<string, (...a: unknown[]) => unknown>;
  const im: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) { const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name); (im[i.module] ??= {})[i.name] = f; }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const DUR = Number(process.argv[3] ?? 8) || 8;
const SUP = (process.argv[4] ?? 'l') as 'l' | 'r';
const dtC = 1 / 60, dtP = 1 / 120, stages = 2;
console.log(`增益扫描 · 单腿(${SUP}) · ${DUR}s`);
console.log('  kSagP  kLatP   存活    终倾°  终躯干y  MoS最小  越界拍  摆动触地  承重授予');
console.log('  ' + '─'.repeat(76));
for (const kSagP of [0, 1.1, 2.2, 4.4]) {
  for (const kLatP of [0, 3, 6, 12]) {
    const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: DUR, driver: 'controller' });
    sim.begin(new Float32Array(sim.params.length));
    const ctrl = new Controller(sk, sim, {
      ...DEFAULT_CONTROLLER,
      gait: { ...DEFAULT_CONTROLLER.gait, singleLeg: SUP },
      balance: { ...DEFAULT_CONTROLLER.balance, kSagP, kLatP },
    });
    let n = 0, bearer = 0, minMos = Infinity, outN = 0, touched = false, single = 0;
    const steps = Math.round(DUR / dtP);
    for (let i = 0; i < steps && !sim.finished; i++) {
      if (i % stages === 0) {
        sim.doll.setMotorTargets(ctrl.step(dtC));
        ctrl.soleClearance('l'); ctrl.soleClearance('r');
        const s = ctrl.snapshot; n++;
        if (s.loadBearer) bearer++;
        if (s.mos < minMos) minMos = s.mos;
        if (s.mos < 0) outN++;
        const swY = SUP === 'l' ? s.legs.r.soleY : s.legs.l.soleY;
        if (i > 10 && swY < 0.005) touched = true;
        const supG = s.legs[SUP].grounded, oG = s.legs[SUP === 'l' ? 'r' : 'l'].grounded;
        if (supG && !oG) single++;
      }
      sim.advance(1);
    }
    const s = ctrl.snapshot;
    const alive = sim.ticksDone / 60;
    console.log(`  ${kSagP.toFixed(1).padStart(5)} ${kLatP.toFixed(0).padStart(6)}  `
      + `${(alive >= DUR - .05 ? '站满' : alive.toFixed(2) + 's').padStart(7)}`
      + ` ${s.tiltDeg.toFixed(1).padStart(7)} ${s.torsoY.toFixed(3).padStart(9)}`
      + ` ${(minMos * 1000).toFixed(0).padStart(8)}mm ${String(outN).padStart(6)}/${n}`
      + `  ${touched ? '是' : '否'}`.padStart(9) + `  ${bearer > 0 ? '是' : '否'}`);
  }
}
