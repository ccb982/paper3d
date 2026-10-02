// probe-gaitcycle —— 用户的三个质疑，用实测回答：
//  ① "真是一次迈一个脚吗"（会不会其实双脚乱蹬）
//  ② "迈脚间隔真是 1s 吗"
//  ③ "迈出脚后为啥不能自主调整平衡"（顺便量 WBAM / MoS 在稳住窗口里的走势）
//
// 判据全部来自文献：
// · 正常走路 = 20% 双支撑、40% 单支撑、**0% 腾空(flight)**（两脚绝不能同时离地）
//   （Perry 八相分期：双支撑 0~10% 与 50~60%）
// · 幼儿双支撑占 30~40%（比成人高），摆动相短
// · 落地后能调的只有支撑脚下的 CoP，量程 0.7~3 cm（lateral ankle strategy）
// ⇒ 我们没有踝关节（ankleEnabled 默认 false）⇒ 这一层权限是 **0**。

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints, brainParamCount } from '../src/core/brain';
import { footGrounded, readCom, newCom, readSupport, newSupport, omegaAt } from '../src/core/posture';
import { marginOfStability } from '../src/core/stability';
import { wholeBodyAngularMomentum } from '../src/core/balance';
import { CAPTURE_GAIT } from '../src/core/phaseSeed';
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
const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
const DUR = 8;
const dt = 1 / 120;

const FB: CaptureParams = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau, kLat: 0, kLatV: 0, kLatSwing: 0,
};

interface Meas {
  n: number; dbl: number; sgl: number; flight: number;
  touchdowns: number[];                 // 每次触地时刻（两条腿合并，按时间排）
  stanceSeq: string;                    // 支撑腿序列 L/R
  mosInSettle: number[];                // 稳住窗口内的 MoS
  wbamInSettle: number[];               // 稳住窗口内的 |WBAM|
  mosAll: number[];
  maxFlightRun: number;
}

function measure(teacher: boolean, g?: Float32Array): Meas {
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  if (teacher) { sim.begin(new Float32Array(sim.params.length)); }
  else { sim.begin(g!); }
  const com = newCom(), sup = newSupport(), l = new Float64Array(3);
  const m: Meas = { n: 0, dbl: 0, sgl: 0, flight: 0, touchdowns: [], stanceSeq: '', mosInSettle: [], wbamInSettle: [], mosAll: [], maxFlightRun: 0 };
  let t = 0, lastG: [boolean, boolean] = [true, true], flightRun = 0, sinceTouch = 0;
  let pendG: [boolean, boolean] | null = null;
  const onFrame = (): void => {
    const gL = footGrounded(sim.doll, 'l'), gR = footGrounded(sim.doll, 'r');
    const ng = (gL ? 1 : 0) + (gR ? 1 : 0);
    m.n++;
    if (ng === 2) m.dbl++; else if (ng === 1) m.sgl++; else { m.flight++; flightRun++; if (flightRun > m.maxFlightRun) m.maxFlightRun = flightRun; }
    if (ng > 0) flightRun = 0;
    readCom(sim.doll, com); readSupport(sim.doll, sup);
    const mos = marginOfStability(com.x, com.vx, omegaAt(com.y), sup.cx + sup.halfX, com.z, com.vz, sup.cz + sup.halfZ);
    m.mosAll.push(mos.x);
    if (ng === 1) { m.mosInSettle.push(mos.x); wholeBodyAngularMomentum(sim.doll, com, l); m.wbamInSettle.push(Math.hypot(l[0]!, l[1]!, l[2]!)); }
    // 触地检测（去抖 2 帧）
    const g2: [boolean, boolean] = [gL, gR];
    for (let s = 0; s < 2; s++) {
      if (g2[s] && !lastG[s]) { if (!pendG) pendG = [lastG[0], lastG[1]]; }
    }
    if (pendG && gL !== pendG[0] && gR !== pendG[1]) {
      // 确认新触地（两帧一致）
      m.touchdowns.push(t);
      m.stanceSeq += (gR && !gL) ? 'R' : (gL && !gR) ? 'L' : '?';
      pendG = null;
      sinceTouch = 0;
    }
    lastG = g2;
    t += dt;
    sinceTouch += dt;
  };
  if (teacher) runCaptureTeacher(sk, sim, FB, { dur: DUR, clockDriven: true, onFrame });
  else { while (!sim.finished) { sim.advance(1); onFrame(); } }
  return m;
}

