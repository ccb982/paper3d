/**
 * ══════════════════════════════════════════════════════════════════
 * probe-t0.ts —— **前 0.2s 的能量账**（用户：「一上来就倒，不知道什么原因」）
 * ══════════════════════════════════════════════════════════════════
 *
 * 上一轮已测到（`probe-firstframes`）：前 0.1s 里
 *   · **重心一动不动**（0.1→0.3mm）、`CoM.y` 恒定、pitch/roll ≈ 0.0x°
 *   · 但关节角速度 31→277°/s、CoP 前移 0→22mm、力矩只有 5.7~30.7 N·m（**没饱和**）
 *
 * ⇒ 那不是"倒下"，是"**原地充能**"。本探针用**能量账**把它钉死：
 *   · `KE`      = Σ ½m|v|² + ½ω·(I∘ω)      —— 从 0 开始的**动能总量**
 *   · `P_joint` = `τ_applied · ω_rel`        —— 每根轴的**机械功率**
 *     **正功率 = 该轴在往系统里注能量** ⇒ 泵就是它
 *   · `P_ctrl`  = 所有正功率之和             —— 总的注入率
 *   · 同时给出"外力功率"的量级对照（重力不做功：CoM 没升高、也没水平位移）
 *
 * 判据：若 `KE` 与 `Σ正功率` 同步指数增长 ⇒ **是执行器在自激**，
 *       而不是"被外力/接触打倒"。且"哪根轴在泵"会直接点名。
 *
 * 用法：`node tools/run.mjs probe-t0 [秒数] [ABL]`
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
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');

const log = (s: string) => console.log(s);
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const SECS = Number(ARGS[0] ?? 0.3);
const NC = ARGS.includes('nocontrol');       // ★ 完全不调 ctrl.step（连 setMotorTargets 都不调）
const ABL = (ARGS[1] ?? '').trim();
const HZ = 120, DT = 1 / HZ, PER = 2;

log(`══ probe-t0 时长=${SECS}s（物理 ${HZ}Hz、控制 ${HZ / PER}Hz）${ABL ? ` 消融[${ABL}]` : ''} ══`);
const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  balance: { ...DEFAULT_CONTROLLER.balance, ablate: ABL || undefined },
});
const d = sim.doll;
const rvv = new Float64Array(3);

log('   t(s)      KE(J)   Σ正功率(W)  max|ω|   泵①　　| ★ hip_l 逐轴：轴:角度°/τ/ω°/s/归属（τ·ω>0 = 正反馈）');
const rows: string[] = [];
for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
  if (!NC && i % PER === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  if (i % PER !== 0) continue;
  const rs = ctrl.rs;
  // ── KE（逐刚体）──
  let ke = 0, maxW = 0;
  for (let b = 0; b < d.bodies.length; b++) {
    const rb = d.bodies[b]!;
    const v = rb.linvel(), w = rb.angvel();
    const m = rb.mass();
    ke += 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z);
    const I = rb.principalInertia();
    ke += 0.5 * (w.x * w.x * I.x + w.y * w.y * I.y + w.z * w.z * I.z);
  }
  // ── 逐轴机械功率 `τ·ω_rel`（正 = 注能量）──
  const pw: { n: string; p: number }[] = [];
  for (let j = 0; j < sk.joints.length; j++) {
    d.jointRelVel(j, rvv);
    const w = Math.hypot(rvv[0]!, rvv[1]!, rvv[2]!) * 57.2958;
    if (w > maxW) maxW = w;
    let p = 0;
    for (let k = 0; k < 3; k++) {
      p += (d.tauApplied[j * 3 + k] ?? 0) * rvv[k]!;
    }
    if (p > 0.01) {
      // ★ 泵的细节：归属 / 参考角 / 实际角 / τ / ω（判"正反馈"用）
      const nm2 = sk.joints[j]!.name;
      const jr = new Float64Array(3); d.jointRot(j, jr);
      let tk = 0, wk = 0, best = 0;
      for (let k2 = 0; k2 < 3; k2++) {
        const pp = (d.tauApplied[j * 3 + k2] ?? 0) * rvv[k2]!;
        if (Math.abs(pp) > best) { best = Math.abs(pp); tk = d.tauApplied[j * 3 + k2] ?? 0; wk = rvv[k2]!; }
      }
      const own2 = ctrl.rs.axisOwner(j * 3 + (Math.abs(rvv[2]!) > Math.abs(rvv[0]!) ? 2 : 0));
      pw.push({ n: `${nm2}[${own2}] 角${(-jr[2]! * 57.2958).toFixed(1)}° τ${tk.toFixed(0)} ω${(wk * 57.2958).toFixed(0)}°/s`, p });
    }
  }
  pw.sort((a, b) => b.p - a.p);
  const posSum = pw.reduce((a, x) => a + x.p, 0);
  const top3 = [0, 1, 2].map((q) => (pw[q] ? `${pw[q]!.n} ${pw[q]!.p.toFixed(1)}W` : '—').padEnd(24));
  rows.push(`${(i / HZ).toFixed(3).padStart(8)}${ke.toFixed(4).padStart(11)}${posSum.toFixed(1).padStart(12)}`
    + `${maxW.toFixed(0).padStart(9)}   ${top3[0]}`
    + `  | ★ hip_l：` + (() => {
      const ji = sk.joints.findIndex((j: any) => j.name === 'hip_l');
      if (ji < 0) return '—';
      const jr = new Float64Array(3); d.jointRot(ji, jr);
      d.jointRelVel(ji, rvv);
      const out2: string[] = [];
      for (let k2 = 0; k2 < 3; k2++) {
        const tau = d.tauApplied[ji * 3 + k2] ?? 0;
        const om = rvv[k2]! * 57.2958;
        const own = ctrl.rs.axisOwner(ji * 3 + k2);
        out2.push(`${k2}:${(-jr[k2]! * 57.2958).toFixed(1)}°/${tau.toFixed(0)}/${om.toFixed(0)}/${own}${tau * om > 0.5 ? '★泵' : ''}`);
      }
      return out2.join(' ');
    })());
}
log(rows.join('\n'));
log(`\n  跑了 ${rows.length} 拍（每 ${PER / HZ * 1000}ms 一条）`);
