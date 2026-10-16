/** _tmp-hipwho.ts —— 法庭场景：hip_r/0 全部写手（提案总线 + 手动设角调用栈） */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { courtSetup, courtInject } from '../src/core/court';
const w = new World();
const ctl = new ControlModule(w, { postureTone: 0 });
w.controller = ctl;
w.reset();
const st = courtSetup(w, ctl, 2.0);
type Entry = [number, number, string, number, string];
const log: Entry[] = [];
(globalThis as unknown as { __WRITELOG: Entry[] }).__WRITELOG = log;
const plog: Array<[number, string, number, string]> = [];
(globalThis as unknown as { __PROPLOG: Array<[number, string, number, string]> }).__PROPLOG = plog;
for (let s = 0; s < 480; s++) { courtInject(w, ctl); w.advance(1); }
void st;
const di = w.body.dofByName('hip_r', 0);
const ents = plog.filter((e) => e[0] === di);
const kinds = new Map<string, number>();
for (const e of ents) { const k = `${e[1]}@${e[3]}`; kinds.set(k, (kinds.get(k) ?? 0) + 1); }
console.log(`hip_r/0 提案 ${ents.length} 条:`);
for (const [k, n] of kinds) console.log(`  ${k} × ${n}`);
const es = log.filter((e) => e[1] === di && e[2] === 'a-set');
console.log(`hip_r/0 a-set ${es.length} 条；前 2 条:`);
for (const e of es.slice(0, 2)) console.log(`  rad=${e[3]} :: ${e[4].split('|').slice(0, 3).join(' | ')}`);
console.log(`最终：模式=${ctl.warner.supportState.mode} 应用=${w.executor.appliedOf(di).toFixed(1)}`);
