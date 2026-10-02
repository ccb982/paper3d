// ★ 腰（脊柱）到底有没有被驱动？（用户 2026-10-02："再去修腰的问题"）
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, spineJointNames, jointIndexByName } from '../src/core/skeleton';
const require = createRequire(import.meta.url);
{ const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const c = await WebAssembly.compile(fs.readFileSync(p));
  const imp: Record<string, Record<string, unknown>> = {};
  for (const i of WebAssembly.Module.imports(c)) { const f = (bgNs as unknown as Record<string, unknown>)[i.name]; if (typeof f === 'function') (imp[i.module] ??= {})[i.name] = f; }
  const r = (await WebAssembly.instantiate(c, imp)) as unknown as { instance?: { exports: unknown }; exports: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(r.instance ? r.instance.exports : r.exports); }

const sk = buildSkeleton({ ...DEFAULT_CONFIG, spineSegments: 4 } as never);
const names = spineJointNames(sk);
console.log('=== 腰（脊柱）关节现状 ===\n');
console.log(`  spineSegments = ${(sk.cfg as { spineSegments: number }).spineSegments}`);
console.log(`  实际存在的脊柱关节：${names.length ? names.join(', ') : '（无）'}`);
console.log(`  旧写法 JOINT_ORDER.indexOf('spine1') = -1 ⇒ setAxis 静默 return ⇒ 腰从未被驱动`);
console.log(`  新写法 jointIndexByName(sk,'spine1') = ${jointIndexByName(sk, 'spine1')}\n`);
console.log('  关节名        索引  父→子            限位轴2(°)         力矩(°)');
for (const n of names) {
  const i = jointIndexByName(sk, n);
  const j = sk.joints[i]!;
  console.log(`  ${n.padEnd(12)} ${String(i).padStart(4)}  ${(j.parentKey + '→' + j.childKey).padEnd(16)}`
    + ` [${(j.minRad[2] * 180 / Math.PI).toFixed(0)}, ${(j.maxRad[2] * 180 / Math.PI).toFixed(0)}]`.padEnd(18)
    + ` ${(j.maxTorque[2]).toFixed(0)}`);
}
console.log(names.length ? '\n  ✓ 腰现在可以被下指令了（teacher 已改用 spineJointNames）' : '\n  ✗ 仍然没有脊柱关节');
