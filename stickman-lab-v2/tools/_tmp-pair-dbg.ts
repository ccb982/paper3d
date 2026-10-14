/** _tmp-pair-dbg.ts —— 瞬时 pair 内部分解（spine 轴），抬腿窗
 *  用法：node tools/run.mjs _tmp-pair-dbg
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';

const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
w.controller = ctl;
w.reset();
ctl.actions.play('singleLegR');
const W = w.sk.massTotal * 9.81;
const D = (r: number): number => (r * 180) / Math.PI;

let wasLoaded = false; let lifted = -1;
for (let s = 0; s < Math.round(4.5 / w.dt); s++) {
  w.advance(1);
  const fz = ctl.sensors.feet[0]!.fz;
  if (fz > 0.3 * W) wasLoaded = true;
  if (wasLoaded && fz < 0.05 * W) { lifted = s; break; }
}
if (lifted < 0) { console.log('抬腿未发生'); process.exit(0); }
console.log(`抬腿 t=${(lifted * w.dt).toFixed(3)}s`);

const buf: Array<Record<string, number>> = [];
(globalThis as unknown as { __PAIRDBG: Array<Record<string, number>> }).__PAIRDBG = buf;

// 只打印 spine1/0 与 spine2/0
const want = new Set(['spine1', 'spine2'].flatMap((n) => [w.body.dofByName(n, 0)]));
const N = Math.round(0.1 / w.dt);
console.log('t      dof    v     vAvg    dev°    f1     f2     tq    dd     c');
for (let s = 0; s < N; s++) {
  buf.length = 0;
  w.advance(1);
  for (const e of buf) {
    if (!want.has(e.dof!)) continue;
    const nm = e.dof === w.body.dofByName('spine1', 0) ? 'sp1/0' : 'sp2/0';
    console.log(
      `${(s * w.dt).toFixed(3)}  ${nm}  ${e.v!.toFixed(2).padStart(6)} ${e.va!.toFixed(2).padStart(6)} ${D(e.dev!).toFixed(2).padStart(6)}` +
      ` ${e.f1!.toFixed(0).padStart(6)} ${e.f2!.toFixed(0).padStart(6)} ${e.tq!.toFixed(0).padStart(6)} ${e.dd!.toFixed(1).padStart(6)} ${e.c!.toFixed(2)}`,
    );
  }
}
