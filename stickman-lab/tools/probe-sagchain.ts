/**
 * ══════════════════════════════════════════════════════════════════
 * probe-sagchain.ts —— **矢状链前馈落地 + A/B/C 对照**
 * ══════════════════════════════════════════════════════════════════
 *
 * 病灶（2026-10-06 定位）：`balance.ts` 的 ④ 块算出完整力
 *   `doll.jacobianTorque(F.fx, F.fy, F.fz, …)` 写进 `TMP_TAU`，而全文唯一
 *   读它的地方在块⑤、那里又重算了一遍（只传横向力）⇒ **矢状分量是死代码**。
 *
 * ④c 修复后在矢状链（`hip/knee/spine` 的 `/2` 轴）上发 `τ=JᵀF`，
 * 并把位置伺服降为纯阻尼（`requestHold`）—— 就是 `RagdollOptions` 里
 * 记的"逆动力学模式"。
 *
 * 三种变体（`ablate` 驱动，不再靠改代码做对照）：
 *   A `''`           —— ④c 全开（让位 + 前馈）
 *   B `'sagJfHold'`  —— 只给前馈**不让位**（位置伺服照常跑 ⇒ 双计）
 *   C `'sagJf'`      —— 整块关掉（= 修之前的基线）
 *
 * 判读：若 A 明显优于 C ⇒ 死代码确实是要害；B 若差于 A ⇒ "让位"是必需的。
 *
 * 用法：node tools/run.mjs probe-sagchain
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
const HZ = 120, DT = 1 / 60;
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);

interface Sum {
  tag: string; secs: number; fall: string;
  comX: number; maxVx: number; tilt: number; maxTilt: number;
  sagTau: number; hipW: number; kneeW: number; rows: string[];
  spine1Ang: number; spine1Tau: number;
}

function run(tag: string, ablate: string, dur: number, verbose: boolean): Sum {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: dur });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
    balance: { ...DEFAULT_CONTROLLER.balance, ablate: ablate || undefined },
  });
  const d = sim.doll;
  const out: Sum = {
    tag, secs: 0, fall: '', comX: 0, maxVx: 0, tilt: 0, maxTilt: 0,
    sagTau: 0, hipW: 0, kneeW: 0, rows: [], spine1Ang: 0, spine1Tau: 0,
  };
  const rv = new Float64Array(3);
  if (verbose) {
    log('   判读：`F.fx` = 上层要的力(N)；`Σ|τ|/让位` = ④c 实际下发；'
      + '关节 τ 若每拍变号 ⇒ 净冲量≈0');
    log('');
    log('   t(s) state   tilt  com.x  vx(mm/s)  F.fx  F.fy  Σ|τ|/让位 | 关节 τ / 相对角速(°/s)');
  }
  for (let i = 0; i < dur * HZ && !sim.finished; i++) {
    if (i % 2 === 0) d.setMotorTargets(ctrl.step(DT));
    sim.advance(1);
    if (i % 10 !== 0) continue;
    const rs = ctrl.rs;
    out.maxVx = Math.max(out.maxVx, Math.abs(rs.com.vx));
    out.maxTilt = Math.max(out.maxTilt, rs.tiltDeg);
    if (verbose) {
      const sup = rs.supportLeg();
      const cells: string[] = [];
      for (const [n, ax] of [[`hip_${sup}`, 2], [`knee_${sup}`, 2]] as [string, number][]) {
        const ji = jointIndexByName(sk, n);
        if (ji < 0) continue;
        d.jointRelVel(ji, rv);
        cells.push(`${n} τ${(d.tauApplied[ji * 3 + ax] ?? 0).toFixed(0).padStart(5)}`
          + ` ω${(rv[ax]! * 57.2958).toFixed(0).padStart(5)}`);
      }
      out.rows.push(`   ${(i / HZ).toFixed(2).padStart(5)} ${rs.state.padEnd(7)}`
        + ` ${rs.tiltDeg.toFixed(0).padStart(4)}`
        + ` ${(rs.com.x * 1000).toFixed(0).padStart(6)}`
        + ` ${(rs.com.vx * 1000).toFixed(0).padStart(8)}`
        + ` ${rs.grfCmd.x.toFixed(0).padStart(6)} ${rs.grfCmd.y.toFixed(0).padStart(5)}`
        + ` ${rs.sagJfTau.toFixed(0).padStart(5)}/${String(rs.sagJfHeld).padStart(2)} | `
        + cells.join('  ')
        + (() => {
          const jiS = jointIndexByName(sk, 'spine1');
          if (jiS < 0) return '';
          d.jointRot(jiS, rv);
          return ` | 腰 ${(-rv[2]! * 57.2958).toFixed(0).padStart(4)}°`
            + ` τ${(d.tauApplied[jiS * 3 + 2] ?? 0).toFixed(0).padStart(5)}`;
        })());
    }
  }
  out.secs = sim.ticksDone / HZ;
  out.fall = sim.fallReason || '未倒';
  out.comX = ctrl.rs.com.x * 1000;
  out.tilt = ctrl.rs.tiltDeg;
  out.sagTau = ctrl.rs.sagJfTau;
  const jiH = jointIndexByName(sk, 'hip_l');
  d.jointRelVel(jiH, rv); out.hipW = Math.abs(rv[2]!) * 57.2958;
  const jiK = jointIndexByName(sk, 'knee_l');
  d.jointRelVel(jiK, rv); out.kneeW = Math.abs(rv[2]!) * 57.2958;
  // ★ 腰的矢状：角度（deg，域口径正=屈）+ 实际施加的力矩 ⇒ 直接看"腰发不发力"
  const jiS = jointIndexByName(sk, 'spine1');
  d.jointRot(jiS, rv);
  out.spine1Ang = -rv[2]! * 57.2958;
  out.spine1Tau = d.tauApplied[jiS * 3 + 2] ?? 0;
  return out;
}

log('══ 变体 A：④c 全开（让位 + 矢状前馈）══');
const A = run('A 全开', '', 1.8, true);
for (const r of A.rows) log(r);
log(`   ⇒ 存活 ${A.secs.toFixed(2)}s  死因 ${A.fall}  tilt ${A.tilt.toFixed(0)}°  com.x ${A.comX.toFixed(0)}mm`);

log('');
log('══ 对照（同 1.8s）══');
log('   变体                        存活   死因   末tilt  末com.x   |vx|max  末Σ|τ|  腰(脊1角/τ)');
const results: Sum[] = [A];
for (const [tag, ab] of [
  ['A2 脊柱也进前馈（对照）', 'sagJfSpine'],
  ['B 只给前馈·不让位', 'sagJfHold'],
  ['C 整块关（修前基线）', 'sagJf'],
] as [string, string][]) {
  const r = run(tag, ab, 1.8, false);
  results.push(r);
  log(`   ${tag.padEnd(26)} ${r.secs.toFixed(2).padStart(5)}s  ${r.fall.padEnd(6)}`
    + ` ${r.tilt.toFixed(0).padStart(5)}°`
    + ` ${r.comX.toFixed(0).padStart(8)}mm`
    + ` ${(r.maxVx * 1000).toFixed(0).padStart(8)}`
    + ` ${r.sagTau.toFixed(0).padStart(7)}`
    + `  ${r.spine1Ang.toFixed(0).padStart(5)}°/${r.spine1Tau.toFixed(0).padStart(5)}`);
}
log('');
{
  const A2 = results[1]!;
  log(`   A2（脊柱不进前馈）tilt ${A2.tilt.toFixed(0)}° com.x ${A2.comX.toFixed(0)}mm |vx|max ${(A2.maxVx * 1000).toFixed(0)}`
    + `　vs A tilt ${A.tilt.toFixed(0)}° com.x ${A.comX.toFixed(0)}mm`);
  const better = A.comX > results[3]!.comX && A.maxVx < results[3]!.maxVx;
  log(`   判读：A 的 com.x ${A.comX.toFixed(0)}mm / |vx|max ${(A.maxVx * 1000).toFixed(0)}mm/s`
    + `　vs　C（修前）${results[2]!.comX.toFixed(0)}mm / ${(results[2]!.maxVx * 1000).toFixed(0)}mm/s`);
  log(`   ⇒ 矢状前馈${better ? '**有效**（漂移与速度都更小）' : '**无效或更差**'}`
    + `；B 相对 A ${Math.abs(results[2]!.comX) < Math.abs(A.comX) ? '更好（让位反而有害）' : '更差（让位是必需的）'}`);
}
