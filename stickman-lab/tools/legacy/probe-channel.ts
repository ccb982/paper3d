/**
 * probe-channel.ts —— 两个通道的**送达值**回读（只走 `rs.snapshot()`）
 *
 * ★ 本工具只读**正式快照**（UI 用的同一份），不碰 `doll` / `rigState` 私有成员。
 *   起因：`Controller.step` 里 `const out = rs.arbitrate(dt)` 的 `out`
 *   **从未被送进 `setMotorTargets`** ⇒ 角度通道（位置伺服 + 步态关键帧）
 *   从项目第一天起就没在工作（实测 480 拍里 `setMotorTargets` 调用 0 次，
 *   `motorTarget` 54 项全 0，而仲裁器明明算出 13 项非零目标）。
 *
 * 判据：
 *   ① `channels.motorTarget` 非零项数 —— >0 才说明位置伺服真的在收目标
 *   ② `channels.torqueOut`   非零项数 —— 力矩通道
 *   ③ `axes[].owner`         谁在驱动每根轴（仲裁结果，非请求）
 *   ④ `qp`                   全链 QP 的本拍读数（null = 没跑）
 *   ⑤ `com.y / tiltDeg`      姿态（用于判断是否倒下）
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
  const bg = bgNs as any; const im: any = {};
  for (const i of WebAssembly.Module.imports(c)) {
    const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name);
    (im[i.module] ??= {})[i.name] = f;
  }
  bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { DEFAULT_BALANCE_PARAMS } = await import('../src/core/systems/balance');
const log = console.log;
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const ABLATE = ARGS[0] ?? '';
const DUR = Number(ARGS[1] ?? 6) || 6;

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: DUR });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  balance: { ...DEFAULT_BALANCE_PARAMS, ablate: ABLATE },
});

const nz = (a: ArrayLike<number>): number => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i]!) > 1e-6) n++; return n; };
const PHz = DEFAULT_SIM.physicsHz ?? 240;
const CHz = DEFAULT_SIM.controlHz ?? 120;

log('══ 通道送达回读（正式快照）  ablate="' + ABLATE + '" ══');
log('    t/s   com.y   tilt°   角度通道   力矩通道   QP           F_des        残差  可行');
const N = Math.round(DUR * PHz);
let last: ReturnType<typeof ctrl.rs.snapshot> | null = null;
for (let f = 0; f < N; f++) {
  ctrl.step(1 / CHz);
  sim.advance(1);
  const s = ctrl.snapshot;
  last = s as typeof last;
  if (f % Math.round(PHz * 0.5) !== 0 || !s) continue;
  const q = s.qp;
  log('  ' + (f / PHz).toFixed(2).padStart(5)
    + s.com.y.toFixed(4).padStart(8)
    + s.tiltDeg.toFixed(1).padStart(7)
    + String(nz(s.channels.motorTarget)).padStart(9)
    + String(nz(s.channels.torqueOut)).padStart(11)
    + (q ? '  有' : '  \u2014').padEnd(13)
    + (q ? '(' + q.fDesX.toFixed(0) + ',' + q.fDesZ.toFixed(0) + ')N' : '').padStart(12)
    + (q ? q.residual.toFixed(1) : '').padStart(8)
    + (q ? (q.feasible ? '  \u2713' : '  \u2717') : ''));
}
if (!last) { log('  ★ 快照为 null —— 控制器没在出快照'); process.exit(1); }

const s = last;
log('');
log('══ 末拍结论 ══');
log('  角度通道非零 ' + nz(s.channels.motorTarget) + '/' + s.channels.motorTarget.length
  + '   ' + (nz(s.channels.motorTarget) > 0 ? '\u2713 位置伺服在收目标' : '\u2717 位置伺服仍是死的'));
log('  力矩通道非零 ' + nz(s.channels.torqueOut) + '/' + s.channels.torqueOut.length);
log('  头碰地 = ' + (((sim as any).doll as any).headHitGround() ? '\u2717 已碰' : '\u2713 未碰'));
log('  com = (' + s.com.x.toFixed(3) + ', ' + s.com.y.toFixed(3) + ', ' + s.com.z.toFixed(3) + ')');
const owners = new Map<string, number>();
for (const a of s.axes) owners.set(a.owner, (owners.get(a.owner) ?? 0) + 1);
log('  轴归属分布: ' + [...owners].map(([k, v]) => k + '\u00d7' + v).join('  '));
if (s.qp) {
  log('  QP: 残差 ' + s.qp.residual.toFixed(2) + 'N  可行=' + (s.qp.feasible ? '\u2713' : '\u2717')
    + '  grfSat=' + (s.qp.grfSat ? '\u2717 \u5df2\u78b0\u6469\u64e6\u9525\u4e0a\u9650' : '\u2713'));
}
