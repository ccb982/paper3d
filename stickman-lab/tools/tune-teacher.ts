// ═══════════════════════════════════════════════════════════════════════
//  ★ 教师控制器参数寻优 —— 目标函数 = 与标准步态数据的差距（2026-10-02）
// ═══════════════════════════════════════════════════════════════════════
//  用户："调算法优化数据啊"（不要只报偏差，要真的把数据调上去）
//
//  目标函数（全部来自 src/core/normGait.ts 的文献标准）：
//    ① 双支撑占比 → 慢速档 17%（实测 82.7%，+819%）  ★ 权重最高
//    ② 单支撑占比 → 41%（实测 17.3%）
//    ③ 脚净位移   → **正**且 ≈0.35m（实测 −0.118 m，后退）
//    ④ 跨步时间   → 1.02 s
//    ⑤ 膝 midstance → 15.7° / 膝摆动峰 → 63° / 髋 ROM → 46.9°
//    ⑥ 上身：肩摆动峰 → ~20°（慢速档，标准快走 ~30°）
//    ⑦ 腾空 → 0%
//
//  方法：坐标下降（每轮扫一个参数的网格，取最优），可复现（确定性 LCG）。
// ═══════════════════════════════════════════════════════════════════════

// ★ rapier 的 WASM 必须手动实例化（与其它探针同一套引导代码）
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { footGrounded } from '../src/core/posture';
import { CAPTURE_DEFAULT, runCaptureTeacher, type CaptureParams } from '../src/core/teacher';
import { CAPTURE_GAIT } from '../src/core/phaseSeed';
import { SPACE, SPEED } from '../src/core/normGait';

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

