/**
 * probe-no-ground —— ★ 决定性实验：把地面移走，零重力/零τ 下还漂不漂？
 *
 * 已知：关重力 + 零 τ + 零控制器，静置 1s 仍漂 454°（knee_l/2 弯 −114°），
 *       且 torso.y 上升 383mm（"被顶起来"的样子）。
 * 已排除：限位冲量 / 阻尼 / 弓马达 / 控制器 / 锚点不自洽 / 病态刚体。
 *
 * 剩余唯一能量源 = **接触求解器**（地面穿透恢复 / 接触刚度）。
 * 本探针：把地面刚体整体下移 10 m（= 无接触），看漂移是否消失。
 *
 * 用法：node tools/run.mjs probe-no-ground
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
const MODE = ARGS[0] ?? 'noground';   // noground | asis | gravon

const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
env.V4MODE = '1';

const sk = buildSkeleton(DEFAULT_CONFIG) as any;
const nj = sk.joints.length;
const DEG = 180 / Math.PI;
const rr = new Float64Array(3);

const sim: any = new Sim(sk, shapeForJoints(nj), { ...DEFAULT_SIM, mode: 'stand', duration: 600 });
sim.begin(new Float32Array(sim.paramCount));
const d: any = sim.doll;

if (MODE === 'noground') {
  sim.world.gravity = { x: 0, y: 0, z: 0 };
  // ★ Rapier 的 `world.bodies` 不是可迭代对象 ⇒ 用 collider 遍历找地面（fixed + 在 y≈0）
  let moved = 0;
  const nc = sim.world.numColliders?.() ?? 0;
  for (let i = 0; i < nc; i++) {
    const col = sim.world.getCollider?.(i);
    const rb = col?.parent?.();
    if (!rb) continue;
    if (typeof rb.isFixed === 'function' && rb.isFixed()) {
      const t = rb.translation();
      if (Math.abs(t.y) < 0.01) { rb.setTranslation({ x: 0, y: -10, z: 0 }, true); moved++; }
    }
  }
  console.log(`[地面下移] 移动的 fixed 刚体数=${moved}（colliders=${nc}）`);
} else {
  sim.world.gravity = { x: 0, y: 0, z: 0 };
}
d.setV4Torques(new Float64Array(nj * 3));

const a0: number[] = [];
for (let k = 0; k < nj * 3; k++) { d.jointRot(k / 3 | 0, rr); a0[k] = rr[k % 3]!; }
const y0 = d.torso().translation().y;

for (let f = 0; f < 240; f++) sim.advance(1);

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
console.log(`[${MODE}] Σ|Δθ|=${sum.toFixed(0)}°  max=${maxv.toFixed(1)}° (${mxName})  torso.y ${y0.toFixed(3)}→${d.torso().translation().y.toFixed(3)} m`);
if (big.length) console.log(`  大漂移：${big.slice(0, 8).join(' ')}`);
