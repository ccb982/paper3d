// probe-gaitref —— 人类文献步态参考轨迹能不能当奖励用？
//
// 三件事，按顺序：
// ① **实测**本 rig 的关节角符号约定（人类"屈曲为正"，rig 的膝是负）——不靠猜；
// ② 量参考曲线本身：采样出来画一遍，检查它是不是一条合理的步态曲线（单调、过冲）；
// ③ 给现有三种"步态"打分，看这个分数**能不能区分**会走的和不会走的：
//    手写捕获点 teacher / 相位种子步态 / 镇定器（站着不动）。
//    ★ 判据很硬：**站着不动必须拿 0 分**。如果站桩也能拿高分，这个奖励就是废的
//      （我前面已经在"要动"这一项上栽过一次：站着扭关节反而是全局最优）。

import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import {
  KNEE_REF, HIP_REF, kneeRefDeg, hipRefDeg, scoreLeg, RIG_SIGN,
  STANCE_FRAC, TOLERANCE_DEG, hipROM, kneeROM,
} from '../src/core/gaitRef';
import { BEST_BALANCER, balancerGenome, phaseGenomeFor, BEST_PHASE, CAPTURE_GAIT } from '../src/core/phaseSeed';
import { brainParamCount } from '../src/core/brain';
import { runCaptureTeacher, type CaptureParams } from '../src/core/teacher';
import { PelvisFirstTracker } from '../src/core/gaitRef';
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
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};

const sk = buildSkeleton(DEFAULT_CONFIG);
const shape = shapeForJoints(sk.joints.length);
const DUR = 6;
const iHipL = JOINT_ORDER.indexOf('hip_l');
const iHipR = JOINT_ORDER.indexOf('hip_r');
const iKneeL = JOINT_ORDER.indexOf('knee_l');
const iKneeR = JOINT_ORDER.indexOf('knee_r');

// ★ `jointAngle(i)` **无 axis 参数**、返回绕本地 Z 的分量（= 矢状面屈伸），
//   而且返回的是**相对 restRad 的偏差**，不是绝对角。我一开始按 `jointAngle(i, 2)` 调，
//   多传的参数被忽略倒还好，但它给的是 restRad 之差 —— 所以下面要加回 restRad。
const restOf = (name: string): number => {
  const j = sk.joints.find((q) => q.name === name)!;
  return j.restRad[2]!;
};


