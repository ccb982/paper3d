/**
 * ══════════════════════════════════════════════════════════════════
 * probe-firstframes.ts —— **最初的命令到底下了什么、是不是"用力太狠"**
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06：
 *   「你需要读最开始的几帧，看看都下了什么命令，这些命令感觉是不是用力太狠了，
 *     导致了摔倒」
 *
 * 此前 `probe:sagchain` 在第一拍（t=0.00）就测得：
 *   `hip_l τ=200`（顶到 τmax）、`foot_l τ=−120`（顶到）、`spine1 τ=−120`（顶到）、
 *   腰 τ=−120（顶到），而髋的**相对角速度已经是 608°/s**。
 * ⇒ 强烈怀疑：开局所有马达直接顶轨 ⇒ 一记砸下去的冲量 ⇒ 从第 1 拍就失稳。
 *
 * 本探针逐拍（前 24 个控制拍 = 0.4s）打印：
 *   ① 每根轴的**角度命令** `motorTarget`（归一化 −1..1，斜坡限制 `slewLimit=8/s`）
 *   ② 关节实际角（deg）与**命令误差**
 *   ③ 实际施加的 τ 与是否**顶到 τmax**（← "用力太狠"的直接证据）
 *   ④ 谁的请求（owner）与让位掩码（holdMask）
 *   ⑤ 该轴相对角速度（°/s，看砸出来的速度）
 *   ⑥ 每拍统计：顶轨轴数 / 最大 |τ|/τmax / 最大 |ω|
 *
 * 用法：node tools/run.mjs probe-firstframes
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
{
  const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as any;
  const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name];
    if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const log = (s: string) => console.log(s);
const HZ = 60, DT = 1 / HZ;   // ★ 控制拍 60Hz（`i % 2 === 0` 时调 step）

// ★ 命令行可传消融名单：`node tools/run.mjs probe-firstframes "sagJf,ankleCop,…"`
//   ⚠⚠ **不能读 `process.argv`**：打包产物是独立文件，看到的只有打包器参数
//     （`_bundle.mjs:72` 专门记了这个坑"实测三次都拿不到"）。走 `__PROBE_ARGS`。
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const ABLATE = (ARGS[0] ?? '').trim();
// ★ `nocontrol` = **完全不调 `ctrl.step`**（连 `setMotorTargets` 都不调）
//   ⇒ 把"物理/引擎层"与"任何控制输出"彻底分离。
const NOCONTROL = ARGS.includes('nocontrol');
// ★ `zero` = 只把**全零目标**喂给马达（`setMotorTargets(0)`），不调 `ctrl.step`。
//   用途：把 `driveMotors` 本身从 `ctrl.step` 的其余部分里**分离**出来 ——
//   若零目标也会砸，那问题在马达层（PD/限位/让位），不在任何控制律。
const ZERO = ARGS.includes('zero');
if (ABLATE) log(`   （消融：${ABLATE}）`);
if (NOCONTROL) log('   （★ nocontrol：完全不调 ctrl.step —— 排除一切控制输出）');
if (ZERO) log('   （★ zero：只喂全零目标给马达，不调 ctrl.step —— 隔离 driveMotors）');

const sk = buildSkeleton(DEFAULT_CONFIG);
// ★ A/B：引擎电机（`arch_*`/`mfoot_*`，Rapier 力模式电机、K≈400）的刚度扫
//   假说：零命令下"速度指数增长（31→276°/s）"来自这一类**不受 `motorAlpha` 管**的执行器。
const AS = Number(process.env.ARCH_STIFF ?? NaN);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), {
  ...DEFAULT_SIM, mode: 'stand', duration: 1.0,
  doll: Number.isFinite(AS) ? { archStiffness: AS, midfootStiffness: AS } : undefined,
});
if (Number.isFinite(AS)) log(`（ARCH_STIFF=${AS}）`);
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  // ★ A/B：整条 τ 层消融（`ABL=all`）—— 判别"恒定加速度"来自 τ 层还是接触/限位层
  balance: { ...DEFAULT_CONTROLLER.balance, ablate: process.env.ABL || undefined },
});
const d = sim.doll;
const rv = new Float64Array(3);
const ZEROS = new Float32Array(sk.joints.length * 3);

// 只看这几个关节（腿 + 腰；其余同理）
const KEYS = ['hip_l', 'knee_l', 'foot_l', 'hip_r', 'knee_r', 'foot_r', 'spine1'];
const AI = KEYS.map((n) => ({ n, i: jointIndexByName(sk, n) }));

// ── ★ 开局姿态检查：有没有关节**本来就在限位外/贴限位** ──
//   若有 ⇒ `driveMotors` 的软限位分支会以 `JOINT_MAX_SPEED` 满力回程，
//   那一砸与"命令"无关，是**初始姿态越界**造成的。
log('══ 开局姿态 vs 限位（`sim.begin()` 之后、任何控制之前）══');
{
  const NAMES = ['hip_l', 'knee_l', 'foot_l', 'hip_r', 'knee_r', 'foot_r', 'spine1', 'spine2', 'spine3'];
  let nOut = 0, nNear = 0;
  for (const nm of NAMES) {
    const ji = jointIndexByName(sk, nm);
    if (ji < 0) continue;
    const jdef = sk.joints[ji]!;
    const rvv = new Float64Array(3);
    d.jointRot(ji, rvv);
    const parts: string[] = [];
    for (let k = 0; k < 3; k++) {
      const lo = (jdef.minRad[k] ?? 0) * 57.2958, hi = (jdef.maxRad[k] ?? 0) * 57.2958;
      if (jdef.revoluteAxis && jdef.revoluteAxis[k] === 0) continue;   // 引擎锁死的轴不算
      const a = rvv[k]! * 57.2958;
      const out = a > hi + 1e-6 || a < lo - 1e-6;
      const near = !out && (Math.abs(a - hi) < 2 || Math.abs(a - lo) < 2);
      if (out) nOut++;
      if (near) nNear++;
      parts.push(`轴${k} ${a.toFixed(1)}°/[${lo.toFixed(0)},${hi.toFixed(0)}]`
        + (out ? ' ⚠越界' : near ? ' 贴限位' : ''));
    }
    log(`   ${nm.padEnd(7)} ${parts.join('   ')}`);
  }
  log(`   ⇒ 越界 ${nOut} 轴、贴限位(2°内) ${nNear} 轴`);
}
log('');
log('══ 最初几帧：角度命令 / 实际角 / τ / 顶轨 / 归属 / 让位 / 角速度 ══');
log('   （命令 = `motorTarget` 归一化值 −1..1；τmax 见每轴；⚠ = 顶到 τmax）');
log('');

let prev = 0;
for (let i = 0; i < 1.0 * 120 && !sim.finished; i++) {
  if (i % 2 === 0) {
    if (ZERO) d.setMotorTargets(ZEROS);
    else if (!NOCONTROL) d.setMotorTargets(ctrl.step(DT));
  }
  sim.advance(1);
  if (i % 2 !== 0) continue;                 // 只看控制拍
  const rs = ctrl.rs;
  const tick = i / 2;

  // 每拍统计
  let sat = 0, maxFrac = 0, maxW = 0;
  for (let a = 0; a < sk.joints.length * 3; a++) {
    const j = sk.joints[Math.floor(a / 3)]!;
    const tmax = j.maxTorque[a % 3] ?? 0;
    const t = Math.abs(d.tauApplied[a] ?? 0);
    if (tmax > 0) {
      const frac = t / tmax;
      if (frac > maxFrac) maxFrac = frac;
      if (frac > 0.995) sat++;
    }
  }
  for (let jj = 0; jj < sk.joints.length; jj++) {
    d.jointRelVel(jj, rv);
    const w = Math.abs(rv[2]!) * 57.2958;
    if (w > maxW) maxW = w;
  }

  if (tick === 0) {
    // ★ 逐关节找"被砸飞"的那根（第 0 拍就已 610°/s ⇒ 一个物理步内产生）
    const spd: string[] = [];
    for (let jj = 0; jj < sk.joints.length; jj++) {
      d.jointRelVel(jj, rv);
      const w = Math.hypot(rv[0]!, rv[1]!, rv[2]!) * 57.2958;
      if (w > 20) spd.push(`${sk.joints[jj]!.name}:${w.toFixed(0)}°`);
    }
    log(`     ★ 第 0 拍 |ω|>20°/s 的关节：${spd.length ? spd.join('  ') : '（无）'}`);
  }
  log(`── 拍 ${String(tick).padStart(2)}　t=${(i / 120).toFixed(3)}s　`
    + `顶轨轴 ${String(sat).padStart(2)} 根　max|τ|/τmax ${(maxFrac * 100).toFixed(0)}%　`
    + `max|ω| ${maxW.toFixed(0)}°/s　状态 ${rs.state}　CoM.y ${rs.com.y.toFixed(3)}`);
  // ★★★ 逐拍**物理状态行**（用户：「查前 0.1s，一开始明明没问题，到底发生了什么」）
  {
    const gc0 = rs.groundChain;
    const copW = [gc0?.l, gc0?.r].filter((x: any) => x?.copValid);
    const copX = copW.length
      ? copW.reduce((a: number, x: any) => a + x.fz * x.copX, 0) / copW.reduce((a: number, x: any) => a + x.fz, 0)
      : NaN;
    log(`      物理： CoM.x ${(rs.com.x * 1000).toFixed(1).padStart(6)}mm  `
      + `v.x ${(rs.com.vx * 1000).toFixed(1).padStart(7)}mm/s  `
      + `CoM.z ${(rs.com.z * 1000).toFixed(1).padStart(6)}  `
      + `CoP.x ${Number.isFinite(copX) ? (copX * 1000).toFixed(1).padStart(6) : '  --  '}mm  `
      + `踝轴x ${(() => { const a = new Float64Array(3); d.jointWorld(jointIndexByName(sk, 'foot_l'), a); return (a[0]! * 1000).toFixed(0); })().padStart(5)}mm  `
      + `pitch ${(rs.pitchDeg ?? 0).toFixed(2).padStart(6)}°  roll ${(rs.rollDeg ?? 0).toFixed(2).padStart(6)}°  `
      + `紧迫度 ${(rs.fall.urgency ?? 0).toFixed(2)}  ${rs.fall.region}`);
    // ★★ 冲量 vs 有效惯量：找出"上劲"到底是哪个冲量给的（Δω = imp/I_eff）
    {
      let bi = -1, bv = 0;
      for (let a2 = 0; a2 < d.motorImpulse.length; a2++) {
        const v2 = Math.abs(d.motorImpulse[a2] ?? 0);
        if (v2 > bv) { bv = v2; bi = a2; }
      }
      if (bi >= 0) {
        const jj2 = Math.floor(bi / 3), k2 = bi % 3;
        const Ie = (d as any).jointIeff?.[jj2] ?? NaN;
        const dW = Number.isFinite(Ie) && Ie > 0 ? (bv / Ie) * 57.2958 : NaN;
        log(`      冲量： 最大轴 ${sk.joints[jj2]!.name}/${k2}  `
          + `imp ${(bv * 1e6).toFixed(1).padStart(8)}e-6 N·m·s  `
          + `I_eff ${Number.isFinite(Ie) ? Ie.toFixed(5) : '--'} kg·m²  `
          + `⇒ Δω ${Number.isFinite(dW) ? dW.toFixed(0) : '--'}°/s  `
          + `(τ等效 ${(bv / (1 / 120) / 1).toFixed(1)} N·m)`);
      }
    }
  }

  for (const { n, i: ji } of AI) {
    if (ji < 0) continue;
    d.jointRot(ji, rv);
    const jdef = sk.joints[ji]!;
    const cells: string[] = [];
    for (let k = 0; k < 3; k++) {
      const idx = ji * 3 + k;
      const tmax = jdef.maxTorque[k] ?? 0;
      if (tmax <= 0) continue;
      const cmd = d.motorTarget[idx] ?? 0;
      const tau = d.tauApplied[idx] ?? 0;
      const ang = (-rv[k]! * 57.2958);
      const frac = Math.abs(tau) / tmax;
      const hold = rs.holdMask[idx] ?? 0;
      const own = rs.axisOwner(idx);
      const br = d.motorBranch[idx] ?? 0;
      const BR: Record<number, string> = { 0: '—', 1: 'PD', 2: '让位', 3: '越上限', 4: '越下限' };
      const brS = BR[br] ?? String(br);
      const tRef = ((d.motorThRef[idx] ?? 0) * 57.2958);
      const eRv = ((d.motorErr[idx] ?? 0) * 57.2958);
      // ★ τ 分量分解（rad/s 量纲）：P=弹簧 D=阻尼 FF=力矩通道
      const eP = ((d.motorErrP[idx] ?? 0) * 57.2958);
      const eD = ((d.motorErrD[idx] ?? 0) * 57.2958);
      const eF = ((d.motorTauFF[idx] ?? 0));
      const comp = (Math.abs(eP) > 3 || Math.abs(eD) > 3)
        ? `{P${eP.toFixed(0)} D${eD.toFixed(0)}${Math.abs(eF) > 0.5 ? ' FF' + eF.toFixed(0) : ''}}` : '';
      cells.push(`轴${k}[${brS}${br >= 3 ? '★' : ''}${Math.abs(tRef) > 0.2 ? ' tRef' + tRef.toFixed(0) + '°' : ''}`
        + `${Math.abs(eRv) > 5 ? ' err' + eRv.toFixed(0) : ''}${comp}] `
        + `cmd${cmd >= 0 ? '+' : ''}${cmd.toFixed(2)}`
        + ` 角${ang.toFixed(0).padStart(4)}° τ${tau.toFixed(0).padStart(4)}`
        + `${frac > 0.995 ? '⚠' : ' '}${(frac * 100).toFixed(0).padStart(3)}%`
        + ` [${own}${hold ? `/让位${hold}` : ''}]`);
    }
    log(`     ${n.padEnd(7)} ${cells.join('  ')}`);
  }
  if (tick >= 8) break;                      // 前 9 个控制拍足够看清"开局那一砸"
  prev = tick;
}

log('');
log(`   ⇒ 判读要点：若第 1~2 拍就出现「顶轨轴」且 max|ω| 上百 °/s，`);
log(`     说明开局那一记冲量是**直接顶轨**砸下去的（不是渐入）—— 那就是"用力太狠"。`);
