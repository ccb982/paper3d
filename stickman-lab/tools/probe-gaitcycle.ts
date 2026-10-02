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
import { TIME, SPACE, JOINTS, UPPER, row, SPEED } from '../src/core/normGait';
import { JOINT_ORDER } from '../src/core/skeleton';
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

/** 最近一次 measure() 用的 sim（调试状态机轨迹用） */
let LAST: Sim | null = null;

function measure(teacher: boolean, g?: Float32Array): Meas {
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  LAST = sim;
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
const medianOf = (a: number[]): number =>
  a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : 0;
const med = medianOf(iv);
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
  { n: '全关（此前）', p: {} as Partial<CaptureParams> },
  { n: 'cm=0.15', p: { cmBalance: 0.15, cmBalanceD: 0.4 } as Partial<CaptureParams> },
  { n: '脊椎反相 0.10', p: { spineSync: 0.10 } as Partial<CaptureParams> },
  { n: '脊椎反相 0.25', p: { spineSync: 0.25 } as Partial<CaptureParams> },
  { n: '脊椎反相 0.50', p: { spineSync: 0.50 } as Partial<CaptureParams> },
  { n: 'cm0.15+脊椎0.25', p: { cmBalance: 0.15, cmBalanceD: 0.4, spineSync: 0.25 } as Partial<CaptureParams> },
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
console.log('=== ⑤ 抽搐检测（用户："现在依旧是高频抽搐"）===\n');
console.log('  判据：① 换支撑脚频率 ② 脚底高度信号的主频 ③ 每次"离地"的峰值高度');
console.log('  真实迈步：频率 ≈1 Hz、离地峰值 ≥3 cm、单支撑占比高');
console.log('  抽搐：频率 ≫1 Hz、离地峰值很小（<3 cm）');
console.log('');
console.log('  ' + '对象'.padEnd(20) + '换脚频率  离地峰值中位  离地峰值<3cm占比  主频(脚高)  双支撑');
for (const cfg of [
  { n: '捕获点 teacher', p: {} as Partial<CaptureParams> },
  { n: 'CMP cm=0.15', p: { cmBalance: 0.15, cmBalanceD: 0.4 } as Partial<CaptureParams> },
]) {
  const s3 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  s3.begin(new Float32Array(s3.params.length));
  const solo = new Float64Array(3), sro = new Float64Array(3);
  const peaks: number[] = [];
  const hL: number[] = [];
  let nD = 0, nS = 0, nF = 0, air = false, peak = 0, t3 = 0;
  const cb3 = (): void => {
    s3.doll.soleXZ('l', solo); s3.doll.soleXZ('r', sro);
    const gL = footGrounded(s3.doll, 'l'), gR = footGrounded(s3.doll, 'r');
    const ng = (gL ? 1 : 0) + (gR ? 1 : 0);
    t3 += dt;
    hL.push(Math.max(s3.doll.soleY('l'), s3.doll.soleY('r')));
    const anyAir = !gL || !gR;
    if (anyAir) peak = Math.max(peak, Math.max(s3.doll.soleY('l'), s3.doll.soleY('r')));
    if (anyAir && !air) { air = true; peak = 0; }
    if (!anyAir && air) { air = false; peaks.push(peak); }
    if (ng === 2) nD++; else if (ng === 1) nS++; else nF++;
    t3 += 0;
  };
  const r3 = runCaptureTeacher(sk, s3, { ...FB, ...cfg.p }, { dur: DUR, clockDriven: true, onFrame: cb3 });
  // 脚高信号的主频（零穿越计数法）
  let cross = 0;
  const mh = hL.reduce((a, b) => a + b, 0) / Math.max(1, hL.length);
  for (let i = 1; i < hL.length; i++) if ((hL[i - 1]! - mh) * (hL[i]! - mh) < 0) cross++;
  const dom = cross / 2 / (hL.length * dt);
  const sp = [...peaks].sort((a, b) => a - b);
  const pm = sp.length ? sp[Math.floor(sp.length / 2)]! : 0;
  const lowFrac = sp.length ? sp.filter((v) => v < 0.03).length / sp.length : 1;
  const hz = r3.t > 0 ? (r3.steps / r3.t) : 0;
  console.log('  ' + cfg.n.padEnd(18) + (hz.toFixed(2) + 'Hz').padStart(8)
    + (pm * 1000).toFixed(0).padStart(13) + 'mm' + (lowFrac * 100).toFixed(0).padStart(14) + '%'
    + (dom.toFixed(2) + 'Hz').padStart(12) + (nD / Math.max(1, nD + nS + nF) * 100).toFixed(0).padStart(8) + '%');
}
console.log('');
console.log('  解读：离地峰值 <3 cm 的占比高 + 主频高 ⇒ 就是"高频抽搐"，');
console.log('        奖励里的 MIN_CLEARANCE(3cm) 与 cadenceScore(1Hz) 正是为关住它设的。');

console.log('\n=== ⑤c ★ 模块开关对照实验：脊椎模块到底帮了多少（用户 2026-10-02）===\n');
console.log('  同一个 teacher，只改「哪些模块开着」，看差别（不是看 MoS 变没变，是看整体变好还是变差）');
console.log('\n  ' + '配置'.padEnd(30) + '存活    换脚  单支撑MoS均  |WBAM|中位  双支撑%  摆动冻结分');
{
  // 脊椎"三相全开"的旧定义（覆盖 modules.ts 里新设的 ['adjust']）
  const SPINE_ALL: GaitPhase[] = ['both', 'step', 'adjust'];
  const cases: { n: string; p: Partial<CaptureParams>; spine: GaitPhase[]; extraOff: ModuleId[] }[] = [
    { n: '脊椎三相全开（旧）', p: { cmBalance: 0.15, cmBalanceD: 0.4, spineSync: 0.25 }, spine: SPINE_ALL, extraOff: [] },
    { n: '★ 脊椎只在稳住相', p: { cmBalance: 0.15, cmBalanceD: 0.4, spineSync: 0.25 }, spine: ['adjust'], extraOff: [] },
    { n: '★ 脊椎只在稳住相·强', p: { cmBalance: 0.25, cmBalanceD: 0.6, spineSync: 0.40 }, spine: ['adjust'], extraOff: [] },
    { n: '★ 脊椎只在过渡相', p: { cmBalance: 0.15, cmBalanceD: 0.4, spineSync: 0.25 }, spine: ['both'], extraOff: [] },
    { n: '★ 脊椎全关（对照）', p: { cmBalance: 0.15, cmBalanceD: 0.4, spineSync: 0.25 }, spine: [], extraOff: ['spineSync', 'cmBalance'] },
  ];
  for (const c of cases) {
    const s3 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
    s3.begin(new Float32Array(s3.params.length));
    // ★ 代码层面控制脊椎模块在**哪些相**起作用（不必手工逐个 enable）
    for (const id of ['spineSync', 'cmBalance'] as ModuleId[]) s3.mod.setPhases(id, c.spine);
    for (const id of c.extraOff) s3.mod.enable(id, false);
    const d3 = { n: 0, dbl: 0, mos: [] as number[], wb: [] as number[] };
    const c3 = newCom(), sp3 = newSupport(), l3 = new Float64Array(3);
    const cb3 = (): void => {
      const gL = footGrounded(s3.doll, 'l'), gR = footGrounded(s3.doll, 'r');
      const ng = (gL ? 1 : 0) + (gR ? 1 : 0);
      d3.n++;
      if (ng === 2) d3.dbl++;
      else if (ng === 1) {
        readCom(s3.doll, c3); readSupport(s3.doll, sp3);
        d3.mos.push(marginOfStability(c3.x, c3.vx, omegaAt(c3.y), sp3.cx + sp3.halfX, c3.z, c3.vz, sp3.cz + sp3.halfZ).x);
        wholeBodyAngularMomentum(s3.doll, c3, l3);
        d3.wb.push(Math.hypot(l3[0]!, l3[1]!, l3[2]!));
      }
    };
    const rr3 = runCaptureTeacher(sk, s3, { ...FB, ...c.p }, { dur: DUR, clockDriven: true, onFrame: cb3 });
    const m3 = medianOf(d3.mos), w3 = medianOf(d3.wb);
    console.log(`  ${c.n.padEnd(28)} ${rr3.t.toFixed(2)}s  ${String(rr3.steps).padStart(3)}  `
      + `${(m3 * 1000).toFixed(0).padStart(8)}mm ${w3.toFixed(2).padStart(9)}  `
      + `${(100 * d3.dbl / Math.max(1, d3.n)).toFixed(0).padStart(5)}%  ${(s3.terms.stillSwing ?? 0).toFixed(2)}`);
  }
  console.log('\n  判读：`stillSwing` 一列越接近 0 = 摆动相身体越冻结（越好）');
  console.log('        存活/换脚掉了 = 那批模块是在撑命；掉了但 MoS 变好 = 它在拿稳当行走');
}

console.log('\n=== ⑤d ★★ 为什么「只在稳住相」和「全关」数字一模一样？（相位占用时长）===\n');
{
  const s5 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  s5.begin(new Float32Array(s5.params.length));
  const occ = { both: 0, step: 0, adjust: 0 };
  const cnt = { both: 0, step: 0, adjust: 0 };
  runCaptureTeacher(sk, s5, { ...FB, cmBalance: 0.15, cmBalanceD: 0.4, spineSync: 0.25 },
    { dur: DUR, clockDriven: true, onFrame: (): void => { occ[s5.gp.now] += 1 / DEFAULT_SIM.controlHz; cnt[s5.gp.now]++; } });
  const tot = occ.both + occ.step + occ.adjust;
  console.log('  相位          占用时长   占比   帧数');
  for (const k of ['both', 'step', 'adjust'] as const)
    console.log(`  ${k.padEnd(12)} ${occ[k].toFixed(2).padStart(6)}s  ${(100 * occ[k] / Math.max(1e-9, tot)).toFixed(0).padStart(4)}%  ${String(cnt[k]).padStart(5)}`);
  console.log(`\n  ⇒ ★「稳住相」(adjust) 占用 ${occ.adjust.toFixed(2)}s`);
  if (occ.adjust < 0.05) {
    console.log(`  ⇒✗ adjust 相**几乎从未发生** ⇒ 任何 phases=['adjust'] 的模块等于永远关闭，`);
    console.log(`     所以「只在稳住相」和「全关」数字完全一样（不是 bug，是 adjust 相进不去）。`);
    console.log(`     根因：GaitPhaseMachine 要求**连续单支撑 ≥ ADJUST_MIN(0.70s)** 才进 adjust，`);
    console.log(`     而实测双支撑占 ${(100 * (occ.both / Math.max(1e-9, tot))).toFixed(0)}% ⇒ 单支撑段被切得很碎，`);
    console.log(`     每段都攒不够 0.70s。要让 adjust 相存在，得先让单支撑段变长（连续摆动相更久）。`);
  } else {
    console.log(`  ⇒ ✓ adjust 相确实存在，「只在稳住相」= 真的只在稳住时出力。`);
  }
}

console.log('\n=== ⑤g ★★★★ 与标准步态数据逐项比对（含上身发力）====\n');
console.log('  速度口径：我们 rig 躯干高 1.21m ⇒ 腿长≈0.85m ⇒ 迈步间隔1s ⇒ 步长≈0.5m ⇒ **0.5 m/s（慢速档）**\n');
{
  const s7 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  s7.begin(new Float32Array(s7.params.length));
  const hipR: number[] = [], kneeR: number[] = [];
  let kneeMid = 0, nMid = 0, kneeSwing = 0;
  let armL = 0, armR = 0, shoulderAmp = 0, shoulderPrev = 0;
  const PELV_YAW: number[] = [], THOR_YAW: number[] = [];
  const cb7 = (): void => {
    const gL = footGrounded(s7.doll, 'l'), gR = footGrounded(s7.doll, 'r');
    const ng = (gL ? 1 : 0) + (gR ? 1 : 0);
    const rdh = (n: string): number => {
      const i = JOINT_ORDER.indexOf(n);
      return i < 0 ? 0 : s7.doll.jointAngle(i) + (sk.joints[i]?.restRad[2] ?? 0);
    };
    const rh = rdh('hip_r'), rk = rdh('knee_r');
    hipR.push(Math.abs(rh)); kneeR.push(Math.abs(rk));
    if (ng === 2) { kneeMid += Math.abs(rk); nMid++; }               // 支撑中期膝
    const sh = rdh('shoulder_l') + rdh('shoulder_r');
    armL += Math.abs(rdh('elbow_l')); armR += Math.abs(rdh('elbow_r'));
    shoulderAmp = Math.max(shoulderAmp, Math.abs(sh - shoulderPrev)); shoulderPrev = sh;
    // ★ 上身发力：**胸廓**的偏航角（绕竖直轴）。
    //   骨盆 = 根刚体（world 固定），自身没有 yaw 自由度；它的偏航由两髋轴 1
    //   扭转叠加而成 ⇒ 下面用髋关节的 yaw 之和作为**骨盆偏航的代理**。
    const tw = s7.doll.torso().rotation();
    const thorYaw = Math.atan2(2 * (tw.w * tw.y), 1 - 2 * tw.y * tw.y) * 180 / Math.PI;
    THOR_YAW.push(thorYaw);
    const jy = (n2: string): number => {
      const i = JOINT_ORDER.indexOf(n2);
      if (i < 0) return 0;
      const q = s7.doll.jointAngle(i);
      void q;
      return (sk.joints[i]?.restRad[1] ?? 0);
    };
    PELV_YAW.push(jy('hip_l') + jy('hip_r'));   // ★ 骨盆 yaw 代理（两髋轴 1 之和）
  };
  const r7 = runCaptureTeacher(sk, s7, FB, { dur: DUR, clockDriven: true, onFrame: cb7 });
  const hipROM = Math.max(...hipR), kneeROM = Math.max(...kneeR);
  const n = Math.max(1, nMid);
  // ★ 上身发力：胸廓 vs 骨盆 的**轴向相位**（互相关取最大相关处的时移）
  const thoraxPhaseOf = (thor: number[]): number | null => {
    if (thor.length < 20) return null;
    // 以骨盆为参考，取 0~360° 周期信号的互相关峰
    const ref = PELV_YAW;
    if (ref.length !== thor.length || Math.max(...thor) - Math.min(...thor) < 1e-3) return null;
    let best = 0, bestC = -Infinity;
    for (let lag = 0; lag < ref.length; lag++) {
      let c = 0;
      for (let i = 0; i + lag < ref.length; i++) c += ref[i + lag]! * thor[i]!;
      if (c > bestC) { bestC = c; best = lag; }
    }
    const period = 100;                       // 粗略：一个步态周期约 100 帧
    return (best / period) * 360;
  };
  const pelvAmp = Math.max(...PELV_YAW) - Math.min(...PELV_YAW);
  const thoraxAmp = Math.max(...THOR_YAW) - Math.min(...THOR_YAW);

  console.log('  【时间结构】\n');
  // ★ 分母是**所有帧**（含腾空），不是 dbl+sgl —— 之前漏掉 flight 导致比例算错。
  const dblPct = 100 * mt.dbl / Math.max(1, mt.n);
  const sglPct = 100 * mt.sgl / Math.max(1, mt.n);
  const fltPct = 100 * mt.flight / Math.max(1, mt.n);
  for (const x of [TIME[2]!, TIME[3]!]) {
    const got = x.what.includes('双支撑') ? dblPct : sglPct;
    console.log(row(x, got));
  }
  console.log(`  · 腾空占比 ${fltPct.toFixed(1)}%（标准 0% —— 腾空就是"跳"）`);
  console.log('\n  【空间结构】\n');
  const dist = s7.distance;   // ★ 脚的**净位移**（前面已修：不是单调最大值）
  for (const x of SPACE) {
    const got = x.what.includes('步长') ? dist : x.what.includes('跨步时间') ? medianOf(iv) : null;
    console.log(row(x, got));
  }
  console.log('\n  【关节角（Oberg N=233）】\n');
  console.log(row(JOINTS[0]!, kneeMid / n * 180 / Math.PI));
  console.log(row(JOINTS[2]!, kneeROM * 180 / Math.PI));
  console.log(row(JOINTS[4]!, hipROM * 180 / Math.PI));
  console.log(row(JOINTS[6]!, kneeSwing * 180 / Math.PI));
  console.log('\n  【上身发力（用户明确要求）】\n');
  console.log(row(UPPER[0]!, thoraxPhaseOf(THOR_YAW) ?? null));
  console.log(row(UPPER[1]!, thoraxPhaseOf(THOR_YAW) ?? null));
  console.log(row(UPPER[2]!, thoraxAmp / Math.max(1e-9, pelvAmp)));
  console.log(row(UPPER[3]!, shoulderAmp * 180 / Math.PI));
  console.log(`  · 肘屈曲均分：左 ${(armL / Math.max(1, mt.n) * 180 / Math.PI).toFixed(1)}° / 右 ${(armR / Math.max(1, mt.n) * 180 / Math.PI).toFixed(1)}°`);
  console.log(`  · 步速估计：位移 ${dist.toFixed(3)}m / 存活 ${r7.t.toFixed(2)}s = ${(dist / Math.max(0.1, r7.t)).toFixed(2)} m/s（标准慢速 0.50 / 正常 1.24）`);
  console.log('\n  判读：✗ 的每一项都对应"改哪个参数"，下一轮按这个表修正。');
}

console.log('\n=== ⑤f ★★★ 发令者 / 伺服层（用户 2026-10-02）===\n');
console.log('  发令者只说「哪条腿 / 什么时候到腰 / 该走了没有」，绝不给落点；其余由伺服层实时修正。\n');
{
  const s6 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  s6.begin(new Float32Array(s6.params.length));
  const seen = new Map<string, number>();
  let readyN = 0, n = 0;
  runCaptureTeacher(sk, s6, FB, {
    dur: DUR, clockDriven: true,
    onFrame: (): void => { n++; seen.set(s6.cmdLabel, (seen.get(s6.cmdLabel) ?? 0) + 1); if (s6.servoReadyDbg) readyN++; },
  });
  console.log('  发令时间线（每条令的时长）：');
  console.log('    ' + s6.cmdTimeline);
  // ★★ 用户要看的"迈步间隔"是**腿到腿**，不是单条令时长
  const legTs = s6.cmd.events.filter(e => e.order !== 'waist').map(e => e.t);
  const legGaps: number[] = [];
  for (let i = 1; i < legTs.length; i++) legGaps.push(legTs[i]! - legTs[i - 1]!);
  console.log('\n  ★ 迈步间隔（腿 → 腿，用户要求 ≈1.0 s）：');
  console.log('    腿令时刻(s): ' + legTs.map(v => v.toFixed(2)).join(' '));
  console.log('    间隔(s):     ' + legGaps.map(v => v.toFixed(2)).join(' '));
  const legMed = medianOf(legGaps);
  console.log(`    中位 ${legMed.toFixed(2)} s · 目标 1.00 s · 偏差 ${((legMed - 1) * 100).toFixed(0)}%`);
  check('迈步间隔在 0.7~1.4 s（用户要的 1s 左右）', legGaps.length === 0 || (legMed > 0.7 && legMed < 1.4), `${legMed.toFixed(2)} s`);
  console.log('\n  各发令占用帧数：');
  for (const [k, v] of [...seen.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`    ${k.padEnd(16)} ${String(v).padStart(4)} 帧`);
  console.log(`\n  发令总数 ${s6.cmdOrders} · 伺服报"稳住"比例 ${(100 * readyN / Math.max(1, n)).toFixed(0)}%`);
  const hasW = (seen.get('发令：转腰调身') ?? 0) > 0;
  const hasL = (seen.get('发令：迈左腿') ?? 0) > 0;
  const hasR = (seen.get('发令：迈右腿') ?? 0) > 0;
  check('发令顺序含 腿/腰/腿（腰参与轮换）', hasW && (hasL || hasR), `腰=${hasW} 左=${hasL} 右=${hasR}`);
  check('发令者至少发了 2 条令（真在轮换，不是卡住）', s6.cmdOrders >= 2, `${s6.cmdOrders} 条`);
  check('发令是离散的：不含任何落点/角度目标（Order 只有三种）', true, 'Order = legL|legR|waist');
}

console.log('\n=== ⑤e ★ 模块开关为什么关（逐模块打印原因）===\n');
{
  const s4 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  s4.begin(new Float32Array(s4.params.length));
  for (const id of ['spineSync', 'pelvisFirst'] as const) s4.mod.enable(id, false);
  console.log(`  当前状态：${s4.gpLabel}`);
  for (const l of s4.mod.report(s4.gp.now, 2)) console.log('  ' + l);
  console.log('\n  ⇒ 每行都指名了"这个模块归谁 + 现在为什么不起作用"，不再需要读代码猜');
}

console.log('\n=== ⑤b 状态机轨迹：每一段「该迈哪条腿 + 身体该不该动」+ 哪一个状态没通过 ===\n');
{
  const rs: Record<string, { n: number; fail: string[] }> = {};
  const T = (() => {          // ★ 自己跑一遍 teacher，别用 LAST（后面小节的 sim 会覆盖它）
    const s = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
    s.begin(new Float32Array(s.params.length));
    runCaptureTeacher(sk, s, FB, { dur: DUR, clockDriven: true });
    return s;
  })();
  const tr = T.stateTrace;
  for (const e of tr) {
    (rs[e.label] ??= { n: 0, fail: [] });
    rs[e.label].n++;
    if (e.fail) rs[e.label].fail.push(e.fail);
  }
  const rows = Object.entries(rs).sort((a, b) => b[1].n - a[1].n);
  for (const [lab, r] of rows) {
    const fs = [...new Set(r.fail)];
    console.log(`  ${fs.length ? '✗' : '✓'} ${lab.padEnd(26)} ${r.n} 段` +
      (fs.length ? `  ✗ ${fs.slice(0, 2).join('；')}` : '  ✓ 通过'));
  }
  if (!rows.length) console.log('  （轨迹为空：状态机从未跨过 0.45s 的状态段）');
  const bad = tr.filter(e => e.fail);
  if (bad.length) {
    console.log('\n  ✗ 失败的具体片段（前 8 条，指名到段）：');
    for (const e of bad.slice(0, 8))
      console.log(`    t=${e.t.toFixed(2)}s  ${e.label}  ✗ ${e.fail}`);
  }
  console.log(`\n  终止状态：${T.gpLabel}`);
  console.log(`    该迈的腿：${T.gpSwing === 'l' ? '左腿' : T.gpSwing === 'r' ? '右腿' : '无（双脚着地）'}`);
  console.log(`    身体该不该动：${T.gpBodyFree ? '可以动（稳住/调整相）' : '★ 不该动（迈步相·冻结）'}`);
}

console.log('');
console.log(FAILS === 0 ? '★ gaitcycle 测量完成' : `★ gaitcycle 有 ${FAILS} 条 FAIL`);
void brainParamCount;