// ══════════════════════════════════════════════════════════════════════
console.log('');
console.log('=== 1. rig 的符号约定（实测，不靠猜）===');
{
  // ★ 必须用**手写捕获点 teacher** 测：相位种子步态在这个 rig 上没有单支撑帧
  //   （amp=0.35 实测 n=0），拿它测符号只会测到"两脚都在地上"的平均值。
  const FB: CaptureParams = {
    T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
    kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
    absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau,
    kLat: 0, kLatV: 0, kLatSwing: 0,
  };
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  sim.begin(new Float32Array(sim.params.length));
  const swHip: number[] = [], stHip: number[] = [], swKnee: number[] = [], stKnee: number[] = [];
  runCaptureTeacher(sk, sim, FB, {
    dur: DUR, clockDriven: true,
    onFrame: () => {
      const gL = footGrounded(sim.doll, 'l'), gR = footGrounded(sim.doll, 'r');
      if (gL === gR) return;                        // 只取真单支撑帧
      const swingIsL = !gL;
      const rd = (idx: number, name: string): number => sim.doll.jointAngle(idx) + restOf(name);
      swHip.push(rd(swingIsL ? iHipL : iHipR, swingIsL ? 'hip_l' : 'hip_r'));
      stHip.push(rd(swingIsL ? iHipR : iHipL, swingIsL ? 'hip_r' : 'hip_l'));
      swKnee.push(rd(swingIsL ? iKneeL : iKneeR, swingIsL ? 'knee_l' : 'knee_r'));
      stKnee.push(rd(swingIsL ? iKneeR : iKneeL, swingIsL ? 'knee_r' : 'knee_l'));
    },
  });
  const D = 180 / Math.PI;
  const mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const mSH = mean(swHip), mST = mean(stHip), mSK = mean(swKnee), mSTK = mean(stKnee);
  console.log(`  捕获点 teacher（时钟驱动）真单支撑帧 n=${swHip.length}`);
  console.log(`  髋：摆动腿 ${(mSH * D).toFixed(1)}° · 支撑腿 ${(mST * D).toFixed(1)}°  → 差 ${((mSH - mST) * D).toFixed(1)}°`);
  console.log(`  膝：摆动腿 ${(mSK * D).toFixed(1)}° · 支撑腿 ${(mSTK * D).toFixed(1)}°  → 差 ${((mSK - mSTK) * D).toFixed(1)}°`);
  check('髋：摆动腿比支撑腿更屈 ⇒ rig 里"腿往前 = 正"（与人类同号）', mSH > mST,
    `差 ${((mSH - mST) * D).toFixed(1)}°`);
  check('膝：摆动腿角度更小（更负）⇒ rig 里"屈曲 = 负"（与人类反号）', mSK < mSTK,
    `差 ${((mSK - mSTK) * D).toFixed(1)}°`);
}
// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 2. 参考曲线本身 ===\n');
{
  const line = (name: string, f: (t: number) => number): string => {
    const parts: string[] = [];
    for (let i = 0; i <= 20; i++) parts.push(f(i / 20).toFixed(0).padStart(4));
    return `${name} ${parts.join('')}`;
  };
  console.log('  相位 %   ' + Array.from({ length: 21 }, (_, i) => String(i * 5).padStart(4)).join(''));
  console.log(line('  膝°   ', kneeRefDeg));
  console.log(line('  髋°   ', hipRefDeg));
  // 单调性/过冲检查：曲线不应超出关键帧的取值范围
  let kMin = 1e9, kMax = -1e9, hMin = 1e9, hMax = -1e9;
  for (let i = 0; i <= 2000; i++) {
    const t = i / 2000;
    kMin = Math.min(kMin, kneeRefDeg(t)); kMax = Math.max(kMax, kneeRefDeg(t));
    hMin = Math.min(hMin, hipRefDeg(t)); hMax = Math.max(hMax, hipRefDeg(t));
  }
  const kLo = Math.min(...KNEE_REF.map((k) => k[1])), kHi = Math.max(...KNEE_REF.map((k) => k[1]));
  const hLo = Math.min(...HIP_REF.map((k) => k[1])), hHi = Math.max(...HIP_REF.map((k) => k[1]));
  console.log(`  膝范围 ${kMin.toFixed(1)}..${kMax.toFixed(1)}°（关键帧 ${kLo}..${kHi}°）`);
  console.log(`  髋范围 ${hMin.toFixed(1)}..${hMax.toFixed(1)}°（关键帧 ${hLo}..${hHi}°）`);
  console.log(`  活动度：膝 ${kneeROM().toFixed(0)}° · 髋 ${hipROM().toFixed(0)}° · 容差 ${TOLERANCE_DEG}°`);
  check('插值无过冲（膝）', kMin >= kLo - 0.5 && kMax <= kHi + 0.5, `${kMin.toFixed(1)}..${kMax.toFixed(1)}`);
  check('插值无过冲（髋）', hMin >= hLo - 0.5 && hMax <= hHi + 0.5, `${hMin.toFixed(1)}..${hMax.toFixed(1)}`);
  check('膝摆动峰值落在 60~70°（Oberg 实测 66.9±5.2°）',
    kneeRefDeg(0.78) >= 60 && kneeRefDeg(0.78) <= 72, `${kneeRefDeg(0.78).toFixed(1)}°`);
  check('膝 midstance 在 0~20°（Oberg 实测 15.7±5.0°）',
    kneeRefDeg(0.30) >= 0 && kneeRefDeg(0.30) <= 22, `${kneeRefDeg(0.30).toFixed(1)}°`);
  check('髋 terminal stance 是**伸展**（负值，Perry 峰值伸展 ≈8°）',
    hipRefDeg(0.50) < 0, `${hipRefDeg(0.50).toFixed(1)}°`);
}

// ══════════════════════════════════════════════════════════════════════
console.log('\n=== 3. 这个分数能不能区分"会走"和"站着不动" ===\n');

// 逐帧打分的正经实现：包一层，在 sim.advance 之后取角度
function refScore(genome: Float32Array, label: string): { hip: number; knee: number; single: number; x: number; t: number } {
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR });
  sim.begin(genome);
  let aHip = 0, aKnee = 0, nSingle = 0, n = 0;
  const T = sim.cfg.gaitHz > 0 ? 1 / sim.cfg.gaitHz : 1;   // 一个步态周期
  while (!sim.finished) {
    sim.advance(1);
    const gL = footGrounded(sim.doll, 'l'), gR = footGrounded(sim.doll, 'r');
    const single = (!gL && gR) || (gL && !gR);
    if (!single) continue;
    nSingle++;
    // 左腿相位：以"右腿离地"为左腿触地（简化：用时钟，按占空比推相位）
    const t = sim.clock.phase;
    const tl = gL ? t : (t + 0.5) % 1;
    const sL = scoreLeg(tl,
      sim.doll.jointAngle(iHipL) + restOf('hip_l'), sim.doll.jointAngle(iKneeL) + restOf('knee_l'));
    const sR = scoreLeg((t + 0.5) % 1,
      sim.doll.jointAngle(iHipR) + restOf('hip_r'), sim.doll.jointAngle(iKneeR) + restOf('knee_r'));
    aHip += (sL.hip + sR.hip) / 2;
    aKnee += (sL.knee + sR.knee) / 2;
    n++;
  }
  void T;
  const denom = Math.max(1, n);
  const singleRatio = sim.walkStat.singleRatio;
  return {
    hip: aHip / denom, knee: aKnee / denom, single: singleRatio,
    x: sim.distance, t: DUR,
  };
  void label;
}

