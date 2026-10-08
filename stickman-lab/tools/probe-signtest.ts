/**
 * probe-signtest —— **逐关节单位力矩符号标定**（Featherstone 约定验证 / 伺服"dir"参数同源）
 *
 *   标准做法：只给 ONE 关节注入 +τ_unit，其余全零、控制器不介入 ⇒ 读该关节 Δq 符号。
 *   一次跑完 6 个腿关节（每个独立重建 sim，零污染）。
 *   用法：`node tools/run.mjs probe-signtest`
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';

const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG, jointIndexByName } = await import('../src/core/skeleton');
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

const TAU = 5;   // 单位力矩（N·m）——小到不离位、大到可测
const TARGETS: Array<[string, number]> = [
  ['none', 2],   // 零力矩对照（基线：重力瞬态）
  ['hip_l', 2], ['knee_l', 2], ['foot_l', 2],
  ['hip_r', 2], ['knee_r', 2], ['foot_r', 2],
];
const READ: string[] = ['hip_l', 'knee_l', 'foot_l', 'hip_r', 'knee_r', 'foot_r'];
const buf = new Float64Array(3);

console.log(`══ probe-signtest（+${TAU} N·m 逐关节注入；Δq 单位°）══`);
console.log('        ' + READ.map((n) => n.padStart(8)).join(''));

const SIGN: Record<string, number> = {};
let baseline: number[] | null = null;
for (const [name, ax] of TARGETS) {
  const sk = buildSkeleton(DEFAULT_CONFIG);
  const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: 0.4 });
  sim.begin(new Float32Array(sim.paramCount));
  const d = sim.doll;
  const jT = jointIndexByName(sk, name);
  const tau = new Float64Array(sk.joints.length * 3);
  if (name !== 'none') tau[jT * 3 + ax] = TAU;

  const idx = READ.map((n) => jointIndexByName(sk, n));
  const q0: number[] = [];
  for (const i of idx) { d.jointRot(i, buf); q0.push(buf[2]!); }

  // ★ 瞬时判定：advance(1) 单物理步后读**相对角速度符号**（零积分污染）
  d.setV4Torques(tau);
  sim.advance(1);
  {
    const spd = new Float64Array(3);
    for (let r = 0; r < idx.length; r++) {
      d.jointRelVel(idx[r]!, spd);
      console.log(`   W ${name}->${READ[r]} ${(spd[2]! ).toFixed(5)}`);
    }
  }
  let ownDelta = 0;
  let lastCells: number[] = [];
  for (let k = 0; k < 5; k++) {         // 5 拍 ≈ 0.042s（耦合尚未主导）
    d.setV4Torques(tau);
    sim.advance(2);
    const cells: number[] = [];
    for (let r = 0; r < idx.length; r++) {
      d.jointRot(idx[r]!, buf);
      cells.push((buf[2]! - q0[r]!) * 57.2958);
    }
    if (k === 4) { lastCells = cells; }
    console.log(`${name} t=${((k + 1) / 120).toFixed(3)}`.padEnd(8) + cells.map((v) => v.toFixed(2).padStart(8)).join(''));
  }
  if (name === 'none') { baseline = lastCells.slice(); }
  else if (baseline) {
    const net = lastCells[READ.indexOf(name)]! - baseline[READ.indexOf(name)]!;
    ownDelta = net;
    SIGN[name] = net >= 0 ? +1 : -1;
    console.log(`   → 净值(减基线): ${net.toFixed(2)}°  sign=${SIGN[name]}`);
  }
}

console.log('══ 符号表（+τ → Δq 同号=+1）══');
console.log(JSON.stringify(SIGN));
