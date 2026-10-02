// ★ 架构体检：谁在写哪个关节？（用户 2026-10-02："打印一下指令，然后重做架构"）
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { runCaptureTeacher, type CaptureParams } from '../src/core/teacher';
import { footGrounded, readCom, newCom } from '../src/core/posture';
import { HIP_Z } from '../src/core/teacher';
import { LegEventTracker, EVENT_LABEL, WT, THR } from '../src/core/gaitEvents';
import { CAPTURE_GAIT } from '../src/core/phaseSeed';
const require = createRequire(import.meta.url);
{ const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) { const f = (bgNs as unknown as Record<string, unknown>)[i.name]; if (typeof f === 'function') (imp[i.module] ??= {})[i.name] = f; }
  const r = (await WebAssembly.instantiate(c, imp)) as unknown as { instance?: { exports: unknown }; exports: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(r.instance ? r.instance.exports : r.exports); }

const sk = buildSkeleton({ ...DEFAULT_CONFIG, ankleEnabled: true } as never);
const fbL = new Float64Array(2), fbR = new Float64Array(2);
const cTmp = newCom();
const shape = shapeForJoints(sk.joints.length);
const FB: CaptureParams = {
  T: CAPTURE_GAIT.T, vDes: CAPTURE_GAIT.vDes, lift: CAPTURE_GAIT.lift, kv: CAPTURE_GAIT.kv,
  kPitch: CAPTURE_GAIT.kPitch, kRate: CAPTURE_GAIT.kRate, thresh: CAPTURE_GAIT.thresh,
  absorb: CAPTURE_GAIT.absorb, absorbTau: CAPTURE_GAIT.absorbTau,
  kLat: 3.5, kLatV: 1.2, kLatSwing: 0.10, stancePush: 0.18, stanceLock: 0.6, reach: 0.5,
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
for (const dy of [0.05, 0.10, 0.125, 0.15, 0.20, 0.25, 0.30]) {
  const s3 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 4, gaitHz: 1 / FB.T });
  s3.begin(new Float32Array(s3.params.length));
  let peak = 0;
  const c3 = (): void => { peak = Math.max(peak, Math.max(s3.doll.soleY('l'), s3.doll.soleY('r'))); };
  const r3 = runCaptureTeacher(sk, s3, { ...FB, hipDy: dy }, { dur: 4, clockDriven: true, onFrame: c3 });
  const hipY = 0.964 - dy;   // ★ CoM.y 实测 0.964（不是躯干高 1.429）
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

// ═══════ 离地高度：lift × 踝 × 重心转移期占比 ═══════
console.log('\n=== 离地高度扫描（需要 ≥30mm 才能算"真迈一步"）===\n');
console.log('  lift   SHIFT  踝    离地峰   存活    换脚');
for (const c of [
  { lf: 0.26, sf: 0.25, an: 12, aw: 15, n: '当前' },
  { lf: 0.26, sf: 0.25, an: 0, aw: 0, n: '踝关' },
  { lf: 0.35, sf: 0.25, an: 12, aw: 15, n: 'lift↑' },
  { lf: 0.35, sf: 0.25, an: 0, aw: 0, n: 'lift↑+踝关' },
  { lf: 0.45, sf: 0.25, an: 0, aw: 0, n: 'lift↑↑+踝关' },
  { lf: 0.35, sf: 0.10, an: 0, aw: 0, n: '转移期10%+踝关' },
  { lf: 0.35, sf: 0.40, an: 0, aw: 0, n: '转移期40%+踝关' },
]) {
  const s9 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 4, gaitHz: 1 / FB.T });
  s9.begin(new Float32Array(s9.params.length));
  let pk = 0;
  const r9 = runCaptureTeacher(sk, s9, { ...FB, lift: c.lf, ankleSwing: c.an, anklePush: c.aw }, { dur: 4, clockDriven: true,
    onFrame: (): void => { pk = Math.max(pk, Math.max(s9.doll.soleY('l'), s9.doll.soleY('r'))); } });
  console.log(`  ${c.lf.toFixed(2)}   ${c.sf.toFixed(2)}   ${c.an > 0 ? '开' : '关'}   ${(pk * 1000).toFixed(0).padStart(4)}mm  ${r9.t.toFixed(2)}s   ${r9.steps}   ${c.n}`);
}

