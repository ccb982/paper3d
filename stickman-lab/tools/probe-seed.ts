// probe-seed —— 只问一件事：相位步态种子在**训练门槛**下为什么判不出有效迈步。
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG } from '../src/core/skeleton';
import { Sim, DEFAULT_SIM } from '../src/core/sim';
import { shapeForJoints } from '../src/core/brain';
import { BEST_PHASE, phaseGenomeFor } from '../src/core/phaseSeed';

const require = createRequire(import.meta.url);
{
  const p = require.resolve('@dimforge/rapier3d/rapier_wasm3d_bg.wasm');
  const compiled = await WebAssembly.compile(fs.readFileSync(p));
  const bg = bgNs as unknown as Record<string, (...a: unknown[]) => unknown>;
  const imports: WebAssembly.Imports = {};
  for (const imp of WebAssembly.Module.imports(compiled)) {
    const f = bg[imp.name];
    if (typeof f === 'function') (imports[imp.module] ??= {})[imp.name] = f;
  }
  const r = (await WebAssembly.instantiate(compiled, imports)) as unknown as
    { instance?: { exports: unknown }; exports?: unknown };
  (bgNs as unknown as { __wbg_set_wasm(v: unknown): void }).__wbg_set_wasm(
    r.instance ? r.instance.exports : r.exports,
  );
}

const sk = buildSkeleton(DEFAULT_CONFIG);
const SHAPE = shapeForJoints(sk.joints.length);
const NAMES: Record<string, string> = {
  switch: '候选落地', noPrev: '无上一只脚', noAlt: '同腿/未换脚', slow: '速度不足',
  notStraight: '不直（侧偏过大）', tooSmall: '位移不够', notYet: '未过所需步长', ok: '★有效迈步',
};
for (const sc of [BEST_PHASE.scale, 0.5, 1.0]) {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk', duration: 6 });
  sim.begin(phaseGenomeFor(sk.joints.length, { ...BEST_PHASE, scale: sc }));
  let g = 0;
  while (g < 8 * DEFAULT_SIM.physicsHz && !sim.finished) g += sim.advance(400);
  const d = sim.stepDiag;
  const s = sim.stepStat;
  console.log(`\n  scale=${sc}  位移=${sim.distance.toFixed(2)}m  倒地=${sim.fallen}  有效迈步=${s.count}`);
  console.log('  门槛拦截: ' + Object.entries(NAMES).map(([k, n]) => `${n}=${d[k as keyof typeof d]}`).join('  '));
  console.log(`  分项: ${JSON.stringify(sim.terms)}`);
}
console.log(`\n  当前门槛: stepMinDx=${DEFAULT_SIM.stepMinDx} stepMinTotal=${DEFAULT_SIM.stepMinTotal}`
  + ` stepMaxDz=${DEFAULT_SIM.stepMaxDz} stepVMin=${DEFAULT_SIM.stepVMin} stepMinGap=${DEFAULT_SIM.stepMinGap}`);
