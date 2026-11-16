/** _tmp-writers.ts —— 全写手 Census（__WRITELOG）：单腿保持窗，逐 dof 列出写手（通道+栈）与量级
 *  用法：node tools/run.mjs _tmp-writers
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { isLiftDone } from '../src/core/servo/supportReg';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const body = w.body;

type Entry = [number, number, string, number, string];
const log: Entry[] = [];
(globalThis as unknown as { __WRITELOG: Entry[] }).__WRITELOG = log;

let tLift = -1, collecting = false, t0 = 0;
const N = Math.round(0.3 / w.dt);
const DOFS = ['foot_r/2', 'foot_r/0', 'foot_r/1', 'knee_r/2', 'hip_r/2', 'hip_r/0', 'spine1/2', 'spine2/0', 'spine3/2'];
const idxOf = new Map<string, number>();
for (const k of DOFS) { const [n, a] = k.split('/'); const i = body.dofByName(n!, Number(a)); if (i >= 0) idxOf.set(k, i); }

for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  w.advance(1);
  const t = s * w.dt;
  if (tLift < 0) { if (isLiftDone()) { tLift = t; } continue; }
  const dtL = t - tLift;
  if (dtL >= 0.3 && !collecting) { collecting = true; t0 = t; log.length = 0; }
  if (collecting && dtL >= 0.3 + N * w.dt) break;
}

console.log(`Census 窗 t=${t0.toFixed(2)}..${(t0 + N * w.dt).toFixed(2)}s 共 ${log.length} 条`);
const byDof = new Map<number, Map<string, { cnt: number; sum: number; mx: number }>>();
const samples = new Map<string, string>();
const callerOf = (st: string): string => {
  const m = /at\s+([^\s(]+)/.exec(st ?? '');
  return m ? m[1]! : '?';
};
for (const e of log) {
  const di = e[1]!;
  if (![...idxOf.values()].includes(di)) continue;
  const kind = e[2]!;
  const v = e[3]!;
  const key = `${kind}@${callerOf(e[4] ?? '')}`;
  samples.set(`${di}|${key}`, (e[4] ?? '').slice(0, 160));
  if (!byDof.has(di)) byDof.set(di, new Map());
  const m = byDof.get(di)!;
  const cur = m.get(key) ?? { cnt: 0, sum: 0, mx: 0 };
  cur.cnt++; cur.sum += Math.abs(v); cur.mx = Math.max(cur.mx, Math.abs(v));
  m.set(key, cur);
}
for (const [name, di] of idxOf) {
  const m = byDof.get(di);
  if (!m) { console.log(`${name.padEnd(9)} : （无记录）`); continue; }
  const rows = [...m.entries()].map(([k, v]) => `${k}: n=${v.cnt} |均|=${(v.sum / v.cnt).toFixed(1)} max=${v.mx.toFixed(1)}`);
  console.log(`${name.padEnd(9)} : ${rows.join('  ||  ')}`);
}

