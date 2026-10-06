/** probe-archpen.ts —— 弓 collider 是否扎进地面（脚弹跳的嫌疑） */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
const require = createRequire(import.meta.url);
const { buildSkeleton, DEFAULT_CONFIG } = await import('../src/core/skeleton');
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
const log = console.log;
const sk = buildSkeleton(DEFAULT_CONFIG);
const bi = (k: string) => sk.bodies.findIndex((b) => b.key === k);
log('══ 弓 collider 离地高度（负 = 扎进地面）══');
for (const side of ['foot_l', 'arch_l']) {
  const b = sk.bodies[bi(side)]!;
  log(`  ${side}  体心 y=${(b.cy * 1000).toFixed(1)}mm`);
  b.colliders.forEach((c, i) => {
    const oy = c.offsetY ?? 0;
    const bottom = oy - c.hy;
    log(`    #${i} ${(c.label ?? '?').padEnd(10)} offsetY=${(oy * 1000).toFixed(1).padStart(7)}`
      + ` hy=${(c.hy * 1000).toFixed(1).padStart(5)}`
      + ` ⇒ 底面体心相对 ${(bottom * 1000).toFixed(1).padStart(7)}mm`
      + `  世界离地 ${((b.cy + bottom) * 1000).toFixed(1).padStart(7)}mm`
      + ` ${b.cy + bottom < -0.0005 ? '★ 扎进地面' : ''}`);
  });
}
