/**
 * ══════════════════════════════════════════════════════════════════
 * probe-footpush.ts —— **脚发力 → 全身前倾/侧倾** 的整条链路逐帧追踪
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户 2026-10-06：
 *   「有一件是做不到：**从脚部发力从而带动整个身体前倾或者侧倾**。
 *     **完全没察觉到这种痕迹**。你先查这整个链路，为什么依然做不到」
 *
 * ── 链条的物理（本探针逐环打）──────────────────────────────────
 *   ① 脚部执行器出力：踝 `foot/2`（左/右）、`arch` 旋前旋后
 *   ② 接触力重分布：内/外侧柱载荷、逐块法向力、CoP（单脚 + 全局）
 *   ③ 对 CoM 的力矩：`M = (CoP - CoM) × GRF`（横向/矢状各一）
 *   ④ 全身响应：CoM 加速度 `a = F_h/m`、躯干角速度与倾角
 *   ⑤ 结论：链条在哪一环断的（τ 没下去？CoP 没动？力矩没出来？身体没响应？）
 *
 * ── 注入方式 ───────────────────────────────────────────────────
 *   绕开控制律：`ctrl.step()` 之后**直接覆盖** `setTorqueTargets`（与
 *   `probe-footlat` 同法）。⇒ 测的是"**物理**能不能做到"，不是"控制律有没有写"。
 *   基线（同样时长、不注入）并排打，差值即"注入的净效应"。
 *
 * 用法：node tools/run.mjs probe-footpush [注入N·m] [secs]
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
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const TAU_INJ = Number(ARGS[0] ?? 120);       // 注入的踝力矩（N·m，正 = 跖屈）
const SECS = Number(ARGS[1] ?? 1.6);
const ON_AT = Number(ARGS[2] ?? 0.0);         // 从第几秒开始注入（默认 0 = 直立时）
const DEG = 57.2958;
const HZ = 120;

async function run(inject: boolean): Promise<string[]> {
  const sk = buildSkeleton(DEFAULT_CONFIG);
  const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, {
    ...DEFAULT_CONTROLLER,
    gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
    balance: DEFAULT_CONTROLLER.balance,
  });
  const d = sim.doll;
  const JFL = jointIndexByName(sk, 'foot_l'), JFR = jointIndexByName(sk, 'foot_r');
  const nAx = sk.joints.length * 3;
  const tauF = new Float32Array(nAx);
  const cop = new Float64Array(4);
  const rows: string[] = [];
  const pelvis = d.bodyByKey('torso');
  const torso = d.torso();

  for (let i = 0; i < SECS * HZ && !sim.finished; i++) {
    if (i % 2 === 0) {
      d.setMotorTargets(ctrl.step(1 / 60));
      if (inject && i / HZ >= ON_AT) {
        // ★ 直接覆盖力矩通道：踝双侧跖屈（把 CoP 往前推 ⇒ 身体应前倾）
        tauF.fill(0);
        if (JFL >= 0) tauF[JFL * 3 + 2] = TAU_INJ;
        if (JFR >= 0) tauF[JFR * 3 + 2] = TAU_INJ;
        d.setTorqueTargets(tauF);
      }
    }
    sim.advance(1);
    if (i % 10 !== 0) continue;
    const rs = ctrl.rs;
    const gc = rs.groundChain;
    d.readCoP(0, cop); const copLx = cop[0]!, copLz = cop[2]!, copLl = cop[3]!;
    d.readCoP(1, cop); const copRx = cop[0]!, copRz = cop[2]!, copRl = cop[3]!;
    const pv = torso.linvel(); const pw = torso.angvel();
    if (!rows.length) {
      rows.push('   t(s)  下发 实际τ  单脚CoP_L(x,z,载)       单脚CoP_R(x,z,载)       全局CoP(x,z)    com.x  vx     com.z  vz    M_pitch M_roll  躯干pitch 躯干roll |ω|');
    }
    rows.push(`   ${(i / HZ).toFixed(2)}  ${inject && i / HZ >= ON_AT ? TAU_INJ.toFixed(0).padStart(5) : '    0'}`
      + ` ${(d.tauApplied[JFL * 3 + 2] ?? 0).toFixed(0).padStart(5)}`
      + `  (${(copLx * 1000).toFixed(0).padStart(5)},${(copLz * 1000).toFixed(0).padStart(5)},${copLl.toFixed(0).padStart(4)})`
      + `  (${(copRx * 1000).toFixed(0).padStart(5)},${(copRz * 1000).toFixed(0).padStart(5)},${copRl.toFixed(0).padStart(4)})`
      + `   (${gc ? (gc.copX * 1000).toFixed(0).padStart(5) : '    —'},${gc ? (gc.copZ * 1000).toFixed(0).padStart(5) : '    —'})`
      + `  ${(rs.com.x * 1000).toFixed(0).padStart(6)} ${(rs.com.vx * 1000).toFixed(0).padStart(6)}`
      + `  ${(rs.com.z * 1000).toFixed(0).padStart(6)} ${(rs.com.vz * 1000).toFixed(0).padStart(6)}`
      + `  ${(gc ? (gc.copX - rs.com.x) * (gc.l.fz + gc.r.fz) : 0).toFixed(0).padStart(7)}`
      + ` ${(gc ? -(gc.copZ - rs.com.z) * (gc.l.fz + gc.r.fz) : 0).toFixed(0).padStart(6)}`
      + `  ${rs.pitchDeg.toFixed(1).padStart(8)}  ${rs.rollDeg.toFixed(1).padStart(7)}`
      + ` ${(Math.hypot(pw.x, pw.y, pw.z) * DEG).toFixed(0).padStart(4)}`);
    // ★ 逐块载荷（左右脚各自的鞋底块）—— 验证"绕棱 rocking"（载荷在块间交替）
    {
      const pk: string[] = [];
      for (const ff of [gc?.l, gc?.r]) {
        if (!ff) continue;
        pk.push(ff.patches.map((x) => x.ny.toFixed(0)).join(',') || '—');
      }
      rows.push(`        └ 逐块N  左[${pk[0] ?? '—'}]  右[${pk[1] ?? '—'}]`
        + `　内/外 左${(gc?.l.colIn ?? 0).toFixed(0)}/${(gc?.l.colOut ?? 0).toFixed(0)}`
        + ` 右${(gc?.r.colIn ?? 0).toFixed(0)}/${(gc?.r.colOut ?? 0).toFixed(0)}`
        + `　CoP有效 ${gc?.l.copValid ? 'L' : '·'}${gc?.r.copValid ? 'R' : '·'}`);
    }
    void pv;
  }
  rows.push(`   ⇒ 存活 ${(sim.ticksDone / 60).toFixed(2)}s  死因 ${sim.fallReason || '未倒'}`);
  return rows;
}

log('══ A. **基线**（不注入）══');
const base = await run(false);
for (const r of base) log(r);

log('');
log(`══ B. **强制脚发力**：踝双侧跖屈 +${TAU_INJ} N·m（从 t=${ON_AT}s 起）══`);
const inj = await run(true);
for (const r of inj) log(r);

log('');
log('══ 判读（链条哪一环断的）══');
log('   ① 若"实际τ"没跟上"下发" ⇒ 执行器层（力矩通道/让位/饱和）');
log('   ② 若 τ 到位但"单脚CoP"不动 ⇒ 接触层（力臂=0：CoP 恰在踝心？脚没滚动？）');
log('   ③ 若 CoP 动了但 |F_h|≈0 ⇒ 地面对 CoM 的**水平力**没出来（只有力矩）');
log('   ④ 若 CoP/力矩都有但躯干 pitch/roll 不动 ⇒ **全身惯量/关节被别处钉住**');
