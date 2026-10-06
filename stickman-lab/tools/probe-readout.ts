/**
 * probe-readout.ts —— **完整回读**：每一拍到底发生了什么
 *
 * ════════════════════════════════════════════════════════════════════════
 * 为什么需要这个（用户 2026-10-06：「进行一次完整回读，现在的干净是腰椎不发力」）
 *
 *   本项目最贵的一类故障是**静默失效**：`τ ≡ 0`、目标 ≡ 0、让位 ≡ 0
 *   看起来"干净"，但既可能是「机制正确地判定为不需要出力」，
 *   也可能是「机制根本没接上」。两者在存活/倾角指标里**完全一样**。
 *   （历史上栽过：踝只能出 3% 的力矩而所有指标正常；
 *     `setMotorTargets` 480 拍调用 0 次而仲裁器算出了 10 项非零目标。）
 *
 *   ⇒ 这个探针不给结论，只给**事实**，并且把「谁在驱动、出了多大力、
 *     被什么卡住、接触力实际是多少、QP 要求多少」摆在一起对读。
 *
 *   重点：**腰椎**（`spine1/2/3` 的 9 根轴）。用户指出"现在的干净是腰椎不发力"，
 *   而 `AXIS_OWNERSHIP` 里腰椎只有 `postureSag`(pos)、`postureLat`(pos)、
 *   `wholeBodyQp`(tau) 三条记录 —— τ 通道上**只有 QP**。
 *   ⇒ 要回答「腰椎不出力」是(α)机制判定它不需要，还是 (β) 没接上，
 *     必须同时看：owner / target / τ / authority / 位置误差。
 *
 * 用法：node tools/run.mjs probe-readout [秒数] [采样点数]
 * ════════════════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
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
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { centroidal, newCentroidalState } = await import('../src/core/centroidal');
const { solveGrfQp } = await import('../src/core/systems/grfQp');
import type { Contact } from '../src/core/systems/grfQp';

const log = console.log;
const SECS = Number(process.env.RO_SECS ?? 1.2);
const NSAMP = Number(process.env.RO_NSAMP ?? 6);
const PHYS_HZ = DEFAULT_SIM.physicsHz;
const CTRL_HZ = DEFAULT_SIM.controlHz;
const PHYS_PER_CTRL = Math.max(1, Math.round(PHYS_HZ / CTRL_HZ));

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const NAX = sk.joints.length * 3;

// ══ ① 轴归属全图 ══════════════════════════════════════════════════════
log('╔══ ① 轴归属全图（54 根轴，flat = joint*3 + axis）══════════════════════════╗');
{
  const rows: string[] = [];
  for (let j = 0; j < sk.joints.length; j++) {
    const jn = sk.joints[j]!.name;
    const lo = jn.indexOf('_');
    const base = lo > 0 ? jn.slice(0, lo) : jn;
    rows.push(`  ${String(j).padStart(2)} ${jn.padEnd(11)} → 轴 ${base}/0=${String(j * 3).padStart(2)}`
      + `  ${base}/1=${String(j * 3 + 1).padStart(2)}  ${base}/2=${String(j * 3 + 2).padStart(2)}`
      + `   τmax=[${sk.joints[j]!.maxTorque.map((v) => v.toFixed(0)).join(',')}]`);
  }
  log(rows.join('\n'));
  log(`  合计 ${sk.joints.length} 关节 × 3 = ${NAX} 轴`);
}

// ══ 跑仿真 ══════════════════════════════════════════════════════════════
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const cs = newCentroidalState();
const COPB = new Float64Array(4);
const BBB = new Float64Array(4);
const TMPJ = new Float64Array(3);

interface Samp {
  tSec: number;
  owner: string[];
  target: Float32Array;
  tau: Float32Array;
  hold: number[];
  auth: Float32Array;
  pos: Float64Array;
  cop: [number, number, number, number][];
  fTot: [number, number, number];
  zmpMeas: [number, number];
  qpZmp: [number, number];
  qpFeas: boolean;
  qpChecks: Record<string, boolean>;
}
const samples: Samp[] = [];
/** ⑦ 用的腰椎时间序列：每个物理步读一次（不是每控制拍） */
const spineTrace: { t: number; ang: Float64Array; tau: Float64Array }[] = [];
let totTauByJoint = new Float64Array(sk.joints.length * 3);
let maxAuthByAxis = new Float64Array(NAX);

