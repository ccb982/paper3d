/**
 * probe-trace.ts —— 逐帧回读：锁定承诺 + 腰 PD 之后，重心转移到底卡在哪
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

const { DEFAULT_BALANCE_PARAMS } = await import('../src/core/systems/balance');

const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const { jointIndexByName } = await import('../src/core/skeleton');
const SP1 = jointIndexByName(sk, 'spine1');
const SHAPE = shapeForJoints(sk.joints.length);
const DEG = 180 / Math.PI;
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  balance: { ...DEFAULT_BALANCE_PARAMS, waistKp: 0.6, waistKd: 1.2, latDamp: 40 },
});
log('══ 逐帧：锁定承诺 + 腰PD(0.6,1.2) + 髋阻尼40，腿驱动关 ══');
log('   （腰 = spine1 轴0；实际=pos，归属=ownerLabel）');
log('   t    相位   锁 承重 L载  com.z   vz  X3 腰实 髋τ X1 X2 X3c X4 X5 X7 X8 MoS  倾角');
for (let i = 0; i < 120 * 3.2 && !sim.finished; i++) {
  if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
  sim.advance(1);
  if (i % 4) continue;
  const s = ctrl.snapshot;
  const sup = s.supportLeg;
  const dz = (s.com.z - s.legs[sup].footZ) * 1000;
  const lk = s.locked.l ? 'L' : s.locked.r ? 'R' : '-';
  const bl = s.loadBearer === 'l' ? 'L' : s.loadBearer === 'r' ? 'R' : '-';
  // 脊柱1 轴0 实际角
  const sp: any = s.axes.find((a: any) => a.joint === SP1 && a.axis === 0);
  const hv: any = (s.criteria as any).handover;
  const f = (k: string): string => (hv?.flags?.[k] ? '✓' : '·').padStart(2);
  log(`  ${s.t.toFixed(2).padStart(5)} ${s.phase.padEnd(6)} ${lk}  ${bl}`
    + ` ${(s.legs.l.loadFrac * 100).toFixed(0).padStart(3)}%`
    + ` ${(s.com.z * 1000).toFixed(0).padStart(6)} ${(s.com.vz * 1000).toFixed(0).padStart(6)}`
    + ` ${dz.toFixed(0).padStart(4)}`
    + ` ${((sp?.pos ?? 0) * DEG).toFixed(0).padStart(4)}`
    + ` ${(s.hipLatTau ?? 0).toFixed(0).padStart(5)}`
    + ` ${f('X1_前腿接地')}${f('X2_矢状到位')}${f('X3_额状到位')}${f('X4_驻留')}`
    + `${f('X5_前腿承重')}${f('X7_MoS')}${f('X8_倾角')}`
    + ` ${((s.support.halfZ ?? 0) * 1000).toFixed(0).padStart(4)}`
    + ` ${s.tiltDeg.toFixed(1).padStart(5)}°`);
  if (s.tiltDeg >= 25) break;
}
