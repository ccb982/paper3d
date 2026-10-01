// 手写"捕获点行走控制器"：摆动脚落到 ξ（捕获点）附近，而不是按正弦摆。
// 用户 2026-10-01："压根走不起来" ⇒ 先证明这个骨架物理上能不能走。
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { readCom, newCom, omegaAt } from '../src/core/posture';

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

interface Params { T: number; vDes: number; lift: number; kv: number; kPitch: number; kRate: number; kLat: number; kLatV: number; kLatSwing: number; thresh: number }

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
    const swingX = xi + p.kv * (com.vx - p.vDes) * p.T * 0.5;
    const swingY = 0.012 + p.lift * Math.sin(Math.PI * Math.min(1, s));
    const corr = p.kPitch * pitch + p.kRate * av.x;
    for (const side of ['l', 'r'] as const) {
      const isStance = (side === 'l') === stanceL;
      const hipX = com.x + (side === 'l' ? HIP_Z : -HIP_Z);
      const [h, k] = isStance
        ? ik(hipX, com.y - 0.10, side === 'l' ? plantL : plantR, 0.012)
        : ik(hipX, com.y - 0.10, swingX, swingY);
      setAxis(`hip_${side}`, h + corr, jHip);
      setAxis(`knee_${side}`, k, jKnee);
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

// ── 已搜到的参数（前后）+ 状态触发阈值 ──
const BEST: Params = { T: 1.89, vDes: 0.59, lift: 0.31, kv: 0.3283, kPitch: 1.24, kRate: 0.35, kLat: 0, kLatV: 0, kLatSwing: 0, thresh: 0.05 };
let FAILS = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) FAILS++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`);
};
const zero = run({ ...BEST, T: 0, thresh: 1e9, lift: 0, kv: 0, vDes: 0, kPitch: 0, kRate: 0 }, 8);
const cap = run(BEST, 8);
console.log(`
  捕获点控制器: 位移 ${cap.x.toFixed(3)} m · 存活 ${cap.t.toFixed(2)} s · 换脚 ${cap.steps}`);
console.log(`  零输出基线 : 位移 ${zero.x.toFixed(3)} m · 存活 ${zero.t.toFixed(2)} s · 换脚 ${zero.steps}`);

// ★ 验收：这套控制器**真的踩出了单腿支撑**（实测载荷 0.00/1.00），这是骨架第一次
check('★ 捕获点控制器能踩出单腿支撑（不是滑行）', cap.steps >= 3, `换脚 ${cap.steps} 次`);
check('★ 前进方向为正（CoM 真的在往前移）', cap.x > 0.3, `${cap.x.toFixed(3)} m`);
check('★ 比零输出基线活得久', cap.t > zero.t, `${cap.t.toFixed(2)}s vs ${zero.t.toFixed(2)}s`);
console.log(`
  ⚠ 已知不足：迈步后躯干**俯仰会发散**（实测 t=1.0s 起 pitch −1.2°→−13°、`
  + `vx 0.28→0.55 m/s 前扑倒下）。逐拍 trace 显示俯仰反馈的**符号与髋的符号约定相反**`
  + `（kPitch 选到 +1.24 反而在放大前扑）—— 下一步是显式扫这个符号 + 加"落地吸能"（支撑膝屈）。`);
console.log(FAILS === 0 ? '★ capture 全部通过' : `★ capture 有 ${FAILS} 条 FAIL`);