// ═══════ 摆动腿到底被命令成什么样 ═══════
console.log('\n=== 摆动腿指令追踪（s / swingY / swingX / 实际髋膝角）===\n');
{
  const sa = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 2, gaitHz: 1 / FB.T });
  sa.begin(new Float32Array(sa.params.length));
  let printed = 0;
  runCaptureTeacher(sk, sa, FB, { dur: 2, clockDriven: true, onFrame: (_t, _s, _p, _ol, _co, al, dl): void => {
    if (!dl || printed > 9) return;
    printed++;
    const sole = Math.max(sa.doll.soleY('l'), sa.doll.soleY('r'));
    console.log(`  s=${dl.s}  swingY=${dl.swingY}m  swingX=${dl.swingX}m  支撑脚X=${dl.stanceX}m  虚拟髋=${dl.hipY}m`
      + `  |  实际离地 ${(sole * 1000).toFixed(0)}mm  髋指令 ${al?.['hip_r/2']}/${al?.['hip_l/2']}  膝指令 ${al?.['knee_r/2']}/${al?.['knee_l/2']}`);
  } });
}

// ═══════ 存活优先寻优（IK 已修好，这次消融/寻优才有意义）═══════
console.log('\n=== 存活寻优（坐标下降；目标：先站得住，再谈迈步）===\n');
{
  const evalP = (p: Partial<CaptureParams>): { t: number; steps: number; pk: number; torso: number } => {
    const sx = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 6, gaitHz: 1 / FB.T });
    sx.begin(new Float32Array(sx.params.length));
    let pk = 0;
    const r = runCaptureTeacher(sk, sx, { ...FB, ...p }, { dur: 6, clockDriven: true,
      onFrame: (): void => { pk = Math.max(pk, Math.max(sx.doll.soleY('l'), sx.doll.soleY('r'))); } });
    return { t: r.t, steps: r.steps, pk, torso: sx.doll.torso().translation().y };
  };
  const AX: { k: keyof CaptureParams; g: number[] }[] = [
    { k: 'kPitch', g: [-2.0, -1.2, -0.8, -0.4, 0, 0.4, 0.8, 1.6, 2.544] },
    { k: 'kRate', g: [-1.4, -0.8, -0.4, 0, 0.25, 0.542, 1.0] },
    { k: 'kLat', g: [0, 0.5, 1.0, 2.0, 3.5] },
    { k: 'kLatV', g: [0, 0.3, 0.6, 1.2] },
    { k: 'absorb', g: [0, 0.2, 0.4, 0.7, 1.0] },
    { k: 'stancePush', g: [0, 0.05, 0.12, 0.18, 0.28] },
    { k: 'stanceLock', g: [0, 0.3, 0.6, 0.9] },
    { k: 'lift', g: [0.15, 0.20, 0.26, 0.32] },
  ];
  const cost = (r: { t: number; steps: number; pk: number; torso: number }): number =>
    -r.t * 2 - r.steps * 0.6 + Math.max(0, 0.03 - r.pk) * 40 + Math.max(0, 1.35 - r.torso) * 8;
  let best: Partial<CaptureParams> = {};
  let bc = cost(evalP(best));
  const b0 = evalP(best);
  console.log(`  起点：存活 ${b0.t.toFixed(2)}s 换脚 ${b0.steps} 离地峰 ${(b0.pk * 1000).toFixed(0)}mm cost=${bc.toFixed(2)}`);
  for (let round = 0; round < 3; round++) {
    let imp = false;
    for (const ax of AX) for (const v of ax.g) {
      const c = cost(evalP({ ...best, [ax.k]: v }));
      if (c < bc - 1e-3) { bc = c; best = { ...best, [ax.k]: v }; imp = true;
        console.log(`  r${round} ${String(ax.k).padEnd(11)}=${String(v).padEnd(6)} cost=${c.toFixed(2)}`); }
    }
    if (!imp) break;
  }
  const bF = evalP(best);
  console.log(`\n  最优：存活 ${bF.t.toFixed(2)}s  换脚 ${bF.steps}  离地峰 ${(bF.pk * 1000).toFixed(0)}mm  躯干高 ${bF.torso.toFixed(3)}`);
  console.log(`  参数：${JSON.stringify(best)}`);
}

