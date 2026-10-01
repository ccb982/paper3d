// 手写"捕获点行走控制器"：摆动脚落到 ξ（捕获点）附近，而不是按正弦摆。
// 用户 2026-10-01："压根走不起来" ⇒ 先证明这个骨架物理上能不能走。
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { readCom, newCom, omegaAt } from '../src/core/posture';
import { CAPTURE_GAIT } from '../src/core/phaseSeed';

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

const sk = buildSkeleton(DEFAULT_CONFIG);
const SH = shapeForJoints(sk.joints.length);
const PX2M = 0.00068;
const Y = (py: number): number => (2899 - py) * PX2M;      // mapY：画布 y=2899 是地面
const LEN_A = Y(1574.5) - Y(2206);                        // 大腿 0.429 m
const LEN_B = Y(2206) - Y(2792);                          // 小腿 0.398 m
const HIP_Z = 0.007;
const jHip = sk.joints.find((j) => j.name === 'hip_l')!;
const jKnee = sk.joints.find((j) => j.name === 'knee_l')!;

interface Params { T: number; vDes: number; lift: number; kv: number; kPitch: number; kRate: number; kLat: number; kLatV: number; kLatSwing: number; thresh: number; absorb: number; absorbTau: number }

function run(p: Params, dur = 8): { x: number; alive: boolean; steps: number; t: number } {
  const sim = new Sim(sk, SH, { ...DEFAULT_SIM, mode: 'walk', duration: dur });
  const out = new Float32Array(sim.doll.jointCount * 3);
  sim.begin(new Float32Array(sim.params.length));
  const com = newCom();
  const dt = 1 / DEFAULT_SIM.controlHz;
  const iL = sk.bodies.findIndex((b) => b.key === 'shin_l');
  const iR = sk.bodies.findIndex((b) => b.key === 'shin_r');
  let plantL = sim.doll.bodies[iL].translation().x;
  let plantR = sim.doll.bodies[iR].translation().x;
  let t = 0, steps = 0, prevStance = 1, lastSwitch = 0;

  const setAxis = (joint: string, ang: number, j: typeof jHip, ax = 2): void => {
    const o = JOINT_ORDER.indexOf(joint) * 3 + ax;
    if (o < 0) return;
    out[o] = ang >= 0 ? ang / (0.9 * j.maxRad[ax]) : ang / (0.9 * -j.minRad[ax]);
  };

  /** 二连杆 IK：髋 (hipX,hipY) → 脚 (fx,fy)，返回 [髋屈伸, 膝屈伸]（膝屈为负） */
  const ik = (hipX: number, hipY: number, fx: number, fy: number): [number, number] => {
    const dx = fx - hipX, dy = fy - hipY;
    let d = Math.hypot(dx, dy);
    d = Math.min(d, (LEN_A + LEN_B) * 0.995);
    d = Math.max(d, Math.abs(LEN_A - LEN_B) + 0.02);
    const base = Math.atan2(dx, -dy);
    const cosK = Math.max(-1, Math.min(1, (LEN_A * LEN_A + LEN_B * LEN_B - d * d) / (2 * LEN_A * LEN_B)));
    const interior = Math.acos(cosK);
    const hipRel = base + Math.atan2(LEN_B * Math.sin(interior), LEN_A + LEN_B * Math.cos(interior));
    return [hipRel, -(Math.PI - interior)];
  };

  while (!sim.finished && t < dur) {
    sim.advance(1);
    const torso = sim.doll.torso();
    const rot = torso.rotation();
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (rot.w * rot.x + rot.y * rot.z))));
    const av = torso.angvel();
    readCom(sim.doll, com);
    const om = omegaAt(com.y);
    const xi = com.x + com.vx / om;                 // ★ 捕获点
    // ★★★ **状态触发**换脚，而不是固定时钟：捕获点 ξ 走出当前支撑脚的落点，
    //   而且已经超过半个周期（防抖），才换支撑脚。这才是 Raibert/捕获点那条规则本身 ——
    //   固定时钟的版本在 2.95 s 必定因为"该迈的时候没迈"而前倾失控。
    const ph = (t / p.T) % 1;
    let stanceL = prevStance === 1;
    const plantNow = stanceL ? plantL : plantR;
    const need = p.thresh;                                  // 捕获点走出支撑脚的阈值 (m)
    if (Math.abs(xi - plantNow) > need && t - lastSwitch > p.T * 0.5) {
      stanceL = !stanceL;
      steps++;
      lastSwitch = t;
      if (stanceL) plantL = xi; else plantR = xi;
      prevStance = stanceL ? 1 : 2;
    }
    // 摆动相位：用"迈出去多久"归一，配合最小摆动时间
    const s = Math.max(0, Math.min(1, (t - lastSwitch) / Math.max(0.2, p.T * 0.5)));
    // ★ Raibert 落脚点：x* = ξ + kv·(v_des − v_x)·T_s/2
    //   （**慢了就把脚放得更靠前**）。之前写成 (v_x − v_des) ⇒ 方向整个反了，
    //   站得住也走起来了，但一路往后走（实测 −0.26 ~ −1.15 m）。
    const swingX = xi + p.kv * (p.vDes - com.vx) * p.T * 0.5;
    const swingY = 0.012 + p.lift * Math.sin(Math.PI * Math.min(1, s));
    // ★ 落地吸能：支撑脚刚落地的一小段时间里额外屈膝，把落地的冲击/前扑动能吃掉
    //   （膝能屈 −145°，权限足够；这是所有双足行走器必备的一步）。
    const dtSw = t - lastSwitch;
    const absorb = p.absorb * Math.exp(-dtSw / Math.max(0.05, p.absorbTau));
    const corr = p.kPitch * pitch + p.kRate * av.x;
    for (const side of ['l', 'r'] as const) {
      const isStance = (side === 'l') === stanceL;
      const hipX = com.x + (side === 'l' ? HIP_Z : -HIP_Z);
      const [h, k] = isStance
        ? ik(hipX, com.y - 0.10, side === 'l' ? plantL : plantR, 0.012)
        : ik(hipX, com.y - 0.10, swingX, swingY);
      setAxis(`hip_${side}`, h + corr, jHip);
      setAxis(`knee_${side}`, k + (isStance ? -Math.abs(absorb) : 0), jKnee);
      setAxis(`shoulder_${side}`, -h * 0.4, jHip);
      // ★★ 侧向调节（axis 0 = 外展）：站距 0.33 m，只调俯仰是**必然**倒的 ——
      //   横向平衡没有出口。支撑腿外展把骨盆/重心推向支撑脚，摆动腿外展控制落点宽度。
      const latCorr = p.kLat * (com.z - (side === 'l' ? HIP_Z : -HIP_Z)) + p.kLatV * com.vz;
      setAxis(`hip_${side}`, isStance ? latCorr : -p.kLatSwing, jHip, 0);
    }
    sim.doll.setMotorTargets(out);
    t += dt;
  }
  return { x: sim.distance, alive: !sim.fallen, steps, t };
}