// ★ teacher 用**它自己的摆动相位**打分（不是 rig 的时钟）：teacher 的换脚是
//   按 T/2 周期走的，所以相位就是 (t/T + 偏移)，这样"参考曲线"和"实际动作"才真的对齐。
function teacherScore(): { hip: number; knee: number; single: number; x: number; angles: string } {
  const FB: CaptureParams = {
    T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
    kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
    absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau,
    kLat: 0, kLatV: 0, kLatSwing: 0,
  };
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB.T });
  sim.begin(new Float32Array(sim.params.length));
  let aHip = 0, aKnee = 0, n = 0;
  const swHip: number[] = [], swKnee: number[] = [], stHip: number[] = [], stKnee: number[] = [];
  runCaptureTeacher(sk, sim, FB, {
    dur: DUR, clockDriven: true,
    onFrame: (t, stanceL) => {
      // 该腿的相位：stanceL 腿在相位 [0,0.5)，摆动腿在 [0.5,1)
      const half = FB.T * 0.5;
      const kL = Math.floor(t / half);
      const stanceLNow = kL % 2 === 0;
      const swingIsL = !stanceLNow;
      const gL = footGrounded(sim.doll, 'l'), gR = footGrounded(sim.doll, 'r');
      if (gL === gR) return;                          // 只取真单支撑帧
      // 摆动腿的相位（它正在摆）
      const tSw = swingIsL ? (t / FB.T + 0.5) % 1 : (t / FB.T) % 1;
      const hSw = sim.doll.jointAngle(swingIsL ? iHipL : iHipR) + restOf(swingIsL ? 'hip_l' : 'hip_r');
      const kSw = sim.doll.jointAngle(swingIsL ? iKneeL : iKneeR) + restOf(swingIsL ? 'knee_l' : 'knee_r');
      const hSt = sim.doll.jointAngle(swingIsL ? iHipR : iHipL) + restOf(swingIsL ? 'hip_r' : 'hip_l');
      const kSt = sim.doll.jointAngle(swingIsL ? iKneeR : iKneeL) + restOf(swingIsL ? 'knee_r' : 'knee_l');
      swHip.push(hSw); swKnee.push(kSw); stHip.push(hSt); stKnee.push(kSt);
      const sL = scoreLeg(tSw, hSw, kSw);
      const sR = scoreLeg((tSw + 0.5) % 1, hSt, kSt);
      aHip += (sL.hip + sR.hip) / 2;
      aKnee += (sL.knee + sR.knee) / 2;
      n++;
      void stanceL;
    },
  });
  const D = 180 / Math.PI, mean = (v: number[]): number => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  return {
    hip: aHip / Math.max(1, n), knee: aKnee / Math.max(1, n), single: sim.walkStat.singleRatio, x: sim.distance,
    angles: `摆动髋 ${(mean(swHip) * D).toFixed(0)}°/摆动膝 ${(mean(swKnee) * D).toFixed(0)}°`
      + ` · 支撑髋 ${(mean(stHip) * D).toFixed(0)}°/支撑膝 ${(mean(stKnee) * D).toFixed(0)}°`,
  };
}