// ═══════ 正反馈消除后，重新标定 HIP_DY ═══════
console.log('\n=== HIP_DY 重标（正反馈已消除）===\n');
console.log('  HIP_DY   锁定虚拟髋高   存活     换脚  离地峰  躯干高(终)');
for (const dy of [0.15, 0.18, 0.22, 0.25, 0.28]) {
  const sb = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 5, gaitHz: 1 / FB.T });
  sb.begin(new Float32Array(sb.params.length));
  let pk = 0;
  const rb = runCaptureTeacher(sk, sb, { ...FB, hipDy: dy }, { dur: 5, clockDriven: true,
    onFrame: (): void => { pk = Math.max(pk, Math.max(sb.doll.soleY('l'), sb.doll.soleY('r'))); } });
  console.log(`  ${dy.toFixed(2).padStart(6)}   ${(0.964 - dy).toFixed(3)}m       ${rb.t.toFixed(2)}s   ${rb.steps}    ${(pk * 1000).toFixed(0).padStart(3)}mm  ${sb.doll.torso().translation().y.toFixed(3)}`);
}

// ═══════ 摆动脚：指令高度 vs 实际高度 ═══════
console.log('\n=== 摆动脚 指令 vs 实际（接地问题）===\n');
{
  const sc = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 2.4, gaitHz: 1 / FB.T });
  sc.begin(new Float32Array(sc.params.length));
  console.log('   t(s)   s    摆动腿  指令高度   实际高度   差值     膝指令   膝实际');
  let n = 0;
  runCaptureTeacher(sk, sc, FB, { dur: 2.4, clockDriven: true, onFrame: (_t, stanceL, _s, _ol, _co, al, dl): void => {
    if (!dl || n++ % 8 !== 0) return;
    const sw = stanceL ? 'R' : 'L';
    const sole = stanceL ? sc.doll.soleY('r') : sc.doll.soleY('l');
    const ki = JOINT_ORDER.indexOf(stanceL ? 'knee_r' : 'knee_l');
    const kAct = sc.doll.jointAngle(ki) * 180 / Math.PI;
    console.log(`  ${String(dl.s).padStart(5)}  ${sw}   ${Number(dl.swingY).toFixed(3)}m   ${sole.toFixed(3)}m    ${(sole - Number(dl.swingY)).toFixed(3).padStart(6)}`
      + `   ${(Number(al?.[`knee_${sw.toLowerCase()}/2`]) * 180 / Math.PI).toFixed(1).padStart(6)}°  ${kAct.toFixed(1).padStart(6)}°`);
  } });
}

// ═══════ 膝的力矩权限：单独给屈曲指令能到多少 ═══════
console.log('\n=== 膝权限测试（站立时单给屈曲指令）===\n');
console.log('  指令θ_ref   实际膝角    误差     脚高度');
{
  const ki = JOINT_ORDER.indexOf('knee_r');
  for (const wantDeg of [-30, -60, -90, -120, -145]) {
    const sd = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 1.2 });
    sd.begin(new Float32Array(sd.params.length));
    const out = new Float32Array(sd.params.length);
    const span = Math.max(Math.abs(sk.joints[ki]!.minRad[2]), Math.abs(sk.joints[ki]!.maxRad[2]));
    out[ki * 3 + 2] = (wantDeg * Math.PI / 180) / (0.9 * span);
    sd.doll.setMotorTargets(out);
    for (let i = 0; i < 90; i++) { sd.doll.driveMotors(1 / 120); sd.world.step(); }
    const got = sd.doll.jointAngle(ki) * 180 / Math.PI;
    console.log(`  ${String(wantDeg).padStart(7)}°  ${got.toFixed(1).padStart(8)}°  ${(got - wantDeg).toFixed(1).padStart(7)}°  ${(sd.doll.soleY('r') * 1000).toFixed(0).padStart(5)}mm`);
  }
  console.log('\n  膝限位 [-145°, +2°]，力矩 150 N·m。若误差很大 ⇒ 是**被体重压住**，不是权限不足。');
}

// ═══════ 马达 kP：解决"移动目标追不上" ═══════
console.log('\n=== 马达 kP / kD 扫描（追踪滞后）===\n');
console.log('   kP    kD    离地峰   存活    换脚');
for (const [kp, kd] of [[9, 1], [18, 1], [30, 1], [45, 1], [45, 2], [70, 2], [100, 3]] as [number, number][]) {
  const se = new Sim(sk, shape, { ...DEFAULT_SIM, mode: "walk", duration: 4, gaitHz: 1 / FB.T, doll: { kP: kp, kD: kd } } as never);
  se.begin(new Float32Array(se.params.length));
  let pk = 0;
  const re = runCaptureTeacher(sk, se, FB, { dur: 4, clockDriven: true,
    onFrame: (): void => { pk = Math.max(pk, Math.max(se.doll.soleY('l'), se.doll.soleY('r'))); } });
  console.log(`  ${String(kp).padStart(4)}  ${String(kd).padStart(4)}   ${(pk * 1000).toFixed(0).padStart(4)}mm  ${re.t.toFixed(2)}s   ${re.steps}`);
}

