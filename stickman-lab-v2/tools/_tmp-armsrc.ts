/** _tmp-armsrc: 判定 supportClean 的 ARM_AXES 块在**站立**和**蹲姿**下分别走哪个分支。
 *
 *  判据（不需要改 src）：
 *    死代码那段（第 268 行，几何俯仰）如果跑起来，dev = pitch − 0.65rad ≈ ±0.5~0.9
 *    ⇒ tau = kpNorm·dev ≈ 数百 N·m，会被 clamp 到 ±tauMax（脊柱 ≈ 200）= **顶格**。
 *    活着的站立分支用 kpNorm + dev=关节角误差（很小） ⇒ 输出是**几十到一百多**，不顶格。
 *    蹲姿分支用 kp = I·4.5 ⇒ 输出 **< 1 N·m**。
 *  所以：看 spine1/2 的 tau 量级就能区分三个分支。
 */
import './_boot';
import { World } from '../src/core/world';
import { ControlModule } from '../src/core/control';
import { supportClean } from '../src/core/servo/supportClean';
import { baseState } from '../src/core/servo/baseTable';

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
Math.random = mulberry32(101);
const w = new World();
const ctl = new ControlModule(w, { postureTone: 8 });
const ctx = { sensors: ctl.sensors, bal: ctl.warner, body: w.body };
(globalThis as { __PRED_OFF_RT?: boolean }).__PRED_OFF_RT = true;
w.controller = ctl;
w.reset();
ctl.actions.idleEnabled = true;

const WATCH: Array<[string, number]> = [
  ['spine1', 2], ['spine2', 2], ['spine3', 2], ['neck', 2],
  ['shoulder_l', 2], ['elbow_l', 2],
];
const idx = new Map<number, string>();
for (const [n, ax] of WATCH) {
  const i = w.body.dofByName(n, ax);
  if (i >= 0) idx.set(i, `${n}/${ax}`);
}
const g = globalThis as { __PROPLOG?: Array<[number, string, number, string]> };
const pitchNow = (): number => {
  const i = w.body.indexByKey.get('spine4') ?? w.body.indexByKey.get('spine3')!;
  const q = w.body.bodies[i]!.rotation();
  const ux = 2 * (q.x * q.y - q.w * q.z);
  const uy = 1 - 2 * (q.x * q.x + q.z * q.z);
  return Math.atan2(ux, uy);
};
let dumped = false;
for (let s = 0; s < Math.round(6.0 / w.dt); s++) {
  // 站立 6s（idle 保持）；第 4s 抓一帧
  if (!dumped && s * w.dt >= 4.0) g.__PROPLOG = [];
  supportClean(ctx, 'r');
  supportClean(ctx, 'l');
  w.advance(1);
  if (!dumped && s * w.dt >= 4.0) {
    dumped = true;
    const log = g.__PROPLOG ?? [];
    console.log(`[state] ${baseState()}  spine3 世界 pitch=${(pitchNow() * 57.3).toFixed(1)}°  死代码判据: 若 tau≈±τmax 则 268 行在跑`);
    const seen = new Map<string, { tau: number; n: number }>();
    for (const [dof, kind, param, src] of log) {
      const nm = idx.get(dof);
      if (!nm) continue;
      const k = `${nm}|${src}|${kind}`;
      const cur = seen.get(k);
      if (cur) { cur.tau = param; cur.n++; } else seen.set(k, { tau: param, n: 1 });
    }
    for (const [k, v] of seen) {
      const [nm, src, kind] = k.split('|') as [string, string, string];
      const di = w.body.dofByName(nm.split('/')[0]!, Number(nm.split('/')[1]));
      const d = di >= 0 ? w.body.dofs[di]! : null;
      const ang = d ? (d.angle * 57.3).toFixed(1) : '-';
      const app = di >= 0 ? w.body.executor.appliedOf(di).toFixed(1) : '-';
      const param = kind === 'pair' ? 'ref' : `tau=${v.tau.toFixed(1)}`;
      console.log(`  ${nm.padEnd(12)} ${src.padEnd(22)} ${kind.padEnd(8)} ${param.padEnd(12)} ang=${ang}° applied=${app}${v.n > 1 ? ` ×${v.n}` : ''}`);
    }
    g.__PROPLOG = undefined;
  }
}
