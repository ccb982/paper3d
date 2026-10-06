/**
 * ══════════════════════════════════════════════════════════════════
 * probe-lat.ts —— **重心侧移通道的逐帧回读**（用户 2026-10-06 定位的方向）
 * ══════════════════════════════════════════════════════════════════
 *
 * 用户原话：「**是重心无法完成侧移并保持平衡才不能迈步啊**」
 *
 * 本探针回答：从脚→腿→骨盆→重心的**侧向（额状，z 轴）**这条链，卡在哪一环。
 *   A. 目标侧：`drive`/`sup` 侧、`driveMed`/`supMed`（CoP 到脚边界的余量）、门槛
 *   B. 通道：横向驱动有没有发（`hipLatTau`）、`τ=JᵀF` 链条长几节
 *   C. 结果：`CoM.z` 是否真的在动、`CoP z`、双脚载荷、`soleZ`
 *
 * 用法：`node tools/run.mjs probe-lat [秒数] [ABL]`
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
const SECS = Number(ARGS[0] ?? 3);
const ABL = (ARGS[1] ?? '').trim();
const HZ = 60, DT = 1 / HZ, PER = 2, R2D = 57.2958;

log(`══ probe-lat 时长=${SECS}s ${ABL ? `消融[${ABL}]` : ''} ══`);
const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: SECS });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, {
  ...DEFAULT_CONTROLLER,
  gait: { ...DEFAULT_CONTROLLER.gait, startBearer: 'l' },
  balance: { ...DEFAULT_CONTROLLER.balance, ablate: ABL || undefined },
});
const d = sim.doll;

log('  t(s)  状态  支持/摆动  驱动侧 driveMed supMed 门槛  hipLatτ/shiftF/pushτ 链条  | CoM.z  v.z  CoP.z_l  CoP.z_r  载荷l/r  脚CoP有效  髋外展角  躯干roll  腰roll修 侧倾  段数 躯干tilt 躯干方位 最歪段  最歪角');
const rows: string[] = [];
let n = 0, maxComZ = 0, latFired = 0;
for (let i = 0; i < SECS * 120 && !sim.finished; i++) {
  if (i % PER === 0) d.setMotorTargets(ctrl.step(DT));
  sim.advance(1);
  if (i % PER !== 0) continue;
  const rs = ctrl.rs;
  n++;
  maxComZ = Math.max(maxComZ, Math.abs(rs.com.z));
  const gc = rs.groundChain;
  const dl = gc?.l as any; const dr = gc?.r as any;
  if (Math.abs(rs.hipLatTau ?? 0) > 1) latFired++;
  if (i % (PER * 6) !== 0) continue;
  const sup = rs.supportLeg(), sw = rs.swingLeg();
  // 侧向驱动门（与块④ 同式）：CoP 到该脚内侧边界的余量
  const med = (ff: any): number => {
    if (!ff || !ff.copValid) return NaN;
    const inner = ff.copZ > 0 ? ff.latMin : ff.latMax;
    return Math.abs(inner - ff.copZ);
  };
  const drive = rs.shiftDriveSide;
  const jh = rs.sk.joints[drive === 'l' ? 0 : 0];   // 占位（真索引由关节名查）
  void jh;
  rows.push(
    `${(i / 120).toFixed(2).padStart(6)}  ${String(rs.state).padEnd(5)}`
    + `${String(sup ?? '-').padEnd(4)}/${String(sw ?? '-').padEnd(4)}`
    + `${String(drive ?? '-').padEnd(6)}`
    + `${(med(drive === 'l' ? dl : dr)).toFixed(0).padStart(8)}`
    + `${(med(sup === 'l' ? dl : dr)).toFixed(0).padStart(7)}`
    + `${(((DEFAULT_CONTROLLER.balance as any).latShiftCopMargin ?? 0) * 1000).toFixed(0).padStart(5)}`
    + `${(rs.hipLatTau ?? 0).toFixed(0).padStart(8)}`
    + `/${(rs.shiftDemandF ?? 0).toFixed(0).padStart(5)}`
    + `/${(rs.shiftPushTau ?? 0).toFixed(0).padStart(5)}`
    + `${String((rs as any).latChainN ?? '-').padStart(5)}`
    + ` | ${(rs.com.z * 1000).toFixed(0).padStart(6)}`
    + `${(rs.com.vz * 1000).toFixed(0).padStart(5)}`
    + `${((dl?.copZ ?? NaN) * 1000).toFixed(0).padStart(8)}`
    + `${((dr?.copZ ?? NaN) * 1000).toFixed(0).padStart(8)}`
    + `  ${rs.loadFrac.l.toFixed(2)}/${rs.loadFrac.r.toFixed(2)}`
    + `  ${dl?.copValid ? 'L✓' : 'L✗'}${dr?.copValid ? 'R✓' : 'R✗'}`
    + `${(rs.angleOf('hip_l', 0) * R2D).toFixed(1).padStart(9)}`
    + `${(rs.rollDeg ?? 0).toFixed(1).padStart(8)}`
    + `${(rs.trunkRollCmd ?? 0).toFixed(2).padStart(9)}`
    + `${(rs.trunkRollErr ?? 0).toFixed(1).padStart(8)}`
    + `${String(rs.trends.segs.length).padStart(4)}`
    + `${(rs.trends.segs.find((x) => x.name === 'torso')?.tiltDeg ?? -1).toFixed(1).padStart(8)}`
    + `${(rs.trends.segs.find((x) => x.name === 'torso')?.azimDeg ?? -999).toFixed(0).padStart(7)}`
    + `${(rs.trends.worstSeg ?? '-').padEnd(9)}`
    + `${(rs.trends.worstTiltDeg ?? 0).toFixed(1).padStart(7)}`,
  );
}
log(rows.join('\n'));
log(`\n  |CoM.z|max ${(maxComZ * 1000).toFixed(0)}mm　侧移通道出力帧数 ${latFired}/${n}`
  + `　存活 ${(n * DT).toFixed(2)}s${sim.finished ? '（倒了）' : ''}`);