const nTicks = Math.round(SECS * PHYS_HZ);
const every = Math.max(1, Math.floor(nTicks / (NSAMP * PHYS_PER_CTRL)));
let k = 0;
for (let i = 0; i < nTicks && !sim.finished; i++) {
  if (i % PHYS_PER_CTRL === 0) {
    const out = ctrl.step(1 / CTRL_HZ);
    sim.doll.setMotorTargets(out);
    // ★ 质心动量（每**控制拍**推一次，dt 用真实墙钟）
    centroidal(sim.doll, cs);
    const take = (i / PHYS_PER_CTRL) % every === 0;
    if (take || i === nTicks - PHYS_PER_CTRL) {
      const owner: string[] = [];
      for (let a = 0; a < NAX; a++) owner.push(ctrl.rs.axisOwner(a));
      const cop: [number, number, number, number][] = [];
      for (const s of [0, 1] as const) { sim.doll.readCoP(s, COPB); cop.push([...COPB] as any); }
      // 实测 ZMP（按法向力加权；法向力 = Σλ × physicsHz）
      let w = 0, zx = 0, zz = 0;
      for (let s = 0; s < 2; s++) {
        const fN = cop[s]![3]! * PHYS_HZ;
        if (fN > 1e-6) { w += fN; zx += fN * cop[s]![0]!; zz += fN * cop[s]![2]!; }
      }
      // λ-QP：给零速零加速度需求（静态），看它**要求**多少
      const contacts: Contact[] = [0, 1].map((s) => {
        sim.doll.footSoleBounds(s as 0 | 1, BBB);
        return {
          x: (BBB[0]! + BBB[1]!) / 2, y: BBB[2]!, z: (BBB[2]! + BBB[3]!) / 2,
          copX: [BBB[0]!, BBB[1]!], copZ: [BBB[2]!, BBB[3]!],
          active: sim.doll.footGrounded(s as 0 | 1),
        };
      });
      const qp = solveGrfQp({
        contacts, cs, aDesX: -1.0, aDesY: 0, aDesZ: -1.0,   // 要 1 m/s² 回中
      });
      samples.push({
        tSec: i / PHYS_HZ,
        owner,
        target: Float32Array.from(out),
        tau: Float32Array.from(ctrl.rs.tauOut),
        hold: ctrl.rs.holdMask.slice(0, NAX),
        auth: Float32Array.from(sim.doll.motorAuthority),
        pos: Float64Array.from(ctrl.rs.pos),
        cop,
        fTot: [cop[0]![3]! * PHYS_HZ, 0, cop[1]![3]! * PHYS_HZ],
        zmpMeas: w > 1e-6 ? [zx / w, zz / w] : [NaN, NaN],
        qpZmp: qp.zmp,
        qpFeas: qp.feasible,
        qpChecks: qp.checks as any,
      });
    }
    for (let a = 0; a < NAX; a++) {
      totTauByJoint[a] = Math.max(totTauByJoint[a]!, Math.abs(ctrl.rs.tauOut[a] ?? 0));
      maxAuthByAxis[a] = Math.max(maxAuthByAxis[a]!, sim.doll.motorAuthority[a] ?? 1);
    }
  }
  sim.advance(1);
  // ⑦ 脊柱逐**物理步**（240Hz）记录：限位与马达在同一时间尺度上比
  {
    const ang = new Float64Array(NAX);
    for (let jj = 0; jj < sk.joints.length; jj++) {
      sim.doll.jointRot(jj, TMPJ);
      ang[jj * 3] = TMPJ[0]!; ang[jj * 3 + 1] = TMPJ[1]!; ang[jj * 3 + 2] = TMPJ[2]!;
    }
    spineTrace.push({ t: i / PHYS_HZ, ang, tau: Float64Array.from(ctrl.rs.tauOut) });
  }
  k++;
}