// ★ 端到端：直接看 Sim 的 terms 里这三项（证明奖励真的接上了）
function termRow(name: string, g: Float32Array | null, teacher?: CaptureParams): { n: string; f: number; rh: number; rk: number; pf: number; lead: number; pre: number } {
  const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / (teacher?.T ?? CAPTURE_GAIT.T) });
  if (teacher) { sim.begin(new Float32Array(sim.params.length)); runCaptureTeacher(sk, sim, teacher, { dur: DUR, clockDriven: true }); }
  else { sim.begin(g!); while (!sim.finished) sim.advance(1); }
  const t = sim.terms;
  return {
    n: name, f: sim.fitness,
    rh: t.refHip ?? 0, rk: t.refKnee ?? 0, pf: t.pelvisFirst ?? 0,
    lead: t.hipLeadSec ?? 0, pre: t.preActive ?? 0,
  };
}
const FB2: CaptureParams = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau, kLat: 0, kLatV: 0, kLatSwing: 0,
};
const trows = [
  termRow('捕获点 teacher', null, FB2),
  termRow('镇定器（站着不动）', balancerGenome(shape, BEST_BALANCER)),
  termRow('零输出', new Float32Array(brainParamCount(shape))),
  termRow('随机基因组', (() => { const a = new Float32Array(brainParamCount(shape)); for (let i = 0; i < a.length; i++) a[i] = Math.sin(i * 0.37) * 0.25; return a; })()),
];
console.log('  端到端 terms（奖励真的接上了吗）');
console.log('  ' + '对象'.padEnd(20) + '适应度  髋参考  膝参考  盆骨优先  膝滞后髋  预激活');
for (const r of trows) {
  console.log('  ' + r.n.padEnd(18) + r.f.toFixed(2).padStart(6) + r.rh.toFixed(2).padStart(8) + r.rk.toFixed(2).padStart(8)
    + r.pf.toFixed(2).padStart(9) + (r.lead * 1000).toFixed(0).padStart(9) + 'ms' + r.pre.toFixed(2).padStart(8));
}
console.log('');
check('★ 站着不动：三项参考分全为 0', trows[1]!.rh === 0 && trows[1]!.rk === 0 && trows[1]!.pf === 0,
  `refHip=${trows[1]!.rh} refKnee=${trows[1]!.rk} pelvisFirst=${trows[1]!.pf}`);
{
  // 先量真实角速度量级，否则启动阈值只能瞎猜
  const sim2 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: DUR, gaitHz: 1 / FB2.T });
  sim2.begin(new Float32Array(sim2.params.length));
  const buf = new Float64Array(3);
  const mx: Record<string, number> = {};
  for (const nm of ['hip_l', 'knee_l', 'hip_r', 'knee_r']) mx[nm] = 0;
  runCaptureTeacher(sk, sim2, FB2, {
    dur: DUR, clockDriven: true,
    onFrame: () => {
      for (const nm of ['hip_l', 'knee_l', 'hip_r', 'knee_r']) {
        const i = JOINT_ORDER.indexOf(nm);
        sim2.doll.jointRelVel(i, buf);
        mx[nm] = Math.max(mx[nm]!, Math.abs(buf[2]!));
      }
    },
  });
  console.log('  单步内 |相对角速度| 峰值 (rad/s)：'
    + Object.entries(mx).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' · '));
  console.log('  ⇒ 启动阈值取 0.35 rad/s 的话永远测不到 onset（这就是 pelvisFirst 全 0 的原因）');
}
// ══════════════════════════════════════════════════════════════════════
// ★ 单元测试：这项到底是"能分辨"还是"恒等于 0/恒等于常数"。
//   构造三条已知时序的速度包络喂给 tracker：
//     ① 髋先动（膝滞后 120 ms，落在文献 50~250 ms 区间）⇒ 应给满分、领先量为正
//     ② **膝先动**（髋滞后 120 ms）⇒ 这是要治的病，应给**负分**
//     ③ 同时动 ⇒ 应给部分分
//   ⚠ 顺带一个诚实的发现：**手写捕获点 teacher 实测领先量只有 1 ms**，
//     也就是它**本来就不是"盆骨优先"**（IK 同时驱动髋和膝，两者峰值同一拍）。
//     所以这一项不是"给已有控制器加分"，而是**要教会策略的新东西**。
function synth(hipPeakT: number, kneePeakT: number): { lead: number; score: number } {
  const tr = new PelvisFirstTracker();
  const dt = 1 / 120;
  for (let t = 0; t < 0.8; t += dt) {
    const hv = 6 * Math.exp(-(((t - hipPeakT) / 0.06) ** 2));
    const kv = 6 * Math.exp(-(((t - kneePeakT) / 0.06) ** 2));
    tr.step(hv, kv, t > 0.4, dt);            // 0.4 s 时"触地"，结算这一步
  }
  return { lead: tr.meanLead, score: tr.score() };
}
const good = synth(0.10, 0.22);      // 膝滞后 120 ms ✔
const bad = synth(0.22, 0.10);       // 膝先动 ✘
const same = synth(0.15, 0.15);      // 同时
console.log('  盆骨优先项的单元测试（构造已知时序）');
console.log(`    髋先动(膝滞后120ms)  领先 ${(good.lead * 1000).toFixed(0)}ms  分 ${good.score.toFixed(2)}`);
console.log(`    膝先动(髋滞后120ms)  领先 ${(bad.lead * 1000).toFixed(0)}ms  分 ${bad.score.toFixed(2)}`);
console.log(`    同时动              领先 ${(same.lead * 1000).toFixed(0)}ms  分 ${same.score.toFixed(2)}`);
console.log('    ℹ teacher 实测领先量只有 ' + (trows[0]!.lead * 1000).toFixed(0)
  + ' ms ⇒ 它本来就不是"盆骨优先"，这一项是要**教会**策略的新东西');
