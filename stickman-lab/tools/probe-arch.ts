// ★ 架构体检：谁在写哪个关节？（用户 2026-10-02："打印一下指令，然后重做架构"）
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { runCaptureTeacher, type CaptureParams } from '../src/core/teacher';
import { footGrounded, readCom, newCom } from '../src/core/posture';
import { CAPTURE_GAIT } from '../src/core/phaseSeed';
const require = createRequire(import.meta.url);
{ const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) { const f = (bgNs as unknown as Record<string, unknown>)[i.name]; if (typeof f === 'function') (imp[i.module] ??= {})[i.name] = f; }
  const r = (await WebAssembly.instantiate(c, imp)) as unknown as { instance?: { exports: unknown }; exports: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(r.instance ? r.instance.exports : r.exports); }

const sk = buildSkeleton({ ...DEFAULT_CONFIG, ankleEnabled: true } as never);
const shape = shapeForJoints(sk.joints.length);
const FB: CaptureParams = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau,
  kLat: 2.0, kLatV: 0.6, kLatSwing: 0.10, stancePush: 0.18, stanceLock: 0.6, reach: 0.5,
  ankleSwing: 12, anklePush: 15, ankleStance: 0,
};

console.log('=== 架构体检：每个关节轴的「唯一 owner」===\n');
const sim = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 8, gaitHz: 1 / FB.T });
sim.begin(new Float32Array(sim.params.length));
const owners = new Map<string, Map<string, number>>();
const R = runCaptureTeacher(sk, sim, FB, { dur: 8, clockDriven: true, onFrame: (_t, _s, _p, ol) => {
  if (!ol) return;
  for (const [k, v] of ol) {
    const m = owners.get(k) ?? new Map<string, number>();
    m.set(v, (m.get(v) ?? 0) + 1);
    owners.set(k, m);
  }
} });
const AX = ['0(外展)', '1(扭转)', '2(屈伸)'];
for (const [k, m] of [...owners.entries()].sort()) {
  const tot = [...m.values()].reduce((a, b) => a + b, 0);
  const parts = [...m.entries()].sort((a, b) => b[1] - a[1])
    .map(([o, c]) => `${o} ${(100 * c / tot).toFixed(0)}%`);
  console.log(`  ${k.padEnd(14)} ${parts.join('  |  ')}`);
}
console.log('\n=== 换脚诊断：到底是 landed 不成立还是 ready 不成立 ===\n');
console.log(`  支撑腿序列：${R.stanceSeq ?? '(无换脚)'}`);
console.log(`  换脚次数 steps=${R.steps}  存活 ${R.t.toFixed(2)}s\n`);
console.log('   t(s)   s    摆动腿  landed  ready  离地高度(m)');
for (const d of (R.swapTrace ?? []).slice(0, 24))
  console.log(`  ${String(d.t).padStart(5)}  ${String(d.s).padStart(4)}    ${d.swing}     ${d.landed ? ' ✓  ' : ' ✗  '}   ${d.ready ? ' ✓  ' : ' ✗  '}   ${String(d.sole).padStart(8)}`);
console.log('\n  判读：**一格里有多个 owner** = 多个机制在抢同一个关节轴 ⇒ 冲突。');
console.log('        hip_l/2 现在是 balance(ik+corr+lock+push) 四合一，摆动/支撑两种语义混在一格。');

// ═══════ 为什么 0.47s 就倒 ═══════
console.log('\n=== 摔倒解剖（重心转移 + 迈腿顺序已加，还是 0.47s 倒）===\n');
{
  const s2 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 8, gaitHz: 1 / FB.T });
  s2.begin(new Float32Array(s2.params.length));
  const h: string[] = [];
  const cb = (): void => {
    const t = s2.ticksDone / DEFAULT_SIM.controlHz;
    const gL = footGrounded(s2.doll, 'l'), gR = footGrounded(s2.doll, 'r');
    const nG = (gL ? 1 : 0) + (gR ? 1 : 0);
    h.push(`  ${t.toFixed(2).padStart(5)}s  支撑${nG}  离地${(Math.max(s2.doll.soleY('l'), s2.doll.soleY('r')) * 1000).toFixed(0).padStart(4)}mm`
      + `  倾角${(s2.doll.tiltOf(s2.doll.torso()) * 180 / Math.PI).toFixed(1).padStart(6)}°`
      + `  躯干高${s2.doll.torso().translation().y.toFixed(3)}  头高${s2.doll.head().translation().y.toFixed(3)}`);
  };
  const r2 = runCaptureTeacher(sk, s2, FB, { dur: 8, clockDriven: true, onFrame: cb });
  h.filter((_, i) => i % 6 === 0).slice(0, 14).forEach(x => console.log(x));
  console.log(`\n  存活 ${r2.t.toFixed(2)}s  摔倒原因【${s2.fallReason || '未知'}】`);
}