// ══ ② 质心动量 ═══════════════════════════════════════════════════════════
log('');
log('╔══ ② 质心动量（centroidal.ts 的输出，末拍）════════════════════════════╗');
log(`║  m       = ${cs.m.toFixed(2)} kg`);
log(`║  c       = (${cs.cx.toFixed(4)}, ${cs.cy.toFixed(4)}, ${cs.cz.toFixed(4)}) m`);
log(`║  v_c     = (${cs.vx.toFixed(4)}, ${cs.vy.toFixed(4)}, ${cs.vz.toFixed(4)}) m/s`);
log(`║  h_c     = (${cs.hx.toFixed(3)}, ${cs.hy.toFixed(3)}, ${cs.hz.toFixed(3)}) kg·m²/s`);
log(`║  ḣ_c     = (${cs.dhx.toFixed(3)}, ${cs.dhy.toFixed(3)}, ${cs.dhz.toFixed(3)}) N·m/s  ready=${cs.dhReady}`);
log(`║  I_c 对角 = (${cs.Ic[0]!.toFixed(3)}, ${cs.Ic[4]!.toFixed(3)}, ${cs.Ic[8]!.toFixed(3)}) kg·m²`);
log(`║  I_c 非对角 = ${cs.Ic[1]!.toFixed(3)}, ${cs.Ic[2]!.toFixed(3)}, ${cs.Ic[3]!.toFixed(3)}, ${cs.Ic[5]!.toFixed(3)}, ${cs.Ic[6]!.toFixed(3)}, ${cs.Ic[7]!.toFixed(3)}`);
log(`║  tr(I_c) = ${(cs.Ic[0]! + cs.Ic[4]! + cs.Ic[8]!).toFixed(3)} kg·m²   ⇒ 体高量级 ${(Math.cbrt(3 * (cs.Ic[0]! + cs.Ic[4]! + cs.Ic[8]!) / cs.m) * 1000).toFixed(0)} mm`);

// ══ ③ 接触力实测 vs λ-QP 要求 ══════════════════════════════════════════
log('');
log('╔══ ③ 接触力：实测 vs λ-QP 要求（每拍）════════════════════════════════╗');
log('║   t(s)   左Fz(N)  右Fz(N)  ΣFz(N)   占体重%   ZMP实测(x,z)        ZMP_QP(x,z)        QP');
for (const s of samples) {
  const l = s.cop[0]![3]! * PHYS_HZ, r = s.cop[1]![3]! * PHYS_HZ;
  const tot = l + r;
  log(`║  ${s.tSec.toFixed(3).padStart(6)}  ${l.toFixed(1).padStart(8)} ${r.toFixed(1).padStart(8)}`
    + ` ${tot.toFixed(1).padStart(9)}  ${(100 * tot / cs.m / 9.81).toFixed(1).padStart(7)}%`
    + `  (${s.zmpMeas[0].toFixed(4)},${s.zmpMeas[1].toFixed(4)})`.padEnd(22)
    + `  (${s.qpZmp[0].toFixed(4)},${s.qpZmp[1].toFixed(4)})`.padEnd(22)
    + `  ${s.qpFeas ? '✓' : '✗ ' + JSON.stringify(s.qpChecks)}`);
}
const lastS = samples[samples.length - 1];
if (lastS) {
  const tot = (lastS.cop[0]![3]! + lastS.cop[1]![3]!) * PHYS_HZ;
  log(`║  体重 m·g = ${(cs.m * 9.81).toFixed(1)} N    实测 ΣF_z = ${tot.toFixed(1)} N`
    + `    比值 = ${(tot / (cs.m * 9.81)).toFixed(3)}`);
  log(`║  ⇒ ★ 这个比值就是「竖向撑住了多少」。1.00 = 撑满；<1 = 还在往下沉；>1 = 有余量。`);
}

