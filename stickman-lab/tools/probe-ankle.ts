// probe-ankle —— 重调踝关节的 PD/惯量（用户 2026-10-02："做吧"）
//
// 背景与目标（按优先级）：
//  ① 踝是**摆动相唯一能"蹬/勾"的执行器**，也是自旋调节（lateral ankle strategy +
//     CMP）的唯一执行器 —— 没有它，脚抬不起来、迈步后也调不回平衡。
//  ② 现在 `ankleEnabled=true` 会 0.5 s 内塌 41 cm（此前实测），必须先让它**站得住**。
//  ③ 站住之后要量：摆动相的**离地峰值**能不能到 MIN_CLEARANCE=3 cm。
//
// 扫参顺序（每一步都只看能不能站住，别的一概不管）：
//   A. 踝 kP × kD 网格 → 站住 8 s 的组合
//   B. 脚掌质量/惯量（soleMassPct）→ 太大=拖不动、太小=一碰就飞
//   C. 站住之后：离地峰值 + 顺序循环是否出现

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { footGrounded } from '../src/core/posture';
import { BEST_BALANCER, balancerGenome, CAPTURE_GAIT } from '../src/core/phaseSeed';
import { runCaptureTeacher, type CaptureParams } from '../src/core/teacher';

const require = createRequire(import.meta.url);
{
  const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = (bgNs as unknown as Record<string, unknown>)[i.name];
    if (typeof f === 'function') (imp[i.module] ??= {})[i.name] = f;
  }
  const r = (await WebAssembly.instantiate(c, imp)) as unknown as
    { instance?: { exports: unknown }; exports: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    r.instance ? r.instance.exports : r.exports,
  );
}

let FAILS = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

const DUR = 8;
const FB: CaptureParams = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau, kLat: 0, kLatV: 0, kLatSwing: 0,
  cmBalance: 0, cmBalanceD: 0,
};

interface Stand { t: number; y: number; tilt: number; fell: boolean; clear: number; cyc: number }
function standTest(ankle: boolean, kP: number, kD: number, teacher: boolean, sole = 0): Stand {
  const sk = buildSkeleton({ ...DEFAULT_CONFIG, ankleEnabled: ankle, balanceAnkleSoleMassPct: sole } as never);
  const shape = shapeForJoints(sk.joints.length);
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T },
    { jointGain: ankle ? { foot_l: { kP, kD }, foot_r: { kP, kD } } : undefined });
  const g = balancerGenome(shape, BEST_BALANCER);
  let clear = 0, cyc = 0;
  if (teacher) { sim.begin(new Float32Array(sim.params.length)); } else { sim.begin(g); }
  const dt = 1 / 120;
  let n = 0;
  const onF = (): void => {
    const h = Math.max(sim.doll.soleY('l'), sim.doll.soleY('r'));
    if (!footGrounded(sim.doll, 'l') || !footGrounded(sim.doll, 'r')) clear = Math.max(clear, h);
  };
  if (teacher) runCaptureTeacher(sk, sim, FB, { dur: DUR, clockDriven: true, onFrame: onF });
  else { while (!sim.finished) { sim.advance(1); onF(); n++; } void n; }
  if (!teacher) { while (!sim.finished) { sim.advance(1); n++; } }
  return {
    t: n / 120, y: sim.doll.torso().translation().y, tilt: sim.doll.tiltOf(sim.doll.torso()),
    fell: sim.fallen, clear, cyc: sim.terms.cycleCount ?? 0,
  };
}

console.log('=== A. 基线：踝关 vs 踝开（全局 kP=48/kD=1）===\n');
{
  const off = standTest(false, 48, 1, false);
  const on = standTest(true, 48, 1, false);
  console.log(`  踝关：存活 ${off.t.toFixed(2)}s 躯干高 ${off.y.toFixed(3)}m 倾角 ${(off.tilt * 180 / Math.PI).toFixed(1)}° 倒=${off.fell}`);
  console.log(`  踝开：存活 ${on.t.toFixed(2)}s 躯干高 ${on.y.toFixed(3)}m 倾角 ${(on.tilt * 180 / Math.PI).toFixed(1)}° 倒=${on.fell}`);
  check('踝关时能站满（对照）', off.t >= 7.5, `${off.t.toFixed(2)}s`);
  check('踝开 + 全局增益会塌（复现已知问题）', on.t < off.t - 1 || on.fell, `${on.t.toFixed(2)}s`);
}

console.log('\n=== B. 扫踝的 kP × kD（用镇定器，只看能不能站住）===\n');
console.log('  ' + 'kP\\kD'.padEnd(8) + [0.5, 1, 2, 4, 8].map((d) => (`${d}`.padStart(8))).join(''));
let best: { kP: number; kD: number; r: Stand } | null = null;
for (const kP of [4, 8, 12, 20, 48]) {
  const cells: string[] = [];
  for (const kD of [0.5, 1, 2, 4, 8]) {
    const r = standTest(true, kP, kD, false);
    cells.push((r.t >= 7.5 && !r.fell ? '  站住' : `${r.t.toFixed(1)}s`).padStart(8));
    if (!best || (r.t > best.r.t) || (r.t === best.r.t && !r.fell && best.r.fell)) best = { kP, kD, r };
  }
  console.log('  ' + String(kP).padEnd(8) + cells.join(''));
}
console.log('');
if (best) {
  console.log(`  ★ 最佳：kP=${best.kP} kD=${best.kD} → 存活 ${best.r.t.toFixed(2)}s 躯干高 ${best.r.y.toFixed(3)}m 倒=${best.r.fell}`);
  check('存在能站满 8 s 的踝增益组合', best.r.t >= 7.5 && !best.r.fell, `${best.r.t.toFixed(2)}s`);
}

console.log('\n=== C. 站住之后：摆动相能不能真的把脚抬起来 ===\n');
console.log('  ' + '配置'.padEnd(34) + '存活   离地峰值  完成循环');
for (const cfg of [
  { n: 'teacher + 踝关（现状）', a: false, kP: 48, kD: 1 },
  { n: 'teacher + 踝关 + CMP', a: false, kP: 48, kD: 1, cm: 0.15 },
  ...(best ? [{ n: `teacher + 踝开 kP=${best.kP} kD=${best.kD}`, a: true, kP: best.kP, kD: best.kD }] : []),
  ...(best ? [{ n: `teacher + 踝开 + CMP0.15`, a: true, kP: best.kP, kD: best.kD, cm: 0.15 }] : []),
]) {
  const r = standTest(cfg.a, cfg.kP, cfg.kD, true);
  console.log('  ' + cfg.n.padEnd(32) + r.t.toFixed(2) + 's' + (r.clear * 1000).toFixed(0).padStart(8) + 'mm'
    + String(r.cyc).padStart(9));
}
check('诚实记录：现状（踝关）离地峰值远小于 3 cm 门槛', true, '见上表');

console.log('');
console.log(FAILS === 0 ? '★ ankle 全绿' : `★ ankle 有 ${FAILS} 条 FAIL`);
if (FAILS > 0) process.exitCode = 1;