// ═══════ 关节指令 vs 限位：是否在要求不可能的姿态 ═══════
console.log('\n=== 指令 vs 限位（IK 是否在要求超限姿态）===\n');
console.log('  关节      限位(°)          指令峰(°)   超限?');
{
  const sf = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 2.5, gaitHz: 1 / FB.T });
  sf.begin(new Float32Array(sf.params.length));
  const peak: Record<string, number> = {};
  runCaptureTeacher(sk, sf, FB, { dur: 2.5, clockDriven: true, onFrame: (_t, _s, _p, _o, _c, al): void => {
    if (!al) return;
    for (const [k, v] of Object.entries(al)) peak[k] = peak[k] === undefined ? v : (v > peak[k]! ? v : Math.min(peak[k]!, v));   // 保留符号的极值
  } });
  for (const nm of ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r']) {
    const i = JOINT_ORDER.indexOf(nm);
    if (i < 0) continue;
    const j = sk.joints[i]!;
    const lo = j.minRad[2] * 180 / Math.PI, hi = j.maxRad[2] * 180 / Math.PI;
    // ★ 要按**符号**分别比：之前用绝对值，把"负向限位很大"的膝/踝误判成超限
    const pk = peak[`${nm}/2`] ?? 0;
    const pkd = pk * 180 / Math.PI;
    const over = pk > j.maxRad[2] + 1e-3 || pk < j.minRad[2] - 1e-3;
    console.log(`  ${nm.padEnd(9)} [${lo.toFixed(0)}, ${hi.toFixed(0)}]`.padEnd(26)
      + `${pkd.toFixed(1).padStart(9)}°   ${over ? '★超限' : '✓'}`);
  }
  console.log('\n  判读：★超限 ⇒ IK 在要求关节做不到的姿态，软限位接管 ⇒ 脚到不了目标位置。');
}

// ═══════ 骨骼几何体检：髋 / 膝 / 踝 的真实位置与段长 ═══════
console.log('\n=== 骨骼几何体检（用户：盆骨、踝骨位置都不对）===\n');
{
  const LIMS = ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r'];
  console.log('  关节锚点（构建值，米）：');
  console.log('   关节        x       y       z');
  for (const nm of LIMS) {
    const j = sk.joints.find(q => q.name === nm);
    if (!j) continue;
    console.log(`   ${nm.padEnd(10)} ${j.wx.toFixed(3).padStart(6)}  ${j.wy.toFixed(3).padStart(6)}  ${j.wz.toFixed(3).padStart(6)}`);
  }
  // 真实段长（用锚点，不是像素换算）
  const A = (n: string) => sk.joints.find(q => q.name === n)!;
  const thigh = Math.hypot(A('hip_l').wx - A('knee_l').wx, A('hip_l').wy - A('knee_l').wy, A('hip_l').wz - A('knee_l').wz);
  const shin = Math.hypot(A('knee_l').wx - A('foot_l').wx, A('knee_l').wy - A('foot_l').wy, A('knee_l').wz - A('foot_l').wz);
  console.log(`\n  真实段长： thigh=${thigh.toFixed(3)}m  shin=${shin.toFixed(3)}m  LEG=${(thigh + shin).toFixed(3)}m`);
  console.log(`  teacher 用的常数： LEN_A=0.429  LEN_B=0.398  LEG=0.827`);
  console.log(`  髋高（锚点 y）= ${A('hip_l').wy.toFixed(3)}m   踝高 = ${A('foot_l').wy.toFixed(3)}m`);
  console.log(`\n  ★ 关键：髋高 ${A('hip_l').wy.toFixed(3)}m  vs  腿长 ${(thigh + shin).toFixed(3)}m`
    + (A('hip_l').wy > thigh + shin ? '   ⇒ ★髋比腿还高，腿根本伸不直、脚够不到地' : '   ✓ 够得到'));
  console.log(`  髋间距（z）： hip_l=${A('hip_l').wz.toFixed(3)}  hip_r=${A('hip_r').wz.toFixed(3)}`
    + `  ⇒ ${(Math.abs(A('hip_l').wz - A('hip_r').wz) * 1000).toFixed(0)}mm`);
  console.log(`  踝间距（z）： foot_l=${A('foot_l').wz.toFixed(3)}  foot_r=${A('foot_r').wz.toFixed(3)}`
    + `  ⇒ ${(Math.abs(A('foot_l').wz - A('foot_r').wz) * 1000).toFixed(0)}mm`);
  console.log(`  踝高 ${(A('foot_l').wy * 1000).toFixed(0)}mm（踝应该在脚掌上方，脚掌厚度 + 踝高）`);
}

