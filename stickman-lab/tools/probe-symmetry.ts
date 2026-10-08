/**
 * probe-symmetry —— ★ 左右对称性 + 关节力矩回读（用户令 2026-10-16）
 *
 * 用户："迈步系统关了之后，理论上就完全对称了" ⇒ 左右同名轴读数应逐位接近。
 *       "你还得回读关节力矩，特别是腰的力矩"。
 *
 * 本探针做两件事：
 *   ① **对称性**：关重力/零τ/零控制器，静置后逐对比较 L/R 同名轴（角度 + 角速度），
 *      并给出**最大不对称量**。迈步系统已关 ⇒ 任何显著不对称都是 bug。
 *   ② **力矩回读**：逐关节打印 3 轴的 `tauApplied`（实际下发）与 `motorDemand`（想要），
 *      腰部（spine1/2/3）单列，并给出"腰的力矩链"（谁给腰施加了力矩）。
 *
 * 用法：node tools/run.mjs probe-symmetry [frames]
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
await import('../src/core/ragdoll');
const bg = bgNs as any;
const p: string = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
const c = await WebAssembly.compile(fs.readFileSync(p));
const im: any = {};
for (const i of WebAssembly.Module.imports(c)) {
  const impl = (bg as any)[i.name];
  if (typeof impl === 'function') (im[i.module] ??= {})[i.name] = impl;
}
bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');

const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const FRAMES = Number(ARGS[0] ?? 120);
const GRAV = ARGS[1] !== 'off';   // 默认开重力（看真实站桩）；传 off 关重力

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.V4MODE = '1';

const sk = buildSkeleton(DEFAULT_CONFIG) as any;
const sim: any = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 600 });
sim.begin(new Float32Array(sim.paramCount));
const d: any = sim.doll;
if (!GRAV) sim.world.gravity = { x: 0, y: 0, z: 0 };
d.setV4Torques(new Float64Array(sk.joints.length * 3));

const nj = sk.joints.length;
const rr = new Float64Array(3);
const DEG = 180 / Math.PI;

console.log(`════ ① 左右对称性检验（重力=${GRAV ? 'ON' : 'OFF'} · 零τ · 零控制器 · ${FRAMES} 拍）════`);
console.log('');

for (let f = 0; f < FRAMES; f++) sim.advance(1);

// 关节名 → 索引
const byName = new Map<string, number>();
sk.joints.forEach((j: any, i: number) => byName.set(j.name, i));

// 左右配对
const pairs: [string, string][] = [];
for (const j of sk.joints) {
  const m = /^(.*)_l$/.exec(j.name);
  if (m && byName.has(m[1] + '_r')) pairs.push([j.name, m[1] + '_r']);
}

console.log('配对         | 轴 |   L角(°)    R角(°)  | asym角(°) |   Lω       Rω     | asym ω');
let worst = { label: '', a: 0, w: 0 };
for (const [ln, rn] of pairs) {
  const li = byName.get(ln)!, ri = byName.get(rn)!;
  const la = new Float64Array(3), ra = new Float64Array(3);
  d.jointRot(li, la); d.jointRot(ri, ra);
  const lw = new Float64Array(3), rw = new Float64Array(3);
  d.jointRelVel(li, lw); d.jointRelVel(ri, rw);
  for (let k = 0; k < 3; k++) {
    // 镜像轴：X(外展) 左右反号，Y(扭转) 反号，Z(屈伸) 同号
    const mirror = k === 2 ? 1 : -1;
    const da = (la[k] - mirror * ra[k]) * DEG;
    const dw = lw[k] - mirror * rw[k];
    const flag = Math.abs(da) > 2 || Math.abs(dw) > 1 ? '  ← 不对称!' : '';
    if (Math.abs(da) > Math.abs(worst.a)) worst = { label: `${ln}/${k} 角`, a: da, w: dw };
    console.log(
      `${ln.padEnd(11)} | ${k}  | ${(la[k]*DEG).toFixed(2).padStart(8)} ${(ra[k]*DEG).toFixed(2).padStart(8)} | ` +
      `${da.toFixed(2).padStart(9)} | ${lw[k].toFixed(3).padStart(7)} ${rw[k].toFixed(3).padStart(7)} | ${dw.toFixed(3).padStart(7)}${flag}`,
    );
  }
}
console.log('');
console.log(`最大不对称：${worst.label} = ${worst.a.toFixed(2)}°`);
console.log('');

// ══════════════════════════════════════════════════════════════
console.log(`════ ② 关节力矩回读（applied=实际下发 / demand=被护栏削之前）════`);
console.log('');
console.log('joint/ax      |    τmax |  applied |  demand | authority | branch');
const spineIdx: number[] = [];
for (let i = 0; i < nj; i++) {
  const j = sk.joints[i];
  for (let k = 0; k < 3; k++) {
    const idx = i * 3 + k;
    const app = d.tauApplied?.[idx] ?? NaN;
    const dem = d.motorDemand?.[idx] ?? NaN;
    const auth = d.motorAuthority?.[idx] ?? NaN;
    const br = d.motorBranch?.[idx] ?? -1;
    if (/^spine/.test(j.name)) spineIdx.push(idx);
    const flag = Math.abs(app) > 1e-6 ? '' : (Math.abs(dem) > 1e-6 ? '  ← 有需求没下发!' : '');
    console.log(
      `${(j.name + '/' + k).padEnd(13)} | ${String(j.maxTorque[k]).padStart(7)} | ${app.toFixed(3).padStart(8)} | ${dem.toFixed(3).padStart(7)} | ` +
      `${(Number.isFinite(auth) ? (auth * 100).toFixed(1) + '%' : 'n/a').padStart(9)} | ${br}${flag}`,
    );
  }
}

// 腰部专项
console.log('');
console.log('──── 腰部（spine1/2/3）专项 ────');
let anySpine = false;
for (let i = 0; i < nj; i++) {
  const j = sk.joints[i];
  if (!/^spine/.test(j.name)) continue;
  for (let k = 0; k < 3; k++) {
    const idx = i * 3 + k;
    const app = d.tauApplied?.[idx] ?? 0;
    const dem = d.motorDemand?.[idx] ?? 0;
    if (Math.abs(app) > 1e-6 || Math.abs(dem) > 1e-6) anySpine = true;
    console.log(`  ${(j.name + '/' + k).padEnd(11)} applied=${app.toFixed(4).padStart(9)}  demand=${dem.toFixed(4).padStart(9)}  τmax=${j.maxTorque[k]}`);
  }
}
if (!anySpine) console.log('  ⚠ 腰部全部力矩 = 0（零命令下确实该为 0；但注入命令时必须有值 —— 见 probe-joint-survey spine 段）');

console.log('');
console.log(`躯干高度 torso.y = ${d.torso().translation().y.toFixed(4)} m`);
console.log(`脚底 soleY(l)=${d.soleY('l').toFixed(4)}  soleY(r)=${d.soleY('r').toFixed(4)}`);