// ══ ④ 逐轴回读（末拍）═══════════════════════════════════════════════════
log('');
log('╔══ ④ 逐轴回读（末拍）owner / 目标 / τ / 让位 / 权限 / 位置══════════════╗');
log('║ 轴              owner   标签/系统        目标      τ(N·m)   让位  权限   角度°');
const TG = ctrl.snapshot.axes;
for (let a = 0; a < NAX; a++) {
  const s = lastS!;
  const j = Math.floor(a / 3), ax = a % 3;
  const jn = sk.joints[j]!.name;
  const own = s.owner[a]!;
  const tag = TG[a]?.ownerLabel ?? '—';
  const tg = s.target[a]!;
  const tq = s.tau[a]!;
  const hd = s.hold[a]!;
  const au = s.auth[a]!;
  const pos = s.pos[a]! * 57.2958;
  const isSpine = /^spine/.test(jn);
  const mark = isSpine ? '◆' : own === 'bind' ? ' ' : '█';
  log(`║ ${mark}${jn}/${ax}`.padEnd(20)
    + `${own.padEnd(7)} ${tag.slice(0, 16).padEnd(17)}`
    + `${tg.toFixed(3).padStart(7)} ${tq.toFixed(1).padStart(9)}`
    + `${String(hd).padStart(5)} ${au.toFixed(3).padStart(6)} ${pos.toFixed(1).padStart(8)}`);
}
log('║ 图例：◆ = 腰椎   █ = 本拍真有人写   (空) = bind（仲裁兜底保持绑定姿态）');

// ══ ⑤ 腰椎专段 ══════════════════════════════════════════════════════════
log('');
log('╔══ ⑤ 腰椎专段（用户指出：现在的"干净"是腰椎不发力）════════════════╗');
log('║ 轴             owner   τ最大(N·m)  末拍τ   末拍目标   位置(°)   轴限位(°)');
for (let j = 0; j < sk.joints.length; j++) {
  const jn = sk.joints[j]!.name;
  if (!/^spine/.test(jn)) continue;
  const J = sk.joints[j]!;
  for (let ax = 0; ax < 3; ax++) {
    const a = j * 3 + ax;
    const pos = lastS!.pos[a]! * 57.2958;
    log(`║ ${jn}/${ax}`.padEnd(17)
      + `${(lastS!.owner[a] ?? '?').padEnd(7)}`
      + `${J.maxTorque[ax]!.toFixed(0).padStart(8)}  ${lastS!.tau[a]!.toFixed(2).padStart(8)}`
      + `${lastS!.target[a]!.toFixed(4).padStart(10)}  ${pos.toFixed(2).padStart(9)}`
      + `  [${(J.minRad[ax]! * 57.2958).toFixed(0)}, ${(J.maxRad[ax]! * 57.2958).toFixed(0)}]`);
  }
}
log('║ ⇒ 判断「腰椎不发力」是 (α)机制判定不需要  还是 (β)根本没接上：');
log('║    · 位置环通道：看「目标」列。若目标 ≈ 0 且位置误差也很小 ⇒ 判定不需要。');
log('║    · 力矩通道：看「τ」列。τ ≡ 0 且目标非 0 ⇒ ★ 才是"没接上"。');
const spineJ = sk.joints.map((j, i) => ({ j, i })).filter((x) => /^spine/.test(x.j.name));
let spineTauMax = 0, spineTgtMax = 0, spineErrMax = 0;
for (const { j, i } of spineJ) {
  for (let ax = 0; ax < 3; ax++) {
    const a = i * 3 + ax;
    spineTauMax = Math.max(spineTauMax, Math.abs(lastS!.tau[a]!));
    spineTgtMax = Math.max(spineTgtMax, Math.abs(lastS!.target[a]!));
    const dd = sk.joints[i]!.maxRad[ax]! - sk.joints[i]!.minRad[ax]!;
    spineErrMax = Math.max(spineErrMax, Math.abs(lastS!.pos[a]!) / Math.max(1e-9, dd));
  }
}
log(`║  腰椎：末拍 |τ| 最大 = ${spineTauMax.toFixed(2)} N·m   目标最大 = ${spineTgtMax.toFixed(4)}`
  + `   相对量程位置偏移最大 = ${(100 * spineErrMax).toFixed(1)}%`);

