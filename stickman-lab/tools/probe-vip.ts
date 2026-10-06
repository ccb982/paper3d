/**
 * ══════════════════════════════════════════════════════════════════
 * probe-vip.ts —— **踝 CoP / VIP 闭环的逐帧回读**
 * ══════════════════════════════════════════════════════════════════
 *
 * 背景（本轮已确认的结论）：
 *   · 身体"一开始就没稳住"是**真实的倒立摆发散**，不是执行器在推
 *     （`zero`/`nocontrol` 稳、一切执行器侧处置无效）
 *   · 站立不倒的第一道防线是**踝 CoP**，块⑥ 用的是 VIP 模型
 *     `τ = K_a·q_vip − C_a·q̇_vip` + 间歇延迟反馈（S3）
 *   · 但 `K_a = 0.88·K_crit` 是**刻意欠临界**（Loram & Lakie 实测人体如此）
 *     ⇒ 单靠刚度**必然缓慢发散**，全靠 S3 往回泵 —— 所以 S3 是否在工作是关键
 *
 * 本探针回答（逐控制拍，全部走公开回读）：
 *   A. VIP 状态机：`vipOn` 占空比、切换次数、判据四项（q_δ / q̇_δ / a / 积）
 *   B. 流形：`vipGamma`（+1 = 稳定流形、−1 = 不稳定流形）
 *   C. 力矩：`ankleTauVip`（含饱和标志）、VIP 刚度项 vs S3 反馈项各占多少
 *   D. 效果：CoM.x / CoP.x / **稳定裕度 mos** / 踝角 —— 闭环到底有没有把 CoM 拉回来
 *
 * 用法：`node tools/run.mjs probe-vip [秒数] [ABL]`
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
const SECS = Number(ARGS[0] ?? 3);
const ABL = (ARGS[1] ?? '').trim();
// ★ 扫踝刚度：`KVIP=565 node tools/run.mjs probe-vip 3`（K_crit = m·g·h ≈ 627）
const KVIP = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.KVIP ?? NaN);
const VP = Number((globalThis as { process?: { env?: Record<string, string> } }).process?.env?.VIPP ?? NaN);
const HZ = 60, DT = 1 / HZ, R2D = 57.2958;

log(`══ probe-vip 时长=${SECS}s ${ABL ? `消融[${ABL}]` : ''} ══`);

const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  balance: {
    ...DEFAULT_CONTROLLER.balance, ablate: ABL || undefined,
    ...(Number.isFinite(KVIP) ? { kVipAnkle: KVIP } : {}),
    ...(Number.isFinite(VP) ? { vipP: VP } : {}),
  },
});
const d = sim.doll;

log('  t(s)  状态   q_vip   q̇_vip   a     q_g·(q̇-a·q)  ON  γ流形  切次数  τ_踝  刚度   阻尼   S3   饱和 | CoM.x  CoP.x  mos(mm) 踝角  骨盆y');

let duty = 0, n = 0, maxAbsComX = 0;
const rows: string[] = [];
// ★★ 口径必须与 `probe-domain` 一致：物理 120Hz、控制 60Hz ⇒ **每 2 个物理步控一次**
//   （原先每物理步都控 ⇒ 等效控制频率翻倍，是假数据）
const PER_CTRL = Math.max(1, Math.round(120 / HZ));
for (let i = 0; i < SECS * 120 && !sim.finished; i++) {
  if (i % PER_CTRL === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  const rs = ctrl.rs;
  const fc = rs.groundChain;
  const diag = rs.vipDiag;
  const q = rs.qVip ?? 0;
  const tau = rs.ankleTauVip ?? 0;
  // VIP 刚度项（复算，与块⑥ 同式）：`K_a·q`；S3 项 = 总 − 刚度项 − 阻尼项
  const kv = Number.isFinite(KVIP) ? KVIP : (DEFAULT_CONTROLLER.balance.kVipAnkle ?? 270);
  const zt = DEFAULT_CONTROLLER.balance.vipZeta ?? 0.9;
  const iA = Math.max(1e-4, d.inertiaAboutJoint(jointIndexByName(sk, 'foot_l')));
  const cV = 2 * zt * Math.sqrt(kv * iA);
  const vipK = kv * q;                       // 刚度项
  const vipDamp = -cV * (diag?.qdD ?? 0);    // 阻尼项
  const vipS3 = tau - vipK - vipDamp;        // S3 反馈项（残差）
  if (i % PER_CTRL !== 0) continue;
  n++; if (rs.vipOn) duty++;
  maxAbsComX = Math.max(maxAbsComX, Math.abs(rs.com.x));
  if (i % (PER_CTRL * 6) !== 0) continue;
  const copX = fc?.copX ?? 0;
  const jA = jointIndexByName(sk, 'foot_l');
  const ankDeg = (rs.angle(jA, 2) * R2D);
  rows.push(
    `${(i * DT).toFixed(2).padStart(6)}  ${rs.state.padEnd(5)}`
    + `${(q * R2D).toFixed(2).padStart(8)}`
    + `${((diag?.qdD ?? 0) * R2D).toFixed(1).padStart(8)}`
    + `${(diag?.a ?? 0).toFixed(2).padStart(7)}`
    + `${(diag?.prod ?? 0).toFixed(3).padStart(12)}`
    + `${rs.vipOn ? ' ON' : 'off'}`
    + `${(rs.vipGamma ?? 0).toFixed(2).padStart(7)}`
    + `${String(rs.vipSwitches ?? 0).padStart(7)}`
    + `${tau.toFixed(0).padStart(6)}`
    + `${vipK.toFixed(0).padStart(7)}`
    + `${vipDamp.toFixed(0).padStart(7)}`
    + `${vipS3.toFixed(0).padStart(6)}`
    + `${rs.ankleTauSat ? '  ★' : '   '}`
    + ` | ${(rs.com.x * 1000).toFixed(0).padStart(6)}`
    + `${(copX * 1000).toFixed(0).padStart(7)}`
    + `${((rs.mos ?? 0) * 1000).toFixed(0).padStart(9)}`
    + `${ankDeg.toFixed(1).padStart(7)}`
    + `${(rs.pelvisW ?? 0).toFixed(0).padStart(7)}`,
  );
}
log(rows.join('\n'));
log(`\n  S3 占空比 ${((duty / Math.max(1, n)) * 100).toFixed(0)}%　切换 ${ctrl.rs.vipSwitches} 次`
  + `　|CoM.x|max ${(maxAbsComX * 1000).toFixed(0)}mm　存活 ${(n * DT).toFixed(2)}s`
  + `　${sim.finished ? '(倒了)' : ''}`);
