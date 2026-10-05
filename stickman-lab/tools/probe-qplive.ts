/**
 * probe-qplive.ts —— 全链 QP 在**真实状态**下的读数
 *
 * ★ 这是 QP 第一次接进 balanceSystem 后的验收。`probe-qp` 验的是求解器本身
 *   （数学性质，不依赖仿真）；这里验的是**接线是否正确**：
 *   轴取对了没、力臂算对了没、解有没有真被电机吃掉、可行性如何。
 *
 * 判据：
 *   ① `nAxes` = 承重腿整链 + 腰的轴数（不该是 0 或 1）
 *   ② 残差与 F_des 的关系（不可行时必须如实报 feasible=false）
 *   ③ 解写到哪些轴、量级多少（与该轴的 τmax 比）
 *   ④ 轴归属冲突数必须为 0（否则 QP 被 rigState 拒收 ⇒ 静默失效）
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
const ABLATE = ARGS[0] ?? 'qp';          // 默认把 QP 单独关掉做对照
const DUR = Number(ARGS[1] ?? 8) || 8;
const PHz = DEFAULT_SIM.physicsHz ?? 240;

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: DUR, physicsHz: PHz });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  balance: { ...DEFAULT_BALANCE_PARAMS, ablate: ABLATE },
});
log(`══ QP 接线验收（ablate="${ABLATE}" → ${ABLATE.includes('qp') ? 'QP 关' : 'QP 开'}）══`);
log('   t/s   ξx      ξz    F_des_x  F_des_z  轴数  残差N  可行  冲突  电机实收');
let last: any = null;
for (let f = 0; f < Math.round(DUR * (DEFAULT_SIM.physicsHz ?? 240)); f++) {
  ctrl.step(1 / (DEFAULT_SIM.controlHz ?? 120));
  sim.advance(1);
  const rs: any = (sim as any).rig;
  const q = rs?.qpTick;
  if (!q) continue;
  // ★ ξ 自己算（`RigState` 没有 ξ 字段，只有 com 与 v）—— ξ = com − ẋ/ω₀
  // ★ ξ 由 QP 自己回读（已改为**相对支撑中心**），不要在这里重算
  last = { t: f / PHz, q, rs, xiX: q.xiX, xiZ: q.xiZ };
  // ★ 实测坐标与支撑中心（不推断）—— 用来判断 ref 选对了没
  if (f === 0 || f === PHz) {
    const BB0 = new Float64Array(4);
    ((sim as any).doll as any).footSoleBounds(0, BB0);
    log('  ★ t=' + (f / PHz).toFixed(2)
      + ' com=(' + rs.com.x.toFixed(4) + ', ' + rs.com.y.toFixed(4) + ', ' + rs.com.z.toFixed(4) + ')'
      + '  soleBounds X=[' + BB0[0]!.toFixed(3) + ',' + BB0[1]!.toFixed(3) + ']'
      + ' Z=[' + BB0[2]!.toFixed(3) + ',' + BB0[3]!.toFixed(3) + ']'
      + '  ref=(' + ((BB0[0]! + BB0[1]!) / 2).toFixed(3) + ',' + ((BB0[2]! + BB0[3]!) / 2).toFixed(3) + ')'
      + '  ξ=(' + q.xiX.toFixed(3) + ',' + q.xiZ.toFixed(3) + ')');
  }
  if (f % Math.round((PHz * 0.5)) !== 0) continue;
  // ★ 读 **QP 实际写的那根轴**，而不是固定读踝 —— 我第一版固定读 `foot_l/2`，
  //   而 QP 主要出力在膝/髋/腰，于是看起来"解被丢弃"，其实读错了轴。
  const qq = last.q;
  let bi = -1, bv = 0;
  qq.tau.forEach((v: number, i: number) => { if (Math.abs(v) > Math.abs(bv)) { bv = v; bi = i; } });
  const axName = bi >= 0 ? qq.names[bi]! : '—';
  const qj = sk.joints.findIndex((j) => axName.startsWith(j.name + '/'));
  const qa = bi >= 0 ? Number(axName.split('/')[1]) : 0;
  const tRec = qj >= 0 ? (rs.tauOut?.[qj * 3 + qa] ?? 0) : 0;
  last.axName = axName;
  log('  ' + last.t.toFixed(2).padStart(5)
    + ' ' + last.xiX!.toFixed(3).padStart(8) + ' ' + last.xiZ!.toFixed(3).padStart(7)
    + ' ' + qq.fDesX.toFixed(1).padStart(8) + ' ' + qq.fDesZ.toFixed(1).padStart(7)
    + ' ' + String(qq.nAxes).padStart(4) + ' ' + qq.residual.toFixed(1).padStart(7)
    + '  ' + (qq.feasible ? '✓' : '✗')
    + (qq.grfSat ? ' SAT' : '    ')
    + String(rs.axisConflicts?.length ?? 0).padStart(3)
    + ' ' + axName.padEnd(12)
    + ' QP ' + bv.toFixed(1).padStart(7)
    + '  电机 ' + tRec.toFixed(1).padStart(7));
}
// ★ 与模式无关的结局摘要（两种模式都能读）
{
  const rs: any = (sim as any).rig;
  const head = ((sim as any).doll as any)?.headHitGround?.() ?? false;
  log('  ══ 结局 ══');
  log('   com.y 最终 = ' + rs.com.y.toFixed(4) + '   (初始 0.9623)');
  log('   头碰地 = ' + (head ? '✗ 已碰' : '✓ 未碰')
    + '   finishReason = "' + String((sim as any).finishReason ?? '') + '"');
  log('   com 漂移 = (' + rs.com.x.toFixed(3) + ', ' + rs.com.z.toFixed(3) + ')');
}
if (!last) {
  log('   ★ QP 一次都没被调用（qpTick 始终为 null）');
  log(`     检查：ablate="${ABLATE}" 含 'qp' ⇒ 被关掉（这是预期）`);
  log(`     要开它：ablate 里**不写** 'qp'，或设 balance.qpEnable = true`);
} else {
  const q = last.q;
  log('');
  log('   ① 轴数 = ' + q.nAxes + (q.nAxes >= 6 ? '  ✓ 整链都进了' : '  ✗ 太少，轴没取全'));
  log(`   ② 末拍 F_des=(${q.fDesX.toFixed(1)}, ${q.fDesZ.toFixed(1)})N  残差 ${q.residual.toFixed(2)}N`
    + `  可行=${q.feasible ? '✓' : '✗'}`);
  log('   ③ 各轴解（N·m，括号内是 τmax）:');
  q.tau.forEach((v: number, i: number) => {
    log(`        ${q.names[i]!.padEnd(14)} ${v.toFixed(1).padStart(8)}`);
  });
  // ★ `axisConflicts` 里**没有** QP 的轴（那才是静默失效）。
  //   它记的是其它通道之间的冲突（`against=balance/step`），
  //   而 `rigState` 明确写着“记下来但**不改变行为**”。
  const qpAxes = new Set(q.names.map((n: string) => n));
  const qpConflicts = (last.rs.axisConflicts ?? []).filter((c: any) =>
    qpAxes.has(`${c.joint}/${c.axis}`));
  log(`   ④ 轴冲突共 ${last.rs.axisConflicts?.length ?? 0} 处`
    + `，其中**属于 QP** 的 ${qpConflicts.length} 处`
    + `  ${qpConflicts.length === 0 ? '✓ QP 未被拒收' : '✗ QP 静默失效'}`);
  for (const c of qpConflicts) {
    log(`        ${c.joint}/${c.axis}  mode=${c.mode}  by=${c.by}  against=${c.against}`);
  }
  for (const c of (last.rs.axisConflicts ?? []).slice(0, 12)) {
    log(`        ${c.joint}/${c.axis}  mode=${c.mode}  by=${c.by}  against=${c.against}`);
  }
}
