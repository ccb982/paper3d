/** _tmp-axisowner: 蹲姿下**每个 DoF 的写手归属表**
 *
 *  目的：新写手（髋策略）必须与现有回正力写手**不同轴**，否则就是"同轴两套定律"对拉
 *        （supportClean.ts:268-276 记的病根）。
 *
 *  做法：跑一帧真实蹲姿，遍历所有 proposalBus 提案，按 dof 统计 src（写手）。
 */
import './_env-main';
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { squatCourtSetup, squatFrame, type CourtState } from '../src/core/servo/squat';
import { supportClean } from '../src/core/servo/supportClean';
import { PROPOSALS } from '../src/core/proposalBus';

(globalThis as { process?: { env?: Record<string, string> } }).process!.env;
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
ctl.actions.idleEnabled = false;
w.controller = ctl;
w.reset();
const court = squatCourtSetup(w, ctl, 2.0) as CourtState;
const body = w.body;

// 采样：释放后连续若干帧，统计每个 dof 的写手组合
const owners = new Map<string, Map<string, number>>();
for (let s = 0; s < Math.round(3.5 / w.dt); s++) {
  supportClean(ctx, 'r'); supportClean(ctx, 'l');
  // 捕获这一帧的提案（在仲裁前）
  const snapshot = PROPOSALS.map((p) => ({ dof: p.dof, src: p.src ?? '?', kind: p.kind, ch: p.channel ?? '-' }));
  w.advance(1);
  squatFrame(w, ctl, court);
  if (court.t < 2.1) continue;
  for (const p of snapshot) {
    const d = body.dofs[p.dof];
    if (!d) continue;
    const key = `${d.name}/${d.axis}`;
    let m = owners.get(key);
    if (!m) { m = new Map(); owners.set(key, m); }
    const k = `${p.src}[${p.kind}:${p.ch}]`;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
}

console.log('\n════ 蹲姿（释放后）每轴的写手归属 ════');
console.log('DoF            | 写手（src[kind:channel]  帧数）');
const rows: string[] = [];
for (const [key, m] of [...owners.entries()].sort()) {
  const parts = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`);
  rows.push(`${key.padEnd(14)} | ${parts.join('  ')}`);
}
console.log(rows.join('\n'));

console.log('\n════ 冲突判定（同 dof 多个 active 写手）════');
for (const [key, m] of [...owners.entries()].sort()) {
  const kinds = [...m.keys()].map((k) => k.split('[')[0]);
  const uniq = [...new Set(kinds)];
  if (uniq.length > 1) {
    console.log(`  ⚠ ${key}: ${uniq.join(' + ')}`);
  }
}

console.log('\n════ 拟用新写手（squatHipStrategy）的候选轴现状 ════');
for (const key of ['hip_l/0', 'hip_r/0', 'hip_l/1', 'hip_r/1', 'knee_l/0', 'foot_l/0']) {
  const m = owners.get(key);
  console.log(`  ${key.padEnd(10)}: ${m ? [...m.keys()].join(', ') : '（无写手）'}`);
}