const tmpX = new Float64Array(2);
let FAILS = 0;
const check = (name: string, ok: boolean, got: string): void => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} ${got}`);
  if (!ok) FAILS++;
};

const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
const DUR = 6;
// ★ 必须显式给全所有字段（与 probe-gaitcycle 的 FB 一致）：
//   漏掉 kLat/kLatV/kLatSwing/absorbTau 会让 teacher 的下肢伺服全部失效（实测角度全 0）。
/** // ★ 参数来自 core/teacher.ts 的 CAPTURE_DEFAULT（唯一真源）。
//   此前每个探针各内联一份 FB，实测互不相同：probe-capture 的 kLat=0（侧向全关）
//   与 probe-arch 的 kLat=3.5 是两个不同的控制器，却一直被当成同一个在比。
 */
const FB: CaptureParams = CAPTURE_DEFAULT;

interface M {
  t: number; n: number; dbl: number; sgl: number; flight: number;
  dist: number; stepLen: number; stepGap: number;
  kneeMid: number; kneeMax: number; hipMax: number; shMax: number;
  mosSgl: number; fell: boolean;
}

function median(a: number[]): number {
  return a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : 0;
}

function run(p: CaptureParams): M {
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  sim.begin(new Float32Array(sim.params.length));
  let n = 0, dbl = 0, sgl = 0, flt = 0, nMid = 0, kneeMid = 0, mosAcc = 0, nMos = 0;
  const knee: number[] = [], hip: number[] = [], sh: number[] = [], gaps: number[] = [];
  let shPrev = 0, lastT = -1, gL = false, gR = false;
  const cb = (tt0: number): void => {
    const a = footGrounded(sim.doll, 'l'), b = footGrounded(sim.doll, 'r');
    const ng = (a ? 1 : 0) + (b ? 1 : 0);
    n++;
    if (ng === 2) dbl++; else if (ng === 1) sgl++; else flt++;
    // 触地（刚离地→刚着地）记一步
    const g = a ? gL : b ? gR : null;
    if (g !== null && !g) {
      const tt = tt0;
      if (lastT > 0) gaps.push(tt - lastT);
      lastT = tt;
    }
    gL = a; gR = b;
    const rdh = (nm: string): number => {
      const i = JOINT_ORDER.indexOf(nm);
      if (i < 0) return 0;
      const v = sim.doll.jointAngle(i) + (sk.joints[i]?.restRad[2] ?? 0);
      return Number.isFinite(v) ? v : 0;      // ★ 过滤 NaN，否则 max/mean 整体变 NaN
    };
    const rk = Math.abs(rdh('knee_r')), rh = Math.abs(rdh('hip_r'));
    knee.push(rk); hip.push(rh);
    if (ng === 2) { kneeMid += rk; nMid++; }
    const shv = rdh('shoulder_l') + rdh('shoulder_r');
    sh.push(Math.abs(shv - shPrev)); shPrev = shv;
    if (ng === 1) { mosAcc += sim.lastMosX; nMos++; }
  };
  const r = runCaptureTeacher(sk, sim, p, { dur: DUR, clockDriven: true, onFrame: cb });
  return {
    t: r.t, n, dbl, sgl, flight: flt, dist: Math.abs(sim.distance),
    stepLen: Math.abs(sim.distance) / Math.max(1, gaps.length),
    stepGap: median(gaps),
    kneeMid: nMid ? kneeMid / nMid * 180 / Math.PI : 0,
    kneeMax: Math.max(...knee) * 180 / Math.PI,
    hipMax: Math.max(...hip) * 180 / Math.PI,
    shMax: Math.max(...sh) * 180 / Math.PI,
    mosSgl: nMos ? mosAcc / nMos : 0, fell: sim.fallen,
  };
}

/** ★ 目标函数：偏离标准越远扣得越多（全部对照 normGait 的文献值） */
function cost(m: M): number {
  const dblP = 100 * m.dbl / Math.max(1, m.n), sglP = 100 * m.sgl / Math.max(1, m.n);
  // ① 双支撑 → 慢速 17%（权重最高，这是"走不起来"的根因）
  let c = 4.0 * (dblP - 17) / 17;
  // ② 单支撑 → 41%
  c += 2.0 * (sglP - 41) / 41;
  // ③ 脚净位移必须为**正**且接近 0.35 m（否则直接重罚）
  if (m.dist < 0.05) c += 6.0 * (0.05 - m.dist) / 0.05;
  else c += 1.0 * (m.dist - 0.35) / 0.35;
  // ④ 跨步时间 → 1.02 s
  if (m.stepGap > 0) c += 1.5 * (m.stepGap - 1.02) / 1.02;
  else c += 2.0;                                   // 没测到触地间隔 = 没换脚
  // ⑤ 关节角（膝 midstance 与摆动峰**都**要看，不能只看一个）
  c += 1.5 * (m.kneeMid - 15.7) / 15.7 + 0.8 * (m.kneeMax - 63) / 63 + 0.8 * (m.hipMax - 46.9) / 46.9;
  // ⑥ 上身肩摆动 → 20°（慢速档）
  c += 2.0 * (m.shMax - 20) / 20;
  // ⑦ 腾空 = 跳，重罚
  c += 10.0 * (100 * m.flight / Math.max(1, m.n)) / 5;
  // ★ 摔倒罚必须**压得住**（之前 +3 太小，寻优宁可摔也不换脚）
  if (m.fell) c += 12;
  return c;
}

/** 可调参数及其网格 */
const AXES: { k: keyof CaptureParams; grid: number[] }[] = [
  { k: 'T', grid: [2.6, 2.3, 2.0, 1.89, 1.7, 1.5] },
  { k: 'vDes', grid: [0.15, 0.22, 0.30, 0.39, 0.50, 0.62] },
  { k: 'lift', grid: [0.06, 0.10, 0.15, 0.20, 0.26] },
  { k: 'thresh', grid: [0.02, 0.045, 0.0673, 0.10, 0.15, 0.22] },
  { k: 'absorb', grid: [0.0, 0.2, 0.4, 0.7, 1.0] },
  { k: 'kv', grid: [0.0, 0.15, 0.3283, 0.55, 0.85] },
  { k: 'kPitch', grid: [-3.0, -1.6, -0.8, -0.4, 0, 0.8, 1.6, 2.544, 3.6] },
  { k: 'kRate', grid: [0.0, 0.25, 0.542, 0.9, 1.4] },
];

const fmt = (m: M): string =>
  `双支撑 ${(100 * m.dbl / Math.max(1, m.n)).toFixed(0).padStart(2)}% 单支撑 ${(100 * m.sgl / Math.max(1, m.n)).toFixed(0).padStart(2)}%`
  + ` 位移 ${m.dist.toFixed(3)}m 步长 ${m.stepLen.toFixed(3)}m 间隔 ${m.stepGap.toFixed(2)}s`
  + ` 膝 ${m.kneeMid.toFixed(0)}/${m.kneeMax.toFixed(0)}° 髋 ${m.hipMax.toFixed(0)}° 肩 ${m.shMax.toFixed(0)}°`;

console.log('=== 教师控制器参数寻优（目标函数 = 与标准步态数据的差距）===\n');
let best: CaptureParams = { ...FB };
let bc = cost(run(best));
const b0 = run(best);
console.log(`  起点 cost=${bc.toFixed(3)}`);
console.log(`    帧数 n=${b0.n} 存活性=${b0.fell} 存活=${b0.t.toFixed(2)}s  · ${fmt(b0)}\n`);
if (b0.n === 0) console.log('  ⚠ onFrame 一次都没被调用 ⇒ 控制器根本没驱动，检查 runCaptureTeacher 的调用方式\n');
console.log(`  参考标准：双支撑 17% / 单支撑 41% / 步长 ${SPACE[1]!.v}m / 跨步 ${SPACE[3]!.v}s`
  + ` / 膝 15.7°·63° / 髋 46.9° / 肩 ~20° / 腾空 0%\n`);

let stall = 0;
for (let round = 0; round < 4 && stall < 2; round++) {
  let improved = false;
  for (const ax of AXES) {
    for (const v of ax.grid) {
      const cand: CaptureParams = { ...best, [ax.k]: v };
      const m = run(cand);
      const c = cost(m);
      if (c < bc - 1e-3) {
        bc = c; best = cand; improved = true;
        console.log(`  r${round} ${String(ax.k).padEnd(7)}=${String(v).padEnd(6)} cost=${c.toFixed(3)}  ${fmt(m)}`);
      }
    }
  }
  if (improved) stall = 0; else stall++;
}

console.log('\n=== armSwing 消融（肩到底动不动？）===');
const bm = run(best);
console.log(`\n=== 最优：cost=${bc.toFixed(3)} ===`);
console.log(`  ${JSON.stringify({
  T: best.T, vDes: best.vDes, lift: best.lift, thresh: best.thresh,
  absorb: best.absorb, kv: best.kv, kPitch: best.kPitch, kRate: best.kRate,
}, null, 0)}\n`);
console.log(`  ${fmt(bm)}\n`);
console.log('  与标准比对：');
const dblP = 100 * bm.dbl / Math.max(1, bm.n), sglP = 100 * bm.sgl / Math.max(1, bm.n);
check('双支撑 → 慢速档 17%±6', dblP > 11 && dblP < 23, `${dblP.toFixed(1)}%`);
check('单支撑 → 41%±10', sglP > 31 && sglP < 51, `${sglP.toFixed(1)}%`);
check('脚净位移为正', bm.dist > 0.02, `${bm.dist.toFixed(3)} m`);
check('跨步时间 0.7~1.4 s', bm.stepGap > 0.7 && bm.stepGap < 1.4, `${bm.stepGap.toFixed(2)} s`);
check('膝 midstance 15.7±5°', Math.abs(bm.kneeMid - 15.7) < 5, `${bm.kneeMid.toFixed(1)}°`);
check('膝摆动峰 63±13°', Math.abs(bm.kneeMax - 63) < 13, `${bm.kneeMax.toFixed(1)}°`);
check('髋 ROM 46.9±9°', Math.abs(bm.hipMax - 46.9) < 9, `${bm.hipMax.toFixed(1)}°`);
check('肩摆动峰 ≥12°（上身发力）', bm.shMax > 12, `${bm.shMax.toFixed(1)}°`);
check('无腾空（不是跳）', bm.flight === 0, `${bm.flight} 帧`);
check('没摔倒', !bm.fell, bm.fell ? '摔了' : `存活 ${bm.t.toFixed(2)}s`);

console.log(`\n  速度口径：步长 ${bm.stepLen.toFixed(3)}m ÷ 跨步 ${bm.stepGap.toFixed(2)}s = ${(bm.stepLen / Math.max(0.01, bm.stepGap)).toFixed(2)} m/s`);
console.log(`  （标准：慢速 ${SPEED.slow} / 正常 ${SPEED.normal} m/s）`);
console.log(`\n${FAILS === 0 ? '★ 寻优完成且全部达标' : `★ 寻优完成，仍有 ${FAILS} 项未达标`}`);
// ═══════════════════════════════════════════════════════════════════════
// ★★ 联合网格：lift × stanceLock —— 目标是让 `adjust` 相**存在**（>0 帧）
//   背景（npm run roles 回读）：锁住支撑腿后 step 相支撑膝 ROM 30.7°→16.5°（达标），
//   但单支撑段变短、both 相占到 88% ⇒ `adjust` 相 0 帧 ⇒ 循环跑不完。
//   这两个参数**互相冲突**：lift 大 ⇒ 抬得久（单支撑长）；stanceLock 大 ⇒ 支撑腿稳。
//   单参数贪心搜不动，所以做联合网格。
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 联合网格 lift × stanceLock（目标：让 adjust 相出现）===\n');
console.log('  lift \ lock' + [0, 0.3, 0.6, 0.9].map(v => String(v).padStart(17)).join(''));
{
  const locks = [0, 0.3, 0.6, 0.9];
  for (const lf of [0.15, 0.20, 0.26, 0.32]) {
    const rowOut: string[] = [];
    for (const lk of locks) {
      const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
      sim.begin(new Float32Array(sim.params.length));
      const occ = { both: 0, step: 0, adjust: 0 };
      runCaptureTeacher(sk, sim, { ...FB, lift: lf, stanceLock: lk },
        { dur: DUR, clockDriven: true, onFrame: (): void => { occ[sim.gp.now]++; } });
      rowOut.push(`${String(occ.adjust).padStart(6)}帧/${String(occ.step).padStart(4)}`.padStart(17));
    }
    console.log(`  ${String(lf).padEnd(11)}` + rowOut.join(''));
  }
  console.log('\n  读法：`adjust帧/step帧` —— 单元格第一个数是 adjust 相帧数（目标 >0），第二个是 step 相帧数。');
}

// ═══════════════════════════════════════════════════════════════════════
// ★★★ 抬腿时脚到底往前伸了没有？（用户 2026-10-02："抬腿的时候脚都不往前伸"）
//   判据：摆动相里脚的**水平前伸量**。文献慢速档步长 0.50 m（2~3 个脚长）。
// ═══════════════════════════════════════════════════════════════════════
console.log('\n=== 摆动腿的前伸量（这是"走不起来"的直接原因）===\n');
console.log('  参数                            摆动脚前伸  落地位置  水平位移');
{
  for (const c of [
    { n: '当前（kv=0.3283）', p: {} as Partial<CaptureParams> },
    { n: 'kv=0', p: { kv: 0 } },
    { n: 'kv=1.0', p: { kv: 1.0 } },
    { n: 'reach=0.25m', p: { reach: 0.25 } },
    { n: 'reach=0.50m（文献步长）', p: { reach: 0.50 } },
    { n: 'reach=0.50 + kv=0', p: { reach: 0.50, kv: 0 } },
  ]) {
    const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
    sim.begin(new Float32Array(sim.params.length));
    let reachMax = 0, plantX = 0, startX = 0, started = false;
    runCaptureTeacher(sk, sim, { ...FB, ...c.p }, {
      dur: DUR, clockDriven: true,
      onFrame: (): void => {
        const gL = footGrounded(sim.doll, 'l'), gR = footGrounded(sim.doll, 'r');
        const swingL = !gL && gR;                       // 左脚在摆
        sim.doll.soleXZ("l", tmpX);
        const x = tmpX[0]!;
        if (sim.gp.now === 'step') {
          if (!started) { started = true; startX = x; }
          reachMax = Math.max(reachMax, x - startX);
        } else if (started) { plantX = x; started = false; }
      },
    });
    console.log(`  ${c.n.padEnd(30)} ${(reachMax * 1000).toFixed(0).padStart(7)}mm ${(plantX * 1000).toFixed(0).padStart(8)}mm ${(sim.distance * 1000).toFixed(0).padStart(9)}mm`);
  }
  console.log('\n  标准：慢速档步长 ≈ 0.50 m（500mm，Stasiu 步长 0.64m @1.37m/s 按速度缩放）');
}