console.log('=== ① 是一次迈一个脚吗？（接触相分布）===\n');
const mt = measure(true);
const pct = (v: number): string => `${(v / Math.max(1, mt.n) * 100).toFixed(1)}%`;
console.log(`  捕获点 teacher：双支撑 ${pct(mt.dbl)} · 单支撑 ${pct(mt.sgl)} · 两脚同时离地 ${pct(mt.flight)}`);
console.log(`  支撑腿序列: ${mt.stanceSeq}`);
console.log('  文献：正常步行 双支撑≈20% / 单支撑≈40% / 腾空 0%（Perry 八相分期）');
console.log('  ⚠ 我们的 `single` 项在"两脚同时离地"时给 −0.5，正是为了禁止这种"跳"');
check('没有长时间双脚同时离地（不是跳）', mt.maxFlightRun * dt < 0.10,
  `最长连续腾空 ${(mt.maxFlightRun * dt * 1000).toFixed(0)} ms`);
const strictAlt = /^(L|R)(?!\1)/.test(mt.stanceSeq) && !/(LL|RR)/.test(mt.stanceSeq);
console.log(`  → 严格左右交替？${strictAlt ? '是' : '否（有连续同腿支撑或未知标记）'}`);

console.log('\n=== ② 迈脚间隔真是 1s 吗？（实测触地间隔）===\n');
const iv: number[] = [];
for (let i = 1; i < mt.touchdowns.length; i++) iv.push(mt.touchdowns[i]! - mt.touchdowns[i - 1]!);
console.log('  触地时刻(s): ' + mt.touchdowns.map((v) => v.toFixed(2)).join(' '));
console.log('  间隔(s):     ' + iv.map((v) => v.toFixed(2)).join(' ') + (iv.length ? '' : '（不足两次触地）'));
const med = iv.length ? [...iv].sort((a, b) => a - b)[Math.floor(iv.length / 2)]! : 0;
console.log(`  中位间隔 ${med.toFixed(2)} s · 期望 ≈1.00 s（MIN_CYCLE=1.0）`);
console.log(`  ⚠ teacher 的步态周期 T=${FB.T} s ⇒ 每条腿 ${(FB.T / 2).toFixed(2)} s，理论间隔 ${(FB.T / 2).toFixed(2)} s`);
check('实测间隔与 1 s 同量级（0.5~1.5 s）', med > 0.4 && med < 1.6, `${med.toFixed(2)} s`);

