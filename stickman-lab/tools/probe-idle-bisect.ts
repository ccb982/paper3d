/**
 * probe-idle-bisect —— ★ 二分排除：关重力/零τ 下，是谁在注入能量让身体动起来？
 *
 * 已确证事实（probe-idle-drift）：关重力 + 零 τ + 零控制器，静置 1s：
 *   knee_l/2 → −114°、hip_l/0 → −40°、foot_l/1 → 撞限位、torso.y 1.128 → 1.511m
 *   ⇒ 零输入下身体自己加速。能量只能来自：约束求解器 / 限位冲量 / Rapier 马达。
 *
 * 逐个禁用，看漂移量（Σ|Δθ|）如何变化：
 *   base    : 原样
 *   noLimit : 不调 enforceLimits()
 *   noArch  : 弓/中足的 Rapier 马达目标角 = 当前角（不施力）
 *   noGrav0 : 已关重力（本来就是）
 *   noDamp  : KD=0
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

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.V4MODE = '1';

const sk = buildSkeleton(DEFAULT_CONFIG) as any;
const nj = sk.joints.length;
const DEG = 180 / Math.PI;
const rr = new Float64Array(3);

function runCase(label: string, opts: {
  killController?: boolean; kd?: string; rl?: string;
}): void {
  if (opts.kd !== undefined) env.KD = opts.kd; else delete env.KD;
  if (opts.rl !== undefined) env.LREST = opts.rl; else delete env.LREST;

  const sim: any = new Sim(sk, shapeForJoints(nj), { ...DEFAULT_SIM, mode: 'stand', duration: 600 });
  sim.begin(new Float32Array(sim.paramCount));
  const d: any = sim.doll;
  sim.world.gravity = { x: 0, y: 0, z: 0 };
  d.setV4Torques(new Float64Array(nj * 3));

  const a0: number[] = [];
  for (let k = 0; k < nj * 3; k++) { d.jointRot(k / 3 | 0, rr); a0[k] = rr[k % 3]!; }

  const isDying = d.isDying?.() ?? false;
  void isDying;

  for (let f = 0; f < 240; f++) {
    if (opts.killController) {
      // ★ 关控制器：每拍步进后把 v4Tau 清零（Controller 在 controlTick 里写它）
      sim.advance(1);
      d.setV4Torques(new Float64Array(nj * 3));
    } else {
      sim.advance(1);
    }
  }

  let sum = 0, maxv = 0, mxName = '';
  const big: string[] = [];
  for (let ji = 0; ji < nj; ji++) {
    d.jointRot(ji, rr);
    for (let k = 0; k < 3; k++) {
      const dd = (rr[k]! - a0[ji * 3 + k]!) * DEG;
      sum += Math.abs(dd);
      if (Math.abs(dd) > Math.abs(maxv)) { maxv = dd; mxName = `${sk.joints[ji].name}/${k}`; }
      if (Math.abs(dd) > 20) big.push(`${sk.joints[ji].name}/${k}=${dd.toFixed(0)}°`);
    }
  }
  console.log(`${label.padEnd(16)} | Σ|Δθ|=${sum.toFixed(0).padStart(6)}° | max=${maxv.toFixed(1).padStart(7)}° (${mxName}) | y=${d.torso().translation().y.toFixed(3)} | ${big.slice(0, 6).join(' ')}`);
}

console.log('════ 静置漂移二分排除（关重力 / 零τ / 零控制器 / 240拍）════');
console.log('');
runCase('base (带控制器)', {});
runCase('★关控制器', { killController: true });
runCase('关控制器+KD=0', { killController: true, kd: '0' });
runCase('关控制器+LREST=0', { killController: true, rl: '0' });
