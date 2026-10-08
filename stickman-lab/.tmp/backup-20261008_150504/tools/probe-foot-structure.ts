/**
 * probe-foot-structure —— dump：所有刚体 key / collider 形状 / 是否被登记为鞋底 / 实际接触
 *   用法：node tools/run.mjs probe-foot-structure [秒数]
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
for (const i of WebAssembly.Module.imports(c)) { const f = (bg as any)[i.name]; if (typeof f === 'function') (im[i.module] ??= {})[i.name] = f; }
bg.__wbg_set_wasm((await WebAssembly.instantiate(c, im)).exports);
const { Sim, DEFAULT_SIM } = await import('../src/core/sim');
const { Controller, DEFAULT_CONTROLLER } = await import('../src/core/controller');
const { shapeForJoints } = await import('../src/core/brain');
const ARGS = (globalThis as { __PROBE_ARGS?: string[] }).__PROBE_ARGS ?? [];
const T = Number(ARGS[0] ?? 1.5);
const sk = buildSkeleton(DEFAULT_CONFIG);
const sim = new Sim(sk, shapeForJoints(sk.joints.length), { ...DEFAULT_SIM, mode: 'stand', duration: T + 0.3 });
sim.begin(new Float32Array(sim.paramCount));
const d = sim.doll as any;
const ctrl = new Controller(sk, sim, DEFAULT_CONTROLLER);
const DT = 1 / 120;
const log = (s: string) => console.log(s);

// 鞋底 handle 集合
const soleSet = new Map<number, string>();
for (const side of [0, 1] as const) {
  const cols = d.soleCols[side] as any[];
  const lbs = d.soleBlockLabels(side) as string[];
  log(`soleCols[${side}].length = ${cols.length}  标签=[${lbs.join(', ')}]`);
  for (let i = 0; i < cols.length; i++) soleSet.set(cols[i].handle, `脚${side === 0 ? 'L' : 'R'}:${lbs[i]}`);
}
log(`\n── 所有刚体 key / collider 形状 / 是否鞋底 ──`);
for (let bi = 0; bi < d.bodies.length; bi++) {
  const rb = d.bodies[bi];
  const def = sk.bodies[bi] as any;
  const cols = def?.colliders ?? [];
  const shapes = cols.map((cd: any, ci: number) => {
    // 找它的真实 handle：用刚体的 collider 列表
    const rcol = rb.collider?.(ci);
    const h = rcol?.handle;
    const isSole = h !== undefined && soleSet.has(h);
    return `${cd.shape}${isSole ? '★' : ''}`;
  });
  const anySole = shapes.some((s: string) => s.includes('★'));
  const keyRel = /shin_|foot_|forefoot_|arch_|mfoot_|thigh_|pelvis|spine/.test(def?.key ?? '');
  if (keyRel || anySole) log(`  [${String(bi).padStart(2)}] ${String(def?.key).padEnd(14)} ${def?.mass?.toFixed(2) ?? '?'}kg  colliders=[${shapes.join(', ')}]`);
}
// 模拟后 dump 实际接触
for (let k = 0; k <= Math.round(T * 120); k++) { ctrl.step(DT); sim.advance(2); }
log(`\n── t=${T}s 实际有接触冲量的 collider ──`);
for (let bi = 0; bi < d.bodies.length; bi++) {
  const rb = d.bodies[bi];
  const def = sk.bodies[bi] as any;
  const cols = def?.colliders ?? [];
  for (let ci = 0; ci < cols.length; ci++) {
    const rcol = rb.collider?.(ci);
    if (!rcol) continue;
    let sum = 0, nC = 0, nLam = 0;
    d.world.contactPairsWith(rcol, (other: any) => {
      d.world.contactPair(rcol, other, (mf: any) => {
        const nc = mf.numContacts(); nC += nc;
        for (let i = 0; i < nc; i++) { const l = Math.abs(mf.contactImpulse(i)); if (l > 0) { nLam++; sum += l; } }
      });
    });
    if (sum > 1e-4) {
      const tag = soleSet.get(rcol.handle) ?? '（未登记为鞋底）';
      log(`  [${bi}] ${String(def?.key).padEnd(12)} collider#${ci} ${String(cols[ci].shape).padEnd(8)} Σλ=${sum.toFixed(3)} N·s (${(sum * 120).toFixed(0)}N) nC=${nC} 有冲量=${nLam}  ${tag}`);
    }
  }
}
