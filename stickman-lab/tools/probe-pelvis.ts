/**
 * ★ 骨盆/腰执行器权限体检（用户 2026-10-03："是盆骨不能发力，让上半身支撑起来"）
 *
 * 这是一个**静力学**问题，可以直接算，不需要跑控制律：
 *   对每根脊柱关节 j：
 *     · 需求 = 它**上方**所有刚体的重力对该关节的力矩 `Σ mᵢ·g·x_offset`
 *     · 权限 = 该轴的力矩上限
 *     · 裕度 = 权限 / 需求
 *
 * ★ 为什么这个测法是对的：脊柱是**链**，所以"上方"是明确定义的
 *   （沿 parent→child 方向走到底）。若某根关节的裕度 < 1，
 *   那它**物理上撑不住上半身**，任何控制器都救不了 —— 必须改硬件
 *   （加执行器 / 改质量分布 / 加骨盆自由度），不是调增益。
 *
 * 反过来裕度 ≫ 1 ⇒ 撑得住，问题在控制律。
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
  const bg = bgNs as Record<string, (...a: unknown[]) => unknown>;
  const im: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) { const f = bg[i.name]; if (typeof f !== 'function') throw new Error(i.name); (im[i.module] ??= {})[i.name] = f; }
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
}

const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { shapeForJoints } = await import('../src/core/brain');
const { newCom, readCom } = await import('../src/core/posture');

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const G = 9.81;
const log = console.log;

// ── 找根（parent 没有关节的那个刚体）
const childKeys = new Set(sk.joints.map((j) => j.childKey));
const rootKey = sk.bodies.find((b) => !childKeys.has(b.key))?.key ?? 'torso';
log('══ 骨盆 / 腰 执行器权限体检（静力学）══');
log(`  刚体 ${sk.bodies.length}  关节 ${sk.joints.length}  树根 = ${rootKey}`);

// ── 每个刚体的父刚体（沿关节链）
const parentOf = new Map<string, string>();
for (const j of sk.joints) parentOf.set(j.childKey, j.parentKey);

/** 某刚体的"上方"集合 = 沿 parent 链往上走时，j 的 child 那一侧的全部刚体 */
function aboveOf(jname: string): string[] {
  const j = sk.joints.find((x) => x.name === jname);
  if (!j) return [];
  const out = new Set<string>();
  const stack = [j.childKey];
  while (stack.length) {
    const k = stack.pop()!;
    if (out.has(k)) continue;
    out.add(k);
    for (const jj of sk.joints) if (jj.parentKey === k && !out.has(jj.childKey)) stack.push(jj.childKey);
  }
  return [...out];
}

const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'stand', duration: 2, driver: 'controller' });
sim.begin(new Float32Array(sim.params.length));
for (let i = 0; i < 240; i++) sim.advance(1);   // 静置 2 s

const AX = ['轴0 内外旋', '轴1 外展/侧倾', '轴2 屈伸'];
const SPINES = sk.joints.filter((j) => /^spine\d+$/.test(j.name) || j.name === 'neck');

log('');
log('  关节      上方质量kg  上方质心偏移(m)   重力力矩需求(N·m)     τmax(0/1/2)          裕度(轴2)');
log('  ' + '─'.repeat(96));

let worst = 99, worstName = '';
for (const j of SPINES) {
  const above = aboveOf(j.name);
  let m = 0, mx = 0, my = 0, mz = 0;
  const jbuf = new Float64Array(3);
  sim.doll.jointWorld(jointIndexByName(sk, j.name), jbuf);
  const jp: readonly number[] = jbuf;
  for (const k of above) {
    const b = sim.doll.bodies[sim.doll.indexByKey.get(k) ?? 0]!;
    const t = b.translation();
    const bm = b.mass();
    m += bm; mx += bm * t.x; my += bm * t.y; mz += bm * t.z;
  }
  if (m <= 0) { log(`  ${j.name.padEnd(10)} （上方没有刚体）`); continue; }
  const cx = mx / m - jp[0]!, cy = my / m - jp[1]!, cz = mz / m - jp[2]!;
  // 重力 (0,-mg,0) 作用在质心 ⇒ 对该点的力矩 = r × F
  // τ = r × F，F = (0, −m·g, 0) ⇒ τ = (−r_z·m·g, 0, r_x·m·g)
  const tX2 = -cz * m * G;
  const tY2 = 0;
  void cy;
  const need = Math.hypot(tX2, tY2);
  const tau = j.maxTorque;
  const margin = tau[2] / Math.max(1e-6, need);
  if (margin < worst) { worst = margin; worstName = j.name; }
  log(`  ${j.name.padEnd(10)} ${m.toFixed(1).padStart(9)}  x=${cx.toFixed(3)} z=${cz.toFixed(3)}`
    + `   ${need.toFixed(1).padStart(14)}   ${tau[0]!.toFixed(0)}/${tau[1]!.toFixed(0)}/${tau[2]!.toFixed(0)}`
    + `   ${margin >= 99 ? '∞' : margin.toFixed(2).padStart(8)}`);
}

log('');
log(`  最紧的一根：${worstName}   裕度 = ${worst >= 99 ? '∞' : worst.toFixed(2)}`);
log('');
if (worst < 1) {
  log(`  ✗✗ **有脊柱关节的权限 < 需求** ⇒ 骨盆/腰物理上撑不住上半身。`);
  log(`     这不是控制器问题。修法（按性价比）：`);
  log(`       ① 提高 SPINE_TAU（当前 ${sk.joints.find((j) => /^spine/.test(j.name))?.maxTorque[2]} N·m）`);
  log(`       ② 给骨盆单独的转动自由度（本 rig 的 torso 兼作骨盆，49.7% 质量都在它上面）`);
  log(`       ③ 减小上方质量分布（把质量从远离关节处挪近）`);
} else {
  log(`  ✓ 权限 > 需求 ⇒ 骨盆/腰**撑得住**上半身。撑不住的原因是控制律，不是硬件。`);
}
const com = newCom();
readCom(sim.doll, com);
log(`  （静置 2s 后 CoM y = ${com.y.toFixed(3)} m）`);