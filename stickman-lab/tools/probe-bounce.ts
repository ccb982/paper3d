/** probe-bounce.ts —— 「脚上下弹」的**归因**：弓角 / 足体 / 全身，谁在弹 */
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
const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand' });
sim.begin(new Float32Array(sim.paramCount));
const ctrl = new Controller(sk, sim, { ...DEFAULT_CONTROLLER });
const doll = sim.doll;
const bi = (k: string) => doll.sk.bodies.findIndex((b) => b.key === k);
const iFoot = bi('foot_l'), iArch = bi('arch_l'), iShin = bi('shin_l'), iTorso = bi('torso');
const ja = jointIndexByName(sk, 'arch_l');

const N = 360;   // 3 秒，要够分辨 60Hz 控制环与物理振动（≈0.83s）：再往后角色已摔倒，
                    //   躺平后位移恒 0，统计出来全是 0.00 会掩盖真正的抖动
const series = { arch: [] as number[], footY: [] as number[], shinY: [] as number[], torsoY: [] as number[] };
for (let f = 0; f < N; f++) {
  sim.motor.set(ctrl.step(1 / (DEFAULT_SIM.controlHz ?? 60)));
  sim.advance(1);
  series.arch.push(doll.jointAngle(ja));
  series.footY.push(doll.bodies[iFoot]!.translation().y);
  series.shinY.push(doll.bodies[iShin]!.translation().y);
  series.torsoY.push(doll.bodies[iTorso]!.translation().y);
}
// 只统计后半段（跳过落地瞬态）
const H = 60;   // 跳过落地瞬态
const stat = (a: number[], scale = 1, unit = '') => {
  const v = a.slice(H);
  const mean = v.reduce((x, y) => x + y, 0) / v.length;
  let sw = 0;
  for (let i = 1; i < v.length; i++) sw = Math.max(sw, Math.abs(v[i] - v[i - 1]));
  const sd = Math.sqrt(v.reduce((x, y) => x + (y - mean) ** 2, 0) / v.length);
  return `均值 ${(mean * scale).toFixed(2)}${unit}  标准差 ${(sd * scale).toFixed(2)}${unit}  帧间最大 ${(sw * scale).toFixed(3)}${unit}`;
};
log('\u2550\u2550 \u300c\u811a\u4e0a\u4e0b\u5f39\u300d\u5f52\u56e0 \u2550\u2550   (dt=1/120s, 后 240 帧)');
log(`   弓角        ${stat(series.arch, 57.3, '\u00b0')}`);
log(`   足体高 y    ${stat(series.footY, 1000, 'mm')}`);
log(`   小腿高 y    ${stat(series.shinY, 1000, 'mm')}`);
log(`   躯干高 y    ${stat(series.torsoY, 1000, 'mm')}`);
// 弓相对足体的角位移（去掉整体姿态）—— 若这一项远小于弓角，说明弹的是足体不是弓
const rel = series.arch.map((a, i) => a);
log('');
log(`   判读：弓角与足体高度**同相**⇒ 弓在把整个足体顶起来（弓-地反作用）`);
log(`         弓角幅值 >> 足体幅值 ⇒ 弓在限位间甩，撞限位产生冲击`);
// ★ 是不是 Rapier 休眠了（刚体全睡 ⇒ 位移恒 0，看不出抖）
let awake = 0, sleeping = 0;
for (const b of doll.bodies) { if (b.isSleeping()) sleeping++; else awake++; }
let vMax = 0;
for (const b of doll.bodies) {
  const v = b.linvel();
  vMax = Math.max(vMax, Math.hypot(v.x, v.y, v.z));
}
log(`   足体下标 bi('foot_l')=${bi('foot_l')} iArch=${iArch} iShin=${iShin} iTorso=${iTorso}  bodies=${doll.bodies.length}`);
log(`   原始序列 footY[0..8]=${series.footY.slice(0, 9).map((v) => (v * 1000).toFixed(2)).join(',')}`);
log(`   原始序列 torsoY[0..8]=${series.torsoY.slice(0, 9).map((v) => (v * 1000).toFixed(2)).join(',')}`);
log(`   原始序列 arch[0..8]=${series.arch.slice(0, 9).map((v) => (v * 57.3).toFixed(2)).join(',')}`);
log(`   刚体 清醒 ${awake} / 休眠 ${sleeping}   最大线速度 ${vMax.toFixed(4)} m/s`);
log(`   ${awake === 0 ? '⚠ 全部休眠（低事件）：上面的 0.00 意味着没动，不是真稳' : ''}`);
// 弓角峰值对应的足体最低点
let aPk = 0, yPk = 0, aAtYmin = 0;
for (let i = H; i < N; i++) {
  if (Math.abs(series.arch[i]!) > Math.abs(aPk)) aPk = series.arch[i]!;
  if (series.footY[i]! < yPk) yPk = series.footY[i]!;
}
for (let i = H; i < N; i++) if (series.footY[i]! === yPk) aAtYmin = series.arch[i]!;
log(`   弓角峰值 ${(aPk * 57.3).toFixed(2)}°  足体最低 ${(yPk * 1000).toFixed(1)}mm  彩降到最低时弓角 = ${(aAtYmin * 57.3).toFixed(2)}°`);
// 弓角与足体高度的相关（同相：弓在顶足体）
let cov = 0;
const ma = series.arch.slice(H), my = series.footY.slice(H);
const am = ma.reduce((a, b) => a + b, 0) / ma.length;
const ym = my.reduce((a, b) => a + b, 0) / my.length;
let sa = 0, sy = 0, sc = 0;
for (let i = 0; i < ma.length; i++) { const da = ma[i]! - am, dy = my[i]! - ym; sa += da * da; sy += dy * dy; sc += da * dy; }
cov = sa > 1e-12 && sy > 1e-12 ? sc / Math.sqrt(sa * sy) : NaN;
log(`   相关系数 弓角~足体高 = ${cov.toFixed(3)}`
  + `  ${cov > 0.5 ? '✓ 弓在顶足体 = 上下跳的归因' : '✗ 弓角与跳动无关'}`);
