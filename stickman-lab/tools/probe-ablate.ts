/** 通道消融：逐条摘除，回答"是哪一条在 destabilize" */
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
const dtC = 1 / 60, dtP = 1 / 120, stages = 2;
/**
 * mode='zero'：**完全不碰 setMotorTargets**，让 `controlTick` 自己去写（零基因组 ⇒ 输出恒 0）。
 * 这是"真正的什么都不做"基线。
 * ★ 必须和消融行放在**同一个探针同一份配置**里比 ——
 *   否则会出现"控制器全关 0.98s / 零输出 5.53s"这种自相矛盾，
 *   说明两条路径不等价，而差异来自 controller 路径本身。
 */
function run2(ablate: string, label: string, mode: 'ctl' | 'zero'): void {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: DUR, driver: 'controller' });
  sim.begin(new Float32Array(sim.params.length));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    gait: { ...DEFAULT_CONTROLLER.gait, singleLeg: null },
    balance: { ...DEFAULT_CONTROLLER.balance, ablate },
  });
  for (let i = 0; i < Math.round(DUR / dtP) && !sim.finished; i++) {
    if (mode === 'ctl' && i % stages === 0) sim.doll.setMotorTargets(ctrl.step(dtC));
    sim.advance(1);
  }
  const s = ctrl.snapshot;
  const a = sim.ticksDone / 60;
  console.log(`  ${label.padEnd(26)} ${(a >= DUR - .05 ? '站满' : a.toFixed(2) + 's').padStart(7)}`
    + `  ${s.tiltDeg.toFixed(1).padStart(6)}°  躯干 ${s.torsoY.toFixed(3)}`
    + `  ξ ${(s.dcm.x * 1000).toFixed(0).padStart(5)}mm  ${s.fallReason || '-'}`);
}

function run(ablate: string, label: string): void {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: DUR, driver: 'controller' });
  sim.begin(new Float32Array(sim.params.length));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    gait: { ...DEFAULT_CONTROLLER.gait, singleLeg: null },
    balance: { ...DEFAULT_CONTROLLER.balance, ablate },
  });
  for (let i = 0; i < Math.round(DUR / dtP) && !sim.finished; i++) {
    if (i % stages === 0) sim.doll.setMotorTargets(ctrl.step(dtC));
    sim.advance(1);
  }
  const s = ctrl.snapshot;
  const a = sim.ticksDone / 60;
  console.log(`  ${label.padEnd(26)} ${(a >= DUR - .05 ? '站满' : a.toFixed(2) + 's').padStart(7)}`
    + `  ${s.tiltDeg.toFixed(1).padStart(6)}°  躯干 ${s.torsoY.toFixed(3)}`
    + `  ξ ${(s.dcm.x * 1000).toFixed(0).padStart(5)}mm  ${s.fallReason || ''}`);
}
console.log(`平衡系统 · 通道消融 · 双脚支撑(不抬腿) · ${DUR}s`);
console.log('  消融集                     存活    终倾角   终躯干y     终ξx   死因');
console.log('  ' + '─'.repeat(74));
run2('hip,knee,torso,lat,ankle', '★真·零输出（不碰马达）', 'zero');
run2('', '★零输出+控制器跑但不写', 'zero');
run('hip,knee,torso,lat,ankle', '控制器全关');
run('knee,torso,lat,ankle', '只留髋矢状');
run('hip,torso,lat,ankle', '只留膝');
run('hip,knee,lat,ankle', '只留躯干矢状');
run('hip,knee,torso,ankle', '只留躯干额状');
run('knee,torso,lat', '只留踝（无踝时应无差）');
run('torso,lat', '只留髋+膝');
run('knee,lat', '只留髋+躯干矢状');
run('lat', '只留髋+膝+躯干矢状');
run('', '全开（当前平衡系统）');