check('★ 盆骨优先项能分辨时序：髋先动 ⇒ 领先为正且分数高', good.lead > 0.05 && good.score > 0.8,
  `${(good.lead * 1000).toFixed(0)}ms / ${good.score.toFixed(2)}`);
check('★ 盆骨优先项能分辨时序：膝先动 ⇒ 领先为负且**被罚**', bad.lead < -0.05 && bad.score < 0,
  `${(bad.lead * 1000).toFixed(0)}ms / ${bad.score.toFixed(2)}`);
// 设计上"同时动 = 0 分"是**有意的**：不给"髋膝一起动"发分，逼出真正的先后。
// 代价是 L=0 处的目标函数是连续的但斜率很陡（L/LEAD_MIN·0.9），数值抖动会造成 ±0.05 的抖动，
// 可以接受。
check('★ 同时动不给分（不奖励"髋膝一起动"）', Math.abs(same.score) < 0.05, `${same.score.toFixed(2)}`);
check('★ teacher 拿到参考分', trows[0]!.rh + trows[0]!.rk > 0.3,
  `髋 ${trows[0]!.rh.toFixed(2)} + 膝 ${trows[0]!.rk.toFixed(2)}`);

const rows: { name: string; hip: number; knee: number; single: number; x: number; extra?: string }[] = [];
const tch = teacherScore();
rows.push({ name: '捕获点 teacher（真会走）', hip: tch.hip, knee: tch.knee, single: tch.single, x: tch.x, extra: tch.angles });
rows.push({ name: '相位种子步态', ...refScore(phaseGenomeFor(sk.joints.length, { ...BEST_PHASE, amp: 0.35 }), 'phase') });
rows.push({ name: '镇定器（站着不动）', ...refScore(balancerGenome(shape, BEST_BALANCER), 'bal') });
rows.push({ name: '零输出', ...refScore(new Float32Array(brainParamCount(shape)), 'zero') });
rows.push({ name: '随机基因组', ...(() => {
  const a = new Float32Array(brainParamCount(shape));
  for (let i = 0; i < a.length; i++) a[i] = Math.sin(i * 0.37) * 0.25;
  return refScore(a, 'rand');
})() });

console.log('  ' + '步态'.padEnd(22) + '髋分   膝分   单支撑占比  位移');
for (const r of rows) {
  console.log('  ' + r.name.padEnd(20) + r.hip.toFixed(3).padStart(5) + '  ' + r.knee.toFixed(3).padStart(5)
    + '  ' + r.single.toFixed(3).padStart(8) + '   ' + r.x.toFixed(3).padStart(6) + ' m'
    + (r.extra ? `   ${r.extra}` : ''));
}
const stand = rows.find((r) => r.name.includes('镇定器'))!;
console.log('');
console.log(`  ℹ 支撑相占 ${(STANCE_FRAC * 100).toFixed(0)}%、摆动 ${((1 - STANCE_FRAC) * 100).toFixed(0)}%`);
check('★ 站着不动拿 0 分（没有单支撑帧就没有参考分）',
  stand.hip + stand.knee < 1e-9, `镇定器 ${(stand.hip + stand.knee).toFixed(3)}`);
check('★ 会走的 teacher 明显高于 0（参考分认得出真步态）', tch.hip + tch.knee > 0.3,
  `teacher 髋 ${tch.hip.toFixed(3)} + 膝 ${tch.knee.toFixed(3)}`);
check('★ 参考分能区分"像人"和"乱动"', tch.hip + tch.knee > (rows[4]!.hip + rows[4]!.knee),
  `teacher ${(tch.hip + tch.knee).toFixed(3)} vs 随机 ${(rows[4]!.hip + rows[4]!.knee).toFixed(3)}`);

console.log('');
console.log(FAILS === 0 ? '★ gaitref 全绿' : `★ gaitref 有 ${FAILS} 条 FAIL`);
if (FAILS > 0) process.exitCode = 1;