console.log('\n=== ③ 迈出脚后为啥不能自主调整平衡？（量 MoS / WBAM 在稳住窗口的走势）===\n');
const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const sorted = [...mt.mosInSettle].sort((a, b) => a - b);
const p10 = sorted.length ? sorted[Math.floor(sorted.length * 0.1)]! : 0;
console.log(`  单支撑帧 MoS: 均值 ${(mean(mt.mosInSettle) * 1000).toFixed(0)}mm · 10分位 ${(p10 * 1000).toFixed(0)}mm · 最小 ${(Math.min(...mt.mosInSettle) * 1000).toFixed(0)}mm`);
console.log(`  单支撑帧 |WBAM|: 均值 ${mean(mt.wbamInSettle).toFixed(2)}（镇定器基线 0.16，见 probe-balance）`);
const sortedW = [...mt.wbamInSettle].sort((a, b) => a - b);
const w50 = sortedW.length ? sortedW[Math.floor(sortedW.length * 0.5)]! : 0;
console.log(`  |WBAM| 中位 ${w50.toFixed(2)} = 基线的 ${(w50 / 0.16).toFixed(1)}× ⇒ 迈步后**没有**把角动量调回零`);
console.log('');
console.log('  三个可查的原因（对应文献）：');
console.log('   ① ★ 我们**没有踝关节**（ankleEnabled 默认 false）');
console.log('      ⇒ 落地后唯一那点"自主调整"权限（lateral ankle strategy，调支撑脚下 CoP）');
console.log('         在人身上只有 0.7~3 cm，我们这里是 **0**。');
console.log('   ② ★ 没有实现 CMP / Moment Balance Strategy（Popovic, Hofmann & Herr 2004）：');
console.log('      要主动产生**关于质心的非零力矩**（CMP≠ZMP），靠髋策略；');
console.log('      我们现在只是"别倒下"式被动 PD，没有任何主动力矩调节。');
console.log('   ③ 奖励只要求"稳住"（MoS≥0），**从未要求"主动纠正"** ⇒ ES 没有理由学纠正反射。');
check('诚实记录：teacher 的 |WBAM| 明显高于平衡基线（未做主动调节）', w50 > 0.16 * 3,
  `中位 ${w50.toFixed(2)} vs 基线 0.16`);

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== ④ CMP / Moment Balance Strategy 开 vs 关（落地后自主调平衡）===\n');
console.log('  ' + '参数'.padEnd(22) + '存活    换脚  单支撑MoS均  |WBAM|中位  双支撑占比');
for (const cfg of [
  { n: '关闭（此前）', p: {} as Partial<CaptureParams> },
  { n: 'cm=0.05', p: { cmBalance: 0.05, cmBalanceD: 0.2 } as Partial<CaptureParams> },
  { n: 'cm=0.15', p: { cmBalance: 0.15, cmBalanceD: 0.4 } as Partial<CaptureParams> },
  { n: 'cm=0.4', p: { cmBalance: 0.4, cmBalanceD: 1.0 } as Partial<CaptureParams> },
  { n: 'cm=1.0', p: { cmBalance: 1.0, cmBalanceD: 2.0 } as Partial<CaptureParams> },
]) {
  const s2 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  s2.begin(new Float32Array(s2.params.length));
  const d2 = { n: 0, dbl: 0, mos: [] as number[], wb: [] as number[] };
  const c2 = newCom(), sp2 = newSupport(), l2 = new Float64Array(3);
  const cb2 = (): void => {
    const gL = footGrounded(s2.doll, 'l'), gR = footGrounded(s2.doll, 'r');
    const ng = (gL ? 1 : 0) + (gR ? 1 : 0);
    d2.n++;
    if (ng === 2) d2.dbl++;
    else if (ng === 1) {
      readCom(s2.doll, c2); readSupport(s2.doll, sp2);
      d2.mos.push(marginOfStability(c2.x, c2.vx, omegaAt(c2.y), sp2.cx + sp2.halfX, c2.z, c2.vz, sp2.cz + sp2.halfZ).x);
      wholeBodyAngularMomentum(s2.doll, c2, l2);
      d2.wb.push(Math.hypot(l2[0]!, l2[1]!, l2[2]!));
    }
  };
  const r2 = runCaptureTeacher(sk, s2, { ...FB, ...cfg.p }, { dur: DUR, clockDriven: true, onFrame: cb2 });
  const sw = [...d2.wb].sort((a, b) => a - b);
  const wm = sw.length ? sw[Math.floor(sw.length / 2)]! : 0;
  const mm = d2.mos.length ? d2.mos.reduce((a, b) => a + b, 0) / d2.mos.length : 0;
  console.log('  ' + cfg.n.padEnd(20) + r2.t.toFixed(2) + 's' + String(r2.steps).padStart(6)
    + (mm * 1000).toFixed(0).padStart(12) + 'mm' + wm.toFixed(2).padStart(12)
    + (d2.n ? (d2.dbl / d2.n * 100).toFixed(0) : '0').padStart(11) + '%');
}
console.log('');
console.log('  目标：|WBAM| 中位往 0.16（平衡基线）压、单支撑 MoS 往 0 收、双支撑占比往 60~70% 走');
console.log('  （文献：成人双支撑 20%、幼儿 30~40%；我们此前 82.7% ⇒ 此前根本不是"一次迈一个脚"）');

console.log('');
console.log(FAILS === 0 ? '★ gaitcycle 测量完成' : `★ gaitcycle 有 ${FAILS} 条 FAIL`);
void brainParamCount;