// ══ ⑥ 全时段峰值（哪些轴"曾经"出过力）═══════════════════════════════════
log('');
log('╔══ ⑥ 全时段 |τ| 峰值（哪些轴真的动过）════════════════════════════════╗');
{
  const rows: string[] = [];
  for (let a = 0; a < NAX; a++) {
    const j = Math.floor(a / 3), ax = a % 3;
    const jn = sk.joints[j]!.name;
    const v = totTauByJoint[a]!;
    const tmax = sk.joints[j]!.maxTorque[ax]!;
    const pct = tmax > 0 ? (100 * v / tmax) : 0;
    if (v < 1e-6 && lastS!.owner[a] === 'bind') continue;    // 从没动过且是兜底
    rows.push(`  ${jn}/${ax}`.padEnd(18)
      + `peak|τ| = ${v.toFixed(1).padStart(7)} N·m  (τmax ${tmax.toFixed(0).padStart(3)}`
      + ` ⇒ ${pct.toFixed(0).padStart(3)}%)   权限min ${maxAuthByAxis[a]!.toFixed(3)}`
      + `   owner=${lastS!.owner[a]}`);
  }
  log(rows.length ? rows.join('\n') : '  （没有任何轴出过力）');
}
// ══ ⑦ 腰椎限位 vs 马达：每个物理步一读 ═══════════════════════════════════
log('');
log('╔══ ⑦ 腰椎限位 vs 马达（每物理步）═══════════════════════════════════════╗');
log('║  判据：`enforceLimits` 的回复是**速度偏置**，上限 `LIMIT_MAX_BIAS = 12` rad/s');
log('║  （ragdoll.ts:2774），而马达的角冲量是 `τmax × dt = τmax/240`。');
log('║  谁赢 ⇒ `12 × Iax` 与 `τmax/240` 比大小。下面直接看角度往哪走。');
log('║');
log('║   t(s)   spine1/2角   限位   越界(°)   spine1/0角   限位   越界(°)   τ(spine1/2)');
{
  // 最严重的那根轴（按 |位置|/量程 排）
  const j1 = sk.joints.findIndex((j) => j.name === 'spine1');
  const j2 = sk.joints.findIndex((j) => j.name === 'spine2');
  const j3 = sk.joints.findIndex((j) => j.name === 'spine3');
  const hi = (j: number, ax: number): number => sk.joints[j]!.maxRad[ax]! * 57.2958;
  const lim = new Float64Array(sk.joints.length * 3);
  for (let i = 0; i < sk.joints.length; i++) {
    for (let ax = 0; ax < 3; ax++) {
      lim[i * 3 + ax] = Math.min(sk.joints[i]!.maxRad[ax]!, -sk.joints[i]!.minRad[ax]!) * 57.2958;
    }
  }
  void j2; void j3; void hi;
  log(`║  spine1 各轴限位: /0 ±${lim[j1 * 3]!.toFixed(0)}°   /1 ±${lim[j1 * 3 + 1]!.toFixed(0)}°   /2 ±${lim[j1 * 3 + 2]!.toFixed(0)}°`);
  const rows: string[] = [];
  for (const sm of spineTrace) {
    const a02 = sm.ang[j1 * 3]! * 57.2958, a22 = sm.ang[j1 * 3 + 2]! * 57.2958;
    const o0 = a02 - sm.ang[j1 * 3 + 1]! * 0, o2 = a22 - sm.ang[j1 * 3 + 2]! * 0;
    void o0; void o2;
    const ex0 = Math.max(0, Math.abs(a02) - lim[j1 * 3]!);
    const ex2 = Math.max(0, Math.abs(a22) - lim[j1 * 3 + 2]!);
    rows.push(`║  ${sm.t.toFixed(4).padStart(6)}  ${a02.toFixed(1).padStart(10)}°  ±${lim[j1 * 3]!.toFixed(0)}`.padEnd(40)
      + ` ${ex0.toFixed(1).padStart(7)}   ${a22.toFixed(1).padStart(9)}°  ±${lim[j1 * 3 + 2]!.toFixed(0)}`
      + ` ${ex2.toFixed(1).padStart(7)}   ${sm.tau[j1 * 3 + 2]!.toFixed(1).padStart(9)}`);
  }
  log(rows.join(String.fromCharCode(10)));
  const last = spineTrace[spineTrace.length - 1];
  if (last) {
// ★ 2026-10-06：这里必须问**运行时实际值**，而且**必须逐轴**。
    //   踩过的坑（第一版探针）：把 `LIMIT_MAX_BIAS` 常量当成实际生效值
    //   ⇒ 修完仍显示「1.01× 马达赢」，看起来像没修。
    //   第二个坑：拿 `jointIeff` 当惯量 —— 而 `enforceLimits` 里施加冲量
    //   真正用的是 `axisInertia(i, k)`（该轴真实折合惯量），
    //   两者对细长段（脊柱）差 2~4 倍 ⇒ 用错惯量算出来的"权限"没有意义。
    const D = sim.doll as unknown as {
      limitBiasMax?: Float64Array;
      axisInertia?: (i: number, k: number) => number;
    };
    const BIAS = D.limitBiasMax;
    const AI = D.axisInertia;
    log(`║`);
    log(`║  逐轴核对（马达角冲量 = τmax/${PHYS_HZ}；限位角冲量 = bias × 该轴真实惯量）：`);
    log(`║   轴            τmax   jointIeff   轴真实惯量   bias上限   马达冲量   限位冲量   马达/限位`);
    let anyLimitLoses = false;
    for (const jn of ['spine1', 'spine2', 'spine3', 'hip_l', 'knee_l', 'foot_l']) {
      const jj = sk.joints.findIndex((j) => j.name === jn);
      if (jj < 0) continue;
      for (const k of [0, 2]) {
        const tmax = Math.abs(sk.joints[jj]!.maxTorque[k]!);
        const jeff = sim.doll.jointIeff[jj]!;
        const iax = AI ? AI.call(sim.doll, jj, k) : NaN;
        const bias = BIAS ? BIAS[jj * 3 + k]! : NaN;
        const mImp = tmax / PHYS_HZ;
        const lImp = bias * iax;
        const ratio = mImp / lImp;
        if (ratio > 1) anyLimitLoses = true;
        log(`║   ${jn}/${k}`.padEnd(15)
          + `${tmax.toFixed(0).padStart(5)} ${jeff.toFixed(4).padStart(11)} ${iax.toFixed(4).padStart(12)}`
          + `${bias.toFixed(1).padStart(10)} ${mImp.toFixed(4).padStart(10)} ${lImp.toFixed(4).padStart(10)}`
          + `  ${(ratio > 1 ? '★ ' : '') + ratio.toFixed(2) + '×'}`);
      }
    }
    log(`║  ${anyLimitLoses ? '★ 仍有轴的限位拦不住马达' : '✓ 全部轴：限位冲量都压过马达冲量'}`);
  }
}
log('');
log(`  仿真跑了 ${k} 个物理步（${(k / PHYS_HZ).toFixed(2)} s），采样 ${samples.length} 拍`
  + `，跌倒=${sim.finished ? '是（' + sim.fallReason + '）' : '否'}`);
void NSAMP;