// ═══════ IK 常数修正后重标 HIP_DY ═══════
console.log('\n=== LEN 修正为实测值后：重标 HIP_DY ═══════');
console.log('  腿长 LEG = 0.785m，髋高 0.849m ⇒ 站立时膝必弯（正常）');
console.log('  HIP_DY   锁定虚拟髋高   存活    换脚  离地峰  躯干高');
for (const dy of [0.02, 0.06, 0.10, 0.14, 0.18, 0.22]) {
  const sg = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 4, gaitHz: 1 / FB.T });
  sg.begin(new Float32Array(sg.params.length));
  let pk = 0;
  const rg = runCaptureTeacher(sk, sg, { ...FB, hipDy: dy }, { dur: 4, clockDriven: true,
    onFrame: (): void => { pk = Math.max(pk, Math.max(sg.doll.soleY('l'), sg.doll.soleY('r'))); } });
  console.log(`  ${dy.toFixed(2).padStart(6)}   ${(0.964 - dy).toFixed(3)}m      ${rg.t.toFixed(2)}s   ${rg.steps}    ${(pk * 1000).toFixed(0).padStart(3)}mm  ${sg.doll.torso().translation().y.toFixed(3)}`);
}

console.log('\n=== HIP_DY 继续往上扫 ===');
console.log('  HIP_DY   虚拟髋高   存活    换脚  离地峰  躯干高');
for (const dy of [0.22, 0.26, 0.30, 0.34, 0.40]) {
  const sh2 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 4, gaitHz: 1 / FB.T });
  sh2.begin(new Float32Array(sh2.params.length));
  let pk = 0;
  const rh = runCaptureTeacher(sk, sh2, { ...FB, hipDy: dy }, { dur: 4, clockDriven: true,
    onFrame: (): void => { pk = Math.max(pk, Math.max(sh2.doll.soleY('l'), sh2.doll.soleY('r'))); } });
  console.log(`  ${dy.toFixed(2).padStart(6)}   ${(0.964 - dy).toFixed(3)}m      ${rh.t.toFixed(2)}s   ${rh.steps}    ${(pk * 1000).toFixed(0).padStart(3)}mm  ${sh2.doll.torso().translation().y.toFixed(3)}`);
}

// ═══════ 骨骼比例：腿/髋比 vs 人体常态 ═══════
console.log('\n=== 骨骼比例体检（用户："盆骨抬得不够高，导致踝部向前会触地"）===\n');
{
  const A2 = (n: string) => sk.joints.find(q => q.name === n)!;
  const hipY = A2('hip_l').wy, ankY = A2('foot_l').wy;
  const LEG = 0.785;
  console.log(`  髋高 ${hipY.toFixed(3)}m   踝高 ${ankY.toFixed(3)}m   腿长 ${LEG.toFixed(3)}m`);
  console.log(`  腿/髋 = ${(LEG / hipY).toFixed(3)}    人体常态 ≈0.95~1.00`);
  console.log(`  ⇒ 本 rig 腿相对躯干偏短 ${(((LEG / hipY) - 0.97) * 100).toFixed(0)}%`);
  console.log(`\n  后果：站立时膝必须弯到 ${(Math.acos(Math.min(1, (0.407 ** 2 + 0.379 ** 2 - (hipY - 0.012) ** 2) / (2 * 0.407 * 0.379))) * 180 / Math.PI).toFixed(0)}° 才能让脚平贴地`);
  console.log(`        踝前摆时腿要折得更狠 ⇒ 踝必然触地（用户报告的现象）。`);
  console.log(`\n  两条修法：`);
  console.log(`   A. 降髋锚点：${hipY.toFixed(3)} → ${(LEG * 0.97).toFixed(3)} m（腿/髋=0.97，接近人体）`);
  console.log(`      代价：髋与大腿的锚点不再贴合素材 ⇒ 大腿根部会有 ${((hipY - LEG * 0.97) * 1000).toFixed(0)}mm 视觉错位`);
  console.log(`   B. 伸长腿段：腿 ${LEG.toFixed(3)} → ${(hipY * 0.97).toFixed(3)} m`);
  console.log(`      代价：大腿/小腿刚体要拉长 ${((hipY * 0.97 - LEG) * 1000).toFixed(0)}mm，纹理会被拉伸变形`);
  console.log(`\n  ★ 两个都是**骨架改动**，会动到原始素材的比例 —— 需要你决定走哪条。`);
}