// 弓角持续偏转幅度（软弹精的特征：长期偏罬而非挤二边抖动）
const aMean = am * 57.3;
log(`   弓角均值 ${aMean.toFixed(2)}°`
  + `  ${Math.abs(aMean) > 1 ? '✗ 长期偏罬=' + Math.abs(aMean).toFixed(1) + '° → 软弹精在承重' : '✓ 无长期偏罬'}`);
// ★ 主频：自相关函数。60Hz = 控制环限环（30 帧一周期），
//   低频 = 物理振动。用自相关而不用 FFT（算法简单且不会漂移）。
const sig = series.footY.slice(H);
const m0 = sig.reduce((a, b) => a + b, 0) / sig.length;
const c0 = sig.map((v) => v - m0);
let bestLag = 0, bestR = -2;
const rAt = (lag: number): number => {
  let num = 0, d1 = 0, d2 = 0;
  for (let i = 0; i + lag < c0.length; i++) {
    num += c0[i]! * c0[i + lag]!;
    d1 += c0[i]! * c0[i]!; d2 += c0[i + lag]! * c0[i + lag]!;
  }
  return d1 > 1e-18 && d2 > 1e-18 ? num / Math.sqrt(d1 * d2) : 0;
};
for (let lag = 2; lag <= 60; lag++) { const r = rAt(lag); if (r > bestR) { bestR = r; bestLag = lag; } }
const hz = (1 / DEFAULT_SIM.physicsHz!) * 1000 / 1000;
log(`   自相关主周期 = ${bestLag} 帧 = ${(bestLag * 8.333).toFixed(1)} ms`
  + `  频率 ${(1000 / (bestLag * 8.333)).toFixed(1)} Hz   r=${bestR.toFixed(3)}`);
log(`   控制频率 ${DEFAULT_SIM.controlHz} Hz = ${(DEFAULT_SIM.physicsHz! / DEFAULT_SIM.controlHz!).toFixed(0)} 物理帧/控制帧`
  + `  ${bestLag === DEFAULT_SIM.physicsHz! / DEFAULT_SIM.controlHz! ? '✗ 正好是控制环限环' : ''}`);
// 帧间步长模式：奇偶交替 = 控制帧限环
let alt = 0;
for (let i = 1; i < sig.length; i++) if (Math.abs(sig[i]! - sig[i - 1]!) > 1e-9) alt++;
log(`   有变化的帧比例 ${(alt / sig.length * 100).toFixed(0)}%`
  + `  ${alt / sig.length > 0.9 ? '✗ 每帧都动 = 控制环限环' : '✓ 有一段完全不动(达制动位)'}`);
// 弓角态参数
let atLim = 0;
for (let i = H; i < N; i++) {
  const d = series.arch[i]! * 57.3;
  if (Math.abs(d - sk.joints[ja].minRad[0] * 57.3) < 0.2 ||
      Math.abs(d - sk.joints[ja].maxRad[0] * 57.3) < 0.2) atLim++;
}
log(`   弓贴限位帧数 ${atLim}/${N - H} (${(atLim / (N - H) * 100).toFixed(0)}%)`
  + `  ${atLim > (N - H) * 0.15 ? '\u2717 \u6301\u7eed\u649e\u9650\u4f4d = \u5f39\u6027\u6765\u6e90' : '\u2713'}`);
