/**
 * probe-bounce.ts —— 「脚上下弹」的归因与控制频率敏感性
 *
 * 判据（都按后 2/3 采样，跳过落地瞬态）：
 *   · 自相关主周期 → 频率。**等于控制频率 = 控制环极限环**；等于 1~3Hz = 物理振荡。
 *   · 帧间最大位移 → 折算成加速度 (2πf)²·x。若≫g（9.8），说明是数值激励而非物理。
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
const log = console.log;
const PHz = DEFAULT_SIM.physicsHz ?? 120;
const DTms = 1000 / PHz;

/** 跑一次站立，返回弓角/足体/躯干的高度序列 */
function run(ctlHz: number, alpha: number, N = 360, limpAt = -1, gapMm = NaN, noLim = false): Record<string, number[]> {
  const cfg = { ...DEFAULT_CONFIG };
  if (Number.isFinite(gapMm)) cfg.soleBlockGap = gapMm / 1000;
  const sk = buildSkeleton(cfg);
  const SHAPE = shapeForJoints(sk.joints.length);
  const sim = new Sim(sk, SHAPE, {
    ...DEFAULT_SIM, mode: 'stand', controlHz: ctlHz,
    // ★ motorAlpha = 稳定性护栏的每步可吃掉额（显式 P 控制稳定需 α < 2）。
    doll: { ...(DEFAULT_SIM.doll ?? {}), motorAlpha: alpha },
  });
  sim.begin(new Float32Array(sim.paramCount));
  const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
  const d = sim.doll;
  const bi = (k: string) => d.sk.bodies.findIndex((b) => b.key === k);
  const iF = bi('foot_l'), iA = bi('arch_l'), iT = bi('torso');
  const ja = jointIndexByName(sk, 'arch_l');
  const S = { arch: [] as number[], footY: [] as number[], torsoY: [] as number[],
              gnd: [] as number[] };
  for (let f = 0; f < N; f++) {
    if (f === limpAt) { d.setLimp(true); }
    if (noLim) (d as unknown as { skipLimits: boolean }).skipLimits = true;
    sim.motor.set(ctrl.step(1 / ctlHz));
    sim.advance(1);
    S.arch.push(d.jointAngle(ja));
    S.footY.push(d.bodies[iF]!.translation().y);
    S.torsoY.push(d.bodies[iT]!.translation().y);
    // ★ 逐帧接地数：若在 1/0 之间每帧切换 → 周期-2 的真正来源是接触打滑
    S.gnd.push((d.footGrounded(0) ? 1 : 0) + (d.footGrounded(1) ? 1 : 0));
  }
  return S;
}

/**
 * 自相关主周期（帧）—— **必须先去趋势**。
 *
 * ⚠⚠ 我第一版直接对原始序列做自相关，得出「60Hz / Nyquist / 周期-2」的结论 ——
 *   那是**测量假象**：躯干 y 在 3 秒里从 825mm 单调掉到 190mm，斜坡信号在
 *   小 lag 上的自相关天然接近 1，于是 lag=2 永远"最相关"，r=1.00。
 *   ⇒ 任何"下降/上升趋势"都会被我读成"最高频振荡"。
 *   修法：减掉**移动平均**（周期取窗口的 1/4，确保比要测的周期长），
 *   彻底去掉趋势后再自相关。
 */
function detrend(sig: number[], win: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < sig.length; i++) {
    const a = Math.max(0, i - (win >> 1)), b = Math.min(sig.length, i + (win >> 1));
    let m = 0; for (let k = a; k < b; k++) m += sig[k]!;
    out.push(sig[i]! - m / (b - a));
  }
  return out;
}
function acPeriod(raw: number[], maxLag = 60): { lag: number; r: number } {
  const sig = detrend(raw, 41);
  const c = sig.map((v) => v - (sig.reduce((a, b) => a + b, 0) / sig.length));
  let best = { lag: 0, r: -2 };
  for (let lag = 2; lag <= maxLag && lag < c.length - 2; lag++) {
    let num = 0, d1 = 0, d2 = 0;
    for (let i = 0; i + lag < c.length; i++) {
      num += c[i]! * c[i + lag]!; d1 += c[i]! * c[i]!; d2 += c[i + lag]! * c[i + lag]!;
    }
    const r = d1 > 1e-18 && d2 > 1e-18 ? num / Math.sqrt(d1 * d2) : 0;
    if (r > best.r) best = { lag, r };
  }
  return best;
}
function swing(sig: number[], from: number): number {
  let m = 0;
  for (let i = from + 1; i < sig.length; i++) m = Math.max(m, Math.abs(sig[i]! - sig[i - 1]!));
  return m;
}