// ═══════ HIP_DY 标定：IK 虚拟髋点必须够得着地，否则无限屈膝 ═══════
console.log('\n=== HIP_DY 标定（虚拟髋高 = CoM.y − HIP_DY；腿长 0.827m）===\n');
console.log('  目标：站立时躯干高 ≈ 1.429 m（改动前的基准），离地峰值要 ≥30mm');
console.log('  HIP_DY   虚拟髋高   躯干高    离地峰值   存活     换脚');
for (const dy of [0.10, 0.20, 0.307, 0.38, 0.42, 0.46]) {
  const s3 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 4, gaitHz: 1 / FB.T });
  s3.begin(new Float32Array(s3.params.length));
  let peak = 0;
  const c3 = (): void => { peak = Math.max(peak, Math.max(s3.doll.soleY('l'), s3.doll.soleY('r'))); };
  const r3 = runCaptureTeacher(sk, s3, { ...FB, hipDy: dy }, { dur: 4, clockDriven: true, onFrame: c3 });
  const hipY = 1.208 - dy;
  console.log(`  ${dy.toFixed(3)}    ${hipY.toFixed(3)}m    ${s3.doll.torso().translation().y.toFixed(3)}    `
    + `${(peak * 1000).toFixed(0).padStart(5)}mm   ${r3.t.toFixed(2)}s   ${r3.steps}`);
}

// ═══════ 逐项消融：哪个机制把身体压塌 ═══════
console.log('\n=== 消融：谁把人压塌？（躯干高应回到 1.42 m）===\n');
console.log('  配置                          躯干高    存活     离地峰换脚');
for (const c of [
  { n: '全开（当前）', p: {} as Partial<CaptureParams> },
  { n: '关重心转移 kLat=0', p: { kLat: 0, kLatV: 0 } },
  { n: '关蹬离 stancePush=0', p: { stancePush: 0 } },
  { n: '关支撑腿锁定 stanceLock=0', p: { stanceLock: 0 } },
  { n: '关俯仰反馈 kPitch/kRate=0', p: { kPitch: 0, kRate: 0 } },
  { n: '关落地吸能 absorb=0', p: { absorb: 0 } },
  { n: '只留纯IK（以上全关）', p: { kLat: 0, kLatV: 0, stancePush: 0, stanceLock: 0, kPitch: 0, kRate: 0, absorb: 0 } },
  { n: '纯IK + 重心转移', p: { kLat: 2.0, kLatV: 0.6, stancePush: 0, stanceLock: 0, kPitch: 0, kRate: 0, absorb: 0 } },
  { n: '纯IK + 俯仰反馈', p: { kLat: 0, kLatV: 0, stancePush: 0, stanceLock: 0, kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, absorb: 0 } },
]) {
  const s4 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 4, gaitHz: 1 / FB.T });
  s4.begin(new Float32Array(s4.params.length));
  let pk = 0;
  const r4 = runCaptureTeacher(sk, s4, { ...FB, ...c.p }, { dur: 4, clockDriven: true,
    onFrame: (): void => { pk = Math.max(pk, Math.max(s4.doll.soleY('l'), s4.doll.soleY('r'))); } });
  console.log(`  ${c.n.padEnd(28)} ${s4.doll.torso().translation().y.toFixed(3)}    ${r4.t.toFixed(2)}s   ${(pk * 1000).toFixed(0).padStart(4)}mm${r4.steps}`);
}

// ═══════ 马达到底有没有收到指令 ═══════
console.log('\n=== 马达通路体检 ═══════');
{
  const s5 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 4, gaitHz: 1 / FB.T });
  s5.begin(new Float32Array(s5.params.length));
  let sampled = false; let printedAng = false;
  runCaptureTeacher(sk, s5, FB, { dur: 4, clockDriven: true, onFrame: (_t, _s, _p, ol, _co, al): void => {
    if (al && !printedAng) { printedAng = true; console.log(`  angLog: ${JSON.stringify(al)}`); }
    if (sampled) return;
    sampled = true;
    const mt = s5.doll.motorTarget;
    const nz = [...mt].filter(v => Math.abs(v) > 0.01).length;
    console.log(`  motorTarget 长度 ${mt.length}（应 = joints ${s5.doll.jointCount} × 3 = ${s5.doll.jointCount * 3}）`);
    console.log(`  非零指令数 ${nz} / ${mt.length}`);
    console.log(`  前 12 项：${[...mt].slice(0, 12).map(v => v.toFixed(2)).join(' ')}`);
    console.log(`  ownerLog 记到的写入：${ol ? [...ol.keys()].join(', ') : '(无)'}`);
    console.log(`  Sim 的 motor 数组非零数：${[...s5.motor].filter(v => Math.abs(v) > 0.01).length}`);
    console.log(`  ★ 若 motorTarget 全 0 或 ownerLog 为空 ⇒ 指令根本没下发`);
  } });
}