// ═══════ 落地后的重心转移 ═══════
console.log('\n=== 重心转移：CoM 横向位置 vs 支撑脚（用户：缺乏"落地并转移重心"）===\n');
console.log('   t(s)  支撑脚  支撑脚z   CoM.z    偏移     载荷L/R     状态');
{
  const sz = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 4, gaitHz: 1 / FB.T });
  sz.begin(new Float32Array(sz.params.length));
  const dl2 = new Float64Array(2);
  let n = 0;
  runCaptureTeacher(sk, sz, FB, { dur: 4, clockDriven: true, onFrame: (t, stanceL): void => {
    if (n++ % 10 !== 0) return;
    const gL = footGrounded(sz.doll, 'l'), gR = footGrounded(sz.doll, 'r');
    const nG = (gL ? 1 : 0) + (gR ? 1 : 0);
    sz.doll.soleXZ('l', fbL); sz.doll.soleXZ('r', fbR);
    const stZ = stanceL ? fbL[1]! : fbR[1]!;
    const c2 = readCom(sz.doll, cTmp);
    sz.doll.footLoadFrac(1 / DEFAULT_SIM.controlHz);
    const [fL, fR] = sz.doll.footLoadFrac(1 / DEFAULT_SIM.controlHz);
    console.log(`  ${t.toFixed(2).padStart(5)}   ${stanceL ? 'L' : 'R'}    ${stZ.toFixed(3).padStart(6)}  ${c2.z.toFixed(3).padStart(6)}  ${(c2.z - stZ).toFixed(3).padStart(6)}   ${fL.toFixed(2)}/${fR.toFixed(2)}    支撑${nG}`);
  } });
  void dl2;
}

// ═══════ 重心转移符号验证：正/反/无 ═══════
console.log('\n=== 重心转移符号验证（漂移是否由它造成）===\n');
console.log('  配置              CoM.z 终值    存活    换脚');
for (const c of [
  { n: '当前（+）', p: {} as Partial<CaptureParams> },
  { n: 'kLat 负号', p: { kLat: -3.5 } },
  { n: 'kLat=0（无转移）', p: { kLat: 0, kLatV: 0 } },
  { n: 'kLatV 负号', p: { kLatV: -1.2 } },
]) {
  const sw = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 3, gaitHz: 1 / FB.T });
  sw.begin(new Float32Array(sw.params.length));
  const rw = runCaptureTeacher(sk, sw, { ...FB, ...c.p }, { dur: 3, clockDriven: true });
  const c3 = readCom(sw.doll, cTmp);
  console.log(`  ${c.n.padEnd(18)} ${c3.z.toFixed(3).padStart(8)}   ${rw.t.toFixed(2)}s   ${rw.steps}`);
}

// ═══════ 双脚横向位置（踝是否内收）═══════
console.log('\n=== 双脚横向位置 z（用户："脚踝向内收而不是向外迈"）===\n');
console.log('   t(s)   左脚z    右脚z    间距    髋间距   指令(髋外展)');
{
  const sz2 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 3, gaitHz: 1 / FB.T });
  sz2.begin(new Float32Array(sz2.params.length));
  let m = 0;
  runCaptureTeacher(sk, sz2, FB, { dur: 3, clockDriven: true, onFrame: (t, _s, _p, _o, _c, _a2, dl): void => {
    if (m++ % 12 !== 0) return;
    sz2.doll.soleXZ('l', fbL); sz2.doll.soleXZ('r', fbR);
    console.log(`  ${t.toFixed(2).padStart(5)}  ${fbL[1]!.toFixed(3).padStart(7)}  ${fbR[1]!.toFixed(3).padStart(7)}  ${(Math.abs(fbL[1]! - fbR[1]!) * 1000).toFixed(0).padStart(5)}mm  ${(2 * HIP_Z * 1000).toFixed(0).padStart(5)}mm   z=${dl?.comZ ?? 0}`);
  } });
  console.log('\n  髋间距应 ≈ 250mm（锚点 ±0.125）；骨架踝间距 421mm。');
  console.log('  若双脚 z 持续向 0 靠拢 ⇒ 踝内收，横向支撑面消失。');
}