log(`\u2550\u2550 \u300c\u811a\u4e0a\u4e0b\u5f39\u300d\u5f52\u56e0\u00b7\u63a7\u5236\u9891\u7387\u654f\u611f\u6027 \u2550\u2550`);
log(`   physics=${PHz}Hz  dt=${DTms.toFixed(2)}ms  control=60Hz`);
log('');
log('   controlHz  阶段   弓角峰   足体帧间   躯干帧间   主周期    频率     折算��速度');
log('');
for (const a of [1.0, 0.1]) {
  const S = run(60, a);
  const H = Math.floor(S.torsoY.length / 3);
  log(`   α=${a}  逐帧接地数: ${S.gnd.slice(H, H + 24).join('')}`);
}
log('');
log('   验证：前 120 帧平稳后毛软（所有马达归零），看振动是否消失');
for (const [tag, la] of [['常规', -1], ['验证前', 120]] as const) {
  const S = run(60, 1.0, 360, la);
  const H = 180;
  const hp = swing(detrend(S.torsoY.slice(H), 41), 0) * 1000;
  const { lag, r } = acPeriod(S.torsoY.slice(H));
  log(`   ${tag}: 去趋势帧间 ${hp.toFixed(1)}mm  主周期 ${lag}帧  r=${r.toFixed(2)}`
    + `  ${hp < 2 ? '✓ 振动消失 => 是马达造成' : '✗ 仍在 => 是基础物理/缩放'}`);
}
log('');
log('   每帧冲量层候选项（都不受 limp 影响）');
for (const [tag, nl] of [['常规', false], ['关闭 enforceLimits', true]] as const) {
  const S = run(60, 1.0, 360, -1, NaN, nl);
  const H = 180;
  const hp = swing(detrend(S.torsoY.slice(H), 41), 0) * 1000;
  const { lag, r } = acPeriod(S.torsoY.slice(H));
  log(`   ${tag}: 去趋势帧间 ${hp.toFixed(1).padStart(6)}mm  主周期 ${String(lag).padStart(2)}帧  r=${r.toFixed(2)}`
    + `  ${hp < 4 ? '✓ 振动消失' : '✗ 仍在'}`);
}
log('');
log('   弓膙 scan: 块间记缝对 60Hz 周期-2 振动的影响');
for (const g of [NaN, 1.5, 4, 10]) {
  const S = run(60, 1.0, 360, -1, g);
  const H = 180;
  const hp = swing(detrend(S.torsoY.slice(H), 41), 0) * 1000;
  const { lag, r } = acPeriod(S.torsoY.slice(H));
  log(`   gap=${Number.isFinite(g) ? (g + 'mm').padEnd(7) : ('默认'.padEnd(7))}`
    + ` 去趋势帧间 ${hp.toFixed(1).padStart(6)}mm  主周期 ${String(lag).padStart(2)}帧  r=${r.toFixed(2)}`
    + `  ${hp < 4 ? '✓ 振动几乎消失' : '✗ 仍在'}`);
}
log('');
for (const a of [1.0, 0.6, 0.35, 0.2, 0.1]) {
  const S = run(60, a);
  const H = Math.floor(S.torsoY.length / 3);
  const aPk = Math.max(...S.arch.slice(H).map(Math.abs)) * 57.3;
  const fy = swing(S.footY, H);
  const ty = swing(S.torsoY, H);
  const { lag, r } = acPeriod(S.torsoY.slice(H));
  const hp = swing(detrend(S.torsoY.slice(H), 41), 0) * 1000;
  const hz = 1000 / (lag * DTms);
  const acc = (2 * Math.PI * hz) ** 2 * fy;
  log(`   ${a.toFixed(2).padStart(6)}`
    + `  ${aPk.toFixed(2).padStart(6)}°`
    + ` ${(fy * 1000).toFixed(1).padStart(9)}mm`
    + ` ${(ty * 1000).toFixed(1).padStart(9)}mm`
    + `  ${String(lag).padStart(3)}帧`
    + ` ${hz.toFixed(1).padStart(6)}Hz`
    + `  ${(acc / 9.81).toFixed(0).padStart(6)}g`
    + `  去趋势帧间${hp.toFixed(1).padStart(6)}mm`
    + `  ${r > 0.8 ? `✗ 周期-${lag} 振动 r=${r.toFixed(2)}` : `✓ 无规律振动 r=${r.toFixed(2)}`}`);
}
