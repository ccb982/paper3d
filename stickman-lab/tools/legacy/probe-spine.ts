/** probe-spine.ts —— 脊柱限位为什么没拦住 */
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
const { DEFAULT_BALANCE_PARAMS } = await import('../src/core/systems/balance');
const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const DEG = 180 / Math.PI;
const { jointIndexByName } = await import('../src/core/skeleton');
log('══ 脊柱关节静态检查 ══');
for (const nm of ['spine1', 'spine2', 'spine3']) {
  const j = jointIndexByName(sk, nm);
  const d = sk.joints[j];
  if (!d) { log(`   ${nm}: 找不到`); continue; }
  log(`   ${nm} idx=${j} 类型=${(d as any).type ?? '?'} revoluteAxis=${JSON.stringify((d as any).revoluteAxis ?? null)}`);
  for (let k = 0; k < 3; k++) {
    const lo = d.minRad[k]!, hi = d.maxRad[k]!;
    log(`      轴${k}: [${(lo * DEG).toFixed(1)}°, ${(hi * DEG).toFixed(1)}°] 跨度=${((hi - lo) * DEG).toFixed(1)}°`
      + `${(hi - lo) >= Math.PI * 1.99 ? '  ←★ 会被 enforceLimits 跳过(视为不限位)' : ''}`
      + `  τmax=${d.maxTorque[k]}`);
  }
}
const SHAPE = shapeForJoints(sk.joints.length);
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
sim.begin(new Float32Array(sim.paramCount));
const TONE = Number(process.env.TONE ?? 3);
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  balance: { ...DEFAULT_BALANCE_PARAMS, postureLoadGain: 0.5, postureSpineTonic: TONE },
});
let peak = 0, flip = 0, prevS = 0;
const SP = jointIndexByName(sk, 'spine1');
log('');
log('══ 运行时：snapshot 的 pos vs enforceLimits 用的 jointRotAxis ══');
log('   t   snap轴0  snap轴1  snap轴2 | ragdoll轴0 轴1 轴2 | 倾角');
for (let i = 0; i < 120 * 1.2 && !sim.finished; i++) {
  if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
  sim.advance(1);
  if (i % 12) continue;
  const s = ctrl.snapshot;
  const d: any = sim.doll;
  const raw = [0, 1, 2].map((k) => (d as any).jointRotAxis(SP, k) * DEG);
  const snap = [0, 1, 2].map((k) => (s.axes.find((a: any) => a.joint === SP && a.axis === k)?.pos ?? 0) * DEG);
  peak = Math.max(peak, Math.abs(snap[0]!));
  if (Math.sign(snap[0]!) !== 0 && Math.sign(prevS) !== 0 && Math.sign(snap[0]!) !== Math.sign(prevS)) flip++;
  prevS = snap[0]!;
  log(`  ${s.t.toFixed(2).padStart(5)}`
    + ` ${snap.map((x) => x.toFixed(1).padStart(7)).join('')}`
    + ` |${raw.map((x) => x.toFixed(1).padStart(7)).join('')} | ${s.tiltDeg.toFixed(1)}°`);
  if (i === 0) log(`  （TONE=${TONE}）`);
  if (s.tiltDeg >= 25) break;
}
log(`   → 脊柱轴0 峰值=${peak.toFixed(1)}°  换向次数=${flip}`);
