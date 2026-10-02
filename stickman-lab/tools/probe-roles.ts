// ═══════════════════════════════════════════════════════════════════════
//  ★ 阶段 × 角色 跟踪误差回读（用户 2026-10-02）
//  "让角色移动姿态符合各个阶段的参数" ⇒ 先把每格的实测 vs 文献目标打出来
// ═══════════════════════════════════════════════════════════════════════
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { runCaptureTeacher, type CaptureParams } from '../src/core/teacher';
import { CAPTURE_GAIT } from '../src/core/phaseSeed';
import { PHASE_ROLE, cell, cellDesc, type Role } from '../src/core/normGait';
import { footGrounded } from '../src/core/posture';

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
const check = (n: string, ok: boolean, got: string): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n.padEnd(40)} ${got}`);
  if (!ok) FAILS++;
};

const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
const DUR = 8;
const FB: CaptureParams = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau, kLat: 2.0, kLatV: 0.6, kLatSwing: 0.10, stancePush: 0.18, ankleSwing: 12, anklePush: 15, ankleStance: 0,
  stanceLock: 0.6,
};

console.log('=== 阶段 × 角色 姿态指令表（目标全部来自文献）===\n');
for (const ph of ['both', 'step', 'adjust'] as const)
  for (const role of ['swingLeg', 'stanceLeg', 'waist'] as Role[])
    console.log('  ' + cellDesc(ph, role));

console.log('\n=== 实测跟踪误差（每格：相 × 角色）===\n');
const acc: Record<string, { hip: number[]; knee: number[]; n: number }> = {};
{
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  sim.begin(new Float32Array(sim.params.length));
  const cb = (_t: number, stanceL: boolean): void => {
    const key = `${sim.gp.now}`;
    (acc[key] ??= { hip: [], knee: [], n: 0 }).n++;
    const rdh = (nm: string): number => {
      const i = JOINT_ORDER.indexOf(nm);
      if (i < 0) return 0;
      const v = sim.doll.jointAngle(i) + (sk.joints[i]?.restRad[2] ?? 0);
      return Number.isFinite(v) ? v : 0;
    };
    const a = acc[key]!;
    a.hip.push(Math.abs(rdh(stanceL ? 'hip_l' : 'hip_r')));
    a.knee.push(Math.abs(rdh(stanceL ? 'knee_l' : 'knee_r')));
  };
  runCaptureTeacher(sk, sim, FB, { dur: DUR, clockDriven: true, onFrame: cb });
  console.log('  相位   支撑脚数  支撑髋ROM  支撑膝ROM   指令表要求（stanceLeg）');
  for (const ph of ['both', 'step', 'adjust'] as const) {
    const a = acc[ph];
    const c = cell(ph, 'stanceLeg');
    const hd = a && a.hip.length ? (Math.max(...a.hip) - Math.min(...a.hip)) * 180 / Math.PI : null;
    const kd = a && a.knee.length ? (Math.max(...a.knee) - Math.min(...a.knee)) * 180 / Math.PI : null;
    console.log(`  ${ph.padEnd(7)} ${String(a?.n ?? 0).padStart(6)}  ${hd === null ? '   ——  ' : hd.toFixed(1).padStart(7) + '°'}`
      + `  ${kd === null ? '   ——  ' : kd.toFixed(1).padStart(7) + '°'}`
      + `   ${c ? `髋 ${c.hipDeg}° / 膝 ${c.kneeDeg}°  w=${c.w}` : '本相不设目标'}`);
  }
  const tot = Object.values(acc).reduce((a, b) => a + b.n, 0);
  console.log(`\n  相位占用：${Object.entries(acc).map(([k, v]) => `${k} ${(100 * v.n / tot).toFixed(0)}%`).join(' · ')}`);
  check('调整相（adjust）有帧占用', (acc.adjust?.n ?? 0) > 0, `${acc.adjust?.n ?? 0} 帧`);
}
console.log(`\n${FAILS === 0 ? '★ 角色回读完成' : `★ 角色回读完成，${FAILS} 项未达标`}`);

// ═══════ 调整相为什么进不去：单支撑段长度 vs 需求 ═══════
console.log('\n=== 单支撑段长度 vs 「迈步→调整」所需时间 ===\n');
{
  const sim2 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  sim2.begin(new Float32Array(sim2.params.length));
  const segs: number[] = [];
  let cur = 0;
  runCaptureTeacher(sk, sim2, FB, { dur: DUR, clockDriven: true, onFrame: (): void => {
    if (sim2.gp.now === 'step') cur += 1 / DEFAULT_SIM.controlHz;
    else if (cur > 0) { segs.push(cur); cur = 0; }
  } });
  if (cur > 0) segs.push(cur);
  segs.sort((a, b) => a - b);
  const med = segs.length ? segs[Math.floor(segs.length / 2)]! : 0;
  const mx = segs.length ? segs[segs.length - 1]! : 0;
  console.log(`  单支撑段数 ${segs.length} · 长度(s): ${segs.map(v => v.toFixed(2)).join(' ')}`);
  console.log(`  中位 ${med.toFixed(2)}s · 最长 ${mx.toFixed(2)}s`);
  console.log(`\n  需求：STEP_MIN(迈步) 0.28s + ADJUST_MIN(调整) 0.70s = **0.98s 连续单支撑**`);
  console.log(`  最长单支撑段 ${mx.toFixed(2)}s ⇒ 差 ${(0.98 - mx).toFixed(2)}s`);
  console.log(`  发令迈步间隔 1.00s ⇒ 一个周期里留给调整的余量 = 1.00 − 0.28 = 0.72s ≈ ADJUST_MIN 0.70s`);
  console.log(`  ⇒ **余量只有 0.02s**：单支撑段必须连续满 0.98s 才行，而实测最长只有 ${mx.toFixed(2)}s。`);
  console.log(`\n  ★ 结论：不是"没做调整"，是**时间预算不够**。三个数必须同时改：`);
  console.log(`      STEP_MIN ↓（0.28→0.20）/ ADJUST_MIN ↓（0.70→0.40）或 发令间隔 ↑（1.0→1.3s）`);
  check('最长单支撑段 ≥ STEP_MIN + ADJUST_MIN', mx >= 0.98, `${mx.toFixed(2)}s / 需要 0.98s`);
}

// ═══════ 迈步为什么完不成？离地高度够不够 3cm ═══════
console.log('\n=== 迈步相的离地高度（MIN_CLEARANCE = 3cm 的门）===\n');
{
  const sim3 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  sim3.begin(new Float32Array(sim3.params.length));
  const peaks: number[] = []; let cur = 0, tracking = false;
  runCaptureTeacher(sk, sim3, FB, { dur: DUR, clockDriven: true, onFrame: (): void => {
    const gL = footGrounded(sim3.doll, 'l'), gR = footGrounded(sim3.doll, 'r');
    const nG = (gL ? 1 : 0) + (gR ? 1 : 0);
    const air = Math.max(sim3.doll.soleY('l'), sim3.doll.soleY('r'));
    if (nG === 1) { tracking = true; cur = Math.max(cur, air); }
    else if (tracking) { if (cur > 0.001) peaks.push(cur); cur = 0; tracking = false; }
  } });
  peaks.sort((a, b) => a - b);
  const mx = peaks.length ? peaks[peaks.length - 1]! : 0;
  const md = peaks.length ? peaks[Math.floor(peaks.length / 2)]! : 0;
  console.log(`  单支撑事件 ${peaks.length} 次 · 离地峰值(m): ${peaks.map(v => (v * 1000).toFixed(0)).join(' ')}`);
  console.log(`  中位 ${(md * 1000).toFixed(0)}mm · 最��� ${(mx * 1000).toFixed(0)}mm · 门槛 MIN_CLEARANCE = 30mm`);
  const ok = peaks.filter(v => v >= 0.03).length;
  console.log(`  达标(≥30mm)的次数：${ok} / ${peaks.length}`);
  console.log("  21d2 82e58fbe680765704e3a 0Ff0c7b2c4e00905395e8Ff0879bb57303cmFf095c318fc74e0d53bbFf0cadjust 76f86c388fdc8fdb4e0d67653002");
  check('至少有 1 次离地达标（≥30mm）', ok > 0, `${ok}/${peaks.length}，最高 ${(mx * 1000).toFixed(0)}mm`);
}

// ═══════ 落地后支撑腿撑不撑得住：触地瞬间的膝/髋 ═══════
console.log('\n=== 落地瞬间支撑腿姿态（Oberg：初始接触膝屈 ~15°）===\n');
{
  const s4 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  s4.begin(new Float32Array(s4.params.length));
  const rows: string[] = [];
  let wasAir = false, k0 = 0, h0 = 0;
  runCaptureTeacher(sk, s4, FB, { dur: DUR, clockDriven: true, onFrame: (): void => {
    const gL = footGrounded(s4.doll, 'l'), gR = footGrounded(s4.doll, 'r');
    const nG = (gL ? 1 : 0) + (gR ? 1 : 0);
    const air = Math.max(s4.doll.soleY('l'), s4.doll.soleY('r'));
    const rdh = (nm: string): number => { const i = JOINT_ORDER.indexOf(nm);
      return i < 0 ? 0 : (Number.isFinite(s4.doll.jointAngle(i)) ? s4.doll.jointAngle(i) : 0); };
    if (nG === 1 && air > 0.03) wasAir = true;
    else if (wasAir && nG === 2) {
      wasAir = false;
      const k = Math.min(Math.abs(rdh('knee_l')), Math.abs(rdh('knee_r'))) * 180 / Math.PI;
      const h = Math.min(Math.abs(rdh('hip_l')), Math.abs(rdh('hip_r'))) * 180 / Math.PI;
      k0 += k; h0 += h;
      rows.push(`  触地: 支撑膝 ${k.toFixed(1).padStart(6)}°  支撑髋 ${h.toFixed(1).padStart(6)}°`);
    }
  } });
  rows.slice(0, 8).forEach(r => console.log(r));
  if (k0 > 0) {
    console.log(`\n  触地瞬间膝屈均值 ${(k0 / rows.length).toFixed(1)}°（文献 ~15°，上限 ABSORB_MAX=20°）`);
    check('触地瞬间支撑膝屈 ≤ 25°（没被压塌）', k0 / rows.length <= 25, `${(k0 / rows.length).toFixed(1)}°`);
  }
}

// ═══════ 迈出的腿落地后，真的在承重吗？（指令与实际接触是否一致）
console.log('\n=== 落地腿是否真的成为支撑腿（指令 stanceL vs 实际承重）===\n');
{
  const s5 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  s5.begin(new Float32Array(s5.params.length));
  const dl = new Float64Array(2);
  let n = 0, cmdL = 0, agree = 0, disagree = 0;
  const seq: string[] = [];
  runCaptureTeacher(sk, s5, FB, {
    dur: DUR, clockDriven: true,
    onFrame: (_t: number, stanceL: boolean): void => {
      const gL = footGrounded(s5.doll, 'l'), gR = footGrounded(s5.doll, 'r');
      const nG = (gL ? 1 : 0) + (gR ? 1 : 0);
      if (nG !== 1) { const [fl0, fr0] = s5.doll.footLoadFrac(1 / DEFAULT_SIM.controlHz);
        dl[0] = fl0; dl[1] = fr0; return; }
      n++;
      s5.doll.footLoadFrac(1 / DEFAULT_SIM.controlHz);
      const fL = dl[0]!, fR = dl[1]!;
      const realStanceL = fL > fR;             // 实际承重多的那条腿
      if (realStanceL === stanceL) agree++; else disagree++;
      if (stanceL) cmdL++;
      if (seq.length < 24) seq.push(`${stanceL ? 'L' : 'R'}${realStanceL === stanceL ? '✓' : '✗'}`);
    },
  });
  console.log(`  单支撑帧 ${n}：指令支撑腿 = 左 ${cmdL} / 右 ${n - cmdL}`);
  console.log(`  指令与实际承重一致 ${agree} / 不一致 ${disagree}  → 一致率 ${(100 * agree / Math.max(1, n)).toFixed(0)}%`);
  console.log(`  序列（指令腿+是否匹配）: ${seq.join(' ')}`);
  check('指令支撑腿与实际承重腿一致率 ≥80%', agree / Math.max(1, n) >= 0.8, `${(100 * agree / Math.max(1, n)).toFixed(0)}%`);
}
