/**
 * probe-supleg.ts —— X3「驻留 0.03s」是**横向不稳**还是**支撑腿翻转**造成的测量假象？
 * 逐帧记录 supportLeg 翻转次数，并对**固定参照腿**重算 X3 驻留。
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
const { DEFAULT_STEP_PARAMS } = await import('../src/core/systems/step');
const FMAX = Number(process.env.FMAX ?? 0);
const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER,
  step: { ...DEFAULT_STEP_PARAMS, shiftFMax: FMAX } });

let flips = 0, prev = '';
let bearFlips = 0, prevBear = '';
const seq: string[] = [];
for (let i = 0; i < 120 * 4 && !sim.finished; i++) {
  if (i % 2 === 0) sim.doll.setMotorTargets(ctrl.step(1 / 60));
  sim.advance(1);
  if (i % 2) continue;
  const s = ctrl.snapshot;
  const sl = s.supportLeg, bl = s.loadBearer ?? '-';
  if (prev && sl !== prev) flips++;
  if (prevBear && bl !== prevBear) bearFlips++;
  prev = sl; prevBear = bl;
  seq.push(sl === 'l' ? 'L' : 'R');
  if (s.tiltDeg >= 25) break;
}
log(`══ 支撑腿与承重腿翻转统计（${seq.length} 帧）══`);
log(`   supportLeg 翻转 ${flips} 次`);
log(`   loadBearer  翻转 ${bearFlips} 次`);
log(`   supportLeg 序列（前 90 帧）: ${seq.slice(0, 90).join('')}`);

// 对固定参照腿重算：分别以左脚、右脚为参照，看谁能连续驻留 1s
const sim2 = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk' });
sim2.begin(new Float32Array(sim2.paramCount));
const ctrl2 = new Controller(sk, sim2, { ...DEFAULT_CONTROLLER });
const rec: { t: number; comz: number; lz: number; rz: number }[] = [];
const rec2: { f: number; ha: number; ka: number }[] = [];
for (let i = 0; i < 120 * 4 && !sim2.finished; i++) {
  if (i % 2 === 0) sim2.doll.setMotorTargets(ctrl2.step(1 / 60));
  sim2.advance(1);
  if (i % 2) continue;
  const s = ctrl2.snapshot;
  rec.push({ t: s.t, comz: s.com.z, lz: s.legs.l.footZ, rz: s.legs.r.footZ });
  const hr = 12, kr = 13;
  rec2.push({ f: s.shiftDemandF ?? 0, ha: s.axes[hr]?.angle ?? 0, ka: s.axes[kr]?.angle ?? 0 });
  if (s.tiltDeg >= 25) break;
}
log('');
log('══ 对**固定参照腿**重算 X3 驻留（排除支撑腿翻转的干扰）══');
for (const key of ['lz', 'rz'] as const) {
  const leg = key === 'lz' ? '左脚' : '右脚';
  let run = 0, best = 0, inside = 0;
  for (const r of rec) {
    const dz = Math.abs(r.comz - r[key]);
    if (dz <= 0.05) { run++; inside++; best = Math.max(best, run); } else run = 0;
  }
  log(`   以${leg}为参照：X3<50mm 占 ${(100 * inside / Math.max(1, rec.length)).toFixed(0).padStart(3)}%`
    + `  最长连续驻留 = ${(best / 60).toFixed(2)}s`);
}
log('');
log('══ com.z 逐 0.1s（判断是"漂移"还是"来回摆"）══');
log(`   （FMAX=${FMAX}N） t   com.z    申报F  髋角/0右  膝角/0右  左脚z`);
for (let i = 0; i < rec.length; i += 6) {
  const r = rec[i]!;
  const fr = rec2[i]!;
  log(`  ${r.t.toFixed(2).padStart(14)} ${(r.comz * 1000).toFixed(0).padStart(7)}`
    + ` ${fr.f.toFixed(0).padStart(6)}N ${fr.ha.toFixed(1).padStart(8)}° ${fr.ka.toFixed(1).padStart(8)}°`
    + ` ${(r.lz * 1000).toFixed(0).padStart(7)}`);
}
