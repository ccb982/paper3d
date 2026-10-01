// probe-seed —— 只问一件事：相位步态种子在**训练门槛**下为什么判不出有效迈步。
import * as bgNs from '@dimforge/rapier3d/rapier_wasm3d_bg.js';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildSkeleton, DEFAULT_CONFIG, JOINT_ORDER } from '../src/core/skeleton';
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
for (const [sc, lp] of [[0.15, 1], [0.15, -1], [0.3, 1], [0.3, -1], [0.5, 1], [0.5, -1]] as [number, number][]) {
  const sim = new Sim(sk, SHAPE, { ...DEFAULT_SIM, mode: 'walk', duration: 6 });
  sim.begin(phaseGenomeFor(sk.joints.length, { ...BEST_PHASE, scale: sc, legPhase: lp }));
  // ★ 逐控制周期采样**实际**关节角 ⇒ 量出"这条腿到底能摆多大幅度"（程序的参考必须是可达的）
  const NAMES2 = ['hip_l', 'hip_r', 'knee_l', 'knee_r'];
  const mn: Record<string, number> = {}, mx: Record<string, number> = {}, sum: Record<string, number> = {}, cnt: Record<string, number> = {};
  for (const n of NAMES2) { mn[n] = 1e9; mx[n] = -1e9; sum[n] = 0; cnt[n] = 0; }
  let g = 0;
  while (g < 8 * DEFAULT_SIM.physicsHz && !sim.finished) {
    g += sim.advance(2);
    for (const n of NAMES2) {
      const i = JOINT_ORDER.indexOf(n);
      const a = (sim as unknown as { x: Float32Array }).x[20 + 3 * i + 2];
      if (a < mn[n]) mn[n] = a; if (a > mx[n]) mx[n] = a;
      sum[n] += a; cnt[n]++;
    }
  }
  const ampOf = (n: string) => ((mx[n] - mn[n]) / 2).toFixed(3);
  const midOf = (n: string) => (sum[n] / Math.max(1, cnt[n])).toFixed(3);
  const d = sim.stepDiag;
  const s = sim.walkStat;
  const T = sim.terms;
  console.log('     全分项: ' + JSON.stringify(T));
  console.log(`\n  scale=${sc} legPhase=${lp}  位移=${sim.distance.toFixed(2)}m 倒地=${sim.fallen} 抬膝高=${T['mv.knee_l']?.toFixed(2)}`
    + `\n     altQ=${(T.altQ ?? 0).toFixed(2)} move=${(T.moveFrac ?? 0).toFixed(2)} task=${(T.task ?? 0).toFixed(2)}`
    + ` jt.hip=${(T['jt.hip_l'] ?? 0).toFixed(2)}/${(T['jt.hip_r'] ?? 0).toFixed(2)}`
    + ` jt.knee=${(T['jt.knee_l'] ?? 0).toFixed(2)}/${(T['jt.knee_r'] ?? 0).toFixed(2)}`
    + ` program=${(T.program ?? 0).toFixed(2)} total=${(T.total ?? 0).toFixed(2)}`
    + `
     抬腿: 同时抬占比=${(T.overlap ?? 0).toFixed(2)} 互斥分=${(T.excl ?? 0).toFixed(2)}`
    + ` 左膝高度=${(T['lift.knee_l'] ?? 0).toFixed(2)} 右膝高度=${(T['lift.knee_r'] ?? 0).toFixed(2)}`
    + `
     实际可达幅度/中值: ` + NAMES2.map((n) => `${n}±${ampOf(n)}@${midOf(n)}`).join('  '));
}
console.log(`\n  当前门槛: stepMinDx=${DEFAULT_SIM.stepMinDx} stepMinTotal=${DEFAULT_SIM.stepMinTotal}`
  + ` stepMaxDz=${DEFAULT_SIM.stepMaxDz} stepVMin=${DEFAULT_SIM.stepVMin} stepMinGap=${DEFAULT_SIM.stepMinGap}`);