// ═══════ 横向能力体检：髋外展能否把脚分开 ═══════
console.log('\n=== 横向能力体检 ═══\n');
console.log('  髋外展(轴0)限位 ±45°   膝外展 ±6°（几乎锁死）');
console.log('  ★ IK 是**纯矢状面** ik(hipX,hipY,footX,footY) —— 没有 z 输入');
console.log('    ⇒ 脚的横向位置**完全由髋外展决定**，没有 IK 去摆位。\n');
console.log('   t(s)  髋外展指令L  髋外展指令R   左脚z    右脚z   间距');
{
  const sx = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 2.5, gaitHz: 1 / FB.T });
  sx.begin(new Float32Array(sx.params.length));
  let q = 0;
  runCaptureTeacher(sk, sx, FB, { dur: 2.5, clockDriven: true, onFrame: (t, _s, _p, _o, _c, al): void => {
    if (q++ % 12 !== 0) return;
    sx.doll.soleXZ('l', fbL); sx.doll.soleXZ('r', fbR);
    const l = Number(al?.['hip_l/0'] ?? 0) * 180 / Math.PI;
    const r = Number(al?.['hip_r/0'] ?? 0) * 180 / Math.PI;
    console.log(`  ${t.toFixed(2).padStart(5)}   ${l.toFixed(1).padStart(10)}°  ${r.toFixed(1).padStart(10)}°  ${fbL[1]!.toFixed(3).padStart(7)}  ${fbR[1]!.toFixed(3).padStart(7)}  ${(Math.abs(fbL[1]! - fbR[1]!) * 1000).toFixed(0).padStart(4)}mm`);
  } });
  console.log('\n  判读：若外展指令不小但脚间距仍≈0 ⇒ 外展被矢状面 IK 抵消（脚被拉回竖直平面）');
}

// ═══════ 着地检测 + 重心转移阶段（文献阈值）═══════
console.log('\n=== 着地检测 + 重心转移阶段（文献阈值）===\n');
{
  const se2 = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 4, gaitHz: 1 / FB.T });
  se2.begin(new Float32Array(se2.params.length));
  const trL = new LegEventTracker(), trR = new LegEventTracker();
  let tl = ''; let lastT = 0;
  runCaptureTeacher(sk, se2, FB, { dur: 4, clockDriven: true, onFrame: (t, stanceL): void => {
    const dt = 1 / DEFAULT_SIM.controlHz;
    const evL = trL.step(footGrounded(se2.doll, 'l'), ...([, se2.doll.footLoadFrac(dt)[0]] as [number]), se2.doll.soleY('l'), dt);
    const eR2 = trR.step(footGrounded(se2.doll, 'r'), se2.doll.footLoadFrac(dt)[1], se2.doll.soleY('r'), dt);
    const ev = stanceL ? evL : eR2;
    if (ev) { tl += `${ev}@${t.toFixed(2)}s `; lastT = t; }
    if (Math.abs(t - lastT) > 0.12 && t < 3) {
      console.log(`  t=${t.toFixed(2)}s  支撑${stanceL ? 'L' : 'R'}  ${stanceL ? trL.progress : trR.progress}`);
      lastT = t;
    }
  } });
  console.log(`\n  事件序列：${tl || '（没有任何事件触发）'}`);
}

// ===== 三个根本问题：着地检测有用吗 / 迈出的腿能承重吗 / 关节真能发力吗 =====
console.log('\n=== ① 迈出的腿能承重吗？（刚体自己记的马达冲量 vs 想要的力矩）===\n');
console.log('  关节      想要力矩   实际冲量   比值    声明上限   用满?');
{
  const sm = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 2.5, gaitHz: 1 / FB.T });
  sm.begin(new Float32Array(sm.params.length));
  const dem = new Float64Array(sm.doll.jointCount * 3);
  const imp = new Float64Array(sm.doll.jointCount * 3);
  const cnt = new Float64Array(sm.doll.jointCount * 3);
  runCaptureTeacher(sk, sm, FB, { dur: 2.5, clockDriven: true, onFrame: (): void => {
    for (let i = 0; i < dem.length; i++) {
      if (Math.abs(sm.doll.motorDemand[i]!) > Math.abs(dem[i]!)) dem[i] = sm.doll.motorDemand[i]!;
      if (Math.abs(sm.doll.motorImpulse[i]!) > Math.abs(imp[i]!)) imp[i] = sm.doll.motorImpulse[i]!;
      cnt[i]++;
    }
  } });
  for (const nm of ['hip_l', 'hip_r', 'knee_l', 'knee_r', 'foot_l', 'foot_r']) {
    const i = JOINT_ORDER.indexOf(nm);
    if (i < 0) continue;
    const j = sk.joints[i]!;
    for (const [ax, lbl] of [[2, '屈伸'], [0, '外展']] as [number, string][]) {
      const k = i * 3 + ax;
      const d = dem[k]!, mI = imp[k]!;
      // ★ motorImpulse 是**冲量**(N·m·s)，motorDemand 是**力矩**(N·m)
      //   ⇒ 必须除以物理步长折回力矩，否则会误判成"只用了 1%"（量纲错误）。
      const dt = 1 / DEFAULT_SIM.physicsHz;
      const m = mI / dt;
      const cap = j.maxTorque[ax];
      const ratio = Math.abs(d) > 1e-6 ? Math.abs(m) / Math.abs(d) : 1;
      const use = Math.abs(m) / cap;
      console.log(`  ${nm.padEnd(7)}${lbl}  ${d.toFixed(1).padStart(8)}  ${m.toFixed(1).padStart(8)}  ${ratio.toFixed(2).padStart(5)}   ${cap.toFixed(0).padStart(7)}   ${use > 0.8 ? '✓ 用满' : use > 0.3 ? '△ ' + (100 * use).toFixed(0) + '%' : '✗ 只用了 ' + (100 * use).toFixed(0) + '%'}`);
    }
  }
  console.log('\n  判读：「比值」≪1 ⇒ 被稳定性护栏削掉（不敢用力）；比值≈1 但实际≪上限 ⇒ 关节没力气。');
  console.log('        「用满?」✗ ⇒ 关节几乎没出力 ⇒ 它根本撑不住体重。');
}