// ═══════ 决定性测试：完全不驱动，看 rig 自己站不站得住 ═══════
console.log('\n=== 决定性测试：不驱动（零马达）时 rig 自己会怎样 ===\n');
{
  for (const kP of [0, 48]) {
    const s6 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 3 }, { kP, kD: 1 } as never);
    s6.begin(new Float32Array(s6.params.length));
    const tr: string[] = [];
    for (let i = 0; i < 180; i++) {
      s6.advance(1);
      if (i % 30 === 0) tr.push(`${(i / 60).toFixed(2)}s 躯干高 ${s6.doll.torso().translation().y.toFixed(3)} 倾角 ${(s6.doll.tiltOf(s6.doll.torso()) * 180 / Math.PI).toFixed(1)}°`);
      if (s6.finished) break;
    }
    console.log(`  kP=${kP}：${tr.join(' | ')}`);
    console.log(`         存活 ${(s6.ticksDone / 60).toFixed(2)}s 摔倒原因【${s6.fallReason || '没摔'}】`);
  }
  console.log('\n  判读：若 kP=0 与 kP=48 结果相同 ⇒ 马达没起作用（rig 自己在塌）；');
  console.log('        若 kP=48 能站住 ⇒ 马达有效，问题在 teacher 的指令内容。');
}

// ═══════ 踝 开/关：消融列表漏掉的变量 ═══════
console.log('\n=== 踝开关对照（消融列表里没有它）===\n');
{
  for (const an of [false, true]) {
    const skA = buildSkeleton({ ...DEFAULT_CONFIG, ankleEnabled: an } as never);
    const shA = shapeForJoints(skA.joints.length);
    const s7 = new Sim(skA, shA, { ...DEFAULT_SIM, mode: 'walk', duration: 3, gaitHz: 1 / FB.T });
    s7.begin(new Float32Array(s7.params.length));
    let pk = 0;
    const r7 = runCaptureTeacher(skA, s7, FB, { dur: 3, clockDriven: true,
      onFrame: (): void => { pk = Math.max(pk, Math.max(s7.doll.soleY('l'), s7.doll.soleY('r'))); } });
    console.log(`  踝${an ? '开' : '关'}：躯干高 ${s7.doll.torso().translation().y.toFixed(3)}  存活 ${r7.t.toFixed(2)}s  离地峰 ${(pk * 1000).toFixed(0)}mm  摔倒【${s7.fallReason || '没摔'}】`);
  }
  console.log('\n  判读：踝关时若能站住 ⇒ 是**踝指令**把身体压塌（踝力矩 45N·m 顶在脚上）。');
}

// ═══════ IK 的目标距离 vs 腿长：够得着吗 ═══════
console.log('\n=== IK 可达性（腿长常数 vs 实际目标距离）===\n');
{
  const s8 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 2, gaitHz: 1 / FB.T });
  s8.begin(new Float32Array(s8.params.length));
  console.log('   t(s)  躯干高   虚拟髋高(hipDy=0.125)  目标距离   腿长常数   可达?');
  const LA = 0.429, LB = 0.398, LEG = LA + LB;
  runCaptureTeacher(sk, s8, FB, { dur: 2, clockDriven: true, onFrame: (): void => {
    const t = s8.ticksDone / DEFAULT_SIM.controlHz;
    if (Math.round(t * 60) % 15 !== 0) return;
    const com = readCom(s8.doll, newCom());
    const hip = com.y - 0.125;
    const d = hip - 0.012;
    console.log(`  ${t.toFixed(2).padStart(5)}  ${com.y.toFixed(3)}   ${hip.toFixed(3)}                  ${d.toFixed(3)}     ${LEG.toFixed(3)}     ${d <= LEG ? '✓' : '★够不着'}`);
  } });
  console.log(`\n  腿长常数 LEG = ${LEG.toFixed(3)}m（大腿 ${LA} + 小腿 ${LB}，来自 limbAxes 锚点换算）`);
  console.log(`  ★ 若"目标距离 > 腿长" ⇒ IK 求不出解、腿被压到极限 ⇒ 躯干下沉（实测 1.429→1.21）。`);
}