// ── 阶段 1：俯仰反馈的**符号**（之前坐标下降选到 +1.24，而 trace 显示它在放大前扑）──
// ★ 参数真源 = phaseSeed.CAPTURE_GAIT（探针搜出来的，UI/训练共用同一份）
const FB: Params = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau,
  kLat: 0, kLatV: 0, kLatSwing: 0,
};
console.log('  阶段 1：俯仰反馈符号 × 落地吸能');
console.log('   kPitch  kRate  absorb   位移     存活   换脚');
let best = { ...FB }, bs = run(best);
console.log(`   ${FB.kPitch.toFixed(2).padStart(5)}  ${FB.kRate.toFixed(2).padStart(5)}  ${FB.absorb.toFixed(2).padStart(5)}   ${bs.x.toFixed(3)}m  ${bs.t.toFixed(2)}s  ${bs.steps}  (基准)`);
for (const kPitch of [-2, -1, -0.4, 0.4, 1, 2]) {
  for (const absorb of [0, 0.2, 0.4]) {
    const p: Params = { ...FB, kPitch, absorb };
    const r = run(p);
    const better = r.t > bs.t + 1e-9 || (Math.abs(r.t - bs.t) <= 1e-9 && r.x > bs.x);
    if (better) { best = p; bs = r; }
    console.log(`   ${kPitch.toFixed(2).padStart(5)}  ${FB.kRate.toFixed(2).padStart(5)}  ${absorb.toFixed(2).padStart(5)}   ${r.x.toFixed(3)}m  ${r.t.toFixed(2)}s  ${r.steps}${better ? '  ←' : ''}`);
  }
}
console.log(`
  阶段 1 结果: kPitch=${best.kPitch} absorb=${best.absorb} → 位移 ${bs.x.toFixed(3)}m 存活 ${bs.t.toFixed(2)}s 换脚 ${bs.steps}`);