// ===== 载荷到底转不转过去 =====
console.log('\n=== ② 载荷转移：两条腿的承重占比 ===\n');
console.log('   t(s)  支撑   载荷L   载荷R   CoM偏移   重心阶段');
{
  const sl = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 3, gaitHz: 1 / FB.T });
  sl.begin(new Float32Array(sl.params.length));
  let m = 0;
  runCaptureTeacher(sk, sl, FB, { dur: 3, clockDriven: true, onFrame: (t, stanceL): void => {
    if (m++ % 10 !== 0) return;
    const [fl, fr] = sl.doll.footLoadFrac(1 / DEFAULT_SIM.controlHz);
    const c2 = readCom(sl.doll, cTmp);
    sl.doll.soleXZ('l', fbL); sl.doll.soleXZ('r', fbR);
    const stZ = stanceL ? fbL[1]! : fbR[1]!;
    console.log(`  ${t.toFixed(2).padStart(5)}   ${stanceL ? 'L' : 'R'}   ${fl.toFixed(2)}    ${fr.toFixed(2)}   ${(c2.z - stZ).toFixed(3).padStart(7)}`);
  } });
  console.log('\n  判读：载荷长期停在 0.5/0.5 ⇒ 重心没转；某腿长期 0.8+ ⇒ 转过去了但可能转错腿。');
}
// ===== 横向外展符号验证 =====
console.log('\n=== ③ 横向外展符号（左脚 z 应往 +z 走）===\n');
console.log('  配置                    左脚z    右脚z    载荷L/载荷R   CoM.z');
for (const c of [
  { n: '当前 kLat=+3.5', p: { kLat: 3.5, kLatV: 1.2 } as Partial<CaptureParams> },
  { n: 'kLat=-3.5（翻符号）', p: { kLat: -3.5, kLatV: -1.2 } as Partial<CaptureParams> },
  { n: 'kLat=+12 强', p: { kLat: 12, kLatV: 2 } as Partial<CaptureParams> },
  { n: 'kLat=-12 强', p: { kLat: -12, kLatV: -2 } as Partial<CaptureParams> },
]) {
  const ss = new Sim(sk, shape, { ...DEFAULT_SIM, mode: 'walk', duration: 2.5, gaitHz: 1 / FB.T });
  ss.begin(new Float32Array(ss.params.length));
  runCaptureTeacher(sk, ss, { ...FB, ...c.p }, { dur: 2.5, clockDriven: true });
  ss.doll.soleXZ('l', fbL); ss.doll.soleXZ('r', fbR);
  const [fl, fr] = ss.doll.footLoadFrac(1 / DEFAULT_SIM.controlHz);
  const c2 = readCom(ss.doll, cTmp);
  console.log(`  ${c.n.padEnd(24)} ${fbL[1]!.toFixed(3).padStart(7)}  ${fbR[1]!.toFixed(3).padStart(7)}   ${fl.toFixed(2)}/${fr.toFixed(2)}      ${c2.z.toFixed(3)}`);
}
console.log('\n  判读：脚 z 分得开 ⇒ 外展生效；载荷集中到指令支撑腿 ⇒ 符号对。');