// ── 阶段 2：在阶段 1 最好的基础上补齐其余参数 ──
console.log('');
console.log('  阶段 2：其余参数细化');
// ★ 目标必须是"活着 **且** 往前走 **且** 真的迈步"，否则搜索会买最便宜的稳定：
//   只按存活搜的话，"永远不迈步"能拿满分（实测 thresh=0.45 → 0 次换脚、活满 8 s）。
const RANGE: Partial<Record<keyof Params, [number, number]>> = {
  T: [0.5, 2.5], vDes: [0.2, 1.0], lift: [0.02, 0.15], kv: [-0.6, 0.6],
  kRate: [-1.5, 1.5], absorbTau: [0.1, 0.8], thresh: [0.02, 0.12],
  kPitch: [-3, 3], absorb: [0, 0.6],
};
const scoreOf = (r: { x: number; alive: boolean; steps: number; t: number }): number =>
  (r.alive ? 20 : 0) + r.x + 0.6 * r.steps + 0.5 * r.t;
const clampP = (p: Params): Params => {
  const q = { ...p };
  for (const k of Object.keys(RANGE) as (keyof Params)[]) {
    const r = RANGE[k]!;
    q[k] = Math.max(r[0], Math.min(r[1], q[k]));
  }
  return q;
};
let step2 = 0.2;
for (let it = 0; it < 250 && step2 > 5e-3; it++) {
  let improved = false;
  for (const key of ['T', 'vDes', 'lift', 'kv', 'kRate', 'kPitch', 'absorb', 'absorbTau', 'thresh'] as (keyof Params)[]) {
    for (const d of [step2, -step2]) {
      const p = clampP({ ...best, [key]: best[key] + d });
      const r = run(p);
      if (scoreOf(r) > scoreOf(bs) + 1e-9) { best = p; bs = r; improved = true; }
    }
  }
  if (!improved) step2 *= 0.6;
}
console.log(`  ★ 参数 ${JSON.stringify(best, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v))}`);
console.log(`  ★ 结果: 位移 ${bs.x.toFixed(3)} m · 存活 ${bs.t.toFixed(2)} s · 换脚 ${bs.steps} · 活满=${bs.alive}`);

const zero = run({ ...best, T: 0, thresh: 1e9, lift: 0, kv: 0, vDes: 0, kPitch: 0, kRate: 0, absorb: 0 }, 8);
let FAILS = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};
console.log(`  零输出基线: 位移 ${zero.x.toFixed(3)} m · 存活 ${zero.t.toFixed(2)} s · 换脚 ${zero.steps}`);
check('★ 捕获点控制器能踩出单腿支撑（不是滑行）', bs.steps >= 3, `换脚 ${bs.steps} 次`);
check('★ 前进方向为正（CoM 真的在往前移）', bs.x > 0.3, `${bs.x.toFixed(3)} m`);
check('★ 比零输出基线活得久', bs.t > zero.t, `${bs.t.toFixed(2)}s vs ${zero.t.toFixed(2)}s`);
console.log(FAILS === 0 ? '★ capture 全部通过' : `★ capture 有 ${FAILS} 条 FAIL`);
